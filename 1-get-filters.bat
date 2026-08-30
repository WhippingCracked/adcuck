@echo off
REM ===========================================================
REM  AdCuck - STEP 1: find new ads to block
REM
REM  Opens YouTube in a browser, watches what comes through,
REM  and finds ad-looking things you are NOT blocking yet.
REM
REM  Then it asks you about each one and adds the ones you
REM  say yes to. You never have to edit a file by hand.
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

REM --- Which video to watch ---------------------------------
REM  Most YouTube ads only exist while a video is playing, so
REM  this opens a video and sits through the advert. Pasting a
REM  link lets you point it at one you know shows ads.
echo  Paste a YouTube video link and press Enter.
echo  ^(or just press Enter to use the usual pages^)
echo.
set "LINK="
set /p "LINK=  Link: "
echo.

echo  A browser window will open. Leave it alone - it closes
echo  by itself when it is done. Takes about a minute.
echo.

if defined LINK (
  call node tools/discover.mjs "%LINK%"
) else (
  call node tools/discover.mjs
)
if errorlevel 1 (
  echo.
  echo  [X] Something went wrong. The message above says what.
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo   Adding what it found
echo  ============================================
echo.
echo  Anything that is clearly an advert goes straight in.
echo.
echo  It will NOT add parts of YouTube itself - the top bar,
echo  the player, the buttons on the video. Those are refused
echo  outright and listed below so you can see what it left.
echo.
echo  A few things are ad-shaped but could be something else.
echo  Those are set aside rather than added. Run  npm run add
echo  if you want to go through those yourself.
echo.

call node tools/add-filters.mjs --auto
if errorlevel 1 (
  echo.
  echo  [X] Nothing was added. The message above says why.
  echo.
  pause
  exit /b 1
)

echo  ============================================
echo   Done
echo  ============================================
echo.
echo  Anything you said yes to is now in your filter list.
echo.
echo  Next: run  2-check.bat
echo.
pause
