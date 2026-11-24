@echo off
setlocal

cd /d "%~dp0"

set "MODE=%~1"
if not defined MODE set "MODE=production"

if /i not "%MODE%"=="production" if /i not "%MODE%"=="development" (
  echo Usage: run-frontend.bat [production^|development]
  exit /b 2
)

echo Installing frontend dependencies...
call npm install
if errorlevel 1 exit /b %ERRORLEVEL%

if /i "%MODE%"=="development" (
  echo Starting Vite development server...
  call npm run dev
  exit /b %ERRORLEVEL%
)

echo Building frontend...
call npm run build

echo Running frontend...
call npm run start
exit /b %ERRORLEVEL%
