@echo off
setlocal

set "MODE=%~1"
if not defined MODE set "MODE=production"

if /i not "%MODE%"=="production" if /i not "%MODE%"=="development" (
  echo Usage: run-app.bat [production^|development]
  exit /b 2
)

cd /d "%~dp0"

if /i "%MODE%"=="development" (
  echo Starting independent development instances...

  start "API Tool Backend" cmd /k "cd /d "%~dp0backend" && call run-backend.bat development"
  start "API Tool Frontend" cmd /k "cd /d "%~dp0frontend" && call run-frontend.bat development"

  echo Frontend: http://us-l-pf4x9mc1:5173
  echo Backend:  http://us-l-pf4x9mc1:3001
  exit /b 0
)

call "cmd.exe" /c "%~dp0frontend\run-frontend.bat" production
if errorlevel 1 (
  echo Frontend build failed.
  exit /b %ERRORLEVEL%
)

echo Stopping port 3001 listeners...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3001 .*LISTENING"') do (
  powershell.exe -NoProfile -Command "Stop-Process -Id %%P -Force -ErrorAction SilentlyContinue" 2>nul
)

start "API Tool Backend" cmd /k "cd /d "%~dp0backend" && call run-backend.bat production"

echo Production app started at http://us-l-pf4x9mc1:3001
exit /b 0
