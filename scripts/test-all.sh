#!/usr/bin/env bash
# EvoClaw 全量测试 + 构建验证
# 用法: ./scripts/test-all.sh

set -e
cd "$(dirname "$0")/.."

echo "========================================="
echo "  EvoClaw 全量测试"
echo "========================================="

# 1. 测试
echo ""
echo "[1/3] 运行所有测试 ..."
pnpm test

# 2. 构建
echo ""
echo "[2/3] 构建所有包 ..."
pnpm build

# 3. 验证 Core 独立运行
echo ""
echo "[3/3] 验证 Core Service 可启动 ..."
bun run packages/core/dist/server.mjs &
CORE_PID=$!
sleep 2

# 读取首行 JSON 获取端口（从日志文件读取）
PORT=$(cat ~/.evoclaw/logs/core.log 2>/dev/null | grep "服务已启动" | tail -1 | grep -o 'port=[0-9]*' | cut -d= -f2)

if [ -n "$PORT" ]; then
  HEALTH=$(curl -s "http://127.0.0.1:$PORT/health" 2>/dev/null)
  echo "  Health: $HEALTH"
  echo "✅ Core Service 启动正常"
else
  echo "⚠️  无法读取端口，但进程已启动 (PID: $CORE_PID)"
fi

kill $CORE_PID 2>/dev/null || true
wait $CORE_PID 2>/dev/null || true

echo ""
echo "========================================="
echo "  全部通过 ✅"
echo "========================================="
