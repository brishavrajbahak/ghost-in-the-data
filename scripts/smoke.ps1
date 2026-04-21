param(
  [switch]$Down
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if ($Down) {
  docker compose down
  Write-Host "Stopped containers."
  exit 0
}

Write-Host "Building and starting containers..."
docker compose up -d --build

function Wait-ForHttpOk([string]$Url, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $res = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method GET -TimeoutSec 5
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) { return }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  throw "Timed out waiting for $Url"
}

Write-Host "Waiting for backend..."
Wait-ForHttpOk -Url "http://localhost:8000/"

Write-Host "Uploading sample CSV to /api/analyze..."
$csvPath = Join-Path $repoRoot "frontend\public\sample-datasets\server_metrics.csv"
if (!(Test-Path $csvPath)) { throw "Missing sample dataset: $csvPath" }

Add-Type -AssemblyName System.Net.Http
$client = [System.Net.Http.HttpClient]::new()

$multipart = [System.Net.Http.MultipartFormDataContent]::new()
$fileStream = [System.IO.File]::OpenRead($csvPath)
$fileContent = [System.Net.Http.StreamContent]::new($fileStream)
$fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("text/csv")
$multipart.Add($fileContent, "file", [System.IO.Path]::GetFileName($csvPath))

$multipart.Add([System.Net.Http.StringContent]::new('["zscore","iqr","isoforest","lof","autoencoder"]'), "detectors")
$multipart.Add([System.Net.Http.StringContent]::new("25"), "max_anomalies")

try {
  $resp = $client.PostAsync("http://localhost:8000/api/analyze", $multipart).GetAwaiter().GetResult()
  $resp.EnsureSuccessStatusCode() | Out-Null
  $json = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
} finally {
  $fileStream.Dispose()
  $multipart.Dispose()
  $client.Dispose()
}

$analyze = $json | ConvertFrom-Json
if (-not $analyze.anomalies -or $analyze.anomalies.Count -lt 1) {
  throw "Analyze returned no anomalies."
}

$first = $analyze.anomalies[0]
Write-Host ("Analyze OK. Top anomaly: index={0} column={1} severity={2}" -f $first.index, $first.column, $first.severity)

Write-Host "Calling /api/narrate for the top anomaly..."
$payload = @{
  anomaly_data = $first
  correlation_data = @()
} | ConvertTo-Json -Depth 10

$narrate = Invoke-RestMethod -Uri "http://localhost:8000/api/narrate" -Method Post -ContentType "application/json" -Body $payload
if (-not $narrate.story) {
  throw "Narrate returned empty story."
}

Write-Host "Narrate OK."
$preview = ($narrate.story.Substring(0, [Math]::Min(140, $narrate.story.Length)) -replace '\s+', ' ')
Write-Host ("Story preview: {0}" -f $preview)
if ($narrate.story -like "The Ghost encountered an error:*429*") {
  Write-Host "Warning: Gemini rate-limited (429). This is OK for smoke; try again later for a full narrative."
}

Write-Host "Starting chat session (/api/chat/start)..."
$chatStartPayload = @{
  anomaly_data = $first
  correlation_data = @()
} | ConvertTo-Json -Depth 10

$chatStart = Invoke-RestMethod -Uri "http://localhost:8000/api/chat/start" -Method Post -ContentType "application/json" -Body $chatStartPayload
if (-not $chatStart.session_id) { throw "Chat start returned no session_id." }
if (-not $chatStart.messages -or $chatStart.messages.Count -lt 1) { throw "Chat start returned no messages." }
Write-Host ("Chat started: {0}" -f $chatStart.session_id)

Write-Host "Sending follow-up (/api/chat/send)..."
$chatSendPayload = @{
  session_id = $chatStart.session_id
  message = "Give me 3 concrete checks to validate this anomaly in the dataset."
} | ConvertTo-Json -Depth 10

$chatSend = Invoke-RestMethod -Uri "http://localhost:8000/api/chat/send" -Method Post -ContentType "application/json" -Body $chatSendPayload
if (-not $chatSend.messages -or $chatSend.messages.Count -lt 3) { throw "Chat send returned too few messages." }
Write-Host "Chat OK."

Write-Host "Smoke test passed."
