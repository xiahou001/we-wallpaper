@echo off
rem Apply the wallpaper loader to ZCode Desktop.
rem 稳定性说明:本脚本只做 app.asar 的「等长原位补丁」(自动备份原始字节),
rem 不再创建 resources/app 影子目录 —— 影子目录会在 ZCode 更新后造成新旧错配。
rem 若脚本检测到旧的影子目录,会提示你确认后删除(需先关闭 ZCode)。
set "ROOT=%~dp0"
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%ROOT%asar-patch-inplace.js"
if errorlevel 1 exit /b 1
if exist "%LOCALAPPDATA%\Programs\ZCode\resources\app" (
  echo.
  echo 检测到旧的影子目录 resources\app,正在删除(它会在更新后导致新旧错配)…
  rmdir /s /q "%LOCALAPPDATA%\Programs\ZCode\resources\app" 2>nul
  if exist "%LOCALAPPDATA%\Programs\ZCode\resources\app" (
    echo 删除失败:请完全关闭 ZCode 后重新运行本脚本。
  ) else (
    echo 影子目录已删除。
  )
)
echo 完成。重启 ZCode 后生效。
exit /b 0
