# Start all DynamIQ services in separate PowerShell windows

$projectRoot = $PSScriptRoot

# Check if .env exists
if (-not (Test-Path "$projectRoot\.env")) {
    Write-Host "ERROR: .env file not found. Copy .env.example to .env and configure it." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Start Agent 1 - Building (port 8010)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot'; uvicorn agents.building_agent.api:app --app-dir src --port 8010 --reload" -WindowStyle Normal

# Start Agent 2 - Thermal (port 8001)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot'; uvicorn agents.thermal_agent.api:app --app-dir src --port 8001 --reload" -WindowStyle Normal

# Start Agent 3 - Diagnostic (port 8002)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot'; uvicorn agents.diagnostic_agent.api:app --app-dir src --port 8002 --reload" -WindowStyle Normal

# Start Orchestrator (port 8003)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot'; uvicorn orchestration.api:app --app-dir src --port 8003 --reload" -WindowStyle Normal

# Start Frontend (port 5173+)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot\frontend'; npm run dev" -WindowStyle Normal

# Start the live sensor feed -- writes a reading every 2min for every
# instrumented room in every building, and rescans for newly added
# rooms/buildings on its own (no restart needed after onboarding).
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot'; python scripts\simulate_live_sensors.py" -WindowStyle Normal

# Start the orchestration driver -- nothing else calls the orchestrator
# automatically, so without this, calibration/MPC/diagnosis never run on
# their own. Recalibrates every room every 2min (matching the sensor feed)
# and re-solves MPC every 15min; also auto-backfills synthetic history for
# any newly instrumented room so it doesn't sit uncalibrated for ~10h.
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot'; python scripts\run_orchestration_loop.py" -WindowStyle Normal

Write-Host "All services starting in separate windows..." -ForegroundColor Green
Write-Host "Agent 1 (Building): http://localhost:8010" -ForegroundColor Cyan
Write-Host "Agent 2 (Thermal): http://localhost:8001" -ForegroundColor Cyan
Write-Host "Agent 3 (Diagnostic): http://localhost:8002" -ForegroundColor Cyan
Write-Host "Orchestrator: http://localhost:8003" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:5173 (or next available)" -ForegroundColor Cyan
Write-Host "Live sensor feed + orchestration loop: running in background windows, every 2min" -ForegroundColor Cyan