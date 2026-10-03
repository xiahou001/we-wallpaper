' Install a Startup shortcut that points back to this repository.
Dim fso, shell, root, startup, target, shortcut
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
startup = shell.ExpandEnvironmentStrings("%APPDATA%") & "\Microsoft\Windows\Start Menu\Programs\Startup"
If Not fso.FolderExists(startup) Then fso.CreateFolder(startup)
target = startup & "\we-wallpaper-autostart.lnk"
If fso.FileExists(startup & "\we-wallpaper-autostart.vbs") Then fso.DeleteFile startup & "\we-wallpaper-autostart.vbs", True
Set shortcut = shell.CreateShortcut(target)
shortcut.TargetPath = WScript.FullName
shortcut.Arguments = Chr(34) & root & "\autostart.vbs" & Chr(34)
shortcut.WorkingDirectory = root
shortcut.Description = "Start we-wallpaper and ZCode with the wallpaper loader"
shortcut.Save
WScript.Echo "Installed: " & target
