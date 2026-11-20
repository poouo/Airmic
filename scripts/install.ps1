# AirMic 一键安装 / 升级 / 卸载 引导脚本（Windows PowerShell 5.1+ / PowerShell 7+）
#
# 推荐用法（无需 clone 仓库，直接从 GitHub 拉取）：
#   iex ((irm https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.ps1 -UseBasicParsing).TrimStart([char]0xFEFF))
#
# 带参数（Docker 模式 / 升级 / 卸载等）：
#   $s = (irm https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.ps1 -UseBasicParsing).TrimStart([char]0xFEFF)
#   & ([scriptblock]::Create($s)) install --mode docker --language zh-CN
#   & ([scriptblock]::Create($s)) upgrade
#   & ([scriptblock]::Create($s)) uninstall --purge --yes
#   & ([scriptblock]::Create($s)) status
#
# 说明：
#   - 脚本本身只做三件事：准备运行环境（Node / Docker 检查）、下载部署 CLI、把参数交给 CLI。
#     安装、升级、卸载、状态、日志等全部由部署 CLI 完成。
#   - 默认 --source auto：GitHub 有 Release 预构建资产/GHCR 镜像就用预构建（不编译）；
#     没有就直接从 GitHub 源码归档安装并在本机构建（本地模式 npm ci + build，Docker 模式本地构建镜像）。
#   - 缺少 Node.js >= 22.13 时下载官方二进制到 <安装目录>\.runtime\，不污染系统。
#   - 环境变量：AIRMIC_REPO / AIRMIC_REF / AIRMIC_HOME / AIRMIC_NODE_VERSION /
#     AIRMIC_NODE_MIRROR / AIRMIC_RAW_BASE / AIRMIC_SKIP_NODE_INSTALL / AIRMIC_LANGUAGE / GITHUB_TOKEN
#
# 注意：通过 `irm ... | iex` 执行时脚本不会调用 exit，不会关闭当前 PowerShell 会话。

$script:AirMicInline = (-not $MyInvocation.MyCommand.Path) -or ($MyInvocation.InvocationName -eq '.')
$script:AirMicExitCode = 0

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
  # PowerShell 7 / .NET 5+ 不再需要，忽略即可
}

function Show-AirMicUsage {
  $usage = @'

AirMic 一键安装引导脚本（Windows PowerShell）

用法：
  iex ((irm https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.ps1 -UseBasicParsing).TrimStart([char]0xFEFF))
  $s = (irm https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.ps1 -UseBasicParsing).TrimStart([char]0xFEFF)
  & ([scriptblock]::Create($s)) <动作> [选项]

动作：
  install        安装（默认本地模式；Docker 模式加 --mode docker）
  upgrade        升级（自动识别本地/Docker 模式与来源）
  uninstall      卸载（默认保留 data\ 与 backups\，加 --purge 删除 AirMic 数据）
  start|stop|restart   启动 / 停止 / 重启
  status         查看部署状态
  logs           查看日志（可用 --lines 200）
  check-update   检查 GitHub 是否有新版本
  version        显示已安装版本
  help           显示本帮助

常用选项（其余选项原样透传给部署 CLI）：
  --mode local|docker     部署模式（默认 local）
  --dir <路径>            安装目录（默认 %USERPROFILE%\.airmic，或环境变量 AIRMIC_HOME）
  --source auto|release|github|local
                          安装来源（默认 auto：Release 预构建优先，缺失时直接用 GitHub 源码构建）
  --build                 开发者模式：使用当前仓库源码构建（需要已 clone 仓库）
  --from <包|URL|目录>    从离线预构建包安装/升级
  --port <端口>           AirMic 端口（默认 9811）
  --host <地址>           本地模式监听地址（默认 0.0.0.0 所有网卡；仅本机用可设 127.0.0.1）
  --no-livekit            跳过 LiveKit 下载与启动（语音不可用，便于快速验证）
  --livekit-version <v>   指定 LiveKit 版本
  --setup-token [值]      设置初始化口令
  --force                 已安装时强制重装（保留 data\ 与 backups\）
  --yes                   确认卸载（非交互执行时必填）
  --purge                 卸载时连同 data\、backups\ 一起删除
  --json                  check-update 以 JSON 输出
  --ref <git ref>         指定安装的 git ref（分支/Tag，默认 main）
  --repo <owner/name>     指定 GitHub 仓库（默认 poouo/Airmic）
  --language <code>       语言（AirMic 界面目前仅简体中文，兼容保留）
  --install-docker        Docker 缺失时尝试用 winget/choco 安装 Docker Desktop
  --dry-run               只打印将要执行的动作，不下载、不修改任何文件
  -h, --help              显示本帮助

示例：
  iex ((irm https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.ps1 -UseBasicParsing).TrimStart([char]0xFEFF))
  $s = (irm https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.ps1 -UseBasicParsing).TrimStart([char]0xFEFF)
  & ([scriptblock]::Create($s)) install --mode docker --install-docker
  & ([scriptblock]::Create($s)) upgrade
  & ([scriptblock]::Create($s)) uninstall --purge --yes
  & ([scriptblock]::Create($s)) status

'@
  Write-Host $usage -ForegroundColor Gray
}

