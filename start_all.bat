@echo off
setlocal

set ROOT=%~dp0
set VENV=%ROOT%myvenvv\Scripts
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend

echo ============================================
echo  TunisIA Investment Platform
echo ============================================
echo  Starts backend + frontend only.
echo  Ollama is NOT started here - run "ollama serve"
echo  separately if you want live AI. Without it the
echo  app still works (AI features use a fallback).
echo ============================================

:: Check that the venv exists
if not exist "%VENV%\uvicorn.exe" (
    echo [ERROR] Virtual environment not found at %VENV%
    echo Run: python -m venv myvenvv ^&^& myvenvv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

:: Check that Node/npm is available
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found. Install Node.js from https://nodejs.org
    pause
    exit /b 1
)

:: Install frontend deps if node_modules is missing
if not exist "%FRONTEND%\node_modules" (
    echo [INFO] Installing frontend dependencies...
    cd /d "%FRONTEND%"
    call npm install
)

echo.
echo [1/2] Starting backend on http://localhost:8001 ...
start "TunisIA Backend" cmd /k "cd /d "%BACKEND%" && "%VENV%\python.exe" -m uvicorn main:app --reload --host 127.0.0.1 --port 8001"

:: Give uvicorn a moment to bind before the frontend proxy tries to reach it
timeout /t 2 /nobreak >nul

echo [2/2] Starting frontend on http://localhost:5173 ...
start "TunisIA Frontend" cmd /k "cd /d "%FRONTEND%" && npm run dev"

echo.
echo ============================================
echo  Backend:   http://localhost:8001/docs
echo  Frontend:  http://localhost:5173
echo ============================================
echo  Both servers running in separate windows.
echo  Close those windows to stop the servers.
echo ============================================
echo.
pause
