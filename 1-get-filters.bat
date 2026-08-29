@echo off
REM ===========================================================
REM  AdCuck - STEP 1: find new ads to block
REM
REM  Opens YouTube in a browser, watches what comes through,
REM  and writes a list of ad-looking things you are NOT
REM  blocking yet.
REM
REM  Just double-click this file.
REM ===========================================================

cd /d "%~dp0"
title AdCuck - finding new filters

echo.
echo  ============================================
echo   Looking for new ads to block
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node is not installed.
  echo.
  echo      Get it from https://nodejs.org - take the LTS
  echo      button, click through with the defaults, then
  echo      run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\playwright" (
  echo  First time running this, so it needs to download
  echo  a browser to look at YouTube with.
  echo.
  echo  This takes a few minutes and only happens once.
  echo.
  call npm run setup
  if errorlevel 1 (
    echo.
    echo  [X] The download failed. Check your internet and try again.
    echo.
    pause
    exit /b 1
  )
  echo.
)

echo  A browser window will open. Leave it alone - it closes
echo  by itself when it is done. Takes about a minute.
echo.

call node tools/discover.mjs
if errorlevel 1 (
  echo.
  echo  [X] Something went wrong. The message above says what.
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo   Done
echo  ============================================
echo.
echo  The list is in:  feed\discovered.json
echo.
echo  IMPORTANT: do not paste all of it in. Some entries
echo  will be normal videos that just have "ad" somewhere
echo  in the name. Blocking those would hide real videos.
echo.
echo  Pick the ones you are sure about, add them to the
echo  hide list in:  src\filters\filters.js
echo.
echo  Then run  2-check.bat
echo.

if exist "feed\discovered.json" (
  choice /c YN /n /m "  Open the list now? [Y/N] "
  if not errorlevel 2 start "" notepad "feed\discovered.json"
)

echo.
pause
