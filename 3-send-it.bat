@echo off
setlocal enabledelayedexpansion
REM ===========================================================
REM  AdCuck - STEP 3: send your changes out
REM
REM  Saves your changes and pushes them to GitHub. GitHub
REM  then publishes the new filters, and everyone's copy
REM  picks them up within the hour.
REM
REM  Just double-click this file.
REM ===========================================================

cd /d "%~dp0"
title AdCuck - sending it out

echo.
echo  ============================================
echo   Sending your changes to GitHub
echo  ============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo  [X] Git is not installed.
  echo.
  echo      Get it from https://git-scm.com/download/win
  echo      Click through with the defaults, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist ".git" (
  echo  [X] This folder is not connected to git yet.
  echo.
  pause
  exit /b 1
)

REM --- Has anything actually changed? -----------------------
REM  git status (not git diff) - diff cannot see brand-new files.
set "CHANGED="
for /f "delims=" %%i in ('git status --porcelain') do set "CHANGED=1"
if not defined CHANGED (
  echo  Nothing has changed since last time.
  echo.
  echo  Edit src\filters\filters.js first, then come back.
  echo.
  pause
  exit /b 0
)

echo  Here is what changed:
echo.
git status --short
echo.

REM --- Nudge, do not block ----------------------------------
echo  Reminder: have you run 2-check.bat since making these
echo  changes? Sending out a broken filter list affects
echo  everyone using it.
echo.
choice /c YN /n /m "  Carry on? [Y/N] "
if errorlevel 2 (
  echo.
  echo  Stopped. Nothing was sent.
  echo.
  pause
  exit /b 0
)

echo.
set "MSG="
set /p "MSG=  Describe the change (or press Enter for 'New filters'): "
if "!MSG!"=="" set "MSG=New filters"

echo.
echo  Saving...
git add -A
git commit -m "!MSG!"
if errorlevel 1 (
  echo.
  echo  [X] Could not save. The message above says why.
  echo.
  pause
  exit /b 1
)

echo.
echo  Uploading to GitHub...
echo  ^(it may ask you to sign in - that is normal^)
echo.

REM First push needs to set the branch; later ones do not.
git rev-parse --abbrev-ref --symbolic-full-name @{u} >nul 2>nul
if errorlevel 1 (
  git push -u origin main
) else (
  git push
)

if errorlevel 1 (
  echo.
  echo  ============================================
  echo    SAVED, BUT NOT UPLOADED
  echo  ============================================
  echo.
  echo   Your change is saved on this computer, so nothing
  echo   is lost. The upload failed.
  echo.
  echo   Most likely: this folder has not been linked to a
  echo   GitHub repo yet. Run this once, with your details:
  echo.
  echo     git remote add origin https://github.com/whippingcracked/adcuck.git
  echo.
  echo   Then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo    SENT
echo  ============================================
echo.
echo   GitHub is now building the new filter list. Takes
echo   about a minute.
echo.
echo   Everyone's copy picks it up within the hour. To get
echo   it right now, open AdCuck and press "Check now".
echo.
echo   Watch it build:
echo   https://github.com/whippingcracked/adcuck/actions
echo.
pause
