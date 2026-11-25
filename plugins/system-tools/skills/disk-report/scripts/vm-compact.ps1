# Shrink WSL / Docker Desktop virtual disks (vhdx) so space freed inside the VM returns to the host drive.
# Safe path only: prune Docker build cache -> fstrim inside each distro -> stop Docker + WSL -> diskpart "compact vdisk"
# (attached read-only, needs one UAC approval) -> restart Docker. It never turns on WSL sparse mode, which Microsoft still
# marks unsafe (wsl --manage --set-sparse needs --allow-unsafe).
# This stops Docker containers and every WSL session for a few minutes. Run it only when that is fine.
# Usage: pwsh -NoProfile -File vm-compact.ps1 [-DryRun] [-NoPrune] [-NoRestartDocker]
param([switch]$DryRun, [switch]$NoPrune, [switch]$NoRestartDocker)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Gb($p) { '{0,6:N2} GB' -f ((Get-Item -LiteralPath $p).Length / 1GB) }

$disks = @()
$dd = Join-Path $env:LOCALAPPDATA 'Docker\wsl\disk\docker_data.vhdx'
if (Test-Path -LiteralPath $dd) { $disks += [pscustomobject]@{ Name = 'docker_data'; Path = $dd; Distro = $null } }
Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath
    if ($p.BasePath) {
        $v = Join-Path ($p.BasePath -replace '^\\\\\?\\', '') 'ext4.vhdx'
        if (Test-Path -LiteralPath $v) { $disks += [pscustomobject]@{ Name = $p.DistributionName; Path = $v; Distro = $p.DistributionName } }
    }
}
$dockerWasRunning = [bool](Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)
"virtual disks found:"
$disks | ForEach-Object { "  {0}  {1,-14} {2}" -f (Gb $_.Path), $_.Name, $_.Path }
"Docker Desktop running: $dockerWasRunning"
if ($DryRun) { "dry run: nothing changed"; return }

$free0 = (Get-PSDrive -Name $env:SystemDrive.TrimEnd(':')).Free

if ($dockerWasRunning) {
    docker info *> $null
    if ($LASTEXITCODE -eq 0 -and -not $NoPrune) {
        "pruning Docker build cache (images, containers, volumes are not touched)..."
        docker builder prune -a -f 2>&1 | Select-Object -Last 1 | ForEach-Object { "  $_" }
    }
}
"trimming free blocks inside distros..."
foreach ($d in $disks | Where-Object Distro) {
    wsl -d $d.Distro -u root sh -c "fstrim -av" 2>&1 | Select-Object -First 2 | ForEach-Object { "  [$($d.Distro)] $_" }
}
if ($dockerWasRunning) {
    "stopping Docker Desktop..."
    docker desktop stop 2>&1 | Out-Null
    $t = 0; while ((Get-Process 'Docker Desktop', 'com.docker.backend' -ErrorAction SilentlyContinue) -and $t -lt 120) { Start-Sleep 3; $t += 3 }
}
"wsl --shutdown"
wsl --shutdown
Start-Sleep 5

$before = @{}; foreach ($d in $disks) { $before[$d.Path] = (Get-Item -LiteralPath $d.Path).Length }
$lines = foreach ($d in $disks) { "select vdisk file=`"$($d.Path)`""; 'attach vdisk readonly'; 'compact vdisk'; 'detach vdisk' }
$script = Join-Path $env:TEMP 'vm-compact-diskpart.txt'
$log = Join-Path $env:TEMP 'vm-compact-diskpart.log'
Set-Content -LiteralPath $script -Value (($lines + 'exit') -join "`r`n") -Encoding ascii
if (Test-Path $log) { Remove-Item $log -Force }
"compacting (approve the UAC prompt if it appears)..."
$p = Start-Process -FilePath cmd.exe -ArgumentList '/c', "diskpart /s `"$script`" > `"$log`" 2>&1" -Verb RunAs -PassThru -WindowStyle Hidden
$p.WaitForExit(1800000) | Out-Null
"diskpart exit code: $($p.ExitCode)"

"result:"
foreach ($d in $disks) { "  {0} -> {1}  {2}" -f ('{0,6:N2} GB' -f ($before[$d.Path] / 1GB)), (Gb $d.Path), $d.Name }
$free1 = (Get-PSDrive -Name $env:SystemDrive.TrimEnd(':')).Free
"{0} free: {1:N1} -> {2:N1} GB ({3:N1} GB)" -f $env:SystemDrive, ($free0 / 1GB), ($free1 / 1GB), (($free1 - $free0) / 1GB)

if ($dockerWasRunning -and -not $NoRestartDocker) {
    "restarting Docker Desktop..."
    Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe' | Out-Null
}
