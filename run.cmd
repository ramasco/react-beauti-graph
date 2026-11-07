@echo off
rem Starts the demo app (Vite) and opens it in the browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install || exit /b 1
)
start "" http://localhost:5173
call npm run dev
