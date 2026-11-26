@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install
)
echo Starting Marble Labyrinth. Arrow keys or WASD tilt the board. Close this window to stop.
call npm run dev -- --open
pause
