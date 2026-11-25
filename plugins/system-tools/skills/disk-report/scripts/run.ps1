# Disk report: scan a drive and build an HTML report. Read-only: deletes nothing on the scanned drive.
# Usage: pwsh -NoProfile -File run.ps1 [-Drive C:] [-OutRoot <dir>]
# Output: <OutRoot>\<yyyy-MM-dd_HHmm>\report.html (+ data.json for comparing with the next run)
param(
    [string]$Drive = 'C:',
    [string]$OutRoot = (Join-Path $env:USERPROFILE '.disk-report')
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
$Drive = $Drive.TrimEnd('\').ToUpper()
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$work = Join-Path $OutRoot ("{0}_{1}" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'), $Drive.TrimEnd(':'))
New-Item -ItemType Directory -Force $work | Out-Null
$py = (Get-Command python -ErrorAction SilentlyContinue)?.Source
if (-not $py) { throw 'python not found on PATH' }

Write-Host "[1/5] scanning $Drive\ ..."
pwsh -NoProfile -File (Join-Path $here 'fullscan.ps1') -Root "$Drive\" -Out (Join-Path $work 'scan.json')
if ($LASTEXITCODE) { throw 'fullscan failed' }

Write-Host '[2/5] installed apps + run history ...'
pwsh -NoProfile -File (Join-Path $here 'apps.ps1') -Out (Join-Path $work 'apps.json')
if ($LASTEXITCODE) { throw 'apps failed' }

Write-Host '[3/5] disk info ...'
$ld = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$Drive'"
$model = ''
try {
    $pd = Get-Partition -DriveLetter $Drive.TrimEnd(':') | Get-Disk
    $model = "$($pd.FriendlyName) · $($pd.BusType)"
} catch {}
[pscustomobject]@{ size = $ld.Size; free = $ld.FreeSpace; model = $model } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $work 'disk.json')

Write-Host '[4/5] folder dates ...'
$env:PYTHONIOENCODING = 'utf-8'
& $py -I (Join-Path $here 'build.py') targets $work $here
if ($LASTEXITCODE) { throw 'targets failed' }
pwsh -NoProfile -File (Join-Path $here 'newest.ps1') -List (Join-Path $work 'targets.txt') -Out (Join-Path $work 'newest.json')
if ($LASTEXITCODE) { throw 'newest failed' }

Write-Host '[5/5] building report ...'
& $py -I (Join-Path $here 'build.py') report $work $here
if ($LASTEXITCODE) { throw 'build failed' }
# keep only the small files needed for comparison; drop raw scan intermediates
Remove-Item (Join-Path $work 'scan.json'), (Join-Path $work 'targets.txt'), (Join-Path $work 'newest.json') -ErrorAction SilentlyContinue
