# AirMic 部署 CLI 的 PowerShell 包装脚本（Windows PowerShell 5.1+ / PowerShell 7+）
# 优先使用安装目录内的 Node（<安装目录>\.runtime），其次使用系统 Node
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$homeDir = Split-Path -Parent $scriptDir
$node = $null
foreach ($dir in Get-ChildItem -LiteralPath (Join-Path $homeDir ".runtime") -Directory -Filter "node-*" -ErrorAction SilentlyContinue) {
  if ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
  $candidate = Get-Item -LiteralPath (Join-Path $dir.FullName "node.exe") -ErrorAction SilentlyContinue
  if ($candidate -and -not ($candidate.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $node = $candidate.FullName; break }
}
if (-not $node) {
  $cmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { $node = $cmd.Source }
}
if (-not $node) { throw "[AirMic] 未找到 Node.js，请先运行 install.ps1 或安装 Node.js 22.13+" }
& $node (Join-Path $scriptDir "airmic-cli.mjs") @args
exit $LASTEXITCODE
