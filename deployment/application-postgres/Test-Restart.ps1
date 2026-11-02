param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^language-coach-m3a-r1(?:-[a-z0-9-]{1,24})?$')]
  [string]$ProjectName,
  [Parameter(Mandatory=$true)]
  [switch]$AllowDisposableRestart
)
$ErrorActionPreference='Stop'
if(-not $AllowDisposableRestart){ throw 'Explicit disposable restart approval required' }
$restartRepo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$restartArtifacts=Join-Path $restartRepo '.release-validation/migration-m3-a-r1'
$restartContainer="$ProjectName-app-postgres-1"
$restartProbe="$ProjectName-restart-probe"
New-Item -ItemType Directory -Force -Path $restartArtifacts | Out-Null
$restartOut=Join-Path $restartArtifacts 'restart-probe.stdout.log'
$restartErr=Join-Path $restartArtifacts 'restart-probe.stderr.log'
$restartProcess=$null
Push-Location $restartRepo
try {
  $restartLabels=& docker --context desktop-linux inspect $restartContainer --format '{{json .Config.Labels}}'
  if($LASTEXITCODE -ne 0){throw 'Cannot inspect owned restart target'}
  if(($restartLabels | ConvertFrom-Json).'com.docker.compose.project' -ne $ProjectName){ throw 'Unexpected restart target' }
  $restartMounts=& docker --context desktop-linux inspect $restartContainer --format '{{json .Mounts}}'
  if($LASTEXITCODE -ne 0){throw 'Cannot inspect owned restart volume'}
  $restartVolume=@(($restartMounts | ConvertFrom-Json) | Where-Object {$_.Destination -eq '/var/lib/postgresql/data'})
  if($restartVolume.Count -ne 1 -or $restartVolume[0].Name -ne "${ProjectName}_app-data"){ throw 'Unexpected data volume' }
  $restartArgs=@('--context','desktop-linux','compose','--project-name',$ProjectName,
    '--env-file','deployment/application-postgres/.env.example','-f','deployment/application-postgres/compose.json',
    'run','--rm','--no-deps','--name',$restartProbe,'tests','node','-r',
    '/opt/m3a/node_modules/ts-node/register/transpile-only',
    '/workspace/deployment/application-postgres/restart-probe.cjs')
  $restartProcess=Start-Process -FilePath (Get-Command docker).Source -ArgumentList $restartArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $restartOut -RedirectStandardError $restartErr
  # Keep a process handle before exit so Windows PowerShell retains ExitCode.
  $null=$restartProcess.Handle
  $restartReadyBy=[DateTime]::UtcNow.AddSeconds(20)
  while(-not $restartProcess.HasExited){
    if((Test-Path -LiteralPath $restartOut) -and (Select-String -LiteralPath $restartOut -SimpleMatch 'R1_RESTART_READY' -Quiet)){break}
    if([DateTime]::UtcNow -ge $restartReadyBy){throw 'Probe did not reach its bounded ready barrier'}
    Start-Sleep -Milliseconds 50
  }
  if($restartProcess.HasExited){throw 'Probe failed before restart; inspect artifact logs'}
  # The probe reached a real in-flight pg_sleep on a verified synthetic target.
  & docker --context desktop-linux restart --timeout 3 $restartContainer
  if($LASTEXITCODE -ne 0){throw 'Owned disposable restart failed'}
  if(-not $restartProcess.WaitForExit(30000)){throw 'Probe did not finish within its bound'}
  if($restartProcess.ExitCode -ne 0 -or -not (Select-String -LiteralPath $restartOut -SimpleMatch 'R1_RESTART_PASS' -Quiet)){throw 'Restart recovery probe failed'}
  Get-Content -LiteralPath $restartOut
} finally {
  if($null -ne $restartProcess -and -not $restartProcess.HasExited){
    # Only the explicitly named probe container is stopped, never other projects.
    & docker --context desktop-linux stop --timeout 2 $restartProbe | Out-Null
    $restartProcess.WaitForExit(5000) | Out-Null
  }
  Pop-Location
}
