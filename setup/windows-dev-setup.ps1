<#
.SYNOPSIS
  One-shot Windows dev environment for cashfo_backend, kept on a separate drive.

.DESCRIPTION
  Installs Git, Node.js LTS, VS Code, GitHub CLI, WSL2 and Docker Desktop (via
  winget), puts the workspace, npm cache/global packages and Docker's data on
  the chosen drive, clones the repo, writes a .env with freshly generated
  secrets, starts Postgres in Docker and runs `prisma db push` + seed.

  Safe to re-run: installed apps are skipped, an existing .env is kept.

.EXAMPLE
  # From an *Administrator* PowerShell:
  Set-ExecutionPolicy -Scope Process Bypass -Force
  .\windows-dev-setup.ps1 -Drive D

.EXAMPLE
  # After the reboot Docker/WSL may ask for, finish the project part only:
  .\windows-dev-setup.ps1 -Drive D -SkipApps
#>
[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z]$')]
  [string]$Drive = 'D',
  [string]$RepoUrl = 'https://github.com/arifur999/cashfo_backend.git',
  [switch]$SkipApps
)

$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

function New-Secret([int]$bytes = 32) {
  $b = New-Object byte[] $bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}

# --- preflight --------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).
  IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this from an Administrator PowerShell window.' }

$root = "$($Drive.ToUpper()):\dev"
if (-not (Test-Path "$($Drive.ToUpper()):\")) { throw "Drive $($Drive.ToUpper()): not found." }

$dirs = @{
  Projects   = "$root\projects"
  Tools      = "$root\tools"
  NpmGlobal  = "$root\tools\npm-global"
  NpmCache   = "$root\tools\npm-cache"
  DockerApp  = "$root\tools\Docker"
  DockerData = "$root\docker-data"
}
Step "Creating workspace under $root"
$dirs.Values | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }
Ok 'done'

# --- apps -------------------------------------------------------------------
if (-not $SkipApps) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'winget not found. Install "App Installer" from the Microsoft Store, then re-run.'
  }

  Step 'Enabling WSL2 (needed by Docker Desktop)'
  wsl --install --no-distribution 2>&1 | Out-Host
  Ok 'WSL step finished (a reboot may be required)'

  # --location is honoured by installers that support a custom dir (Git, Node,
  # VS Code); others fall back to their default location on C:.
  $apps = @(
    @{ Id = 'Git.Git';                      Loc = "$($dirs.Tools)\Git" },
    @{ Id = 'OpenJS.NodeJS.LTS';            Loc = "$($dirs.Tools)\nodejs" },
    @{ Id = 'Microsoft.VisualStudioCode';   Loc = "$($dirs.Tools)\VSCode" },
    @{ Id = 'GitHub.cli';                   Loc = $null }
  )
  foreach ($app in $apps) {
    Step "Installing $($app.Id)"
    winget list --id $app.Id -e --accept-source-agreements *> $null
    if ($LASTEXITCODE -eq 0) { Ok 'already installed, skipping'; continue }
    $wargs = @('install', '--id', $app.Id, '-e', '--silent',
              '--accept-source-agreements', '--accept-package-agreements')
    if ($app.Loc) { $wargs += @('--location', $app.Loc) }
    winget @wargs
    if ($LASTEXITCODE -ne 0) { Warn "winget exited with $LASTEXITCODE for $($app.Id)" } else { Ok 'installed' }
  }

  Step 'Installing Docker Desktop (app + WSL data on the dev drive)'
  winget list --id Docker.DockerDesktop -e --accept-source-agreements *> $null
  if ($LASTEXITCODE -eq 0) {
    Ok 'already installed, skipping'
  } else {
    $override = "install --quiet --accept-license --backend=wsl-2 " +
                "--installation-dir=$($dirs.DockerApp) --wsl-default-data-root=$($dirs.DockerData)"
    winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements --override $override
    if ($LASTEXITCODE -ne 0) { Warn "Docker install exited with $LASTEXITCODE" } else { Ok 'installed' }
  }

  Refresh-Path

  Step 'Installing VS Code extensions'
  if (Get-Command code -ErrorAction SilentlyContinue) {
    'Prisma.prisma', 'ms-azuretools.vscode-docker', 'oxc.oxc-vscode',
    'esbenp.prettier-vscode', 'vitest.explorer', 'eamodio.gitlens' |
      ForEach-Object { code --install-extension $_ --force | Out-Null }
    Ok 'done'
  } else { Warn 'code CLI not on PATH yet - open a new terminal and re-run with -SkipApps' }
}

