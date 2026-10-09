[CmdletBinding()]
param(
  [string]$BaseUrl = "http://localhost:3001",
  [switch]$RunAll,
  [switch]$RunChat,
  [switch]$RunTranslation,
  [switch]$RunTts,
  [int]$ChatRuns = 3,
  [int]$TtsRuns = 2,
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Continue"
$BaseUrl = $BaseUrl.TrimEnd("/")
if ($RunAll) {
  $RunChat = $true
  $RunTranslation = $true
  $RunTts = $true
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path ([System.IO.Path]::GetTempPath()) "ai-english-friend-benchmark-$((Get-Date).ToString('yyyyMMdd-HHmmss')).json"
}

$results = New-Object System.Collections.Generic.List[object]

function Invoke-TimedRequest {
  param(
    [string]$Name,
    [string]$Path,
    [string]$Method = "GET",
    [object]$Body = $null,
    [string]$ContentType = "application/json"
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $status = 0
  $content = $null
  $headers = @{}
  $errorText = $null
  try {
    $requestArgs = @{
      Uri = "$BaseUrl$Path"
      Method = $Method
      UseBasicParsing = $true
    }
    if ($null -ne $Body) {
      $requestArgs.ContentType = $ContentType
      $requestArgs.Body = if ($ContentType -eq "application/json") { $Body | ConvertTo-Json -Depth 8 -Compress } else { $Body }
    }
    $response = Invoke-WebRequest @requestArgs
    $status = [int]$response.StatusCode
    $content = $response.Content
    $headers = $response.Headers
  } catch {
    $errorText = $_.Exception.Message
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try { $content = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { }
    }
  } finally {
    $stopwatch.Stop()
  }

  $record = [ordered]@{
    name = $Name
    path = $Path
    status = $status
    durationMs = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 2)
    ok = ($status -ge 200 -and $status -lt 300)
  }
  if ($errorText) { $record.error = $errorText }
  if ($headers["X-TTS-Processing-Ms"]) { $record.ttsProcessingMs = [double]$headers["X-TTS-Processing-Ms"] }
  if ($headers["X-TTS-Duration-Ms"]) { $record.audioDurationMs = [double]$headers["X-TTS-Duration-Ms"] }
  if ($content -and $ContentType -eq "application/json") {
    try { $record.payload = $content | ConvertFrom-Json } catch { $record.payloadParseError = $true }
  }
  $results.Add([pscustomobject]$record) | Out-Null
  return [pscustomobject]$record
}

Write-Host "AI English Friend Batch 4.1 benchmark"
Write-Host "Base URL: $BaseUrl"
Write-Host "This script does not simulate browser microphone input."

Invoke-TimedRequest -Name "backend health" -Path "/health" | Out-Null
Invoke-TimedRequest -Name "runtime config" -Path "/api/config" | Out-Null
Invoke-TimedRequest -Name "system resources" -Path "/api/system/resources" | Out-Null
Invoke-TimedRequest -Name "STT health" -Path "/api/stt/health" | Out-Null
Invoke-TimedRequest -Name "TTS health" -Path "/api/tts/health" | Out-Null

if ($RunChat) {
  $conversationId = $null
  for ($index = 1; $index -le [math]::Max(1, $ChatRuns); $index += 1) {
    $payload = @{
      message = "Batch 4.1 benchmark turn $index. Please answer naturally in two short sentences."
      level = "A2"
      messageType = "text"
    }
    if ($conversationId) { $payload.conversationId = $conversationId }
    $chatResult = Invoke-TimedRequest -Name ("chat run {0}" -f $index) -Path "/api/chat" -Method "POST" -Body $payload
    if ($chatResult.payload -and $chatResult.payload.conversationId) { $conversationId = $chatResult.payload.conversationId }
  }
  if ($conversationId) { Write-Host "Benchmark chat conversationId: $conversationId" }
}

if ($RunTranslation) {
  Invoke-TimedRequest -Name "translation" -Path "/api/translate" -Method "POST" -Body @{ targetLanguage = "vi"; text = "This is a Batch 4.1 translation benchmark." } | Out-Null
}

if ($RunTts) {
  for ($index = 1; $index -le [math]::Max(1, $TtsRuns); $index += 1) {
    Invoke-TimedRequest -Name ("TTS run {0}" -f $index) -Path "/api/tts/synthesize" -Method "POST" -Body @{ text = "This is a short Batch 4.1 voice benchmark."; voice = "am_michael"; speed = 1.0; language = "en-us" } -ContentType "application/json" | Out-Null
  }
}

$performance = Invoke-TimedRequest -Name "performance snapshot" -Path "/api/system/performance"
$resources = Invoke-TimedRequest -Name "final system resources" -Path "/api/system/resources"
$report = @{}
$report.generatedAt = (Get-Date).ToString("o")
$report.baseUrl = $BaseUrl
$report.options = @{ runChat = [bool]$RunChat; runTranslation = [bool]$RunTranslation; runTts = [bool]$RunTts; chatRuns = $ChatRuns; ttsRuns = $TtsRuns }
$report.requests = $results.ToArray()
$report.performance = $performance.payload
$report.resources = $resources.payload
$report.manualVoiceTest = "Use the browser UI: Space -> speak -> Space -> review/edit transcript -> Enter -> wait for Qwen/Kokoro -> Space -> second voice cycle. Confirm no STT_BUSY leak, TTS stuck state, OOM, or missing background maintenance."
$parent = Split-Path -Parent $OutputPath
if ($parent -and !(Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8

Write-Host ""
Write-Host "Results:"
$results | Select-Object name,status,durationMs,ok,ttsProcessingMs,audioDurationMs | Format-Table -AutoSize
Write-Host "JSON report: $OutputPath"
