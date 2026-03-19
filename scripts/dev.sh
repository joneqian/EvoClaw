#!/usr/bin/env bash
# EvoClaw 开发模式启动（前端热更新 + Sidecar 自动启动）
# 用法: ./scripts/dev.sh                    # 默认品牌 evoclaw
#       BRAND=healthclaw ./scripts/dev.sh    # 指定品牌
#
# 这个命令会：
# 1. 应用品牌配置（brand-apply.mjs）
# 2. 构建 shared + core（esbuild 打包 server.mjs + native 模块）
# 3. 启动 Tauri 开发模式（Vite 热更新 + Rust 编译 + 自动启动 Node.js Sidecar）
# 4. 修改前端代码会自动刷新，修改 Rust 代码会自动重编译

set -e
cd "$(dirname "$0")/.."

export BRAND="${BRAND:-evoclaw}"

echo "========================================="
echo "  ${BRAND} 开发模式"
echo "========================================="

# 0. 应用品牌配置
echo ""
echo "[0/2] 应用品牌配置: ${BRAND} ..."
node scripts/brand-apply.mjs

# 1. 构建 shared + core
echo ""
echo "[1/2] 构建 @evoclaw/shared + @evoclaw/core ..."
pnpm build --filter=@evoclaw/shared --filter=@evoclaw/core

echo ""
echo "[2/2] 启动 Tauri 开发模式 ..."
echo ""
echo "  提示："
echo "  - 前端热更新: http://localhost:1420"
echo "  - Core 日志:  tail -f ~/$(node -e "const b=require('./brands/${BRAND}/brand.json');console.log(b.dataDir)")/logs/core.log"
echo "  - Ctrl+C 退出"
echo ""

cd apps/desktop
pnpm tauri dev
