# AirMic 一键安装 / 升级 / 卸载 引导脚本（Windows PowerShell）
#
# 用法（无需 clone 仓库）：
#   irm https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.ps1 | iex
#   $script = (iwr https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.ps1 -UseBasicParsing).Content
#   & ([scriptblock]::Create($script)) install --language zh-CN
#   & ([scriptblock]::Create($script)) upgrade
#   & ([scriptblock]::Create($script)) uninstall --purge
#
# 默认从 GitHub Release 下载预构建包，不在本机编译；缺少 Node.js >= 22.13 时
# 自动下载官方 Node 二进制到安装目录 .runtime\ 下（不污染系统）。
# 环境变量：AIRMIC_REPO、AIRMIC_REF、AIRMIC_HOME、AIRMIC_NODE_VERSION、GITHUB_TOKEN

$ErrorActionPreference = "Stop"

$Repo = if ($env:AIRMIC_REPO) { $env:AIRMIC_REPO } else { "poouo/Airmic" }
$Ref = if ($env:AIRMIC_REF) { $env:AIRMIC_REF } else { "main" }
$NodeVersion = if ($env:AIRMIC_NODE_VERSION) { $env:AIRMIC_NODE_VERSION } else { "22.19.0" }
$HomeDir = if ($env:AIRMIC_HOME) { $env:AIRMIC_HOME } else { Join-Path $env:USERPROFILE ".airmic" }
$Raw = "https://raw.githubusercontent.com/$Repo/$Ref"

$Action = "install"
$Rest = @()
if ($args.Count -gt 0) {
  $first = [string]$args[0]
  if (@("install", "upgrade", "uninstall", "status", "start", "stop", "restart", "logs", "check-update", "version") -contains $first) {
    $Action = $first
    if ($args.Count -gt 1) { $Rest = $args[1..($args.Count - 1)] }
  } else {
    $Rest = $args
  }
}

# 过滤 --language / --lang，保持与参考一键脚本参数兼容
$PassArgs = New-Object System.Collections.Generic.List[string]
$skipNext = $false
foreach ($arg in $Rest) {
  if ($skipNext) { $skipNext = $false; continue }
  if ($arg -eq "--language" -or $arg -eq "--lang") { $skipNext = $true; continue }
  if ($arg -like "--language=*" -or $arg -like "--lang=*") { continue }
  $PassArgs.Add([string]$arg)
}

Write-Host "[AirMic] 下载部署 CLI（$Repo@$Ref）..."
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("airmic-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
try {
  $CliPath = Join-Path $TempDir "airmic-cli.mjs"
  Invoke-WebRequest -Uri "$Raw/deploy/airmic-cli.mjs" -OutFile $CliPath -UseBasicParsing

  function Test-Node([string]$Path) {
    if (-not $Path) { return $false }
    try {
      $version = & $Path -p "process.versions.node" 2>$null
      if (-not $version) { return $false }
      $parts = ([string]$version).Split(".")
      return ([int]$parts[0] -gt 22) -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -ge 13)
    } catch { return $false }
  }

  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $NodeBin = if ($nodeCmd) { $nodeCmd.Source } else { $null }
  if (-not (Test-Node $NodeBin)) {
    $runtimeDir = Join-Path $HomeDir ".runtime"
    $nodeDir = Join-Path $runtimeDir "node-v$NodeVersion-win-x64"
    $nodeExe = Join-Path $nodeDir "node.exe"
    if (-not (Test-Path $nodeExe)) {
      Write-Host "[AirMic] 未检测到 Node.js >= 22.13，下载官方 Node v$NodeVersion 到安装目录..."
      New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
      $zip = Join-Path $TempDir "node.zip"
      Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $zip -UseBasicParsing
      Expand-Archive -Path $zip -DestinationPath $runtimeDir -Force
      $extracted = Join-Path $runtimeDir "node-v$NodeVersion-win-x64"
      if (Test-Path $extracted) {
        if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
        Move-Item $extracted $nodeDir
      }
    }
    if (-not (Test-Path $nodeExe)) { throw "Node.js 自动安装失败，请手动安装 Node.js >= 22.13 后重试" }
    $NodeBin = $nodeExe
    Write-Host "[AirMic] 使用安装目录内的 Node.js"
  }

  New-Item -ItemType Directory -Path $HomeDir -Force | Out-Null
  if (@("install", "upgrade", "uninstall") -contains $Action -and -not $PassArgs.Contains("--yes")) {
    $PassArgs.Add("--yes")
  }
  if (-not $PassArgs.Contains("--dir")) {
    $PassArgs.Insert(0, "--dir")
    $PassArgs.Insert(1, $HomeDir)
  }

  $allArgs = @($CliPath, $Action) + $PassArgs.ToArray()
  Write-Host "[AirMic] 执行：airmic $Action（安装目录：$HomeDir）"
  & $NodeBin @allArgs
  exit $LASTEXITCODE
} finally {
  Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
