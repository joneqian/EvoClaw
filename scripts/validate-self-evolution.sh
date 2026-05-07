#!/usr/bin/env bash
# 自我进化 (Skill Inline Review) 端到端验证脚本
#
# 用途：在已经跑起来的 sidecar 上验证 P1-B Inline Review 闭环：
#   1. 种入一个故意写得粗糙的 fixture skill
#   2. 引导用户在前端跟 Agent 完成 1 次 skill 调用 + 1 句负反馈
#   3. 轮询 /skill-evolution/log 观察 inline review 是否触发 + 决策是否 'refine'
#   4. 拉取详情打印 before/after diff 概要
#
# 用法（默认 healthclaw 品牌）：
#   PORT=49152 TOKEN=xxx ./scripts/validate-self-evolution.sh
#   PORT=49152 TOKEN=xxx BRAND=evoclaw ./scripts/validate-self-evolution.sh
#
# 也支持参数形式：
#   ./scripts/validate-self-evolution.sh --port 49152 --token xxx
#
# 前置条件：
#   - 已 BRAND=$BRAND pnpm dev:core 或 pnpm dev:$BRAND 起 sidecar
#   - 已配置 LLM provider（用于 secondary 调用驱动 evolver）
#   - 至少存在 1 个 active agent
#
# 退出码：
#   0  成功观察到 inline review（不论 decision）
#   1  超时未观察到
#   2  前置失败（端口不通 / 未配置）

set -euo pipefail

BRAND="${BRAND:-healthclaw}"
PORT="${PORT:-}"
TOKEN="${TOKEN:-}"
TIMEOUT_SEC="${TIMEOUT_SEC:-300}"   # 5 min 默认轮询时长
POLL_INTERVAL=5
SKILL_NAME="validate-${BRAND}-$(date +%s)"

# 解析 --port / --token 参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)  PORT="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --timeout) TIMEOUT_SEC="$2"; shift 2 ;;
    --brand) BRAND="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PORT" || -z "$TOKEN" ]]; then
  echo "❌ 必须提供 PORT 和 TOKEN（环境变量或 --port/--token 参数）" >&2
  echo "    sidecar 启动后会在 stdout 首行输出 {\"port\":..,\"token\":..}" >&2
  exit 2
fi

# 解析 brand 数据目录
BRAND_JSON="$(dirname "$0")/../brands/$BRAND/brand.json"
if [[ ! -f "$BRAND_JSON" ]]; then
  echo "❌ 找不到品牌配置: $BRAND_JSON" >&2
  exit 2
fi
DATA_DIR_NAME=$(jq -r .dataDir "$BRAND_JSON")
DATA_DIR="$HOME/$DATA_DIR_NAME"
SKILLS_DIR="$DATA_DIR/skills"
SKILL_DIR="$SKILLS_DIR/$SKILL_NAME"
BASE_URL="http://127.0.0.1:$PORT"
AUTH_HEADER="Authorization: Bearer $TOKEN"

