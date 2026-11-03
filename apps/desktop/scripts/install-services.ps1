#Requires -RunAsAdministrator
<#
  PharmaCore post-install: PostgreSQL cluster + two Windows services + first-run .env.
  Called by the NSIS installer hook with -InstallDir "<Program Files>\PharmaCore".
  Idempotent: safe to re-run (upgrade path keeps pgdata and .env).
#>
param([Parameter(Mandatory)][string]$InstallDir, [int]$PgPort = 5433, [int]$ApiPort = 3100)
$ErrorActionPreference = "Stop"
$Data = Join-Path $env:ProgramData "PharmaCore"
$PgData = Join-Path $Data "pgdata"; $Logs = Join-Path $Data "logs"; $Backups = Join-Path $Data "backups"
New-Item -ItemType Directory -Force -Path $Data, $PgData, $Logs, $Backups | Out-Null

# 1) PostgreSQL binaries (zip extracted by installer to $InstallDir\pgsql\pgsql → flatten)
$PgBin = Join-Path $InstallDir "pgsql\bin"
if (-not (Test-Path $PgBin)) {
  $zip = Get-ChildItem -Path (Join-Path $InstallDir "resources") -Filter "postgresql-*-binaries.zip" | Select-Object -First 1
  if (-not $zip) { throw "PostgreSQL zip not found in resources" }
  Expand-Archive -Path $zip.FullName -DestinationPath (Join-Path $InstallDir "pgsql_tmp") -Force
  Move-Item -Path (Join-Path $InstallDir "pgsql_tmp\pgsql") -Destination (Join-Path $InstallDir "pgsql") -Force
  Remove-Item -Recurse -Force (Join-Path $InstallDir "pgsql_tmp")
}

# 2) Cluster (first install only). Password stored only in .env (ACL: Administrators + SYSTEM).
$EnvFile = Join-Path $Data ".env"
function New-Secret([int]$bytes) { $b = New-Object byte[] $bytes; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_') }
if (-not (Test-Path $EnvFile)) {
  $pgPass = New-Secret 24; $jwt = New-Secret 48
  $pwFile = Join-Path $env:TEMP "pc-pgpw.txt"; Set-Content -Path $pwFile -Value $pgPass -NoNewline -Encoding ascii
  & "$PgBin\initdb.exe" -D $PgData -U pharmacore --pwfile=$pwFile -E UTF8 --locale=C --auth-local=scram-sha-256 --auth-host=scram-sha-256 | Out-File (Join-Path $Logs "initdb.log")
  Remove-Item $pwFile -Force
  Add-Content -Path (Join-Path $PgData "postgresql.conf") -Value "`nport = $PgPort`nlisten_addresses = '127.0.0.1'`nmax_connections = 50`nshared_buffers = 256MB`nlog_directory = '$($Logs.Replace('\','/'))'`nlogging_collector = on`n"
  @"
NODE_ENV=production
HOST=127.0.0.1
PORT=$ApiPort
DATABASE_URL=postgres://pharmacore:$pgPass@127.0.0.1:$PgPort/pharmacore
JWT_SECRET=$jwt
AUTO_MIGRATE=true
ENABLE_DOCS=true
STATIC_DIR=$InstallDir\web
BACKUP_DIR=$Backups
BACKUP_KEEP=30
# DEMO_MODE=true  # trial boxes only: seeds users 1/1 (owner) and 2/2 (cashier) + quick-login buttons. Never for a real pharmacy.
"@ | Set-Content -Path $EnvFile -Encoding utf8
  $acl = Get-Acl $EnvFile; $acl.SetAccessRuleProtection($true, $false)
  foreach ($id in @("BUILTIN\Administrators", "NT AUTHORITY\SYSTEM")) { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($id, "FullControl", "Allow"))) }
  Set-Acl $EnvFile $acl
}

# 3) PostgreSQL service
if (-not (Get-Service PharmaCorePG -ErrorAction SilentlyContinue)) {
  & "$PgBin\pg_ctl.exe" register -N PharmaCorePG -D $PgData -S auto -w | Out-Null
}
Start-Service PharmaCorePG
# wait for readiness, create database
$ready = $false; for ($i = 0; $i -lt 30 -and -not $ready; $i++) { Start-Sleep 1; & "$PgBin\pg_isready.exe" -h 127.0.0.1 -p $PgPort | Out-Null; $ready = ($LASTEXITCODE -eq 0) }
if (-not $ready) { throw "PostgreSQL did not become ready" }
$envMap = @{}; Get-Content $EnvFile | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $envMap[$matches[1]] = $matches[2] } }
$env:PGPASSWORD = ([uri]$envMap["DATABASE_URL"]).UserInfo.Split(':')[1]
$exists = & "$PgBin\psql.exe" -h 127.0.0.1 -p $PgPort -U pharmacore -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='pharmacore'"
if ($exists -ne "1") { & "$PgBin\psql.exe" -h 127.0.0.1 -p $PgPort -U pharmacore -d postgres -c "CREATE DATABASE pharmacore" | Out-Null }
Remove-Item Env:PGPASSWORD

# 4) API service via WinSW (loads .env, logs to %ProgramData%\PharmaCore\logs)
$winsw = Join-Path $InstallDir "PharmaCoreAPI.exe"
Copy-Item (Join-Path $InstallDir "resources\winsw.exe") $winsw -Force
$envXml = ($envMap.GetEnumerator() | ForEach-Object { "    <env name=`"$($_.Key)`" value=`"$([System.Security.SecurityElement]::Escape($_.Value))`"/>" }) -join "`n"
@"
<service>
  <id>PharmaCoreAPI</id>
  <name>PharmaCore API</name>
  <description>PharmaCore pharmacy management — API and web UI</description>
  <executable>$InstallDir\pharmacore-api.exe</executable>
  <workingdirectory>$InstallDir</workingdirectory>
  <env name="NODE_PATH" value="$InstallDir\node_modules"/>
$envXml
  <logpath>$Logs</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>
  <onfailure action="restart" delay="5 sec"/>
  <depend>PharmaCorePG</depend>
  <startmode>Automatic</startmode>
</service>
"@ | Set-Content -Path (Join-Path $InstallDir "PharmaCoreAPI.xml") -Encoding utf8
if (Get-Service PharmaCoreAPI -ErrorAction SilentlyContinue) { & $winsw restart | Out-Null } else { & $winsw install | Out-Null; & $winsw start | Out-Null }

# 5) Firewall rule for LAN mode (disabled by default; enabled from Settings → Network)
if (-not (Get-NetFirewallRule -DisplayName "PharmaCore API" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "PharmaCore API" -Direction Inbound -Protocol TCP -LocalPort $ApiPort -Action Allow -Profile Private -Enabled False | Out-Null
}

# 6) Nightly backup task (03:00) using the API's backup endpoint via a local helper script
$task = Join-Path $InstallDir "scripts\backup-task.ps1"
if (Test-Path $task) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$task`""
  $trigger = New-ScheduledTaskTrigger -Daily -At 3am
  Register-ScheduledTask -TaskName "PharmaCore Nightly Backup" -Action $action -Trigger $trigger -RunLevel Highest -User "SYSTEM" -Force | Out-Null
}
Write-Host "PharmaCore services installed. API: http://127.0.0.1:$ApiPort"
