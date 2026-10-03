@echo off
rem we-wallpaper 启动器:起服务器并打开默认浏览器全屏播放
start "" http://127.0.0.1:7396/
node "%~dp0server.mjs"
