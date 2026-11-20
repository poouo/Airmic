# OTA 升级（Windows PowerShell）：.\deploy\upgrade.ps1
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $scriptDir "airmic-cli.mjs") upgrade @args
exit $LASTEXITCODE
