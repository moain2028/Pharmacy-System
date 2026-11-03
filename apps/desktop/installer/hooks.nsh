; PharmaCore NSIS hooks — run service installer after files are copied; remove services on uninstall.
!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Installing PharmaCore services (PostgreSQL + API)…"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\install-services.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "تعذّر تثبيت الخدمات (رمز $0). راجع %ProgramData%\PharmaCore\logs.$\r$\nService installation failed (code $0). See %ProgramData%\PharmaCore\logs."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping PharmaCore services…"
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\uninstall-services.ps1" -InstallDir "$INSTDIR"'
  Pop $0
!macroend
