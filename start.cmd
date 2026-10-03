@echo off
set "ROOT=%~dp0"
start "" /min "%ProgramFiles%\nodejs\node.exe" "%ROOT%server.mjs"
powershell -NoProfile -Command "Start-Sleep -Seconds 2"
start "" http://127.0.0.1:7396/
