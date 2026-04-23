$SampleIntervalSeconds = if ($env:PERF_SAMPLE_INTERVAL_SECONDS) { [int]$env:PERF_SAMPLE_INTERVAL_SECONDS } else { 5 }
$DurationMinutes = if ($env:PERF_DURATION_MINUTES) { [int]$env:PERF_DURATION_MINUTES } else { 20 }
$OutputDir = if ($env:PERF_RESULTS_DIR) { $env:PERF_RESULTS_DIR } else { "performance/results" }

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$counters = @(
    '\Processor(_Total)\% Processor Time',
    '\Memory\Available MBytes',
    '\PhysicalDisk(_Total)\Disk Transfers/sec',
    '\PhysicalDisk(_Total)\Avg. Disk Queue Length',
    '\Process(node)\% Processor Time',
    '\Process(node)\Working Set - Private'
)

$sampleCount = [Math]::Max(1, [int](($DurationMinutes * 60) / $SampleIntervalSeconds))
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$csvPath = Join-Path $OutputDir "system-metrics-$timestamp.csv"

Get-Counter -Counter $counters -SampleInterval $SampleIntervalSeconds -MaxSamples $sampleCount |
    Export-Counter -Path $csvPath -FileFormat csv

Write-Host "System metrics exported to $csvPath"