Refresh-Path

# --- npm on the dev drive ---------------------------------------------------
Step 'Pointing npm cache + global packages at the dev drive'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node not found on PATH. Open a NEW Administrator PowerShell and re-run with -SkipApps.'
}
npm config set prefix $dirs.NpmGlobal
npm config set cache  $dirs.NpmCache
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$($dirs.NpmGlobal)*") {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$($dirs.NpmGlobal)", 'User')
}
Refresh-Path
Ok "node $(node -v), npm $(npm -v)"

# --- repo -------------------------------------------------------------------
$repoDir = "$($dirs.Projects)\cashfo_backend"
Step "Cloning repo into $repoDir"
if (Test-Path "$repoDir\.git") {
  Ok 'already cloned, skipping'
} else {
  git clone $RepoUrl $repoDir
  if ($LASTEXITCODE -ne 0) { throw 'git clone failed (private repo? run `gh auth login` first, then re-run with -SkipApps).' }
}
Set-Location $repoDir

Step 'Writing .env with generated secrets'
if (Test-Path '.env') {
  Ok '.env exists, leaving it alone'
} else {
  $secretKeys = 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'USER_JWT_SECRET', 'USER_JWT_REFRESH_SECRET',
                'USAGE_TRACKING_API_KEY', 'VAULT_ENCRYPTION_KEY', 'VAULT_TOKEN_SECRET'
  $lines = Get-Content '.env.example' | ForEach-Object {
    $line = $_
    foreach ($k in $secretKeys) {
      if ($line -match "^$k=") { $line = "$k=$(New-Secret 32)" }  # 32 bytes = 64 hex chars
    }
    $line
  }
  [IO.File]::WriteAllLines("$repoDir\.env", $lines, (New-Object Text.UTF8Encoding $false))
  Ok '.env created (fill in IMGBB_API_KEY and RESEND_API_KEY yourself)'
}

# --- docker + database ------------------------------------------------------
Step 'Checking Docker'
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $exe = Get-ChildItem -Path $dirs.DockerApp, "$env:ProgramFiles\Docker\Docker" -Filter 'Docker Desktop.exe' -Recurse -ErrorAction SilentlyContinue |
         Select-Object -First 1
  if ($exe) {
    Warn 'Starting Docker Desktop, waiting up to 3 min...'
    Start-Process $exe.FullName
    for ($i = 0; $i -lt 36; $i++) {
      Start-Sleep 5
      docker info *> $null
      if ($LASTEXITCODE -eq 0) { break }
    }
  }
}
docker info *> $null
$dockerUp = ($LASTEXITCODE -eq 0)

Step 'npm install (also runs prisma generate)'
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

if ($dockerUp) {
  Step 'Starting Postgres + pgAdmin'
  docker compose up -d
  Step 'Waiting for Postgres to be healthy'
  for ($i = 0; $i -lt 30; $i++) {
    $state = docker inspect -f '{{.State.Health.Status}}' cashfo-postgres 2>$null
    if ($state -eq 'healthy') { break }
    Start-Sleep 2
  }
  Ok "postgres: $state"

  Step 'Prisma: db push + seed'
  npx prisma db push
  if ($LASTEXITCODE -ne 0) { throw 'prisma db push failed' }
  npm run seed
  if ($LASTEXITCODE -ne 0) { Warn 'seed failed - check the output above' }
} else {
  Warn 'Docker is not running yet (usually needs a reboot after first install).'
  Warn 'Reboot, start Docker Desktop once, then re-run:  .\windows-dev-setup.ps1 -Drive ' + $Drive + ' -SkipApps'
}

# --- summary ----------------------------------------------------------------
Write-Host "`n================ DONE ================" -ForegroundColor Green
Write-Host "Workspace : $root"
Write-Host "Project   : $repoDir"
Write-Host "Postgres  : localhost:5432  (postgres / postgres, db admin_panel)"
Write-Host "pgAdmin   : http://localhost:5050"
Write-Host "Admin     : admin@example.com / ChangeMe123!  (seeded)"
Write-Host "`nNext:  cd $repoDir ; code . ; npm run start:dev   -> http://localhost:5000"
