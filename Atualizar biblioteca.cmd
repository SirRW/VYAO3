@echo off
setlocal
pushd "%~dp0" || exit /b 1

set "RADIOAPPLE_JEKYLL=%LOCALAPPDATA%\RadioAppleReader\jekyll"
if exist "%RADIOAPPLE_JEKYLL%\rubyinstaller-3.3.4-1-x64\bin\ruby.exe" (
  set "GEM_HOME=%RADIOAPPLE_JEKYLL%\gems"
  "%RADIOAPPLE_JEKYLL%\rubyinstaller-3.3.4-1-x64\bin\ruby.exe" -I "%RADIOAPPLE_JEKYLL%\gems\gems\jekyll-3.10.0\lib" -e "gem 'kramdown', '2.4.0'; require 'jekyll'; Jekyll::Site.new(Jekyll.configuration({'safe' => true})).process"
) else (
  where jekyll >nul 2>&1
  if errorlevel 1 (
    echo Jekyll is required to rebuild the local library. See README.md.
    goto failed
  )
  call jekyll build --safe
)

if errorlevel 1 goto failed
if /i not "%~1"=="--build-only" start "" "%CD%\_site\index.html"
popd
exit /b 0

:failed
echo The local library could not be rebuilt.
if /i not "%~1"=="--build-only" pause
popd
exit /b 1
