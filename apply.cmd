@echo off
rem (重新)给 ZCode 客户端应用聊天壁纸背景。
rem ZCode 自动更新后 app.asar 会被替换,再跑一次本脚本即可重新生效。
node "%~dp0asar-extract.js"
node "%~dp0patch-index.js"
node "%~dp0asar-patch-inplace.js"
echo 完成。重启 ZCode 后生效。
pause
