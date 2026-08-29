@echo off
setlocal enabledelayedexpansion
REM ===========================================================
REM  AdCuck - STEP 3: send your filters out
REM
REM  Sends the filter list to GitHub. GitHub rebuilds the
REM  published list, and everyone's copy picks it up within
REM  the hour.
REM
REM  By default this sends ONLY the filter files. Anything
REM  else you have been editing is left alone unless you say
REM  otherwise - so a half-finished change to something else
REM  cannot ride along by accident.
REM
REM  Just double-click this file.
REM ===========================================================

cd /d "%~dp0"
title AdCuck - sending your filters

REM The two files the published filter list is built from.
set "F1=src/filters/filters.js"
set "F2=rules/network.json"

echo.
echo  ============================================
echo   Sending your filters to GitHub
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

REM --- Sort what changed into filters and everything else ----
set "FILTERS="
set "OTHERS="

for /f "tokens=1,* delims= " %%a in ('git status --porcelain') do (
  set "P=%%b"
  if "!P!"=="%F1%" (
    set "FILTERS=1"
  ) else if "!P!"=="%F2%" (
    set "FILTERS=1"
  ) else (
    set "OTHERS=1"
  )
)

if not defined FILTERS if not defined OTHERS (
  echo  Nothing has changed since last time.
  echo.
  echo  Edit src\filters\filters.js first, then come back.
  echo  Or run 1-get-filters.bat to find new ones.
  echo.
  pause
  exit /b 0
)

if defined FILTERS (
  echo  Filters changed - these are what people receive:
  echo.
  git status --short -- "%F1%" "%F2%"
  echo.
) else (
  echo  The filter files have not changed.
  echo.
)

set "SENDOTHERS="
if defined OTHERS (
  echo  Other files also changed. These are part of the
  echo  project but are NOT part of the published filter list:
  echo.
  for /f "tokens=1,* delims= " %%a in ('git status --porcelain') do (
    set "P=%%b"
    if not "!P!"=="%F1%" if not "!P!"=="%F2%" echo      !P!
  )
  echo.
  choice /c YN /n /m "  Include those as well? [Y/N] "
  if not errorlevel 2 set "SENDOTHERS=1"
  echo.
)

if not defined FILTERS if not defined SENDOTHERS (
  echo  Nothing selected to send. Stopped.
  echo.
  pause
  exit /b 0
)

if defined FILTERS (
  echo  Reminder: have you run 2-check.bat since editing the
  echo  filters? A broken list reaches everyone.
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
)

set "MSG="
set /p "MSG=  Describe the change (or press Enter for 'New filters'): "
if "!MSG!"=="" set "MSG=New filters"

echo.
echo  Saving...
if defined SENDOTHERS (
  git add -A
) else (
  git add -- "%F1%" "%F2%"
)

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
  echo   GitHub repo yet. Run this once:
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
if defined OTHERS if not defined SENDOTHERS (
  echo   Left behind, still waiting on this computer:
  for /f "tokens=1,* delims= " %%a in ('git status --porcelain') do (
    set "P=%%b"
    echo      !P!
  )
  echo.
)
echo   GitHub is now rebuilding the filter list. Takes about
echo   a minute.
echo.
echo   Everyone's copy picks it up within the hour. To get it
echo   right now, open AdCuck and press "Check now".
echo.
echo   Watch it build:
echo   https://github.com/whippingcracked/adcuck/actions
echo.
pause
