@echo off
title GW-Backend
cd /d "%~dp0"

rem Liberar puerto 8000 si está ocupado
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr /r ":8000 "') do (
    echo [PRE] Puerto 8000 ocupado por PID %%p, liberando...
    taskkill /PID %%p /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo [GW] Iniciando FastAPI en :8000...
py -m uvicorn main:app --reload --port 8000 --host 0.0.0.0
echo.
echo [GW] Backend termino (codigo: %errorlevel%)
pause
