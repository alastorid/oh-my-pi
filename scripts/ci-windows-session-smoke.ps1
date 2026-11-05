param([Parameter(Mandatory = $true)][string]$Binary)

$ErrorActionPreference = 'Stop'
$Binary = (Resolve-Path $Binary).Path
$runtime = Join-Path $env:RUNNER_TEMP 'omp-session-smoke'
$env:HOME = Join-Path $runtime 'home'
$env:USERPROFILE = $env:HOME
$env:LOCALAPPDATA = Join-Path $runtime 'local'
$env:XDG_DATA_HOME = Join-Path $runtime 'xdg'
# Enables model selection at startup; no prompt or network inference is sent.
$env:OPENAI_API_KEY = 'offline-smoke-test-placeholder'
$cwd1 = Join-Path $runtime 'first'
$cwd2 = Join-Path $runtime 'second'
New-Item -ItemType Directory -Force -Path $env:HOME, $env:LOCALAPPDATA, $env:XDG_DATA_HOME, $cwd1, $cwd2 | Out-Null

& $Binary --version
if ($LASTEXITCODE -ne 0) { throw 'Version check failed' }
$help = & $Binary --help
if ($LASTEXITCODE -ne 0 -or ($help -join "`n") -notmatch '--session-id') { throw 'Help check failed' }
& $Binary --smoke-test
if ($LASTEXITCODE -ne 0) { throw 'Bundled runtime smoke test failed' }

$id = '550e8400-e29b-41d4-a716-446655440000'
function Invoke-Rpc([string]$Directory, [string]$Command) {
   Push-Location $Directory
   try {
      $lines = $Command | & $Binary --session-id $id --mode rpc
      if ($LASTEXITCODE -ne 0) { throw "RPC process failed: $LASTEXITCODE" }
      $frames = @($lines | ForEach-Object { $_ | ConvertFrom-Json })
      $reply = @($frames | Where-Object { $_.type -eq 'response' -and $_.id -eq 'probe' })
      if ($reply.Count -ne 1 -or -not $reply[0].success) { throw "RPC command failed: $($lines -join "`n")" }
      return $reply[0]
   } finally {
      Pop-Location
   }
}

# Naming the session writes metadata without contacting a model. Reopening from
# another working directory must preserve both the exact ID and that metadata.
Invoke-Rpc $cwd1 '{"id":"probe","type":"set_session_name","name":"Windows offline persistence probe"}' | Out-Null
$second = Invoke-Rpc $cwd2 '{"id":"probe","type":"get_state"}'
$third = Invoke-Rpc $cwd1 '{"id":"probe","type":"get_state"}'
foreach ($state in @($second.data, $third.data)) {
   if ($state.sessionId -cne $id -or $state.sessionName -cne 'Windows offline persistence probe') {
      throw "Incorrect resumed state: $($state | ConvertTo-Json -Depth 4 -Compress)"
   }
   if (-not $state.sessionFile -or -not (Test-Path -LiteralPath $state.sessionFile)) { throw 'Missing session file' }
}
if ($second.data.sessionFile -cne $third.data.sessionFile) { throw 'Session file changed across launches' }
$header = @(Get-Content -LiteralPath $second.data.sessionFile -TotalCount 2 | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.type -eq 'session' })
if ($header.Count -ne 1) { throw 'Missing or duplicate session header' }
if ($header[0].id -cne $id) { throw "Session header ID does not match: $($header[0].id)" }
Write-Host 'Windows executable session persistence smoke test passed.'
