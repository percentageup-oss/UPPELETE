<#
.SYNOPSIS
  Windows launcher for Caption Studio (the PowerShell counterpart of dev.sh).

.DESCRIPTION
  .\dev.ps1             Vite dev server + Electron with hot reload
  .\dev.ps1 electron    production build, then `npx electron .`
  .\dev.ps1 smoke       Electron-hosted media-worker smoke
  .\dev.ps1 -Reconfigure   forget the saved tool paths and detect them again
  .\dev.ps1 -Yes           download missing tools without asking

  On first run it finds FFmpeg/ffprobe (PATH, winget, Scoop, Chocolatey, C:\ffmpeg, .tools) and
  checks that the build can export (PNG codec + NVENC or Media Foundation). If none is usable it
  downloads a BtbN FFmpeg build into .tools\. It also fetches whisper-cli (CUDA build when an
  NVIDIA GPU is present). Results go to the gitignored caption-studio.local.json.

  If scripts are blocked:  powershell -ExecutionPolicy Bypass -File .\dev.ps1
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][ValidateSet('dev', 'electron', 'smoke')][string]$Mode = 'dev',
  [switch]$Reconfigure,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Set-Location -LiteralPath $PSScriptRoot

# Inherited from Electron-hosted shells; it makes `electron .` run as plain Node.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$ConfigPath = Join-Path $PSScriptRoot 'caption-studio.local.json'
$ToolsDir = Join-Path $PSScriptRoot '.tools'
$MinFfmpegMajor = 7
$FfmpegAsset = 'ffmpeg-n9.0-latest-win64-lgpl-9.0.zip'
$FfmpegBase = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
# whisper.cpp publishes Windows binaries only on its build tags; b5130 is the build cut with v1.9.4.
$WhisperTag = 'b5130'
$WhisperBase = "https://github.com/ggml-org/whisper.cpp/releases/download/$WhisperTag"

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Note($text) { Write-Host "    $text" -ForegroundColor DarkGray }
function Write-Warn($text) { Write-Host "WARNING: $text" -ForegroundColor Yellow }

function Confirm-Download($what, $size) {
  if ($Yes) { return $true }
  if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { return $false }
  $answer = Read-Host "Download $what ($size)? [Y/n]"
  return ($answer -eq '' -or $answer -match '^[yY]')
}

function Get-Sha256($path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }

function Save-Download($url, $destination) {
  Write-Note "GET $url"
  Invoke-WebRequest -Uri $url -OutFile $destination -UseBasicParsing
}

