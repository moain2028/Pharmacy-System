#Requires -RunAsAdministrator
param([Parameter(Mandatory)][string]$InstallDir, [switch]$Purge)
$ErrorActionPreference = "SilentlyContinue"
Unregister-ScheduledTask -TaskName "PharmaCore Nightly Backup" -Confirm:$false
$winsw = Join-Path $InstallDir "PharmaCoreAPI.exe"; if (Test-Path $winsw) { & $winsw stop; & $winsw uninstall }
Stop-Service PharmaCorePG -Force
& (Join-Path $InstallDir "pgsql\bin\pg_ctl.exe") unregister -N PharmaCorePG
Remove-NetFirewallRule -DisplayName "PharmaCore API"
if ($Purge) { Remove-Item -Recurse -Force (Join-Path $env:ProgramData "PharmaCore") }