trap cleanup EXIT
cleanup() {
  if [[ -n "${SKILL_DIR:-}" && -d "$SKILL_DIR" ]]; then
    rm -rf "$SKILL_DIR"
    echo "🧹 已清理 fixture skill: $SKILL_NAME"
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  $BRAND 自我进化端到端验证"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "BRAND        = $BRAND"
echo "DATA_DIR     = $DATA_DIR"
echo "BASE_URL     = $BASE_URL"
echo "SKILL_NAME   = $SKILL_NAME"
echo "TIMEOUT_SEC  = $TIMEOUT_SEC"
echo

# ─────────────────────────────────────────────
# 步骤 1: 探活
# ─────────────────────────────────────────────
echo "[1/5] 探活 sidecar ..."
if ! curl -sf -m 5 "$BASE_URL/readyz" >/dev/null; then
  echo "❌ /readyz 不通，请确认 sidecar 已启动且 PORT 正确" >&2
  exit 2
fi
echo "✅ sidecar 在线"

# 鉴权探针
if ! curl -sf -m 5 -H "$AUTH_HEADER" "$BASE_URL/skill-evolution/inline-stats?days=1" >/dev/null; then
  echo "❌ Bearer Token 验证失败（401）" >&2
  exit 2
fi
echo "✅ token 验证通过"

# ─────────────────────────────────────────────
# 步骤 2: 种入 fixture skill
# ─────────────────────────────────────────────
echo
echo "[2/5] 种入 fixture skill 到 $SKILL_DIR ..."
mkdir -p "$SKILL_DIR"
cat > "$SKILL_DIR/SKILL.md" <<EOF
---
name: $SKILL_NAME
description: 端到端验证 inline review 用的临时 skill — 故意写得粗糙，方便 evolver 改进
---

# $SKILL_NAME

把用户的输入原样回显，不做任何加工。
EOF
echo "✅ fixture 已就绪（故意写得粗糙）"

# ─────────────────────────────────────────────
# 步骤 3: 记录 baseline
# ─────────────────────────────────────────────
echo
echo "[3/5] 记录 baseline ..."
BASELINE=$(curl -sf -H "$AUTH_HEADER" \
  "$BASE_URL/skill-evolution/inline-stats?days=7" | jq '.total // 0')
echo "✅ 当前 7 天内 inline review 总数 = $BASELINE"

# ─────────────────────────────────────────────
# 步骤 4: 提示用户手动触发
# ─────────────────────────────────────────────
echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  [4/5] 现在请你在 $BRAND 应用里完成两步触发"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "  ① 在前端找一个 active agent，让它调用 \"$SKILL_NAME\":"
echo "     例：\"用 $SKILL_NAME skill 帮我处理：你好\""
echo
echo "  ② 紧接着（5 分钟内）回一句负反馈，例如："
echo "     \"这个 skill 不对\" / \"工具又错了\" / \"再来一次还是错的\""
echo
echo "  ③ 信号检测命中 → 异步触发 inline evolver（10min 限速窗）"
echo
echo "脚本将每 ${POLL_INTERVAL}s 查一次 /skill-evolution/log，最多等 ${TIMEOUT_SEC}s"
echo

# ─────────────────────────────────────────────
# 步骤 5: 轮询观察
# ─────────────────────────────────────────────
START=$(date +%s)
DEADLINE=$((START + TIMEOUT_SEC))

while :; do
  NOW=$(date +%s)
  if (( NOW >= DEADLINE )); then
    echo
    echo "❌ 超时 ${TIMEOUT_SEC}s 未观察到针对 $SKILL_NAME 的 inline review"
    echo "   debug 思路："
    echo "   - tail -f $DATA_DIR/logs/core.log | grep -E '\\[inline-review|skill-evolver\\]'"
    echo "   - 看是否有 [inline-review-signal-hit] / [extract][start]"
    echo "   - 检查 secondary LLM 是否配好（config security.skillEvolver）"
    exit 1
  fi

  LOG_RESP=$(curl -sf -H "$AUTH_HEADER" \
    "$BASE_URL/skill-evolution/log?skill=$SKILL_NAME&limit=10" || echo '{}')
  ENTRIES=$(echo "$LOG_RESP" | jq '.entries // []')
  COUNT=$(echo "$ENTRIES" | jq 'length')
  INLINE_COUNT=$(echo "$ENTRIES" | jq '[.[] | select(.triggerSource == "inline")] | length')

  ELAPSED=$((NOW - START))
  printf "\r⏳ 已等 %3ds / %ds — 该 skill 总记录=%s, inline=%s" \
    "$ELAPSED" "$TIMEOUT_SEC" "$COUNT" "$INLINE_COUNT"

  if (( INLINE_COUNT > 0 )); then
    echo
    echo
    echo "✅ 命中！抓到 inline review 记录"
    LATEST_ID=$(echo "$ENTRIES" | jq '[.[] | select(.triggerSource == "inline")] | .[0].id')
    echo
    echo "📋 最新 inline review (id=$LATEST_ID):"
    DETAIL=$(curl -sf -H "$AUTH_HEADER" "$BASE_URL/skill-evolution/log/$LATEST_ID")
    echo "$DETAIL" | jq '{
      id, decision, reasoning, evolvedAt,
      modelUsed, durationMs, errorMessage,
      previousLen: (.previousContent | length),
      newLen: (.newContent | length),
      contentChanged: (.previousContent != .newContent)
    }'

    # 进一步断言决策类型
    DECISION=$(echo "$DETAIL" | jq -r .decision)
    echo
    case "$DECISION" in
      refine)
        CHANGED=$(echo "$DETAIL" | jq -r '.previousContent != .newContent')
        if [[ "$CHANGED" == "true" ]]; then
          echo "🎯 decision=refine，且 SKILL.md 内容真发生变化 — 自我进化通路 OK"
        else
          echo "⚠️  decision=refine 但内容未变（异常情况）"
        fi
        ;;
      keep)    echo "ℹ️  decision=keep — evolver 评估后认为无需改动" ;;
      disable) echo "ℹ️  decision=disable — evolver 决定禁用 skill" ;;
      "")      echo "❌ decision 为空 — 可能 evolver 报错（看 errorMessage）" ;;
      *)       echo "ℹ️  decision=$DECISION" ;;
    esac

    echo
    echo "📊 7 天 inline 统计："
    curl -sf -H "$AUTH_HEADER" "$BASE_URL/skill-evolution/inline-stats?days=7" \
      | jq '{ total, errorCount, byDecision, topSkills: (.topSkills // [] | .[0:5]) }'

    exit 0
  fi

  sleep "$POLL_INTERVAL"
done
