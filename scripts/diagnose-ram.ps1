# RAM diagnostic script - run in PowerShell (no admin required for most checks).
# Share the output file so we can diagnose.

$out = @()
$out += "=== RAM diagnostic @ $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===`n"

# 1. System memory summary (WMI)
try {
    $cs = Get-CimInstance Win32_OperatingSystem
    # WMI TotalVisibleMemorySize and FreePhysicalMemory are in kilobytes
    $totalMB = [math]::Round($cs.TotalVisibleMemorySize / 1KB, 2)
    $freeMB = [math]::Round($cs.FreePhysicalMemory / 1KB, 2)
    $usedMB = [math]::Round($totalMB - $freeMB, 2)
    $out += "Physical memory: Total ${totalMB} MB, Free ${freeMB} MB, Used ~${usedMB} MB"
} catch {
    $out += "WMI memory: $($_.Exception.Message)"
}

# 2. Top processes by working set (what Task Manager usually shows)
$out += "`n--- Top 25 processes by Working Set (MB) ---"
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 25 |
    ForEach-Object {
        $wsMB = [math]::Round($_.WorkingSet64 / 1MB, 2)
        $out += "  $($_.ProcessName) (PID $($_.Id)): $wsMB MB"
    }

# 3. Top by Private Bytes (committed, can be higher than working set)
$out += "`n--- Top 15 processes by Private Memory (MB) ---"
Get-Process | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 15 |
    ForEach-Object {
        $pMB = [math]::Round($_.PrivateMemorySize64 / 1MB, 2)
        $out += "  $($_.ProcessName) (PID $($_.Id)): $pMB MB"
    }

# 4. WSL - often hides in "vmmem" or similar
$out += "`n--- WSL / Hyper-V ---"
$vmmem = Get-Process -Name vmmem -ErrorAction SilentlyContinue
if ($vmmem) {
    $vmmemMB = [math]::Round($vmmem.WorkingSet64 / 1MB, 2)
    $out += "  vmmem process: $vmmemMB MB (WSL/Hyper-V)"
} else {
    $out += "  vmmem: not running"
}
try {
    $wslList = wsl -l -v 2>&1
    $out += "  wsl -l -v:"
    $out += $wslList | ForEach-Object { "    $_" }
} catch {
    $out += "  wsl: $($_.Exception.Message)"
}

# 5. Node / Electron (often many processes)
$out += "`n--- Node / Electron processes (count + total MB) ---"
$nodeProcs = Get-Process -Name node -ErrorAction SilentlyContinue
$electronProcs = Get-Process | Where-Object { $_.ProcessName -match "electron|Code|Cursor" } -ErrorAction SilentlyContinue
$nodeMB = ($nodeProcs | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB
$electronMB = ($electronProcs | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB
$out += "  node: $($nodeProcs.Count) process(es), total Working Set: $([math]::Round($nodeMB, 2)) MB"
$out += "  Electron/Cursor/Code: $($electronProcs.Count) process(es), total: $([math]::Round($electronMB, 2)) MB"

# 6. Memory performance counters (standby/cache - need one counter that's often available)
$out += "`n--- Memory counters (if available) ---"
try {
    $counters = @(
        "\Memory\Available MBytes",
        "\Memory\Cache Bytes",
        "\Memory\Committed Bytes",
        "\Memory\Pool Nonpaged Bytes",
        "\Memory\Pool Paged Bytes"
    )
    foreach ($c in $counters) {
        $val = (Get-Counter -Counter $c -ErrorAction SilentlyContinue).CounterSamples.CookedValue
        if ($null -ne $val) {
            # \Memory\Available MBytes is already in MB; others are in bytes
            $valMB = if ($c -eq "\Memory\Available MBytes") { [math]::Round($val, 2) } else { [math]::Round($val / 1MB, 2) }
            $out += "  $c : $valMB MB"
        }
    }
} catch {
    $out += "  Counters: $($_.Exception.Message)"
}

# 7. Docker (if installed)
$out += "`n--- Docker ---"
$docker = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
if ($docker) {
    $out += "  Docker Desktop running (PID $($docker.Id)), Working Set: $([math]::Round($docker.WorkingSet64/1MB,2)) MB"
} else {
    $out += "  Docker Desktop: not running (or different process name)"
}

$reportPath = Join-Path $PSScriptRoot "ram-diagnostic-report.txt"
$out | Out-File -FilePath $reportPath -Encoding utf8
Write-Host "Report written to: $reportPath"
Write-Host "`n--- Preview ---"
$out | ForEach-Object { Write-Host $_ }
