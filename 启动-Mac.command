#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -x "node_modules/.bin/vite" ]; then
  echo "正在为 macOS 安装项目依赖…"
  npm ci
fi

echo "拍照端：https://localhost:3000/booth"
echo "按 Control+C 停止。"
exec npm run dev:https
