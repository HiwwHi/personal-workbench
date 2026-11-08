@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 转发给无黑框的 VBS 启动器：后台起服务 + 托盘图标
wscript.exe "%~dp0start-workbench.vbs"
