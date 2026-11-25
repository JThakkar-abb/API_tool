param(
  [ValidateSet("production", "development")]
  [string]$Mode = "production"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $RepoRoot "backend"
$Frontend = Join-Path $RepoRoot "frontend"

Write-Host "Installing dependencies..."
Push-Location $Backend
npm install
Pop-Location

Push-Location $Frontend
npm install
npm run build
Pop-Location

$portListeners = Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue
foreach ($listener in $portListeners) {
  if ($listener.OwningProcess) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

if ($Mode -eq "development") {
  Write-Host "Starting backend and Vite development server..."

  Push-Location $Backend
  Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "npm run dev"
  )
  Pop-Location

  Push-Location $Frontend
  Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "npm run dev"
  )
  Pop-Location

  Write-Host "Frontend: http://us-l-pf4x9mc1:5173"
  Write-Host "Backend:  http://us-l-pf4x9mc1:3001"
  exit
}

Write-Host "Starting production app..."
Push-Location $Backend
$env:NODE_ENV = "production"
$env:HOST = "127.0.0.1"
$env:PORT = "3001"
node index.js
Pop-Location
