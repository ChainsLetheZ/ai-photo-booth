@echo off
setlocal
cd /d "%~dp0"

set "HTTP_PROXY="
set "HTTPS_PROXY="
set "ALL_PROXY="
set "http_proxy="
set "https_proxy="
set "all_proxy="

if not exist "node_modules\.bin\vite.cmd" (
  echo Installing Windows dependencies...
  call npm ci
  if errorlevel 1 exit /b 1
)

echo Booth: http://localhost:3000/booth
echo Press Ctrl+C to stop.
call npm run dev