function Get-AirMicNextValue {
  param(
    [string[]]$List,
    [int]$Index,
    [string]$Option
  )
  if ($Index + 1 -ge $List.Count -or $List[$Index + 1].StartsWith("-")) {
    throw "选项 $Option 需要一个值（使用 --help 查看用法）"
  }
  return [string]$List[$Index + 1]
}

function Invoke-AirMicDownload {
  param(
    [string]$Uri,
    [string]$OutFile,
    [int]$Retries = 3
  )
  $ProgressPreference = "SilentlyContinue"
  $lastError = $null
  for ($attempt = 1; $attempt -le $Retries; $attempt++) {
    try {
      Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -TimeoutSec 900
      if ((Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 0)) {
        return
      }
      $lastError = "下载内容为空"
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Seconds 2
    }
  }
  throw "下载失败：$Uri（$lastError）"
}

function Test-AirMicDownload {
  param(
    [string]$Uri,
    [string]$OutFile
  )
  try {
    Invoke-AirMicDownload -Uri $Uri -OutFile $OutFile -Retries 1
    return $true
  } catch {
    return $false
  }
}

function Get-AirMicNodeVersion {
  param([string]$NodePath)
  if (-not $NodePath) { return $null }
  if (-not (Test-Path -LiteralPath $NodePath)) { return $null }
  try {
    $version = & $NodePath -p "process.versions.node" 2>$null
    if (-not $version) { return $null }
    return ([string]$version).Trim()
  } catch {
    return $null
  }
}

function Test-AirMicNodeOk {
  param([string]$NodePath)
  $version = Get-AirMicNodeVersion -NodePath $NodePath
  if (-not $version) { return $false }
  try {
    return ([version]$version) -ge ([version]"22.13.0")
  } catch {
    return $false
  }
}

function Find-AirMicSystemNode {
  foreach ($candidate in Get-Command node -CommandType Application -ErrorAction SilentlyContinue) {
    if (Test-AirMicNodeOk -NodePath $candidate.Source) { return $candidate.Source }
  }
}

function Get-AirMicNodeArch {
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
  switch ($arch) {
    "AMD64" { return "x64" }
    "ARM64" { return "arm64" }
    default { throw "不支持的 Windows CPU 架构：$arch（支持 x64 / arm64）" }
  }
}

