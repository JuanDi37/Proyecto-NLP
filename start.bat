@echo off
setlocal
cd /d "%~dp0"
set "OLLAMA=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if not exist "%OLLAMA%" set "OLLAMA=ollama"

curl -s http://127.0.0.1:11434/api/tags >nul 2>&1
if errorlevel 1 (
  echo Starting Ollama...
  start "" /min "%OLLAMA%" serve
  timeout /t 3 >nul
)
if not exist node_modules call npm install
start "" http://localhost:5173
call npm run dev