# --- config file (UTF-8 *without* BOM: the app parses it with JSON.parse) -----------------------
function Read-Config {
  $config = [ordered]@{}
  if (Test-Path -LiteralPath $ConfigPath) {
    try {
      $parsed = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
      foreach ($key in 'ffmpegPath', 'ffprobePath', 'whisperCliPath') {
        if ($parsed.PSObject.Properties.Name -contains $key -and $parsed.$key) { $config[$key] = [string]$parsed.$key }
      }
    } catch { Write-Warn "$ConfigPath is not valid JSON; it will be rewritten." }
  }
  return $config
}
function Write-Config($config) {
  $json = ($config | ConvertTo-Json) + "`n"
  [System.IO.File]::WriteAllText($ConfigPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# --- FFmpeg discovery ---------------------------------------------------------------------------
function Test-FfmpegPair($ffmpeg, $ffprobe) {
  # Returns an object describing the build, or $null when it cannot export.
  if (-not ((Test-Path -LiteralPath $ffmpeg -PathType Leaf) -and (Test-Path -LiteralPath $ffprobe -PathType Leaf))) { return $null }
  $ErrorActionPreference = 'Continue'   # Windows PowerShell 5.1 turns native stderr text into terminating errors under 'Stop'
  try {
    $version = (& $ffmpeg -hide_banner -version 2>&1 | Out-String)
    $encoders = (& $ffmpeg -hide_banner -encoders 2>&1 | Out-String)
  } catch { return $null }
  $versionMatch = [regex]::Match($version, 'version\s+n?(\d+)\.')
  if (-not $versionMatch.Success -or [int]$versionMatch.Groups[1].Value -lt $MinFfmpegMajor) { return $null }
  if ($encoders -notmatch '(?m)^\s*V\S*\s+png\s') { return $null }
  $nvenc = $encoders -match '(?m)^\s*V\S*\s+h264_nvenc\s'
  $mf = $encoders -match '(?m)^\s*V\S*\s+h264_mf\s'
  if (-not ($nvenc -or $mf)) { return $null }
  $versionLine = ($version -split "`r?`n" | Select-Object -First 1)
  $license = 'LGPL'
  if ($version -match '--enable-gpl') { $license = 'GPL' }
  return [pscustomobject]@{ Ffmpeg = $ffmpeg; Ffprobe = $ffprobe; Version = $versionLine; License = $license; Nvenc = $nvenc; MediaFoundation = $mf }
}

function Get-FfmpegCandidateDirs {
  $dirs = New-Object System.Collections.Generic.List[string]
  if ($env:CAPTION_STUDIO_FFMPEG_PATH) { $dirs.Add((Split-Path -Parent $env:CAPTION_STUDIO_FFMPEG_PATH)) }
  $existing = Read-Config
  if ($existing.Contains('ffmpegPath')) { $dirs.Add((Split-Path -Parent $existing['ffmpegPath'])) }
  if (Test-Path -LiteralPath $ToolsDir) {
    Get-ChildItem -LiteralPath $ToolsDir -Directory -Filter 'ffmpeg*' -ErrorAction SilentlyContinue | ForEach-Object {
      $dirs.Add($_.FullName); $dirs.Add((Join-Path $_.FullName 'bin'))
      Get-ChildItem -LiteralPath $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object { $dirs.Add((Join-Path $_.FullName 'bin')) }
    }
  }
  foreach ($command in @(Get-Command ffmpeg.exe -All -ErrorAction SilentlyContinue)) { $dirs.Add((Split-Path -Parent $command.Source)) }
  if ($env:LOCALAPPDATA) {
    $wingetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path -LiteralPath $wingetRoot) {
      Get-ChildItem -LiteralPath $wingetRoot -Directory -Filter '*FFmpeg*' -ErrorAction SilentlyContinue | ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -Recurse -Filter ffmpeg.exe -File -ErrorAction SilentlyContinue | ForEach-Object { $dirs.Add($_.DirectoryName) }
      }
    }
    $dirs.Add((Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'))
  }
  $scoop = if ($env:SCOOP) { $env:SCOOP } else { Join-Path $HOME 'scoop' }
  $dirs.Add((Join-Path $scoop 'apps\ffmpeg\current\bin'))
  $dirs.Add((Join-Path $scoop 'shims'))
  $choco = if ($env:ChocolateyInstall) { $env:ChocolateyInstall } else { 'C:\ProgramData\chocolatey' }
  $dirs.Add((Join-Path $choco 'bin'))
  $chocoLib = Join-Path $choco 'lib'
  if (Test-Path -LiteralPath $chocoLib) {
    Get-ChildItem -LiteralPath $chocoLib -Directory -Filter 'ffmpeg*' -ErrorAction SilentlyContinue | ForEach-Object {
      Get-ChildItem -LiteralPath $_.FullName -Recurse -Filter ffmpeg.exe -File -ErrorAction SilentlyContinue | ForEach-Object { $dirs.Add($_.DirectoryName) }
    }
  }
  $dirs.Add('C:\ffmpeg\bin'); $dirs.Add('C:\ffmpeg'); $dirs.Add('C:\Program Files\ffmpeg\bin')
  return $dirs | Where-Object { $_ } | Select-Object -Unique
}

function Find-FfmpegPair {
  $rejected = New-Object System.Collections.Generic.List[string]
  foreach ($dir in Get-FfmpegCandidateDirs) {
    $ffmpeg = Join-Path $dir 'ffmpeg.exe'
    $ffprobe = Join-Path $dir 'ffprobe.exe'
    if (-not (Test-Path -LiteralPath $ffmpeg -PathType Leaf)) { continue }
    $result = Test-FfmpegPair $ffmpeg $ffprobe
    if ($result) { return $result }
    $rejected.Add($dir)
  }
  foreach ($dir in $rejected) { Write-Note "skipped $dir (needs FFmpeg >= $MinFfmpegMajor with PNG + h264_nvenc/h264_mf, and ffprobe.exe beside it)" }
  return $null
}

function Install-Ffmpeg {
  if (-not (Confirm-Download "FFmpeg (BtbN LGPL build with NVENC + Media Foundation) into .tools" '~90 MB')) { return $null }
  New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
  $zip = Join-Path $ToolsDir $FfmpegAsset
  Save-Download "$FfmpegBase/$FfmpegAsset" $zip
  $sums = (Invoke-WebRequest -Uri "$FfmpegBase/checksums.sha256" -UseBasicParsing).Content
  $expected = $null
  foreach ($line in ($sums -split "`r?`n")) { if ($line -match "^([0-9a-fA-F]{64})\s+\*?$([regex]::Escape($FfmpegAsset))\s*$") { $expected = $Matches[1].ToLowerInvariant() } }
  if (-not $expected) { Remove-Item -LiteralPath $zip -Force; throw "checksums.sha256 has no entry for $FfmpegAsset" }
  if ((Get-Sha256 $zip) -ne $expected) { Remove-Item -LiteralPath $zip -Force; throw "SHA-256 mismatch for $FfmpegAsset; download discarded" }
  $target = Join-Path $ToolsDir 'ffmpeg-win64-lgpl'
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  $staging = Join-Path $ToolsDir 'ffmpeg-extract'
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $staging -Force
  $inner = Get-ChildItem -LiteralPath $staging -Directory | Select-Object -First 1
  Move-Item -LiteralPath $inner.FullName -Destination $target
  Remove-Item -LiteralPath $staging -Recurse -Force
  Remove-Item -LiteralPath $zip -Force
  return Test-FfmpegPair (Join-Path $target 'bin\ffmpeg.exe') (Join-Path $target 'bin\ffprobe.exe')
}

# --- NVIDIA / whisper-cli -----------------------------------------------------------------------
function Get-NvidiaGpuName {
  $smi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
  if (-not $smi) {
    $fallback = Join-Path $env:SystemRoot 'System32\nvidia-smi.exe'
    if (Test-Path -LiteralPath $fallback) { $smi = Get-Item -LiteralPath $fallback; $smiPath = $fallback } else { return $null }
  } else { $smiPath = $smi.Source }
  try {
    $ErrorActionPreference = 'Continue'
    $name = (& $smiPath --query-gpu=name --format=csv,noheader 2>$null | Select-Object -First 1)
    if ($name) { return $name.Trim() }
  } catch { }
  return $null
}

function Find-WhisperCli($root) {
  if (-not (Test-Path -LiteralPath $root)) { return $null }
  $found = Get-ChildItem -LiteralPath $root -Recurse -Filter 'whisper-cli.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.FullName }
  return $null
}

function Install-Whisper($hasNvidia) {
  if ($hasNvidia) { $asset = 'whisper-cublas-12.4.0-bin-x64.zip'; $size = '~670 MB'; $variant = 'cublas' }
  else { $asset = 'whisper-bin-x64.zip'; $size = '~8 MB'; $variant = 'cpu' }
  $target = Join-Path $ToolsDir "whisper.cpp-$WhisperTag-win-$variant"
  $existing = Find-WhisperCli $target
  if ($existing) { return $existing }
  if (-not (Confirm-Download "whisper-cli ($variant build) into .tools" $size)) { return $null }
  New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
  $zip = Join-Path $ToolsDir $asset
  Save-Download "$WhisperBase/$asset" $zip
  # GitHub publishes a per-asset digest in the release API; verify it when present.
  try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/$WhisperTag" -UseBasicParsing
    $entry = $release.assets | Where-Object { $_.name -eq $asset } | Select-Object -First 1
    if ($entry -and $entry.digest -match '^sha256:([0-9a-fA-F]{64})$') {
      if ((Get-Sha256 $zip) -ne $Matches[1].ToLowerInvariant()) { Remove-Item -LiteralPath $zip -Force; throw "SHA-256 mismatch for $asset; download discarded" }
      Write-Note "SHA-256 verified"
    } else { Write-Warn "No published digest for $asset; integrity not verified." }
  } catch [System.Net.WebException] { Write-Warn "Could not reach the GitHub API to verify $asset." }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $target -Force
  Remove-Item -LiteralPath $zip -Force
  return Find-WhisperCli $target
}

function Test-WhisperCli($path) {
  $ErrorActionPreference = 'Continue'
  try { $null = & $path --help 2>&1; return $true } catch { return $false }
}

# --- prerequisites ------------------------------------------------------------------------------
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js 22.12 or newer is required. Install it with:  winget install OpenJS.NodeJS.LTS" }
$nodeVersion = [version](((& node --version) -replace '^v', '') -replace '-.*$', '')
if ($nodeVersion -lt [version]'22.12.0') { throw "Node.js $nodeVersion found; 22.12 or newer is required (winget upgrade OpenJS.NodeJS.LTS)." }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
  Write-Step 'npm install'
  & npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}

