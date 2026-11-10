@echo off
setlocal
call "%~dp0Importar PDFs.cmd" --library %*
set "IMPORT_EXIT=%ERRORLEVEL%"
if not "%IMPORT_EXIT%"=="0" if "%~1"=="" pause
exit /b %IMPORT_EXIT%
