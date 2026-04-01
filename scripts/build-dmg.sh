#!/usr/bin/env bash
# macOS DMG 打包
# 用法: ./scripts/build-dmg.sh                    # 默认品牌 evoclaw
#       BRAND=healthclaw ./scripts/build-dmg.sh    # 指定品牌
#
# 注意: 未签名，安装后需右键 → 打开 绕过 Gatekeeper

set -e
cd "$(dirname "$0")/.."

export BRAND="${BRAND:-evoclaw}"
BRAND_NAME=$(bun -e "const b=require('./brands/${BRAND}/brand.json');console.log(b.name)")

echo "========================================="
echo "  ${BRAND_NAME} macOS DMG 打包"
echo "========================================="

# 0. 应用品牌配置 + 下载内嵌 Bun
echo ""
echo "[0/4] 应用品牌配置: ${BRAND} ..."
bun scripts/brand-apply.mjs

echo ""
echo "[1/4] 确保内嵌 Bun 二进制 ..."
bun scripts/download-bun.mjs

# 2. 构建所有包
echo ""
echo "[2/4] 构建所有包 (shared + core + desktop 前端) ..."
pnpm build

# 3. 验证 core 产出
echo ""
echo "[3/4] 验证 Core 构建产出 ..."
if [ ! -f "packages/core/dist/server.mjs" ]; then
  echo "❌ packages/core/dist/server.mjs 不存在"
  exit 1
fi
if [ ! -f "packages/core/dist/package.json" ]; then
  echo "❌ packages/core/dist/package.json 不存在（PI 框架需要）"
  exit 1
fi
if [ ! -f "apps/desktop/src-tauri/bun-bin/bun" ]; then
  echo "❌ 内嵌 Bun 二进制不存在"
  exit 1
fi
echo "✅ server.mjs + package.json + bun 二进制已就绪"

# 4. Tauri 打包
echo ""
echo "[4/4] 执行 Tauri 打包 (cargo build --release + bundle DMG) ..."
echo "  首次打包需要编译 Rust，可能需要 3-5 分钟 ..."
echo ""
cd apps/desktop
pnpm tauri build

echo ""
echo "========================================="
echo "  打包完成！"
echo "========================================="
echo ""

# 查找生成的 DMG
DMG=$(find src-tauri/target/release/bundle/dmg -name "*.dmg" 2>/dev/null | head -1)
if [ -n "$DMG" ]; then
  SIZE=$(du -h "$DMG" | cut -f1)
  echo "📦 DMG 文件: $DMG"
  echo "📏 文件大小: $SIZE"
  echo ""
  echo "安装方式:"
  echo "  1. 双击 DMG 打开"
  echo "  2. 拖拽 ${BRAND_NAME}.app 到 Applications"
  echo "  3. 首次打开: 右键 ${BRAND_NAME}.app → 打开 (绕过 Gatekeeper)"
else
  echo "⚠️  未找到 DMG 文件，请检查 src-tauri/target/release/bundle/"
fi
