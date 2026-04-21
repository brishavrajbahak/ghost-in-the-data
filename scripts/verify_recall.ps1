param(
  [int]$MaxAnomalies = 12
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Assert([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

Write-Host "Verifying backend is reachable..."
try {
  $root = Invoke-RestMethod -Uri "http://localhost:8000/" -Method Get -TimeoutSec 10
} catch {
  throw "Backend not reachable at http://localhost:8000/. Start docker compose first."
}

Write-Host "Creating an analysis session via /api/analyze..."
$csvPath = Join-Path $repoRoot "frontend\public\sample-datasets\server_metrics.csv"
Assert (Test-Path $csvPath) ("Missing sample dataset: {0}" -f $csvPath)

Add-Type -AssemblyName System.Net.Http
$client = [System.Net.Http.HttpClient]::new()
$multipart = [System.Net.Http.MultipartFormDataContent]::new()
$fileStream = [System.IO.File]::OpenRead($csvPath)
$fileContent = [System.Net.Http.StreamContent]::new($fileStream)
$fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("text/csv")
$multipart.Add($fileContent, "file", [System.IO.Path]::GetFileName($csvPath))
$multipart.Add([System.Net.Http.StringContent]::new('["zscore","iqr","isoforest","lof","autoencoder"]'), "detectors")
$multipart.Add([System.Net.Http.StringContent]::new([string]$MaxAnomalies), "max_anomalies")

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
Assert ([bool]$analyze.session_id) "Analyze returned no session_id (persistence likely down)."
Assert ($analyze.anomalies -and $analyze.anomalies.Count -ge 1) "Analyze returned no anomalies."

$analysisSessionId = $analyze.session_id
$first = $analyze.anomalies[0]
Write-Host ("Analyze OK. analysis_session_id={0} top_index={1} top_column={2}" -f $analysisSessionId, $first.index, $first.column)

Write-Host "Checking /api/sessions includes the new session..."
$sessions = Invoke-RestMethod -Uri "http://localhost:8000/api/sessions?limit=25" -Method Get -TimeoutSec 20
$found = $sessions | Where-Object { $_.id -eq $analysisSessionId }
Assert ([bool]$found) "Created session not found in /api/sessions."
Write-Host "Sessions list OK."

Write-Host "Checking /api/sessions/{id} returns anomalies and csv_text..."
$details = Invoke-RestMethod -Uri ("http://localhost:8000/api/sessions/{0}" -f $analysisSessionId) -Method Get -TimeoutSec 20
Assert ($details.anomalies -and $details.anomalies.Count -ge 1) "Session details missing anomalies."
Assert ([bool]$details.csv_text) "Session details missing csv_text (expected for small CSV)."
Write-Host ("Session details OK. csv_text chars={0}" -f (($details.csv_text | Measure-Object -Character).Characters))

Write-Host "Starting chat linked to this analysis session..."
$chatStartPayload = @{
  anomaly_data = $first
  correlation_data = @()
  analysis_session_id = $analysisSessionId
} | ConvertTo-Json -Depth 10

$chatStart = Invoke-RestMethod -Uri "http://localhost:8000/api/chat/start" -Method Post -ContentType "application/json" -Body $chatStartPayload -TimeoutSec 60
Assert ([bool]$chatStart.session_id) "Chat start returned no session_id."
$chatId = $chatStart.session_id
Write-Host ("Chat started. chat_id={0}" -f $chatId)

Write-Host "Sending follow-up and verifying persisted chat history..."
$chatSendPayload = @{
  session_id = $chatId
  message = "Summarize the anomaly in 2 bullet points and suggest 1 likely external cause."
} | ConvertTo-Json -Depth 10

$chatSend = Invoke-RestMethod -Uri "http://localhost:8000/api/chat/send" -Method Post -ContentType "application/json" -Body $chatSendPayload -TimeoutSec 90
Assert ($chatSend.messages -and $chatSend.messages.Count -ge 3) "Chat send returned too few messages."

Start-Sleep -Seconds 1
$chats = Invoke-RestMethod -Uri ("http://localhost:8000/api/sessions/{0}/chats?limit=10" -f $analysisSessionId) -Method Get -TimeoutSec 20
Assert ($chats -and $chats.Count -ge 1) "No chats persisted for session."

$persisted = Invoke-RestMethod -Uri ("http://localhost:8000/api/chats/{0}" -f $chatId) -Method Get -TimeoutSec 20
Assert ($persisted.messages -and $persisted.messages.Count -ge 3) "Persisted chat missing messages (rehydration failed)."
Write-Host ("Persisted chat OK. messages={0}" -f $persisted.messages.Count)

Write-Host "Recall verification passed."

