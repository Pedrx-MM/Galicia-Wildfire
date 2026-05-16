@echo off
title Galicia Wildfire — Shutdown
echo.
echo Cerrando Galicia Wildfire...
echo.

cd /d "%~dp0"
docker compose down

echo.
echo Cerrando frontend (puerto 3000)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 "') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo Todos los servicios detenidos.
timeout /t 2 /nobreak >nul
