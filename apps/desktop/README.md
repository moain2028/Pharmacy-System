# PharmaCore Desktop (Windows)

Single-machine deployment for a pharmacy: **one installer** that ships

| Component | How |
|---|---|
| PostgreSQL 16 (portable zip, EDB build) | extracted to `%ProgramFiles%\PharmaCore\pgsql`, data in `%ProgramData%\PharmaCore\pgdata`, registered as Windows service `PharmaCorePG` on `127.0.0.1:5433` |
| API + Web (Node 22 single executable) | `pharmacore-api.exe` built with Node SEA from `apps/api/dist` + `apps/web/dist`, registered as Windows service `PharmaCoreAPI` (via WinSW) on `127.0.0.1:3100`, serves the SPA |
| Shell window | Tauri 2 app `PharmaCore.exe` that opens `http://127.0.0.1:3100`, waits for health, shows a splash while services start, exposes "Backup now", "Open data folder", "Logs" in the tray menu |
| Backups | `BACKUP_DIR=%ProgramData%\PharmaCore\backups`, nightly task via Windows Task Scheduler calling `POST /api/v1/backup` with a service token |

## Build (on Windows, PowerShell, as Administrator for the installer test)

```powershell
pnpm install
pnpm -w build                      # domain, db, api (dist), web (dist)
pnpm --filter @pharmacore/desktop sea        # → apps/desktop/src-tauri/sidecar/pharmacore-api-x86_64-pc-windows-msvc.exe
pnpm --filter @pharmacore/desktop fetch:pg   # downloads PostgreSQL 16 portable zip + WinSW into src-tauri/resources
pnpm --filter @pharmacore/desktop tauri build # → src-tauri/target/release/bundle/nsis/PharmaCore_<ver>_x64-setup.exe
```

The NSIS hook `installer/hooks.nsh` runs `scripts/install-services.ps1` after files are copied (initdb, service registration, firewall rule for LAN access, first-run `.env` with a random `JWT_SECRET`) and `scripts/uninstall-services.ps1` on uninstall (keeps data unless `/PURGE`).

## Runtime layout
```
%ProgramFiles%\PharmaCore\
  PharmaCore.exe            Tauri shell
  pharmacore-api.exe        API + web (Node SEA)
  pgsql\                    PostgreSQL binaries
  winsw.exe, PharmaCoreAPI.xml
%ProgramData%\PharmaCore\
  .env                      DATABASE_URL, JWT_SECRET, PORT, BACKUP_DIR, STATIC_DIR
  pgdata\                   database cluster
  backups\                  pg_dump files + .meta.json
  logs\                     api.log, pg.log, winsw logs
```

## LAN mode (second POS / manager laptop)
Set `HOST=0.0.0.0` in `.env`, restart `PharmaCoreAPI`, open `http://<server-ip>:3100` from any browser on the LAN. The firewall rule is created by the installer but disabled by default; enable it in Settings → Network.
