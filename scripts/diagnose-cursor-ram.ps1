# Cursor-focused RAM diagnostic: process tree + all Cursor-related processes.
# Run in PowerShell. No admin required.

$ErrorActionPreference = "Stop"
$out = @()
$out += "=== Cursor RAM diagnostic @ $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===`n"

# Get all processes with parent and memory (WMI has WorkingSetSize, PageFileUsage = private commit)
$allProcs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize, PageFileUsage
$byPid = @{}
foreach ($p in $allProcs) { $byPid[$p.ProcessId] = $p }

# Find roots: process name is "Cursor" (or "Cursor.exe") - main Cursor windows
$cursorRootPids = @($allProcs | Where-Object { $_.Name -eq "Cursor.exe" } | ForEach-Object { $_.ProcessId })
if ($cursorRootPids.Count -eq 0) {
    $out += "No process named 'Cursor.exe' found. Listing Cursor-related by name instead.`n"
}

# Collect all descendants of a set of PIDs (recursive)
function Get-DescendantPids {
    param([int[]]$parentPids)
    $desc = @()
    $queue = [System.Collections.Queue]::new()
    foreach ($pp in $parentPids) { $queue.Enqueue($pp) }
    while ($queue.Count -gt 0) {
        $pp = $queue.Dequeue()
        $children = $allProcs | Where-Object { $_.ParentProcessId -eq $pp }
        foreach ($c in $children) {
            $desc += $c.ProcessId
            $queue.Enqueue($c.ProcessId)
        }
    }
    $desc
}

# Full Cursor tree: roots + all descendants
$cursorTreePids = @($cursorRootPids + (Get-DescendantPids -parentPids $cursorRootPids)) | Select-Object -Unique

# Also include processes that are named like Cursor/Electron/Code but might not be in tree (e.g. parent exited)
$cursorLikeNames = @("Cursor", "electron", "Code Helper", "Code - Insiders", "Cursor Helper", "GPU process", "Utility")
$cursorRelated = $allProcs | Where-Object {
    $n = $_.Name -replace "\.exe$", ""
    $cursorLikeNames | Where-Object { $n -like "${_}*" -or $n -eq $_ }
}
$relatedPids = @($cursorRelated | ForEach-Object { $_.ProcessId } | Select-Object -Unique)

# Combine: tree + related by name (in case some are orphaned or renamed)
$allCursorPids = @($cursorTreePids + $relatedPids) | Select-Object -Unique

# Node: often spawned by Cursor; attribute to Cursor if parent is in Cursor tree
$nodeProcs = $allProcs | Where-Object { $_.Name -eq "node.exe" }
$nodePidsWithCursorParent = @()
foreach ($np in $nodeProcs) {
    $ancestor = $np.ParentProcessId
    $depth = 0
    while ($ancestor -and $depth -lt 50) {
        if ($allCursorPids -contains $ancestor) { $nodePidsWithCursorParent += $np.ProcessId; break }
        $parentProc = $allProcs | Where-Object { $_.ProcessId -eq $ancestor } | Select-Object -First 1
        if (-not $parentProc) { break }
        $ancestor = $parentProc.ParentProcessId
        $depth++
    }
}
$allCursorPids = @($allCursorPids + $nodePidsWithCursorParent) | Select-Object -Unique

# Sum Working Set; get Private from .NET (WMI PageFileUsage is often wrong for Electron/sandbox)
$totalWS = 0
$totalPrivate = 0
$details = @()
foreach ($procId in $allCursorPids) {
    $p = $byPid[$procId]
    if (-not $p) { continue }
    $wsMB = [math]::Round($p.WorkingSetSize / 1MB, 2)
    $totalWS += $p.WorkingSetSize
    $privMB = 0
    $privBytes = 0
    try {
        $dotNet = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($dotNet) {
            $privBytes = $dotNet.PrivateMemorySize64
            $privMB = [math]::Round($privBytes / 1MB, 2)
        } else {
            $privBytes = $p.PageFileUsage
            $privMB = [math]::Round($p.PageFileUsage / 1MB, 2)
        }
    } catch {
        $privBytes = $p.PageFileUsage
        $privMB = [math]::Round($p.PageFileUsage / 1MB, 2)
    }
    $totalPrivate += $privBytes
    $details += [pscustomobject]@{ PID = $procId; Name = $p.Name; WS_MB = $wsMB; Private_MB = $privMB }
}

# Sort by private then working set to show biggest hitters
$details = $details | Sort-Object { $_.Private_MB + $_.WS_MB } -Descending

$out += "--- Cursor process tree + related (by name) + Node with Cursor parent ---"
$out += "  Total processes: $($allCursorPids.Count)"
$out += "  Total Working Set: $([math]::Round($totalWS / 1MB, 2)) MB"
$out += "  Total Private (committed): $([math]::Round($totalPrivate / 1MB, 2)) MB"
$out += ""

$out += "--- Per-process (Cursor tree + related), sorted by memory ---"
foreach ($d in $details) {
    $out += "  PID $($d.PID) $($d.Name): WorkingSet=$($d.WS_MB) MB, Private=$($d.Private_MB) MB"
}

# All processes with high private memory (.NET PrivateMemorySize64 - more reliable than WMI)
$out += "`n--- All processes with Private > 400 MB (.NET PrivateMemorySize64) ---"
$bigPrivateList = @()
Get-Process | ForEach-Object {
    $privMB = [math]::Round($_.PrivateMemorySize64 / 1MB, 2)
    if ($privMB -gt 400) {
        $bigPrivateList += [pscustomobject]@{
            ProcessId = $_.Id; Name = $_.ProcessName; WorkingSet_MB = [math]::Round($_.WorkingSet64/1MB,2); Private_MB = $privMB
        }
    }
}
$bigPrivateList = $bigPrivateList | Sort-Object Private_MB -Descending
foreach ($b in $bigPrivateList) {
    $tag = if ($allCursorPids -contains $b.ProcessId) { " [CURSOR TREE]" } else { "" }
    $out += "  PID $($b.ProcessId) $($b.Name): WS=$($b.WorkingSet_MB) MB, Private=$($b.Private_MB) MB$tag"
}

$reportPath = Join-Path $PSScriptRoot "cursor-ram-report.txt"
$out | Out-File -FilePath $reportPath -Encoding utf8
Write-Host "Report written to: $reportPath"
Write-Host ""
$out | ForEach-Object { Write-Host $_ }
