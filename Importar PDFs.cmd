@echo off
setlocal
pushd "%~dp0" || exit /b 1

set "PYTHONUTF8=1"
set "IMPORT_MODE="
if "%~1"=="" set "IMPORT_MODE=--library"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -m tools.radioapple_import %IMPORT_MODE% %*
) else (
  where py >nul 2>&1
  if errorlevel 1 (
    python -m tools.radioapple_import %IMPORT_MODE% %*
  ) else (
    py -3 -m tools.radioapple_import %IMPORT_MODE% %*
  )
)
set "IMPORT_EXIT=%ERRORLEVEL%"
if not "%IMPORT_EXIT%"=="0" if "%~1"=="" pause
popd
exit /b %IMPORT_EXIT%
