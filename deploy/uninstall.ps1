# 卸载 AirMic（Windows PowerShell）：.\deploy\uninstall.ps1 --yes
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $scriptDir "airmic-cli.mjs") uninstall @args
exit $LASTEXITCODE
