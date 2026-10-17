@echo off
rem KKnD Battle wallpaper setup: finds your own KKnD files and builds the wallpaper on this PC.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\setup.ps1" %*
