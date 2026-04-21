param(
  [string]$ComposeFile = "docker-compose.prod.yml"
)

$ErrorActionPreference = "Stop"

Push-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
Pop-Location | Out-Null

Write-Host "Starting prod stack ($ComposeFile)..." -ForegroundColor Cyan
docker compose -f $ComposeFile up -d --build

function Wait-HttpOk([string]$Url, [int]$Seconds = 90) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 400) { return $true }
    } catch {}
    Start-Sleep -Seconds 2
  }
  return $false
}

if (-not (Wait-HttpOk "http://localhost:8080/" 90)) {
  Write-Host "Frontend failed." -ForegroundColor Red
  docker compose -f $ComposeFile ps
  docker compose -f $ComposeFile logs --tail 120 frontend
  exit 1
}

if (-not (Wait-HttpOk "http://localhost:8080/api/health" 90)) {
  Write-Host "Backend health (via proxy) failed." -ForegroundColor Red
  docker compose -f $ComposeFile ps
  docker compose -f $ComposeFile logs --tail 120 backend
  exit 1
}

Write-Host "OK: backend + frontend responding." -ForegroundColor Green
