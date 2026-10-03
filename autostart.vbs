' Start the wallpaper server before ZCode, then apply the loader before launching ZCode.
' This file stays in the repository; install-autostart.vbs creates a Startup shortcut to it.
Dim fso, shell, projectDir, nodeExe, command, zcodeExe
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"
zcodeExe = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\ZCode\ZCode.exe"
If Not fso.FileExists(zcodeExe) Then zcodeExe = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\ZCode\ZCode.exe"

Function Q(ByVal value)
  Q = Chr(34) & value & Chr(34)
End Function

Function ServerReady()
  On Error Resume Next
  Dim req
  Set req = CreateObject("WinHttp.WinHttpRequest.5.1")
  req.SetTimeouts 800, 800, 800, 800
  req.Open "GET", "http://127.0.0.1:7396/api/state", False
  req.Send
  ServerReady = (Err.Number = 0 And req.Status = 200)
  Err.Clear
  On Error GoTo 0
End Function

Function ZCodeRunning()
  On Error Resume Next
  Dim svc, procs
  Set svc = GetObject("winmgmts:\\.\root\cimv2")
  Set procs = svc.ExecQuery("Select ProcessId from Win32_Process where Name='ZCode.exe'")
  ZCodeRunning = (procs.Count > 0)
  Err.Clear
  On Error GoTo 0
End Function

shell.CurrentDirectory = projectDir
If Not ServerReady() Then
  command = Q(nodeExe) & " " & Q(projectDir & "\server.mjs")
  shell.Run command, 0, False
  For i = 1 To 20
    If ServerReady() Then Exit For
    WScript.Sleep 500
  Next
End If

' Do not touch a running client. On a fresh login, patch first and launch once.
If Not ZCodeRunning() Then
  shell.Run Q(projectDir & "\apply.cmd"), 0, True
  If fso.FileExists(zcodeExe) Then shell.Run Q(zcodeExe), 0, False
End If
