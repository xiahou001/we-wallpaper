# nowplaying.ps1 - Windows Now Playing via SMTC (GlobalSystemMediaTransportControls)
# Outputs one JSON line every 2s with the current media session's metadata.
# Requires Windows 10/11; runs under PowerShell 5.1+ (no execution policy changes persist).
$ErrorActionPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function JsonEscape($s) {
  if ($null -eq $s) { return '' }
  $s = [string]$s
  $s = $s.Replace('\', '\\').Replace('"', '\"').Replace("`n", '\n').Replace("`r", '\r').Replace("`t", '\t')
  return $s
}

while ($true) {
  $out = $null
  try {
    $session = $manager.GetSessions() | Sort-Object { $_.PlaybackStatus } | Select-Object -Last 1
    if ($session) {
      $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $tl = $session.GetTimelineProperties()
      $status = switch ($session.PlaybackStatus) {
        'Playing'    { 'playing' }
        'Paused'     { 'paused' }
        'Interrupted'{ 'paused' }
        default      { 'stopped' }
      }
      $posSec = 0
      try { $posSec = [math]::Round($tl.Position.TotalSeconds, 1) } catch {}
      $durSec = 0
      try { $durSec = [math]::Round($tl.EndTime.TotalSeconds, 1) } catch {}
      $out = '{"available":true,"title":"' + (JsonEscape $props.Title) + '","artist":"' + (JsonEscape $props.Artist) + '","album":"' + (JsonEscape $props.AlbumTitle) + '","status":"' + $status + '","position":' + $posSec + ',"duration":' + $durSec + '}'
    } else {
      $out = '{"available":false}'
    }
  } catch {
    $out = '{"available":false}'
  }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
  Start-Sleep -Seconds 2
}
