param([string]$Out)
function Rot13([string]$s) { -join ($s.ToCharArray() | ForEach-Object { $c = [int]$_; if ($c -ge 65 -and $c -le 90) { [char](65 + ($c - 65 + 13) % 26) } elseif ($c -ge 97 -and $c -le 122) { [char](97 + ($c - 97 + 13) % 26) } else { $_ } }) }

# --- last-run evidence: path -> datetime ---
$runs = @{}
function AddRun($path, [datetime]$t) { if (-not $path) { return }; $k = $path.ToLower(); if (-not $runs.ContainsKey($k) -or $runs[$k] -lt $t) { $runs[$k] = $t } }

# Known folder GUIDs used in UserAssist names
$kf = @{
  '{6D809377-6AF0-444B-8957-A3773F02200E}' = $env:ProgramFiles
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}' = ${env:ProgramFiles(x86)}
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}' = "$env:WINDIR\System32"
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}' = $env:WINDIR
  '{0139D44E-6AFE-49F2-8690-3DAFCAE6FFB8}' = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs"
  '{A77F5D77-2E2B-44C3-A6A2-ABA601054A51}' = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
  '{9E3995AB-1F9C-4F13-B827-48B24B6C7174}' = "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned"
}
$uaSource = 0
foreach ($g in Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist' -ErrorAction SilentlyContinue) {
  $key = Join-Path $g.PSPath 'Count'
  $item = Get-Item $key -ErrorAction SilentlyContinue; if (-not $item) { continue }
  foreach ($vn in $item.GetValueNames()) {
    $bytes = $item.GetValue($vn); if ($bytes -isnot [byte[]] -or $bytes.Length -lt 68) { continue }
    $ft = [BitConverter]::ToInt64($bytes, 60); if ($ft -le 0) { continue }
    try { $t = [datetime]::FromFileTime($ft) } catch { continue }
    $name = Rot13 $vn
    foreach ($k in $kf.Keys) { if ($name.StartsWith($k, 'OrdinalIgnoreCase')) { $name = $kf[$k] + $name.Substring($k.Length) } }
    AddRun $name $t; $uaSource++
  }
}
# BAM (background activity moderator): last execution per exe
$bamSource = 0
foreach ($base in 'HKLM:\SYSTEM\CurrentControlSet\Services\bam\State\UserSettings','HKLM:\SYSTEM\CurrentControlSet\Services\bam\UserSettings') {
  foreach ($u in Get-ChildItem $base -ErrorAction SilentlyContinue) {
    $item = Get-Item $u.PSPath
    foreach ($vn in $item.GetValueNames()) {
      $b = $item.GetValue($vn); if ($b -isnot [byte[]] -or $b.Length -lt 8) { continue }
      $p = $vn -replace '^\\Device\\HarddiskVolume\d+', 'C:'
      try { AddRun $p ([datetime]::FromFileTime([BitConverter]::ToInt64($b, 0))); $bamSource++ } catch {}
    }
  }
}
# resolve .lnk targets for start-menu entries
$sh = New-Object -ComObject WScript.Shell
foreach ($k in @($runs.Keys)) { if ($k.EndsWith('.lnk') -and (Test-Path -LiteralPath $k)) { try { $tg = $sh.CreateShortcut($k).TargetPath; if ($tg) { AddRun $tg $runs[$k] } } catch {} } }

# --- installed apps ---
$keys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$apps = foreach ($e in Get-ItemProperty $keys -ErrorAction SilentlyContinue) {
  if (-not $e.DisplayName -or $e.SystemComponent -eq 1 -or $e.ParentKeyName) { continue }
  $loc = $e.InstallLocation
  if (-not $loc -and $e.DisplayIcon) { $ic = ($e.DisplayIcon -split ',')[0].Trim('"'); if ($ic -match '\.exe$') { $loc = Split-Path $ic -Parent } }
  if (-not $loc -and $e.UninstallString -match '"?([A-Za-z]:\\[^"]+?\.exe)') { $loc = Split-Path $Matches[1] -Parent }
  if ($loc) { $loc = $loc.Trim('"').TrimEnd('\') }
  $last = $null
  if ($loc -and $loc.Length -gt 6) { $pre = $loc.ToLower() + '\'; foreach ($k in $runs.Keys) { if ($k.StartsWith($pre) -and ($null -eq $last -or $runs[$k] -gt $last)) { $last = $runs[$k] } } }
  [pscustomobject]@{
    name = $e.DisplayName; publisher = $e.Publisher; version = $e.DisplayVersion
    installDate = $e.InstallDate; location = $loc
    regKB = $e.EstimatedSize; lastRun = if ($last) { $last.ToString('yyyy-MM-dd') } else { $null }
  }
}
$apps = $apps | Sort-Object name -Unique
[pscustomobject]@{ userAssist = $uaSource; bam = $bamSource; apps = $apps; runs = ($runs.GetEnumerator() | ForEach-Object { [pscustomobject]@{ p = $_.Key; t = $_.Value.ToString('yyyy-MM-dd') } }) } | ConvertTo-Json -Depth 4 -Compress | Set-Content -Encoding utf8 $Out
"apps: $(@($apps).Count), with lastRun: $(@($apps | Where-Object lastRun).Count), userAssist entries: $uaSource, bam entries: $bamSource"
