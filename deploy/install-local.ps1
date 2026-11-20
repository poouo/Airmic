# 一键本地部署（Windows PowerShell）：.\deploy\install-local.ps1 --yes
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $scriptDir "airmic-cli.mjs") install --mode local @args
exit $LASTEXITCODE
