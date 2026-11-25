@echo off
setlocal

cd /d "%~dp0"

set "MODE=%~1"
if not defined MODE set "MODE=production"

if /i not "%MODE%"=="production" if /i not "%MODE%"=="development" (
  echo Usage: run-backend.bat [production^|development]
  exit /b 2
)

echo Installing backend dependencies...
call npm install
if errorlevel 1 exit /b %ERRORLEVEL%

if /i "%MODE%"=="development" (
  echo Starting backend in development mode...
  call npm run dev
  exit /b %ERRORLEVEL%
)

echo Starting backend in production mode...
set "NODE_ENV=production"
set "HOST=127.0.0.1"
set "PORT=3001"
node index.js
exit /b %ERRORLEVEL%