# --- tools --------------------------------------------------------------------------------------
$config = Read-Config
if ($Reconfigure) { $config = [ordered]@{}; Write-Step 'Reconfigure: detecting tools again' }

$ffmpegOk = $false
if ($config.Contains('ffmpegPath') -and $config.Contains('ffprobePath') -and -not $env:CAPTION_STUDIO_FFMPEG_PATH) {
  $saved = Test-FfmpegPair $config['ffmpegPath'] $config['ffprobePath']
  if ($saved) { $ffmpegOk = $true; $pair = $saved }
}
if (-not $ffmpegOk) {
  if ($env:CAPTION_STUDIO_FFMPEG_PATH -and $env:CAPTION_STUDIO_FFPROBE_PATH) {
    $pair = Test-FfmpegPair $env:CAPTION_STUDIO_FFMPEG_PATH $env:CAPTION_STUDIO_FFPROBE_PATH
    if (-not $pair) { Write-Warn 'CAPTION_STUDIO_FFMPEG_PATH/FFPROBE_PATH are set but that build cannot export; searching instead.' }
  } else { $pair = $null }
  if (-not $pair) {
    Write-Step 'Looking for FFmpeg'
    $pair = Find-FfmpegPair
  }
  if (-not $pair) {
    Write-Step 'No usable FFmpeg found'
    $pair = Install-Ffmpeg
  }
  if (-not $pair) { throw 'No usable FFmpeg. Re-run with -Yes to download one, or install FFmpeg 7+ (winget install Gyan.FFmpeg) and run again.' }
  $config['ffmpegPath'] = $pair.Ffmpeg
  $config['ffprobePath'] = $pair.Ffprobe
}

