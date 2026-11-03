# Nightly pg_dump without going through the HTTP API (no token needed; runs as SYSTEM).
$Data = Join-Path $env:ProgramData "PharmaCore"; $envMap = @{}
Get-Content (Join-Path $Data ".env") | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $envMap[$matches[1]] = $matches[2] } }
$u = [uri]$envMap["DATABASE_URL"]; $env:PGPASSWORD = $u.UserInfo.Split(':')[1]
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"; $file = Join-Path $envMap["BACKUP_DIR"] "pharmacore-$stamp.dump"
& "$PSScriptRoot\..\pgsql\bin\pg_dump.exe" -h $u.Host -p $u.Port -U $u.UserInfo.Split(':')[0] -d $u.AbsolutePath.TrimStart('/') --format=custom --no-owner --no-privileges --file $file
$sha = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
@{ fileName = (Split-Path $file -Leaf); sizeBytes = (Get-Item $file).Length; createdAt = (Get-Date).ToUniversalTime().ToString("o"); sha256 = $sha; note = "nightly" } | ConvertTo-Json -Compress | Set-Content "$file.meta.json"
Get-ChildItem $envMap["BACKUP_DIR"] -Filter "*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip ([int]($envMap["BACKUP_KEEP"] ?? 30)) | ForEach-Object { Remove-Item $_.FullName -Force; Remove-Item "$($_.FullName).meta.json" -Force -ErrorAction SilentlyContinue }
