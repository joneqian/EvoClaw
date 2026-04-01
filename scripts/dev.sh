#!/usr/bin/env bash
# EvoClaw 开发模式启动（前端热更新 + Sidecar 自动启动）
# 用法: ./scripts/dev.sh                    # 默认品牌 evoclaw
#       BRAND=healthclaw ./scripts/dev.sh    # 指定品牌
#
# 这个命令会：
# 1. 应用品牌配置（brand-apply.mjs）
# 2. 构建 shared + core（esbuild 打包 server.mjs）
# 3. 启动 Tauri 开发模式（Vite 热更新 + Rust 编译 + 自动启动 Bun Sidecar）
# 4. 修改前端代码会自动刷新，修改 Rust 代码会自动重编译

set -e
cd "$(dirname "$0")/.."

export BRAND="${BRAND:-evoclaw}"

echo "========================================="
echo "  ${BRAND} 开发模式"
echo "========================================="

# 0. 应用品牌配置 + 确保内嵌 Bun
echo ""
echo "[0/3] 应用品牌配置: ${BRAND} ..."
bun scripts/brand-apply.mjs

echo ""
echo "[1/3] 确保内嵌 Bun 二进制 ..."
bun scripts/download-bun.mjs

# 2. 构建 shared + core
echo ""
echo "[2/3] 构建 @evoclaw/shared + @evoclaw/core ..."
pnpm build --filter=@evoclaw/shared --filter=@evoclaw/core

echo ""
echo "[3/3] 启动 Tauri 开发模式 ..."
echo ""
echo "  提示："
echo "  - 前端热更新: http://localhost:1420"
echo "  - Core 日志:  tail -f ~/$(bun -e "const b=require('./brands/${BRAND}/brand.json');console.log(b.dataDir)")/logs/core.log"
echo "  - Ctrl+C 退出"
echo ""

cd apps/desktop
pnpm tauri dev