$gpuName = Get-NvidiaGpuName
$whisper = $null
if ($config.Contains('whisperCliPath') -and (Test-Path -LiteralPath $config['whisperCliPath'] -PathType Leaf)) { $whisper = $config['whisperCliPath'] }
elseif ($env:CAPTION_STUDIO_WHISPER_CLI_PATH -and (Test-Path -LiteralPath $env:CAPTION_STUDIO_WHISPER_CLI_PATH -PathType Leaf)) { $whisper = $env:CAPTION_STUDIO_WHISPER_CLI_PATH }
else {
  Write-Step 'Setting up whisper-cli'
  try {
    $hasNvidia = [bool]$gpuName
    $whisper = Install-Whisper $hasNvidia
    if ($whisper -and -not (Test-WhisperCli $whisper)) { Write-Warn "$whisper did not run."; $whisper = $null }
  } catch { Write-Warn "whisper-cli setup failed: $($_.Exception.Message)"; $whisper = $null }
  if (-not $whisper) { Write-Warn 'Continuing without transcription. Re-run .\dev.ps1 to retry.' }
}
if ($whisper) { $config['whisperCliPath'] = $whisper } else { $config.Remove('whisperCliPath') }

Write-Config $config

# --- summary + environment ----------------------------------------------------------------------
$encoders = @(); if ($pair.Nvenc) { $encoders += 'h264_nvenc' }; if ($pair.MediaFoundation) { $encoders += 'h264_mf' }
Write-Host ''
Write-Host "FFmpeg:    $($config['ffmpegPath'])"
Write-Host "           $($pair.Version)  [$($pair.License)]  encoders: $($encoders -join ', ')"
if ($gpuName) { Write-Host "GPU:       $gpuName (NVENC export$(if ($pair.Nvenc) { '' } else { ' NOT in this FFmpeg build' }))" } else { Write-Host 'GPU:       no NVIDIA GPU detected (export uses Media Foundation)' }
if ($whisper) { Write-Host "whisper:   $whisper" } else { Write-Host 'whisper:   not configured (no transcription)' }
Write-Host ''

# Variables already set in the shell win, as in the app.
if (-not $env:CAPTION_STUDIO_FFMPEG_PATH) { $env:CAPTION_STUDIO_FFMPEG_PATH = $config['ffmpegPath'] }
if (-not $env:CAPTION_STUDIO_FFPROBE_PATH) { $env:CAPTION_STUDIO_FFPROBE_PATH = $config['ffprobePath'] }
if ($whisper -and -not $env:CAPTION_STUDIO_WHISPER_CLI_PATH) { $env:CAPTION_STUDIO_WHISPER_CLI_PATH = $whisper }

switch ($Mode) {
  'dev' { & npm run dev }
  'electron' { & npm run build; if ($LASTEXITCODE -eq 0) { & npx electron . } }
  'smoke' { & npm run build:electron; if ($LASTEXITCODE -eq 0) { & npx electron . --media-worker-smoke } }
}
exit $LASTEXITCODE
