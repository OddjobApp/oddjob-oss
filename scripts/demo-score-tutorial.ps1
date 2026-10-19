<#
.SYNOPSIS
    Runs the Oddjob S.C.O.R.E. Interactive Headed Browser Tutorial Demo.

.DESCRIPTION
    Launches a headed Chromium browser with slow-motion execution and pauses
    at each S.C.O.R.E. dimension coachmark so you can observe the target-anchored
    speech bubbles, pulsating spotlight beacons, and closed-loop outcome calibration.

.PARAMETER DelayMs
    Milliseconds to pause on each tutorial step. Defaults to 6000 (6 seconds).

.EXAMPLE
    .\scripts\demo-score-tutorial.ps1
    .\scripts\demo-score-tutorial.ps1 -DelayMs 6000
    .\scripts\demo-score-tutorial.ps1 -DelayMs 8000
#>

param(
    [int]$DelayMs = 6000,
    [string]$Chain = "chain:executive-overview"
)

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Oddjob S.C.O.R.E. Interactive Tutorial Headed Demo     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Playlist Track / Chain: $Chain" -ForegroundColor Green
Write-Host " Step Pause Duration:    $($DelayMs / 1000) seconds per dimension" -ForegroundColor Yellow
Write-Host " Mode:                   Headed Chromium with Live Beacon Anchoring" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Vite server is accessible on localhost:5000
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5000" -Method Head -TimeoutSec 3 -ErrorAction Stop
} catch {
    Write-Host "⚠️ Notice: Oddjob dev server on http://localhost:5000 did not respond immediately." -ForegroundColor DarkYellow
    Write-Host "   Ensure 'npm run dev' is running in another terminal." -ForegroundColor DarkYellow
    Write-Host ""
}

# Run the Playwright script passing delay and chain parameters
node scripts/demo-tutorial-headed.mjs $DelayMs $Chain

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Demo completed successfully with exit code 0." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Demo exited with code $LASTEXITCODE." -ForegroundColor Red
}
