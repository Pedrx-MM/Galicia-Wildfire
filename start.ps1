# Galicia Wildfire - Launcher Docker
# Uso: powershell -ExecutionPolicy Bypass -File start.ps1

$ROOT     = Split-Path -Parent $MyInvocation.MyCommand.Path
$FRONTEND = Join-Path $ROOT "frontend"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  GALICIA WILDFIRE - Sistema de Extincion  " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Verificar Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Docker no encontrado. Instala Docker Desktop." -ForegroundColor Red
    Read-Host "Pulsa Enter para salir"
    exit 1
}

Write-Host ""
Write-Host "[1/3] Levantando servicios Docker..." -ForegroundColor Green
Write-Host "      (mongodb, backend, simulador-gw, mavlink-bridge)" -ForegroundColor Gray
Set-Location $ROOT
docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] docker compose up falló. Revisa los logs con: docker compose logs" -ForegroundColor Red
    Read-Host "Pulsa Enter para salir"
    exit 1
}

Write-Host ""
Write-Host "[2/3] Iniciando frontend HTTP (:3000)..." -ForegroundColor Green
$cmd = "Set-Location '$FRONTEND'; Write-Host 'Frontend en http://localhost:3000' -ForegroundColor Cyan; py -m http.server 3000; Read-Host 'Pulsa Enter para cerrar'"
Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-Command", $cmd

Start-Sleep -Seconds 2

Write-Host "[3/3] Abriendo navegador..." -ForegroundColor Green
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Servicios activos:"
Write-Host "    Backend    :8000  (FastAPI + MAVLink UDP:14550)"
Write-Host "    Frontend   :3000  (HTTP server local)"
Write-Host "    MongoDB    :27018 (Docker)"
Write-Host "    Simulador  simulador-gw (Docker)"
Write-Host "    MAVLink    mavlink-bridge (Docker)"
Write-Host "    DB Admin   :8081  (Mongo Express)"
Write-Host ""
Write-Host "  Para ver logs:   docker compose logs -f"
Write-Host "  Para detener:    .\shutdown.bat"
Write-Host "============================================" -ForegroundColor Cyan
