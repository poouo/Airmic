@echo off
rem AirMic deployment CLI wrapper for Windows Command Prompt
node "%~dp0airmic-cli.mjs" %*
exit /b %ERRORLEVEL%
