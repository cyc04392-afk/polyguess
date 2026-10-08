#!/bin/bash
# 맥에서 더블클릭으로 게임 서버를 켭니다. (처음 열 때 막히면: 파일을 우클릭 → 열기)
cd "$(dirname "$0")"
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js가 아직 설치되어 있지 않습니다."
  echo "  https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행해 주세요."
  echo
  read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "처음 한 번만 필요한 파일을 내려받습니다. 잠시 기다려 주세요..."
  npm install
fi

echo
echo "  게임 서버를 켭니다. 브라우저가 자동으로 열립니다."
echo "  이 창을 닫으면 게임이 꺼집니다."
echo
OPEN_BROWSER=1 node server.js
