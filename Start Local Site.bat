@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE_EXE=node"
) else if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
) else (
  echo Node.js was not found on this computer.
  echo Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

start "The Room - local server (keep this window open)" cmd /k ""%NODE_EXE%" "%~dp0local-server.js""
timeout /t 2 /nobreak >nul
start "" "http://localhost:5500/home.html"
