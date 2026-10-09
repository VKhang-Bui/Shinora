#!/usr/bin/env bash
# Build + chạy Docker bản demo với phiên bản dạng: <phiên-bản>-<hash5>-beta
# Dữ liệu demo (SEED_DEMO=1) nằm TRONG container, không đụng CSDL thật.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node scripts/version.js)"
NAME="deadline-demo"
PORT="${PORT:-3000}"

echo "==> Phiên bản: $VERSION"
docker build --build-arg APP_VERSION="$VERSION" -t "deadline-tracker:$VERSION" .
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "$PORT:3000" -e SEED_DEMO=1 -e APP_VERSION="$VERSION" "deadline-tracker:$VERSION"

LAN_IP="$(hostname -I | awk '{print $1}')"
echo
echo "Phiên bản : $VERSION"
echo "Localhost : http://localhost:$PORT/deadline"
echo "LAN       : http://$LAN_IP:$PORT/deadline"
