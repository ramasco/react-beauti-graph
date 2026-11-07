@echo off
rem Starts the example app (examples/, separate from the library) and opens it in the browser.
cd /d "%~dp0examples"
if not exist node_modules (
  echo Installing the example's dependencies...
  call npm install || exit /b 1
)
start "" http://localhost:5173
call npm run dev
