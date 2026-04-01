#!/usr/bin/env bash
# 快速启动 EvoClaw Core Sidecar
# 用法: ./scripts/start-core.sh [--dev]

set -e
cd "$(dirname "$0")/.."

if [ "$1" = "--dev" ]; then
  echo "🔧 开发模式（tsx watch，自动重载）"
  exec pnpm dev:core
else
  echo "📦 构建中..."
  pnpm build --filter=@evoclaw/shared --filter=@evoclaw/core
  echo "🚀 启动 Core Sidecar"
  exec bun run packages/core/dist/server.mjs
fi
