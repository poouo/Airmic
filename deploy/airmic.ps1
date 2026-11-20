# AirMic 部署 CLI 的 PowerShell 包装脚本（Windows PowerShell 5.1+ / PowerShell 7+）
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $scriptDir "airmic-cli.mjs") @args
exit $LASTEXITCODE
