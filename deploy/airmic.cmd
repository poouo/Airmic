@echo off
rem AirMic 部署 CLI 的 Windows 命令行包装脚本
rem 优先使用安装目录内的 Node（<安装目录>\.runtime），其次使用系统 Node
setlocal DisableDelayedExpansion
set "SCRIPT_DIR=%~dp0"
set "NODE_BIN="
if not defined NODE_BIN for /d %%D in ("%SCRIPT_DIR%..\.runtime\node-*") do if exist "%%D\node.exe" set "NODE_BIN=%%D\node.exe"
if not defined NODE_BIN for %%I in (node.exe) do set "NODE_BIN=%%~$PATH:I"
if not defined NODE_BIN (
  echo [AirMic] Node.js not found. Run install.ps1 or install Node.js 22.13+. 1>&2
  exit /b 1
)
"%NODE_BIN%" "%SCRIPT_DIR%airmic-cli.mjs" %*
exit /b %ERRORLEVEL%
