@echo off
title GW-Frontend
cd /d "%~dp0"
echo [GW] Sirviendo frontend en :3000...
py -m http.server 3000
echo.
echo [GW] Frontend termino (codigo: %errorlevel%)
pause
