' Workbench launcher - ASCII only on purpose (avoids codepage issues).
' Usage:  double click          -> start service + tray icon + open browser
'         wscript ... /silent   -> start service + tray icon only (used by autostart)

Dim sh, fso, root, a, extra
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

extra = ""
For Each a In WScript.Arguments
  If LCase(a) = "/silent" Or LCase(a) = "-silent" Then
    extra = extra & " -Silent"
  Else
    extra = extra & " " & a
  End If
Next

sh.CurrentDirectory = root
sh.Run "powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File """ & root & "\tray.ps1""" & extra, 0, False
