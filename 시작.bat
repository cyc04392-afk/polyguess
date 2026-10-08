@echo off
chcp 65001 >nul
title 폴리게스 - 게임 서버
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js가 아직 설치되어 있지 않습니다.
  echo  https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행해 주세요.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo 처음 한 번만 필요한 파일을 내려받습니다. 잠시 기다려 주세요...
  call npm install
)

echo.
echo  게임 서버를 켭니다. 브라우저가 자동으로 열립니다.
echo  이 창을 닫으면 게임이 꺼집니다.
echo.
set OPEN_BROWSER=1
node server.js
pause