function Install-AirMicNodeRuntime {
  param(
    [string]$NodeVersion,
    [string]$NodeArch,
    [string]$TempDir
  )
  $name = "node-v$NodeVersion-win-$NodeArch"
  $nodeDir = Join-Path $TempDir $name
  $nodeExe = Join-Path $nodeDir "node.exe"
  if (Test-AirMicNodeOk -NodePath $nodeExe) { return $nodeExe }

  $base = "https://nodejs.org/dist"
  if ($env:AIRMIC_NODE_MIRROR) { $base = $env:AIRMIC_NODE_MIRROR.TrimEnd('/') }
  $url = "$base/v$NodeVersion/$name.zip"
  Write-Host "[AirMic] 未检测到 Node.js >= 22.13，下载 Node v$NodeVersion（win-$NodeArch）..." -ForegroundColor Cyan
  Write-Host "  下载地址：$url"
  $zip = Join-Path $TempDir "$name.zip"
  Invoke-AirMicDownload -Uri $url -OutFile $zip
  $checksums = Join-Path $TempDir "SHASUMS256.txt"
  Invoke-AirMicDownload -Uri "$base/v$NodeVersion/SHASUMS256.txt" -OutFile $checksums
  $pattern = '^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape("$name.zip") + '$'
  $checksum = Select-String -LiteralPath $checksums -Pattern $pattern | Select-Object -First 1
  $sha256 = [Security.Cryptography.SHA256]::Create()
  $zipStream = [IO.File]::OpenRead($zip)
  try {
    $actualHash = [BitConverter]::ToString($sha256.ComputeHash($zipStream)).Replace("-", "")
  } finally {
    $zipStream.Dispose()
    $sha256.Dispose()
  }
  if (-not $checksum -or $actualHash -ine $checksum.Matches[0].Groups[1].Value) {
    throw "Node.js ZIP 的 SHA-256 校验失败。"
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $TempDir)
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    throw "Node.js 解压失败：未找到 $nodeExe"
  }
  if (-not (Test-AirMicNodeOk -NodePath $nodeExe)) {
    throw "Node.js 运行时版本校验失败：$nodeExe"
  }
  return $nodeExe
}

function New-AirMicTempDirectory {
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $target = Join-Path $parent ("airmic-install-" + [guid]::NewGuid().ToString("N"))
  return (New-Item -ItemType Directory -Path $target).FullName
}

