param([string]$List,[string]$Out)
$opt=[IO.EnumerationOptions]::new(); $opt.RecurseSubdirectories=$true; $opt.IgnoreInaccessible=$true; $opt.AttributesToSkip=[IO.FileAttributes]::ReparsePoint
$r=foreach($p in Get-Content -Encoding utf8 $List){ $m=[datetime]::MinValue; try{ foreach($f in [IO.DirectoryInfo]::new($p).EnumerateFiles('*',$opt)){ if($f.LastWriteTime -gt $m){$m=$f.LastWriteTime} } }catch{}; [pscustomobject]@{p=$p; t=if($m -gt [datetime]::MinValue){$m.ToString('yyyy-MM-dd')}else{$null}} }
$r | ConvertTo-Json -Compress | Set-Content -Encoding utf8 $Out
"$(@($r).Count) done"
