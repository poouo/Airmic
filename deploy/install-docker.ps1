# 一键 Docker 部署（Windows PowerShell）：.\deploy\install-docker.ps1 --yes
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $scriptDir "airmic-cli.mjs") install --mode docker @args
exit $LASTEXITCODE
