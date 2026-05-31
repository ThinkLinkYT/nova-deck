@echo off
set "APP_DIR=%~dp0."
start "" "%~dp0.vendor\electron\electron.exe" "%APP_DIR%"
