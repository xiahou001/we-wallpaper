@echo off
rem Apply the wallpaper loader before ZCode starts.
set "ROOT=%~dp0"
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%ROOT%asar-extract.js"
if errorlevel 1 exit /b 1
"%NODE%" "%ROOT%patch-index.js"
if errorlevel 1 exit /b 1
"%NODE%" "%ROOT%asar-patch-inplace.js"
exit /b %errorlevel%
