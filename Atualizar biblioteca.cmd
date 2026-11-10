@echo off
setlocal
pushd "%~dp0" || exit /b 1

set "RADIOAPPLE_BUILD_MODE="
set "RADIOAPPLE_OUTPUT=_site"
if /i "%~1"=="--preview" (
  set "RADIOAPPLE_BUILD_MODE=--preview"
  set "RADIOAPPLE_OUTPUT=.radioapple-import\preview"
  shift
) else if /i "%~1"=="--pages" (
  set "RADIOAPPLE_BUILD_MODE=--pages"
  set "RADIOAPPLE_OUTPUT=_pages"
  shift
)

set "RADIOAPPLE_JEKYLL=%LOCALAPPDATA%\RadioAppleReader\jekyll"
if exist "%RADIOAPPLE_JEKYLL%\rubyinstaller-3.3.4-1-x64\bin\ruby.exe" (
  set "GEM_HOME=%RADIOAPPLE_JEKYLL%\gems"
  "%RADIOAPPLE_JEKYLL%\rubyinstaller-3.3.4-1-x64\bin\ruby.exe" -I "%RADIOAPPLE_JEKYLL%\gems\gems\jekyll-3.10.0\lib" tools\build-library.rb --portable %RADIOAPPLE_BUILD_MODE%
) else if defined RADIOAPPLE_BUILD_MODE (
  call ruby tools\build-library.rb %RADIOAPPLE_BUILD_MODE%
) else (
  where jekyll >nul 2>&1
  if errorlevel 1 (
    echo Jekyll is required to rebuild the local library. See README.md.
    goto failed
  )
  call jekyll build --safe
)

if errorlevel 1 goto failed
if /i not "%~1"=="--build-only" start "" "%CD%\%RADIOAPPLE_OUTPUT%\index.html"
popd
exit /b 0

:failed
echo The local library could not be rebuilt.
if /i not "%~1"=="--build-only" pause
popd
exit /b 1
