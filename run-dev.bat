@echo off
setlocal

set "ROOT=%~dp0"
set "FRONTEND_DIR=%ROOT%frontend"
set "MODE=%~1"

if exist "%ROOT%windows-dev-env.bat" (
  call "%ROOT%windows-dev-env.bat"
)

if /I not "%MODE%"=="" (
  echo Usage: run-dev.bat
  echo.
  echo The frontend now runs in Local ^(WASM^) mode only.
  echo Server and HTTP fallback modes have been removed.
  exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
  echo Frontend project not found in "%FRONTEND_DIR%".
  exit /b 1
)

where /q npm
if errorlevel 1 (
  echo npm is not available on PATH. Install Node.js LTS and reopen the launcher.
  exit /b 1
)

where /q wasm-pack
if errorlevel 1 (
  echo wasm-pack is not available on PATH.
  echo The frontend will reuse the committed WASM bundle if it is complete.
)

echo Starting Phalanx Arena frontend...
start "Phalanx Arena Frontend" cmd /k "cd /d ""%FRONTEND_DIR%"" && npm install && npm run dev"

echo Waiting for the frontend dev server...
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173/"

echo Done. The browser UI is starting in Local ^(WASM^) mode.
echo Browser AI is optional and runs directly from the browser session.

endlocal
