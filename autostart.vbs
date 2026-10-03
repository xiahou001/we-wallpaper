' we-wallpaper 开机自启:登录后隐藏窗口运行壁纸服务器
' 把本文件放入 shell:startup 文件夹(或创建计划任务),由 Windows 登录时执行
' 采用相对自身位置的路径,克隆仓库后无需修改
Dim fso, scriptDir
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "node """ & scriptDir & "\server.mjs""", 0, False
