@echo off
REM ===========================================================
REM  AdCuck - STEP 2: check nothing is broken
REM
REM  Runs every test. If it says all checks passed, your
REM  changes are safe to send out.
REM
REM  Just double-click this file.
REM ===========================================================

cd /d "%~dp0"
title AdCuck - checking

echo.
echo  ============================================
echo   Checking your changes
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node is not installed.
  echo      Get it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\playwright" (
  echo  Setting up for the first time. Takes a few minutes.
  echo.
  call npm run setup
  if errorlevel 1 (
    echo.
    echo  [X] Setup failed. Check your internet and try again.
    echo.
    pause
    exit /b 1
  )
  echo.
)

echo  A browser window will flash up during this. That is
echo  meant to happen - Chrome refuses to load an extension
echo  without a real window, so the tests need one.
echo.
echo  Takes about a minute.
echo.

call npm test
set RESULT=%errorlevel%

echo.
if %RESULT%==0 (
  echo  ============================================
  echo    ALL GOOD - safe to send out
  echo  ============================================
  echo.
  echo   Next: run  3-send-it.bat
) else (
  echo  ============================================
  echo    SOMETHING BROKE - do not send this out
  echo  ============================================
  echo.
  echo   Scroll up. Any line starting with FAIL says what
  echo   went wrong.
  echo.
  echo   Most likely cause: a filter you added also matches
  echo   real videos. Undo the last line you added to
  echo   src\filters\filters.js and run this again.
)

echo.
pause
exit /b %RESULT%
