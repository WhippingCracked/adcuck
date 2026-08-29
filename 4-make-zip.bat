@echo off
setlocal enabledelayedexpansion
REM ===========================================================
REM  AdCuck - make the upload zip
REM
REM  Packs ONLY the files Chrome actually needs. Leaves out
REM  the tests, tools, batch files, git folders and notes -
REM  the Chrome Web Store rejects zips with extra junk in
REM  them, and none of it does anything once installed.
REM
REM  Just double-click this file.
REM ===========================================================

cd /d "%~dp0"
title AdCuck - making the zip

echo.
echo  ============================================
echo   Packing the extension
echo  ============================================
echo.

REM --- Everything the extension needs, and nothing else -----
set "FILES=manifest.json"
set "FOLDERS=icons rules src"

for %%P in (%FILES% %FOLDERS%) do (
  if not exist "%%P" (
    echo  [X] Missing: %%P
    echo      Are you running this from the AdCuck folder?
    echo.
    pause
    exit /b 1
  )
)

REM --- Name the zip after the version, so you can never -----
REM --- upload the wrong one by mistake ----------------------
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Get-Content -Raw manifest.json ^| ConvertFrom-Json).version"`) do set "VER=%%V"

if "!VER!"=="" (
  echo  [X] Could not read the version from manifest.json.
  echo.
  pause
  exit /b 1
)

set "ZIP=%CD%\adcuck-!VER!.zip"
set "STAGE=%TEMP%\adcuck-pack-%RANDOM%"

echo  Version : !VER!
echo  Zip     : adcuck-!VER!.zip
echo.
echo  Including:  %FILES% %FOLDERS%
echo  Leaving out: tests, tools, batch files, git, notes
echo.

if exist "!ZIP!" (
  echo  adcuck-!VER!.zip already exists.
  choice /c YN /n /m "  Replace it? [Y/N] "
  if errorlevel 2 (
    echo.
    echo  Stopped. Nothing was changed.
    echo.
    pause
    exit /b 0
  )
  del /q "!ZIP!"
  echo.
)

REM --- Copy the wanted files somewhere clean, then zip that.
REM --- Zipping a known-empty folder is the only way to be
REM --- certain nothing unexpected tags along.
mkdir "!STAGE!" 2>nul
for %%F in (%FILES%) do copy /y "%%F" "!STAGE!\" >nul
for %%D in (%FOLDERS%) do xcopy "%%D" "!STAGE!\%%D\" /E /I /Q /Y >nul

if errorlevel 1 (
  echo  [X] Could not gather the files.
  rd /s /q "!STAGE!" 2>nul
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('!STAGE!', '!ZIP!')"

set PSRESULT=%errorlevel%
rd /s /q "!STAGE!" 2>nul

if not %PSRESULT%==0 (
  echo.
  echo  [X] Zipping failed. The message above says why.
  echo.
  pause
  exit /b 1
)

if not exist "!ZIP!" (
  echo.
  echo  [X] The zip was not created.
  echo.
  pause
  exit /b 1
)

REM --- Show what actually went in, so nothing is a surprise --
echo  ============================================
echo    DONE
echo  ============================================
echo.
echo  What went in:
echo.
powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('!ZIP!'); $z.Entries | Sort-Object FullName | ForEach-Object { '    ' + $_.FullName }; ''; '    {0} files, {1:N0} KB total' -f $z.Entries.Count, ((Get-Item '!ZIP!').Length/1KB); $z.Dispose()"

echo.
echo  manifest.json should be in that list on its own, with
echo  no folder in front of it. If it is, the zip is right.
echo.
echo  Upload it here:
echo  https://chrome.google.com/webstore/devconsole
echo.

choice /c YN /n /m "  Show it in Explorer? [Y/N] "
if not errorlevel 2 explorer /select,"!ZIP!"

echo.
pause
