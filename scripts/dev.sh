#!/usr/bin/env bash
# EvoClaw 开发模式启动（前端热更新 + Sidecar 自动启动）
# 用法: ./scripts/dev.sh
#
# 这个命令会：
# 1. 构建 shared + core（esbuild 打包 server.mjs + native 模块）
# 2. 启动 Tauri 开发模式（Vite 热更新 + Rust 编译 + 自动启动 Node.js Sidecar）
# 3. 修改前端代码会自动刷新，修改 Rust 代码会自动重编译
#
# 日志查看: tail -f ~/.evoclaw/logs/core.log

set -e
cd "$(dirname "$0")/.."

echo "========================================="
echo "  EvoClaw 开发模式"
echo "========================================="

# 1. 构建 shared + core
echo ""
echo "[1/2] 构建 @evoclaw/shared + @evoclaw/core ..."
pnpm build --filter=@evoclaw/shared --filter=@evoclaw/core

echo ""
echo "[2/2] 启动 Tauri 开发模式 ..."
echo ""
echo "  提示："
echo "  - 前端热更新: http://localhost:1420"
echo "  - Core 日志:  tail -f ~/.evoclaw/logs/core.log"
echo "  - Ctrl+C 退出"
echo ""

cd apps/desktop
pnpm tauri dev
