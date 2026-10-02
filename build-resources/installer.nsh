; CoPanel - NSIS tweaks.
;
; electron-builder's assisted installer shows the "Install for all users / Only
; for me" page whenever the build is not a forced per-machine install. CoPanel is
; a per-user app (installs under %LOCALAPPDATA%\Programs, no admin prompt), so the
; page is pointless - forcing the current-user mode makes the template skip it.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
