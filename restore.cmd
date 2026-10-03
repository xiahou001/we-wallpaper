@echo off
rem 一键恢复:删除 resources/app 目录,ZCode 回到原生 app.asar(重启 ZCode 生效)
rem 说明:壁纸注入完全在 resources/app 目录里,原 app.asar 从未被改动。
set "ZCODE_DIR=%LOCALAPPDATA%\Programs\ZCode"
if defined ZCODE_DIR_OVERRIDE set "ZCODE_DIR=%ZCODE_DIR_OVERRIDE%"
if exist "%ZCODE_DIR%\resources\app" (
  rmdir /s /q "%ZCODE_DIR%\resources\app"
  echo 已恢复。重启 ZCode 即为原生界面。
) else (
  echo resources\app 不存在,无需恢复。
)
pause
