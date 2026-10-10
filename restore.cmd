@echo off
rem Restore ZCode to the pristine state (undo the wallpaper injection).
rem 两种注入形态都能恢复:
rem   ① 原位补丁(asar 备份存在时):从 ~/.we-wallpaper/asar-backup 恢复原始字节
rem   ② 影子目录(resources\app 存在时):删除即可
set "ROOT=%~dp0"
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
if exist "%ROOT%restore-asar.js" "%NODE%" "%ROOT%restore-asar.js"
set "ZCODE_DIR=%LOCALAPPDATA%\Programs\ZCode"
if exist "%ZCODE_DIR%\resources\app" (
  rmdir /s /q "%ZCODE_DIR%\resources\app"
  echo 影子目录已删除。
)
echo 恢复完成。重启 ZCode 即为原生界面。
pause
