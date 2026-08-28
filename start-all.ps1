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

Write-Host "All services starting in separate windows..." -ForegroundColor Green
Write-Host "Agent 1 (Building): http://localhost:8010" -ForegroundColor Cyan
Write-Host "Agent 2 (Thermal): http://localhost:8001" -ForegroundColor Cyan
Write-Host "Agent 3 (Diagnostic): http://localhost:8002" -ForegroundColor Cyan
Write-Host "Orchestrator: http://localhost:8003" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:5173 (or next available)" -ForegroundColor Cyan