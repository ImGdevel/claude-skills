param([string]$Root = 'C:\', [int]$MaxDepth = 6, [string]$Out)
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Collections.Generic;
public static class Scan {
    public static Dictionary<string, long[]> Run(string root, int maxDepth, out long total, out long files) {
        var d = new Dictionary<string, long[]>(StringComparer.OrdinalIgnoreCase);
        var opt = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint };
        total = 0; files = 0;
        var rootDi = new DirectoryInfo(root);
        foreach (var f in rootDi.EnumerateFiles("*", new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = 0 })) {
            Add(d, root + "(root files)", f.Length); total += f.Length; files++;
        }
        foreach (var sub in rootDi.EnumerateDirectories("*", new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = FileAttributes.ReparsePoint })) {
            try {
                foreach (var f in sub.EnumerateFiles("*", opt)) {
                    long len = f.Length; total += len; files++;
                    string rel = f.FullName.Substring(root.Length);
                    int depth = 0, idx = -1;
                    while (depth < maxDepth) {
                        idx = rel.IndexOf('\\', idx + 1);
                        if (idx < 0) break;
                        Add(d, rel.Substring(0, idx), len);
                        depth++;
                    }
                }
            } catch { }
        }
        return d;
    }
    static void Add(Dictionary<string, long[]> d, string k, long len) {
        long[] v; if (!d.TryGetValue(k, out v)) { v = new long[2]; d[k] = v; }
        v[0] += len; v[1]++;
    }
}
"@
$sw = [Diagnostics.Stopwatch]::StartNew()
$total = 0L; $files = 0L
$d = [Scan]::Run($Root, $MaxDepth, [ref]$total, [ref]$files)
$min = 100MB
$rows = foreach ($kv in $d.GetEnumerator()) { if ($kv.Value[0] -ge $min) { [pscustomobject]@{ p = $kv.Key; b = $kv.Value[0]; n = $kv.Value[1] } } }
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($Root.Substring(0,2))'"
[pscustomobject]@{
    root = $Root; scannedBytes = $total; files = $files
    diskSize = $disk.Size; diskFree = $disk.FreeSpace; seconds = [int]$sw.Elapsed.TotalSeconds
    dirs = $rows | Sort-Object b -Descending
} | ConvertTo-Json -Depth 4 -Compress | Set-Content -Encoding utf8 $Out
"done: {0:N1}GB scanned, {1:N0} files, {2} dirs >=100MB, {3}s" -f ($total/1GB), $files, @($rows).Count, [int]$sw.Elapsed.TotalSeconds