function Remove-AirMicTempDirectory {
  param([string]$Directory)
  $target = Get-Item -LiteralPath $Directory -ErrorAction SilentlyContinue
  if (-not $target) { return }
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  if ($target.PSIsContainer -and $target.Parent.FullName.TrimEnd('\') -ieq $parent -and
      $target.Name -match '^airmic-install-[0-9a-f]{32}$' -and
      -not ($target.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    Remove-Item -LiteralPath $target.FullName -Recurse -Force
  }
}

function Test-AirMicDockerCli {
  try {
    $null = & docker --version 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Test-AirMicDockerCompose {
  try {
    $null = & docker compose version 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Test-AirMicDockerDaemon {
  try {
    $null = & docker info 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Install-AirMicDockerDesktop {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host "[AirMic] 使用 winget 安装 Docker Desktop ..." -ForegroundColor Cyan
    & winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -eq 0) { return $true }
  }
  $choco = Get-Command choco -ErrorAction SilentlyContinue
  if ($choco) {
    Write-Host "[AirMic] 使用 choco 安装 Docker Desktop ..." -ForegroundColor Cyan
    & choco install docker-desktop -y
    if ($LASTEXITCODE -eq 0) { return $true }
  }
  return $false
}

function Ensure-AirMicDocker {
  param([bool]$AllowInstall)
  if (-not (Test-AirMicDockerCli)) {
    if (-not $AllowInstall) {
      throw "未找到 docker 命令。请先安装 Docker Desktop（https://www.docker.com/products/docker-desktop/），或加 --install-docker 让脚本自动安装；也可以改用 --mode local。"
    }
    if (-not (Install-AirMicDockerDesktop)) {
      throw "Docker Desktop 自动安装失败。请手动安装后重试（安装完成后需启动 Docker Desktop 并等待就绪），或改用 --mode local。"
    }
    if (-not (Test-AirMicDockerCli)) {
      throw "Docker Desktop 已安装但当前会话还找不到 docker 命令。请启动 Docker Desktop、重新打开 PowerShell 后重试，或改用 --mode local。"
    }
  }
  if (-not (Test-AirMicDockerCompose)) {
    throw "未检测到 Docker Compose v2。请升级 Docker Desktop（自带 compose v2），或改用 --mode local。"
  }
  if (-not (Test-AirMicDockerDaemon)) {
    throw "Docker 守护进程未运行。请启动 Docker Desktop 并等待右下角状态变为 Running，然后重试；或改用 --mode local。"
  }
  Write-Host "[AirMic] Docker 就绪：$((& docker --version 2>$null) -join '')" -ForegroundColor Green
}

function Get-AirMicCli {
  param(
    [string]$RawBase,
    [string]$Repo,
    [string]$TempDir
  )
  $raw = "$RawBase/$Repo/main"
  $cli = Join-Path $TempDir "airmic-cli.mjs"
  Invoke-AirMicDownload -Uri "$raw/deploy/airmic-cli.mjs" -OutFile $cli
  $text = Get-Content -LiteralPath $cli -TotalCount 40 -ErrorAction SilentlyContinue
  if (-not ($text -match "AirMic")) {
    throw "下载的部署 CLI 文件无效（内容不是 AirMic CLI）。"
  }
  foreach ($name in @("airmic.ps1", "airmic.cmd", "airmic.sh")) {
    $nul = Test-AirMicDownload -Uri "$raw/deploy/$name" -OutFile (Join-Path $TempDir $name)
    if (-not $nul) {
      Write-Host "[AirMic] 可选文件下载失败：deploy/$name（不影响安装，CLI 会自动生成包装脚本）" -ForegroundColor Yellow
    }
  }
  return $cli
}

function Write-AirMicBanner {
  param(
    [string]$Title,
    [string[]]$Rows = @()
  )
  $line = "=" * 46
  Write-Host ""
  Write-Host $line -ForegroundColor Cyan
  Write-Host " $Title"
  if ($Rows.Count -gt 0) {
    Write-Host ("-" * 46) -ForegroundColor Cyan
    foreach ($row in $Rows) { Write-Host " $row" }
  }
  Write-Host $line -ForegroundColor Cyan
  Write-Host ""
}

function Write-AirMicPhase {
  param(
    [int]$Index,
    [int]$Total,
    [string]$Message
  )
  Write-Host ("[{0}/{1}] {2}" -f $Index, $Total, $Message) -ForegroundColor Cyan
}

function Show-AirMicPlan {
  param(
    [string]$Action,
    [string]$Mode,
    [string]$HomeDir,
    [string]$Language,
    [string]$NodeLabel,
    [string]$CliLabel,
    [string]$DockerLabel,
    [bool]$HasYes
  )
  $modeLabel = $Mode
  if (-not $modeLabel) { $modeLabel = "local（默认）" }
  Write-AirMicBanner "AirMic 一键安装计划（--dry-run，不会修改任何文件）" @(
    "动作      : $Action",
    "系统      : Windows ($($env:PROCESSOR_ARCHITECTURE))",
    "安装目录  : $HomeDir",
    "部署模式  : $modeLabel",
    "语言      : $Language（AirMic 界面目前仅简体中文）",
    "Node.js   : $NodeLabel",
    "部署 CLI  : $CliLabel",
    "Docker    : $DockerLabel",
    "非交互确认: $HasYes"
  )
  Write-Host "去掉 --dry-run 即可开始执行。"
}

function Invoke-AirMic {
  param([string[]]$ScriptArgs)
  $ErrorActionPreference = "Stop"

  $Repo = "poouo/Airmic"
  $RepoExplicit = [bool]$env:AIRMIC_REPO
  if ($env:AIRMIC_REPO) { $Repo = $env:AIRMIC_REPO }
  $Ref = "main"
  if ($env:AIRMIC_REF) { $Ref = $env:AIRMIC_REF }
  $RefExplicit = [bool]$env:AIRMIC_REF
  $NodeVersion = "22.19.0"
  if ($env:AIRMIC_NODE_VERSION) { $NodeVersion = $env:AIRMIC_NODE_VERSION }
  $RawBase = "https://raw.githubusercontent.com"
  if ($env:AIRMIC_RAW_BASE) { $RawBase = $env:AIRMIC_RAW_BASE.TrimEnd('/') }
  $HomeDir = Join-Path $env:USERPROFILE ".airmic"
  if ($env:AIRMIC_HOME) { $HomeDir = $env:AIRMIC_HOME }
  $Language = "zh-CN"
  if ($env:AIRMIC_LANGUAGE) { $Language = $env:AIRMIC_LANGUAGE }
  $Action = "install"
  $Mode = ""
  $DryRun = $false
  $InstallDocker = $false
  $Source = ""
  $HasFrom = $false
  $PassArgs = New-Object System.Collections.Generic.List[string]

  if (-not $ScriptArgs) { $ScriptArgs = @() }

  $i = 0
  while ($i -lt $ScriptArgs.Count) {
    $arg = [string]$ScriptArgs[$i]
    if ($arg -eq "-h" -or $arg -eq "--help" -or $arg -eq "help" -or $arg -eq "--usage") {
      Show-AirMicUsage
      return
    } elseif ($arg -eq "--dry-run" -or $arg -eq "-n") {
      $DryRun = $true
      $i++
    } elseif ($arg -eq "--install-docker") {
      $InstallDocker = $true
      $i++
    } elseif ($arg -eq "-y" -or $arg -eq "--yes") {
      if (-not $PassArgs.Contains("--yes")) { $PassArgs.Add("--yes") }
      $i++
    } elseif ($arg -eq "--language" -or $arg -eq "--lang") {
      $Language = Get-AirMicNextValue -List $ScriptArgs -Index $i -Option $arg
      $i += 2
    } elseif ($arg.StartsWith("--language=") -or $arg.StartsWith("--lang=")) {
      $Language = $arg.Substring($arg.IndexOf("=") + 1)
      $i++
    } elseif ($arg -eq "--mode") {
      $Mode = Get-AirMicNextValue -List $ScriptArgs -Index $i -Option $arg
      $PassArgs.Add("--mode")
      $PassArgs.Add($Mode)
      $i += 2
    } elseif ($arg.StartsWith("--mode=")) {
      $Mode = $arg.Substring("--mode=".Length)
      $PassArgs.Add("--mode")
      $PassArgs.Add($Mode)
      $i++
    } elseif ($arg -eq "--dir") {
      $HomeDir = Get-AirMicNextValue -List $ScriptArgs -Index $i -Option $arg
      $i += 2
    } elseif ($arg.StartsWith("--dir=")) {
      $HomeDir = $arg.Substring("--dir=".Length)
      $i++
    } elseif ($arg -eq "--ref") {
      $Ref = Get-AirMicNextValue -List $ScriptArgs -Index $i -Option $arg
      $RefExplicit = $true
      $i += 2
    } elseif ($arg.StartsWith("--ref=")) {
      $Ref = $arg.Substring("--ref=".Length)
      $RefExplicit = $true
      $i++
    } elseif ($arg -eq "--repo") {
      $Repo = Get-AirMicNextValue -List $ScriptArgs -Index $i -Option $arg
      $RepoExplicit = $true
      $i += 2
    } elseif ($arg.StartsWith("--repo=")) {
      $Repo = $arg.Substring("--repo=".Length)
      $RepoExplicit = $true
      $i++
    } elseif ($arg -match '^--(source|from|port|host|livekit-version|lines)$') {
      $value = Get-AirMicNextValue -List $ScriptArgs -Index $i -Option $arg
      if ($arg -eq "--source") { $Source = $value }
      if ($arg -eq "--from") { $HasFrom = $true }
      $PassArgs.Add("$arg=$value")
      $i += 2
    } elseif ($arg.StartsWith("--source=")) {
      $Source = $arg.Substring("--source=".Length)
      $PassArgs.Add($arg)
      $i++
    } elseif ($arg.StartsWith("--from=")) {
      $HasFrom = $true
      $PassArgs.Add($arg)
      $i++
    } elseif ($arg -eq "--setup-token") {
      if ($i + 1 -lt $ScriptArgs.Count -and -not $ScriptArgs[$i + 1].StartsWith("-")) {
        $PassArgs.Add("--setup-token=$($ScriptArgs[$i + 1])")
        $i += 2
      } else {
        $PassArgs.Add($arg)
        $i++
      }
    } elseif ($arg -eq "update" -or $arg -eq "remove") {
      $Action = if ($arg -eq "update") { "upgrade" } else { "uninstall" }
      $i++
    } elseif (@("install", "upgrade", "uninstall", "status", "start", "stop", "restart", "logs", "check-update", "version") -contains $arg) {
      $Action = $arg
      $i++
    } elseif ($arg.StartsWith("-")) {
      $PassArgs.Add($arg)
      $i++
    } else {
      throw "无法识别的参数：$arg（使用 --help 查看用法）"
    }
  }

  if ($Repo -notmatch '^[\w-]+/[\w.-]+$' -or $Repo -match '/\.{1,2}$') { throw "--repo 需要有效的 GitHub owner/name。" }
  if ($Ref -notmatch '^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$' -or ($Ref -split '/') -contains '..') { throw "--ref 无效。" }
  if ($NodeVersion -notmatch '^\d+\.\d+\.\d+$') { throw "AIRMIC_NODE_VERSION 必须为 major.minor.patch。" }
  if ([string]::IsNullOrWhiteSpace($HomeDir)) { throw "--dir 需要一个安装目录路径。" }
  $PassArgs.Add("--dir=$HomeDir")
  if ($RepoExplicit) { $PassArgs.Add("--repo=$Repo") }
  if ($RefExplicit) { $PassArgs.Add("--ref=$Ref") }

  $hasYes = $PassArgs.Contains("--yes")
  $buildFromCheckout = -not $HasFrom -and ($Source -eq "local" -or ($PassArgs.Contains("--build") -and $Source -in @("", "auto", "release")))
  $localCli = if ($buildFromCheckout -and (-not $script:AirMicInline)) { Join-Path (Split-Path -Parent $PSScriptRoot) "deploy\airmic-cli.mjs" }

  $isDockerMode = ($Mode -eq "docker") -or $Action.StartsWith("docker-")

  # ---- dry-run：只打印计划 ----
  if ($DryRun) {
    $systemNodePath = Find-AirMicSystemNode
    if ($systemNodePath) {
      $nodeLabel = "使用系统 Node.js：v$(Get-AirMicNodeVersion -NodePath $systemNodePath)"
    } else {
      $nodeArch = "x64"
      try { $nodeArch = Get-AirMicNodeArch } catch { $nodeArch = "x64" }
      $nodeLabel = "将下载并校验 Node v$NodeVersion"
    }
    if ($localCli) {
      $cliLabel = "使用当前仓库的 CLI：$localCli"
    } else {
      $cliLabel = "下载 $RawBase/$Repo/main/deploy/airmic-cli.mjs"
    }
    if ($isDockerMode) {
      if (Test-AirMicDockerCli) {
        if (Test-AirMicDockerCompose) {
          $dockerLabel = "已就绪"
        } else {
          $dockerLabel = "Docker 已安装，但缺少 Compose v2"
        }
      } elseif ($InstallDocker) {
        $dockerLabel = "将使用 winget/choco 尝试安装 Docker Desktop"
      } else {
        $dockerLabel = "未检测到 Docker（实际执行时会报错，可加 --install-docker）"
      }
    } else {
      $dockerLabel = "不需要（本地模式）"
    }
    Show-AirMicPlan -Action $Action -Mode $Mode -HomeDir $HomeDir -Language $Language -NodeLabel $nodeLabel -CliLabel $cliLabel `
      -DockerLabel $dockerLabel -HasYes $hasYes
    return
  }

  $modeLabel = if ($Mode) { $Mode } else { "local（默认）" }
  Write-AirMicBanner "AirMic 一键安装 · $Action" @(
    "系统      : Windows ($($env:PROCESSOR_ARCHITECTURE))",
    "动作      : $Action",
    "安装目录  : $HomeDir",
    "部署模式  : $modeLabel"
  )

  Write-AirMicPhase 1 3 "检查运行环境"
  $originalPath = $env:Path
  $TempDir = New-AirMicTempDirectory
  try {
    Write-AirMicPhase 2 3 "准备 Node.js 与部署 CLI"
    if ($buildFromCheckout) {
      if (-not $localCli -or -not (Test-Path -LiteralPath $localCli -PathType Leaf)) { throw "本地源码构建请从 AirMic 仓库运行 scripts/install.ps1。" }
      $cliPath = $localCli
    } else {
      Write-Host "[AirMic] 下载 AirMic 部署 CLI（$Repo@main）..." -ForegroundColor Cyan
      $cliPath = Get-AirMicCli -RawBase $RawBase -Repo $Repo -TempDir $TempDir
    }

    $nodeExe = Find-AirMicSystemNode
    $temporaryNode = -not $nodeExe
    if ($temporaryNode) {
      if ($env:AIRMIC_SKIP_NODE_INSTALL -eq "1") { throw "未检测到 Node.js >= 22.13，且 AIRMIC_SKIP_NODE_INSTALL=1。" }
      $nodeExe = Install-AirMicNodeRuntime -NodeVersion $NodeVersion -NodeArch (Get-AirMicNodeArch) -TempDir $TempDir
    }
    $validateArgs = @($cliPath, "__validate-home", "--action=$Action") + $PassArgs.ToArray()
    $needsRuntime = $temporaryNode -and $Action -in @("install", "upgrade", "start", "restart")
    if ($needsRuntime) { $validateArgs += "--prepare-runtime" }
    $originalEncoding = [Console]::OutputEncoding
    try {
      [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
      $validatedHome = & $nodeExe @validateArgs
    } finally {
      [Console]::OutputEncoding = $originalEncoding
    }
    if ($LASTEXITCODE -ne 0 -or -not $validatedHome) { throw "安装目录校验失败。" }
    $HomeDir = $validatedHome
    if ($needsRuntime) {
      $runtimeDir = Join-Path $HomeDir ".runtime"
      $stagedNode = Split-Path -Parent $nodeExe
      $runtimeName = Split-Path -Leaf $stagedNode
      foreach ($dir in Get-ChildItem -LiteralPath $runtimeDir -Directory -Filter "$runtimeName*") {
        if ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        $cached = Get-Item -LiteralPath (Join-Path $dir.FullName "node.exe") -ErrorAction SilentlyContinue
        if ($cached -and -not ($cached.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
            (Test-AirMicNodeOk -NodePath $cached.FullName)) {
          $nodeExe = $cached.FullName
          break
        }
      }
      if ((Split-Path -Parent $nodeExe) -eq $stagedNode) {
        $target = Join-Path $runtimeDir ($runtimeName + "-" + [guid]::NewGuid().ToString("N"))
        Copy-Item -LiteralPath $stagedNode -Destination $target -Recurse
        $nodeExe = Join-Path $target "node.exe"
      }
    }
    $env:Path = "$(Split-Path -Parent $nodeExe);$originalPath"
    if ($isDockerMode -and $Action -in @("install", "upgrade", "start", "restart")) { Ensure-AirMicDocker -AllowInstall $InstallDocker }
    Write-AirMicPhase 3 3 "执行 AirMic $Action"

    $allArgs = @($cliPath, $Action) + $PassArgs.ToArray()
    & $nodeExe @allArgs
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }

    if ($code -eq 0) {
      if ($Action -eq "install" -or $Action -eq "upgrade") {
        Write-Host ""
        Write-Host "[AirMic] 完成。后续管理命令：" -ForegroundColor Green
        Write-Host "  `"$HomeDir\bin\airmic.cmd`" status      # 查看状态"
        Write-Host "  `"$HomeDir\bin\airmic.cmd`" logs        # 查看日志"
        Write-Host "  `"$HomeDir\bin\airmic.cmd`" upgrade     # 升级"
        Write-Host "  `"$HomeDir\bin\airmic.cmd`" uninstall   # 卸载（加 --purge 删除数据）"
        Write-Host "[AirMic] 下一步：打开上方 CLI 输出的访问地址，在浏览器中完成初始化（创建管理员、配置 LiveKit、设置音质）。"
      }
    } else {
      Write-Host "[AirMic] AirMic $Action 未成功（退出码 $code）。可执行 `"$HomeDir\bin\airmic.cmd`" logs 查看日志。" -ForegroundColor Red
    }
    $script:AirMicExitCode = $code
  } finally {
    $env:Path = $originalPath
    Remove-AirMicTempDirectory -Directory $TempDir
  }
}

try {
  Invoke-AirMic -ScriptArgs @($args)
} catch {
  Write-Host "[AirMic] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "[AirMic] 已中止。问题反馈：https://github.com/poouo/Airmic/issues" -ForegroundColor Red
  $script:AirMicExitCode = 1
}

if ($script:AirMicInline) {
  # 通过 irm | iex 执行：不调用 exit，避免关闭用户会话
  if ($script:AirMicExitCode -ne 0) {
    Write-Host "[AirMic] 退出码：$script:AirMicExitCode" -ForegroundColor Red
  }
} else {
  exit $script:AirMicExitCode
}
