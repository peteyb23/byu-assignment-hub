#!/bin/bash
set -e
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Assignment Hub needs Python 3."
  echo "Install Python 3, then run this file again."
  read -r -p "Press Return to close..."
  exit 1
fi

if [ ! -f .env ]; then
  echo "First-time Canvas setup"
  echo "Your token stays only in this folder on your Mac."
  printf "Paste your Canvas access token, then press Return: "
  stty -echo
  IFS= read -r TOKEN
  stty echo
  echo
  if [ -z "$TOKEN" ]; then
    echo "No token entered. Nothing was saved."
    read -r -p "Press Return to close..."
    exit 1
  fi
  printf "CANVAS_TOKEN=%s\n" "$TOKEN" > .env
  chmod 600 .env
  echo "Token saved locally."
fi

python3 server.py &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT INT TERM
sleep 1
open "http://localhost:8765"
wait $SERVER_PID
