# 22 — 浏览器栈 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/22-browser-stack.md`（1239 行，基线 `00ff9a26` @ 2026-04-16，含 Addendum drift audit：`browser_tool.py` 2218 → 2393 行，+175 净行，5 个新特性）
> **hermes 基线**: `tools/browser_tool.py` 2393 行（10 个工具 + dispatcher + 会话管理）+ `tools/browser_providers/{base,browserbase,browser_use,firecrawl}.py` 4 文件（Provider 抽象 + 3 个云后端）+ `tools/browser_camofox.py`（Camoufox REST client，反检测 Firefox）+ `tools/browser_camofox_state.py`（UUID 派生 managed persistence）+ `agent-browser` npm CLI（Cheerio-based accessibility tree）+ `tests/tools/test_browser*.py` 10+ 个测试文件 + `url_safety.py` / `website_policy.py` / `agent/redact.py`（SSRF + 黑名单 + 脱敏）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `f218c4f`（2026-04-17），`packages/core/src/tools/browser-tool.ts` **共 147 行**（fetch 基础模式 + 可选 Playwright 完整模式，单工具聚合 6 action）+ `packages/core/src/tools/web-fetch.ts` 359 行（URL→Markdown 非浏览器路径）+ `packages/core/src/tools/web-search.ts` 87 行（Brave 搜索 API）+ `packages/core/src/security/web-security.ts` 231 行（URL 校验 + 私有 IP + 安全重定向）
> **综合判定**: 🔴 **结构性缺失**。EvoClaw 只有一个 147 行的 `browser-tool.ts` 通吃 6 个 action，底层是 Playwright 可选依赖（`import('playwright').catch(() => null)` 降级到 `fetch`）；无 Provider 抽象、无云后端（Browserbase/Browser Use/Firecrawl）、无反检测栈（Camoufox）、无 `@ref` accessibility tree、无 session 注册表、无视觉分析、无后台 session 清理线程、无 URL API key 前缀过滤、无 prompt-injection 扫描。仅 3 项 🟢 反超（`web-security.ts` 的 SSRF + HTTPS 升级 + 跨主机重定向 LLM 回传）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes 浏览器栈**（`.research/22-browser-stack.md §1`）—— 面向 **SWE / 爬虫 / 网页自动化** 场景的**分层栈**：10 个原子工具（`browser_navigate` / `browser_snapshot` / `browser_click` / `browser_type` / `browser_scroll` / `browser_back` / `browser_press` / `browser_get_images` / `browser_vision` / `browser_console`）→ dispatcher（`_run_browser_command`）→ Provider 选择层（3 个云 + 1 本地 + 1 Camoufox 反检测）→ `agent-browser` npm CLI（轻量 Cheerio accessibility tree + `@eN` ref ID）→ 真实浏览器（云 CDP WebSocket / 本地 headless Chromium / Camoufox Firefox）。附带完整 session 生命周期管理（`_active_sessions` dict + `_sessions_lock` + 后台 cleanup 线程 + atexit 钩子 + `_reap_orphaned_browser_sessions` 孤儿扫描）、5 层安全检查（URL 前缀 API key 拒绝 / SSRF / 网站策略黑名单 / redirect 安全 / snapshot 两层 redaction）、task-aware LLM 摘要截断（`SNAPSHOT_SUMMARIZE_THRESHOLD = 8000`）。总规模约 **3500 行核心代码 + 10+ 测试文件**。

**EvoClaw 浏览器栈**（`packages/core/src/tools/browser-tool.ts:1-147`）—— 面向**桌面 AI 伴侣**（非程序员企业用户）的**单文件工具聚合**：一个 `browser` 工具通过 `action` 枚举字段分发 6 个子命令（`navigate` / `screenshot` / `click` / `type` / `extract` / `evaluate`）。执行路径二选一：优先 `await import('playwright').catch(() => null)`（`browser-tool.ts:39`）尝试加载 Playwright 可选依赖 → 成功则 `chromium.launch({ headless: true })` 每次启动一个新 browser、完成后 `browser.close()`；失败则降级到 `fetchBasicMode`（`browser-tool.ts:59-80`），纯 `fetch + User-Agent + 正则剥 HTML 到 10000 字符`。**无 session 复用**（每 action 启关一次 browser）、**无 Provider 层**、**无云后端**、**无反检测**、**无 accessibility tree**、**无视觉分析**、**无 URL 前缀安全检查**、**无后台清理**。

**关键架构分歧**：EvoClaw 的产品定位（CLAUDE.md §1 项目概述）是"自进化 AI 伴侣桌面应用 / 面向非程序员企业用户"，浏览器不是核心能力（记忆 / 渠道 / 人格才是）；hermes 是 SWE agent，browser 是 10 个原子工具的分层栈，核心价值主张。因此绝大多数 🔴 项都属于"架构定位差异导致的合理缺失"，**不建议按 hermes 深度补齐**——但现有 `browser-tool.ts` 的单文件设计确实有隐患（无 session、无并发保护、无 URL API key 检测）。

**规模对比**: hermes 浏览器栈约 **3500 行**（2393 browser_tool + 4 provider 文件 + camofox 双文件 + 安全层），EvoClaw 约 **147 行 browser-tool + 231 行 web-security + 359 行 web-fetch**（其中 web-security 跨多个工具共享）。代码规模比 **20:1**。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话判定 |
|---|---|---|---|
| §3.1 | 10 个原子浏览器工具 | 🔴 | EvoClaw 用 `action` 枚举单工具聚合 6 子命令，`browser_get_images` / `browser_vision` / `browser_console` 独立语义缺失 |
| §3.2 | `@ref` accessibility tree ID 系统 | 🔴 | EvoClaw **完全缺失**：`grep -rn "@ref\|@e1\|accessibility.tree" packages/core/src` 零相关实现，`click` 只支持 CSS selector |
| §3.3 | Provider 抽象层（`CloudBrowserProvider` ABC） | 🔴 | EvoClaw **完全缺失**：`grep CloudBrowserProvider\|BrowserProvider` 零结果，只有硬编码 `chromium.launch` |
| §3.4 | 云 Provider（Browserbase / Browser Use / Firecrawl） | 🔴 | EvoClaw **完全缺失**：`grep -i "browserbase\|browser-use\|firecrawl"` 零命中（仅 SKILL.md 提及） |
| §3.5 | Camoufox 反检测 Firefox 栈 | 🔴 | EvoClaw **完全缺失**：`grep -i camoufox` 零命中；无 `@askjo/camofox-browser` npm 依赖 |
| §3.6 | `agent-browser` CLI 集成（npm 包） | 🔴 | EvoClaw **完全缺失**：`agent-browser-clawdbot/SKILL.md` 只是个指导 Skill，没有工具代码调用 `agent-browser` CLI |
| §3.7 | Session 注册表 + 生命周期（`_active_sessions`） | 🔴 | EvoClaw **完全缺失**：每个 action 启停一个 browser（`browser-tool.ts:88, 144`），无复用，无 lock，无 task_id 关联 |
| §3.8 | 后台 cleanup 线程 + 孤儿 session 扫描 | 🔴 | EvoClaw **完全缺失**：`grep -rn "cleanup.*browser\|_active_sessions\|orphaned"` 零结果 |
| §3.9 | CDP override（`BROWSER_CDP_URL`）+ 手动连接 | 🔴 | EvoClaw **完全缺失**：`grep -i "CDP\|BROWSER_CDP_URL"` 在 core/src 零命中 |
| §3.10 | Snapshot 智能截断（task-aware LLM 提取） | 🔴 | EvoClaw 只有 `bodyText.slice(0, 10_000)` 硬截断（`browser-tool.ts:99, 130`），无 user_task LLM 提取 |
| §3.11 | `browser_vision` 截图 + 视觉 LLM 分析 | 🔴 | EvoClaw `screenshot` 仅存盘返回路径（`browser-tool.ts:102-110`），不做视觉 LLM 分析；`createImageTool` 是通用 vision 工具，未与 browser 联动 |
| §3.12 | URL 前缀 API key 拒绝（防 secret 外泄） | 🔴 | EvoClaw **完全缺失**：`grep _prefix_re\|API.*key.*url` 零命中，`web-security.ts` 只检查 `username/password` 不检 key 前缀 |
| §3.13 | SSRF 私有 IP 拦截 | 🟢 | **反超**：`web-security.ts:92-121 isPrivateIP` 覆盖 127/10/172.16-31/192.168/169.254/0.x + IPv6 ::1，早于 navigate 请求，且重定向目标也查（L205-209） |
| §3.14 | HTTP → HTTPS 自动升级 | 🟢 | **反超**：`web-security.ts:129-134 upgradeToHttps` 自动升级，hermes 浏览器栈无此机制（只做 SSRF / 黑名单） |
| §3.15 | 跨主机重定向 LLM 回传 | 🟢 | **反超**：`fetchWithSafeRedirects`（`web-security.ts:173-230`）同主机自动跟随 10 跳，跨主机返回 `{redirect: {originalUrl, redirectUrl, message}}` 让 LLM 决定 |
| §3.16 | 网站策略黑名单（website_policy） | 🔴 | EvoClaw **完全缺失**：`grep -rn "check_website_access\|websitePolicy"` 零结果；只有 `preapproved-domains.ts` 白名单语义相反 |
| §3.17 | Snapshot 两层 redaction（pre/post LLM） | 🔴 | EvoClaw `browser-tool.ts` 无任何脱敏；日志层有 `sanitizePII`（CLAUDE.md），但不覆盖浏览器返回内容 |
| §3.18 | Bot 检测警告（title 关键词） | 🔴 | EvoClaw **完全缺失**：`grep -rn "captcha\|cloudflare\|bot.*detect"` 在 tools/ 零命中 |
| §3.19 | 多 tab / managed_persistence | 🔴 | EvoClaw 单 page 抽象（`newPage`），每次 close 不保留 profile，无 UUID 派生 user_id 机制 |
| §3.20 | 测试覆盖 | 🔴 | EvoClaw `grep -rn browser-tool __tests__` 零结果（**无 browser-tool 测试**），hermes 有 10+ 个专项测试文件 |

**统计**: 🔴 17 / 🟡 0 / 🟢 3（全部集中在 `web-security.ts` SSRF 防护层，跨工具共享）。综合判定：**浏览器能力结构性缺失**，但因产品定位（桌面 AI 伴侣、非 SWE agent）并非核心赛道，多数项目建议**不补齐 / 或仅补齐 P0 安全加固**。

---

## 3. 机制逐条深度对比

每条同时给出 **hermes 实现**（带源码行号）+ **EvoClaw 实现**（带源码行号或 grep 零结果证据）+ **判定与分析**。

### §3.1 10 个原子浏览器工具 vs 单工具 6 action 聚合

**hermes**（`.research/22-browser-stack.md §3.1`）—— 每个能力一个 `@tool` 装饰器声明为独立工具，LLM 看到 10 个工具名：

```python
# tools/browser_tool.py:L1277/L1416/L1470/L1505/L1543/L1590/L1620/L1653/L1835/L1893
browser_navigate (L1277) # 导航 + 自动 snapshot
browser_snapshot (L1416) # 获取 accessibility tree 文本
browser_click    (L1470) # 点击 @e1/@e2 ref
browser_type     (L1505) # 填表单
browser_scroll   (L1543) # 滚动 up/down/left/right
browser_back     (L1590) # 浏览器后退
browser_press    (L1620) # 按键 Enter/Escape/Tab
browser_console  (L1653) # 执行 JS 或读 console.log
browser_get_images (L1835) # 获取页面图片 URL 列表
browser_vision   (L1893) # 截图 + 视觉 LLM 分析
```

**设计原则**：
- `browser_navigate` **自动 snapshot** —— 节省 LLM 一次工具调用
- `browser_snapshot` 返回带 `@e1, @e2` 标号的文本树，`browser_click` 用 `@e3` 引用（**不需要 CSS selector**）
- `browser_vision` 是 escape hatch：accessibility tree 不够时（canvas / 图片）才用视觉 LLM

**EvoClaw**（`packages/core/src/tools/browser-tool.ts:14-56`）—— 单一 `browser` 工具，通过 `action` 字段分发：

```typescript
// browser-tool.ts:14-32
export function createBrowserTool(): ToolDefinition {
  return {
    name: 'browser',
    description: '浏览器自动化：导航网页、点击元素、输入文本、截图。基础模式使用 HTTP 抓取，完整模式需安装 Playwright。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['navigate', 'screenshot', 'click', 'type', 'extract', 'evaluate'],
          description: '操作类型',
        },
        url: { type: 'string', description: '目标 URL（navigate 时必填）' },
        selector: { type: 'string', description: 'CSS 选择器（click/type/extract 时使用）' },
        text: { type: 'string', description: '输入文本（type 时使用）' },
        script: { type: 'string', description: 'JavaScript 代码（evaluate 时使用）' },
      },
      required: ['action'],
    },
```

LLM 视角只看到**一个工具名** `browser`，调用时传 `action="navigate"` 分发。无 `back`、`press`、`scroll`、`get_images`、`vision`、`console` 对应 action（`browser-tool.ts:23` enum 明示只有 6 项）。

**判定 🔴**：三重差距：
1. **粒度差异**：hermes 10 个工具 vs EvoClaw 6 action，`scroll / back / press / get_images / vision / console` 6 项**完全缺失语义**。
2. **Discovery 体验差**：LLM 看到 10 个独立工具的 description 比单工具的枚举字段更容易选对能力（hermes 的 description 各自针对性强；EvoClaw 一个 description 概述所有功能）。
3. **navigate 不自动 snapshot**：`browser-tool.ts:93-100` navigate 返回 `bodyText.slice(0, 10_000)`——这是 `textContent` 不是 accessibility tree，也不带 `@ref` 标号，后续 click 必须用 CSS selector（`browser-tool.ts:113-117`）。

补齐成本：拆成 10 个 ToolDefinition + 加 scroll/back/press/get_images 4 个 Playwright API 调用约 2 人日；`vision` 涉及视觉 LLM 串联约 3 人日；`console.log 捕获 + JS 注入`约 1 人日。合计 ~1 人周。

---

### §3.2 `@ref` accessibility tree ID 系统

**hermes**（`.research/22-browser-stack.md §3.1 设计原则`）—— `browser_snapshot` 返回形如：

```text
[1] button "Submit" @e1
[2] textbox "Email" @e2
[3] link "Home" @e3 href="/"
```

后续工具用 `@e3` 引用元素：`browser_click(ref="@e3")` / `browser_type(ref="@e2", text="a@b.com")`。节点由 `agent-browser` npm 包的 Cheerio-based DOM 解析生成，**文本优先，避免像素**（`§3.1`）。

**EvoClaw**（`browser-tool.ts:112-117`）—— 只支持 CSS selector：

```typescript
case 'click': {
  const selector = args['selector'] as string | undefined;
  if (!selector) return '错误：click 需要 selector 参数';
  await page.click(selector);
  return `已点击: ${selector}`;
}
```

参数文档（`browser-tool.ts:27`）：`selector: { type: 'string', description: 'CSS 选择器（click/type/extract 时使用）' }`。

**grep 零结果证据**：
- `grep -rn "@ref\|@e1\|accessibility.tree" packages/core/src` 仅 SKILL.md 文档提及，无工具代码使用（Grep 命中 3 个 SKILL.md 文件，0 个 `.ts` 文件）

**判定 🔴**：`@ref` ID 系统是 hermes 浏览器栈的**核心创新之一**——它解决了"LLM 生成的 CSS selector 在复杂 SPA 里容易错"的问题（selector 可能 `.btn-primary` 匹配 5 个元素，而 `@e3` 唯一）。EvoClaw 要求 LLM 生成正确的 CSS selector，在动态页面（SPA / React 生成的 class 哈希）下极易失败。补齐需要引入 `agent-browser` 或自实现 DOM → 编号文本树（参考 `§6.2 Cheerio-based accessibility tree` 算法），约 2-3 人周。

---

### §3.3 Provider 抽象层（`CloudBrowserProvider` ABC）

**hermes**（`.research/22-browser-stack.md §3.3`）—— `tools/browser_providers/base.py` 定义抽象基类：

```python
class CloudBrowserProvider(ABC):
    @classmethod
    @abstractmethod
    def provider_name(cls) -> str: ...       # 'browserbase' / 'browser-use' / 'firecrawl'

    @classmethod
    @abstractmethod
    def is_configured(cls) -> bool: ...      # 检查 env vars（不调 API）

    @abstractmethod
    def create_session(self, task_id: str) -> Dict[str, object]:
        """返回 {session_id, cdp_url, connect_url}"""

    @abstractmethod
    def close_session(self, session_id: str) -> bool: ...

    @abstractmethod
    def emergency_cleanup(self, session_id: str) -> None: ...
```

配套 `_PROVIDER_REGISTRY = {"browserbase": BrowserbaseProvider, "browser-use": BrowserUseProvider, "firecrawl": FirecrawlProvider}` 注册表 + `_get_cloud_provider()` 选择函数（显式 config > 自动检测：browser-use > browserbase）。

**EvoClaw** —— 完全没有抽象层：

```typescript
// browser-tool.ts:88  —— 硬编码 chromium.launch，无 provider 抽象
const browser = await pw.chromium.launch({ headless: true });
```

**grep 零结果证据**：
- `grep -rn "CloudBrowserProvider\|BrowserProvider\|providerRegistry.*browser" packages/core/src` **零命中**
- `grep -rn "chromium.launch\|firefox.launch\|webkit.launch" packages/core/src` 仅 `browser-tool.ts:88` 一处

**判定 🔴**：无 Provider 抽象意味着无法接入云浏览器服务（见 §3.4）、无法切换反检测后端（见 §3.5）、无法通过配置动态选择。补齐首先需要定义 `BrowserProvider` interface（~50 行）+ registry + `_get_cloud_provider` 等价函数 + env 检测（~150 行）。工作量约 0.5 人周**仅铺骨架**，后续每接一个 provider 额外 1 人日。

---

### §3.4 云 Provider（Browserbase / Browser Use / Firecrawl）

**hermes**（`.research/22-browser-stack.md §3.4 / §3.5 / §3.6`）—— 3 个独立 provider 实现：

| Provider | 文件 | 关键特性 | 价值 |
|---|---|---|---|
| **Browserbase** | `browserbase.py` | `POST /v1/sessions` + `keepAlive=true` + residential proxies + `advancedStealth=true`（Scale 计划）+ 402 fallback 降级 | 高级反检测，付费隐身 |
| **Browser Use** | `browser_use.py` | `POST /api/v3/browsers` + Nous managed gateway（无需用户自己 API key）+ `X-Idempotency-Key` + 双字段兼容（cdpUrl/connectUrl） | 托管模式，幂等安全 |
| **Firecrawl** | `firecrawl.py` | `POST /v2/browser` + `ttl=300`（服务端 5 分钟回收）+ `DELETE` 关闭 | 最简爬虫 |

所有 provider 返回 `{session_id, cdp_url}`，`agent-browser --cdp <ws>` 连接云浏览器。

**EvoClaw** —— 完全没有云浏览器集成：

**grep 零结果证据**：
- `grep -rni "browserbase" packages/core/src` → 只有 `summarize/SKILL.md` 2 处文档提及，0 处工具代码
- `grep -rni "browser-use" packages/core/src` → 0 处
- `grep -rni "firecrawl" packages/core/src` → 0 处
- `packages/core/package.json` 无 `@browserbasehq/*` / `browser-use` / `@mendable/firecrawl-js` 等云 SDK 依赖

**判定 🔴**：云 browser provider 对 hermes 是**反检测 / 残留代理 / 多 IP 轮转 / 付费隐身**的基础设施；EvoClaw 定位（桌面应用）下用户本地就有 Chrome/Firefox，且企业用户场景多为"抓取公开文档 / 内网知识库"（用 `web-fetch` 即可），云 browser 性价比极低。**不建议补齐**——但可以保留接口扩展能力（§3.3 抽象层做好后，未来如果有企业用户需要 browser 反检测，可以一周内接入一个 provider）。

---

### §3.5 Camoufox 反检测 Firefox 栈

**hermes**（`.research/22-browser-stack.md §3.7`）—— 本地反检测 Firefox fork：

```
@askjo/camofox-browser npm 包 (Addendum 基线 v1.5.2，Node >=20)
  ↓ npm start / docker run -p 9377:9377
Camoufox Server (REST API @ localhost:9377)
  ↓ browser_camofox.py REST client
  POST /tabs                     # 创建 tab
  POST /tabs/{id}/navigate
  GET  /tabs/{id}/snapshot
  POST /tabs/{id}/click
  POST /tabs/{id}/type
  ...  10+ endpoints
```

**C++ 级反检测**（比 Playwright stealth 更深）：
- User Agent 欺骗
- Canvas / WebGL / Audio context 指纹随机化
- 时区 / 字体 / 语言伪装
- `navigator.webdriver` 隐藏
- Plugin 清单伪造

**配套 `browser_camofox_state.py`**（managed persistence）:
```python
user_id = uuid.uuid5(NAMESPACE_URL, f"camofox-user:{scope_root}")
session_key = uuid.uuid5(NAMESPACE_URL, f"camofox-session:{scope_root}:{task_id}")
```
→ 相同 `scope_root` 的不同 task 复用 profile（登录状态 / cookies 保留）；不同 task 有独立 session_key（隔离 tab）。持久化到 `~/.hermes/browser_auth/camofox/`。

**EvoClaw** —— 完全没有：

**grep 零结果证据**：
- `grep -rni "camoufox\|camofox" packages/core/src` → 0 处（Grep 命中数 0）
- `package.json` 无 `@askjo/camofox-browser` 依赖
- 无 `browser_auth` 持久化目录设计

**判定 🔴**：Camoufox 是反 bot 检测的关键能力（Cloudflare / DataDome / Akamai Bot Manager），解决 Playwright 基础模式被检测的痛点。EvoClaw 面向非程序员企业用户，**极少需要反检测**（企业一般在内网访问自己的服务，不面对 bot 检测）；**不建议补齐**。如未来有"爬取公网竞品数据"需求，可通过 MCP 桥接 `@playwright/mcp` 或第三方 Camoufox MCP 服务器（零代码 Day-1 接入，见 §4 P2 建议）。

---

### §3.6 `agent-browser` CLI 集成

**hermes**（`.research/22-browser-stack.md §3.8`）—— `agent-browser ^0.13.0` npm 包，两种模式：

```bash
# CDP 模式（连接远程浏览器）
agent-browser --cdp <ws-url> --json navigate https://example.com

# Session 模式（管理本地浏览器）
agent-browser --session my-session --json navigate https://example.com
```

关键特性：
- **Cheerio-based accessibility tree**（轻量 DOM 查询，非 Playwright 重型引擎）
- **Session isolation**（每 task_id 独立 socket 目录 `AGENT_BROWSER_SOCKET_DIR`）
- **Background daemon**（CLI 退出后浏览器仍运行）
- **PATH 扩展**（Hermes 管理的 Node > Homebrew Node）
- **临时文件 stdout/stderr**（防 daemon 继承 pipe）
- **`start_new_session=True`**（独立 process group）
- **默认超时 30s，navigate 特殊 60s**

**EvoClaw** —— 完全没有：

EvoClaw 的 `browser-tool.ts` 直接 `import('playwright')` 用 Playwright JS API，不走 CLI 子进程。有一个 `agent-browser-clawdbot/SKILL.md` 技能文档提到 agent-browser CLI，但**无任何工具代码调用它**——它只是一份给 LLM 的使用说明（需要用户预先 `npm i -g agent-browser`，然后 LLM 通过 bash 工具调用）。

**grep 零结果证据**：
- `grep -rn "agent-browser\|AGENT_BROWSER_SOCKET_DIR" packages/core/src/tools` → 0 处
- `grep -rn "agent-browser" packages/core/src` → 仅 SKILL.md 79 次出现（全部在文档里）

**判定 🔴**：`agent-browser` CLI 是 hermes 实现轻量 session 隔离 + daemon 模式的关键。EvoClaw 每次 action 启停一整个 Playwright browser（见 §3.7），性能和持久化都差。补齐成本：引入 `agent-browser` 作为 peerDependency（~0.5 人日）+ 实现 `_run_browser_command` 等价函数（~1 人日）+ socket 目录 / PATH 管理（~1 人日）。

---

### §3.7 Session 注册表 + 生命周期

**hermes**（`.research/22-browser-stack.md §3.9`）—— 全局 session 注册表 + lock：

```python
# 全局状态（daemon-thread-safe）
_active_sessions: Dict[str, Dict] = {}    # task_id → session info
_sessions_lock = threading.Lock()
_cleanup_thread: Optional[threading.Thread] = None

def _get_session_info(task_id: str) -> Dict:
    _start_browser_cleanup_thread()
    _update_session_activity(task_id)     # 更新 last_activity 时间戳

    cdp_override = _get_cdp_override()    # $BROWSER_CDP_URL
    if cdp_override:
        return {"cdp_url": cdp_override, "session_id": "manual-cdp"}

    with _sessions_lock:
        if task_id in _active_sessions:
            return _active_sessions[task_id]    # 复用

    provider_class = _get_cloud_provider()
    if provider_class is None:
        session_info = _create_local_session(task_id)
    else:
        provider = provider_class()
        result = provider.create_session(task_id)
        session_info = {"task_id": task_id, "provider": provider.provider_name(), "provider_instance": provider, **result}

    with _sessions_lock:
        _active_sessions[task_id] = session_info
    return session_info
```

**每 task_id 一个 session，跨多工具调用复用**：`browser_navigate → browser_snapshot → browser_click → browser_type` 串联时用的是同一个浏览器实例（保留 cookies / login state / 当前 URL）。

**EvoClaw**（`browser-tool.ts:88-145`）—— 每 action 启停一整个 browser：

```typescript
// browser-tool.ts:88-145 —— 每 action 都 launch + close
async function executeWithPlaywright(pw, action, args) {
  const browser = await pw.chromium.launch({ headless: true });    // ← 每次新 browser
  const page = await browser.newPage();

  try {
    switch (action) { /* navigate / screenshot / click / type / extract / evaluate */ }
  } finally {
    await browser.close();    // ← 每次关闭
  }
}
```

**grep 零结果证据**：
- `grep -rn "_active_sessions\|sessions_lock\|_get_session_info\|task_id.*browser" packages/core/src` → 0 处
- `grep -rn "cleanup.*browser\|orphaned.*session\|cleanup_inactive" packages/core/src` → 0 处

**判定 🔴**：这是 EvoClaw 浏览器栈的**最严重结构缺陷**——无法做多步交互（登录 → 导航 → 填表 → 提交的串联场景全部失效，因为每步重启浏览器会丢失 cookies/session state）。对比：hermes 的 `keepAlive=true`（Browserbase）+ 30s idle timeout + 孤儿清理，EvoClaw 每次 close 且无 cleanup。补齐成本：引入 session map + per-session_key 复用（~1 人日）+ 后台 cleanup 定时器（~0.5 人日）+ 测试（~0.5 人日）。**P0 级别**，见 §4。

---

### §3.8 后台 cleanup 线程 + 孤儿 session 扫描

**hermes**（`.research/22-browser-stack.md §3.9 + Addendum §4.3`）—— 两层清理：

```python
# 第 1 层：后台 cleanup 线程（每 30s 扫描）
def _cleanup_inactive_browser_sessions():
    while not _cleanup_stop_event.is_set():
        now = time.time()
        with _sessions_lock:
            to_close = [
                task_id for task_id, info in _active_sessions.items()
                if now - info.get("last_activity", 0) > DEFAULT_SESSION_TIMEOUT  # 300s
            ]
        for task_id in to_close:
            cleanup_browser(task_id)
        _cleanup_stop_event.wait(timeout=30)

# 第 2 层：孤儿 session 扫描（Addendum 新增 L508-567，commit 75380de4）
def _reap_orphaned_browser_sessions():
    """扫描 /tmp/agent-browser-{h_*,cdp_*} socket 目录，
    读取 {session_name}.pid，检查 PID 活跃性，
    不在 _active_sessions 中的发送 SIGTERM"""
    # 背景：生产 9 天 24 个孤立 session 消耗 7.6GB 内存
```

外加 `cleanup_all_browsers` 注册 atexit 钩子。

**EvoClaw** —— 完全没有：

**grep 零结果证据**：
- `grep -rn "cleanup.*browser\|orphaned.*browser\|_active_sessions" packages/core/src` → 0 处
- `grep -rn "setInterval\|setTimeout.*clean" packages/core/src/tools/browser-tool.ts` → 0 处
- Shutdown 钩子 `registerShutdownHandler`（CLAUDE.md §优雅关闭）覆盖"调度器→渠道→MCP→数据库→日志"四层，**不覆盖 browser-tool**

**判定 🔴**：EvoClaw 因为 §3.7 每 action 启停 browser 的设计，**从功能上规避了孤儿泄漏问题**（每次 try/finally close）——但这是"错误的正确答案"：功能性能先垮掉。未来若按 §3.7 引入 session 复用，必须同步补齐此机制（~0.5 人日：`setInterval(() => cleanupInactive(), 30_000)`）。

---

### §3.9 CDP override（`BROWSER_CDP_URL`）+ 手动连接

**hermes**（`.research/22-browser-stack.md §3.2 环境变量 + Addendum §4.4`）—— 支持用户手动指定 CDP endpoint：

```python
# 优先级（Addendum commit 305a702e 修复）：
# BROWSER_CDP_URL 显式设置 → is_camofox_mode() 返回 False → 绕过 Camoufox
def _get_cdp_override() -> Optional[str]:
    return os.environ.get("BROWSER_CDP_URL")    # 例如 ws://localhost:9222
```

用途：开发者手动连接自己的 Chrome DevTools（启动时 `chrome --remote-debugging-port=9222`），完全绕过 hermes 的 session 管理和 provider 选择。

**EvoClaw** —— 完全没有：

**grep 零结果证据**：
- `grep -rn "BROWSER_CDP_URL\|CDP_URL\|remote-debugging" packages/core/src` → 0 处
- `grep -rn "chromium.connect\|chromium.connectOverCDP" packages/core/src` → 0 处（EvoClaw 只用 `chromium.launch`，不支持连接外部 browser）

**判定 🔴**：CDP override 对开发者高价值（自带 Chrome + 已登录状态 + 自己的 cookies），但对企业非程序员用户几乎无感知——**不建议主动补齐**，若 §3.3 Provider 抽象层落地时可顺手加一个 env override 分支（~15 分钟工作量）。

---

### §3.10 Snapshot 智能截断（task-aware LLM 提取）

**hermes**（`.research/22-browser-stack.md §3.10`）—— 两级截断策略：

```python
SNAPSHOT_SUMMARIZE_THRESHOLD = 8000  # 字符

def browser_snapshot(task_id, full=False, user_task=""):
    snapshot = _run_browser_command(task_id, "snapshot")["snapshot"]
    if len(snapshot) > SNAPSHOT_SUMMARIZE_THRESHOLD and not full:
        if user_task:
            snapshot = _extract_relevant_content(snapshot, user_task)    # LLM 任务感知提取
        else:
            snapshot = _truncate_snapshot(snapshot)    # 简单截断，保留 @ref
    return json.dumps({"success": True, "snapshot": snapshot, ...})

def _extract_relevant_content(snapshot, user_task):
    snapshot = redact_sensitive_text(snapshot)    # Pre-LLM redaction
    prompt = f"""Extract the parts of this page snapshot relevant to the task:
    Task: {user_task}
    Snapshot: {snapshot}
    Return only the relevant portions. Preserve all @eN element refs and interactive elements (buttons, links, inputs)..."""
    extracted = call_llm(task="web_extract", ..., max_tokens=4000)
    return redact_sensitive_text(extracted)    # Post-LLM redaction
```

配套**两层 redaction**（pre 防 API key 泄露给辅助 LLM 服务商，post 防 LLM echo 回 secret）。

**EvoClaw**（`browser-tool.ts:93-100, 127-130`）—— 只有硬截断：

```typescript
// browser-tool.ts:93-100  navigate
const bodyText = await page.textContent('body');
return `页面: ${title}\n内容: ${(bodyText ?? '').slice(0, 10_000)}`;    // ← 硬截断 10k

// browser-tool.ts:127-130  extract
const text = await page.textContent(selector);
return (text ?? '').slice(0, 10_000);    // ← 硬截断 10k
```

- 硬截断 10000 字符（hermes 阈值是 8000，但 hermes 后续会用 LLM 压缩到 ~4000 tokens）
- **无任务感知**：不看 `user_task` 做针对性提取
- **无 redaction**：浏览器里返回的内容如含 API key / 密码，直接送 LLM（会被 `sanitizePII` 在日志层覆盖，但 LLM 上下文仍有）

web-fetch 工具（`web-fetch.ts:138-148`）有二级模型摘要（`applyPromptToContent`），但**未桥接到 browser 工具**。

**判定 🔴**：长页面（如 GitHub README / Wikipedia / 产品文档）截断到 10k 字符会丢失关键信息；无 redaction 有 secret 泄露风险（虽小）。补齐成本：复用 `web-fetch.ts` 的 `applyPromptToContent` LLM 摘要（~1 人日）+ 加 `redact_sensitive_text` 调用（~0.5 人日）。

---

### §3.11 `browser_vision` 截图 + 视觉 LLM 分析

**hermes**（`.research/22-browser-stack.md §3.11 browser_vision L1893`）—— 截图 + 视觉模型分析一体化：

```python
def browser_vision(task_id, question, annotate=False):
    _cleanup_old_screenshots()    # 删 24h 前截图
    screenshot_path = get_hermes_home() / "cache/screenshots/browser_screenshots" / f"browser_screenshot_{uuid.uuid4().hex}.png"

    cmd_args = ["screenshot", "--full", str(screenshot_path)]
    if annotate: cmd_args.insert(1, "--annotate")    # 给元素加 [N] 标号

    _run_browser_command(task_id, *cmd_args)
    with open(screenshot_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode()

    vision_response = call_vision_llm(
        model=_get_vision_model(),    # AUXILIARY_VISION_MODEL
        messages=[{"role": "user", "content": [
            {"type": "text", "text": question},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_data}"}},
        ]}],
        timeout=_get_vision_timeout(),    # default 120s
    )
    return json.dumps({
        "analysis": vision_response,
        "screenshot_path": str(screenshot_path),    # 用户可 MEDIA:<path> 分享（Telegram/Discord 渲染）
    })
```

**核心价值**：accessibility tree 对 canvas / image / 复杂 SVG / 视频画面无能为力，视觉 LLM 是 escape hatch。

**EvoClaw**（`browser-tool.ts:102-110`）—— 只截图，不做视觉分析：

```typescript
case 'screenshot': {
  const url = args['url'] as string | undefined;
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: FETCH_TIMEOUT_MS });
  const buffer = await page.screenshot({ type: 'png' });
  const outputPath = `/tmp/evoclaw-screenshot-${Date.now()}.png`;
  const fs = await import('node:fs');
  fs.writeFileSync(outputPath, buffer);
  return `截图已保存: ${outputPath}`;    // ← 仅返回路径
}
```

EvoClaw 有独立的 `createImageTool`（`packages/core/src/tools/image-tool.ts`，provider-direct vision 调用），但**未与 browser 工具联动**——LLM 需要手动调两步：`browser(action=screenshot)` → `image(path=...)`。

**判定 🔴**：功能上可通过"手动两步"模拟（截图存盘 → image 工具读入），但：
1. 无 `--annotate` 模式（hermes 给元素加 `[1] [2] [3]` 便于视觉 LLM 引用）
2. 无 24h 自动清理（`/tmp/evoclaw-screenshot-*.png` 会无限增长）
3. 无 `MEDIA:<path>` 分享语法（渠道层渲染）
4. 无一体化 timeout 120s vision LLM 调用

补齐成本：合并 `browser + image` 两个工具为 `browser_vision`（~1 人日）+ 自动清理（~0.5 人日）+ annotate mode（需要 Playwright 元素 bounding box 渲染，~2 人日）。

---

### §3.12 URL 前缀 API key 拒绝（防 secret 外泄）

**hermes**（`.research/22-browser-stack.md §3.12 `_prefix_re`）—— navigate 前强制检查：

```python
# tools/browser_tool.py  L1277+
def browser_navigate(url, task_id=None):
    # 1. Secret 泄露防护（最先）
    if _prefix_re.search(url):
        return json.dumps({
            "error": "URL contains what looks like an API key; refusing to navigate"
        })
    # ... 后续 SSRF / 网站策略 / redirect 检查
```

`_prefix_re` 匹配 `sk-*` / `sk-ant-*` / Bearer token / JWT 等常见 secret 前缀（与日志层 `sanitizePII` 逻辑相同）。保护场景：LLM 幻觉或 prompt injection 让 agent 把 `Authorization: Bearer xxx` 或 `?api_key=sk-xxx` 发到恶意网站。

**EvoClaw**（`web-security.ts:47-83 validateWebURL`）—— 只检查用户名/密码，不检 API key：

```typescript
// web-security.ts:66-69
// 凭据检查（防止凭据泄露）
if (parsed.username || parsed.password) {
  return { ok: false, reason: 'URL 不允许包含凭据（用户名/密码）' };
}
```

`browser-tool.ts` 的 navigate 路径（`fetchBasicMode` 走 `validateWebURL`？实际不走——`browser-tool.ts:46-47 `fetchBasicMode` 直接 `fetch(url, ...)` 无 URL 校验，`executeWithPlaywright` 的 `page.goto(url)` 也无前置校验）。

**grep 零结果证据**：
- `grep -rn "_prefix_re\|sk-ant-\|api.*key.*prefix\|navigate.*secret" packages/core/src/tools/browser-tool.ts` → 0 处
- `browser-tool.ts:37-54 execute` 无任何 URL 预检代码，直接 `await import('playwright')` 或 `fetch`

**判定 🔴**：**真实安全漏洞**。场景：用户问"帮我查一下 https://evil.com/leak?token=sk-proj-xxxxx 的内容"（误输入 URL），browser-tool 会直接发 GET 请求把 token 送给 `evil.com`。hermes 会拒绝，EvoClaw 会执行。CLAUDE.md §PII 脱敏提到日志层有 sanitizePII，**不覆盖出站请求**。补齐成本：~2 小时（加一个 `API_KEY_PREFIX_RE` 正则常量 + 在 browser-tool execute 入口和 web-fetch execute 入口各插一行检查）。**P0 级别**。

---

### §3.13 SSRF 私有 IP 拦截 🟢

**hermes**（`.research/22-browser-stack.md §3.12`）—— `is_safe_url()` 云模式必须，本地模式可配置：

```python
# tools/url_safety.py（.research/29-security-approval §3.3-3.4）
def browser_navigate(url, task_id=None):
    # 2. SSRF 检查（云模式必须，本地模式可配置）
    if not _is_local_backend() and not _allow_private_urls():
        if not _is_safe_url(url):
            return json.dumps({"error": "URL points to private/reserved address"})
```

本地 backend（Camoufox / 本地 Chromium）**免 SSRF 检查**，理由："agent 已经通过 terminal 工具有本地网络访问（`curl http://localhost:...`），browser 再检查 SSRF 是多余的"。

**EvoClaw**（`web-security.ts:92-121 isPrivateIP`）—— 始终强制检查，覆盖更全：

```typescript
// web-security.ts:92-121
export function isPrivateIP(hostname: string): boolean {
  // IPv6 回环
  if (hostname === '::1' || hostname === '[::1]') return true;
  // 0.0.0.0
  if (hostname === '0.0.0.0') return true;
  // IPv4
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!ipv4Match) return false;
  const [, a, b] = ipv4Match;
  const first = Number(a); const second = Number(b);
  if (first === 127) return true;        // 127.0.0.0/8 回环
  if (first === 10) return true;         // 10.0.0.0/8 A类私有
  if (first === 172 && second >= 16 && second <= 31) return true;   // 172.16.0.0/12 B类
  if (first === 192 && second === 168) return true;                  // 192.168.0.0/16 C类
  if (first === 169 && second === 254) return true;                  // 169.254.0.0/16 链路本地
  if (first === 0) return true;                                       // 0.0.0.0/8
  return false;
}
```

**判定 🟢**：反超于 hermes 的本地免检策略——EvoClaw 始终检查，更保守更安全。覆盖范围对齐（127/10/172.16-31/192.168/169.254/0.x + IPv6 ::1）。**但**：`browser-tool.ts` **未使用** `validateWebURL`（只有 `web-fetch.ts` 用了），因此 browser 路径实际无 SSRF 防护——需要在 §4 P0 建议中补全 wiring。另外 IPv6 覆盖不足（无 fc00::/7 唯一本地、fe80::/10 链路本地、2001:db8::/32 文档示例）。

---

### §3.14 HTTP → HTTPS 自动升级 🟢

**hermes**（`.research/22-browser-stack.md` / `29-security-approval`）—— **无对应机制**。文档未提及自动升级，仅 redirect 安全检查（禁止 https → http 降级）。

**EvoClaw**（`web-security.ts:129-134 upgradeToHttps`）:

```typescript
// web-security.ts:129-134
export function upgradeToHttps(url: string): string {
  if (url.startsWith('http://')) {
    return 'https://' + url.slice(7);    // 保留路径/查询/哈希/端口
  }
  return url;
}
```

`web-fetch.ts:69` 在 navigate 前强制调用 `const url = upgradeToHttps(rawUrl)`。

**判定 🟢**：**反超**。自动升级避免 MITM 攻击 + 明文 cookie 泄露。但 `browser-tool.ts` 同样未接入（见 §3.12 的 wiring 缺失）。补齐 wiring 工作量 ~5 分钟。

---

### §3.15 跨主机重定向 LLM 回传 🟢

**hermes**（`.research/22-browser-stack.md §3.12 Post-navigate`）—— 重定向到不安全 URL 导航到 `about:blank`：

```python
# Post-navigate: redirect 检查
if result["success"]:
    actual_url = result.get("final_url", url)
    if actual_url != url and not _is_safe_url(actual_url):
        _run_browser_command(task_id, "navigate", "about:blank")
        return json.dumps({"error": f"Redirected to unsafe URL: {actual_url}"})
```

但对**同主机 redirect** 自动跟随（无跨主机区分），**不给 LLM 决策权**。

**EvoClaw**（`web-security.ts:141-164 isPermittedRedirect` + `173-230 fetchWithSafeRedirects`）—— 三层决策：

```typescript
// web-security.ts:141-164
export function isPermittedRedirect(originalUrl, redirectUrl): boolean {
  // 1. 禁止协议降级（https → http）
  if (original.protocol === 'https:' && redirect.protocol === 'http:') return false;
  // 2. 端口必须相同
  if (original.port !== redirect.port) return false;
  // 3. 主机名匹配（允许 www. 前缀差异）
  const stripWww = (h: string) => h.replace(/^www\./, '');
  return stripWww(original.hostname) === stripWww(redirect.hostname);
}

// web-security.ts:217-226 —— 跨主机重定向返回给 LLM
return {
  redirect: {
    type: 'cross_host_redirect',
    originalUrl: currentUrl,
    redirectUrl,
    message: `页面重定向到不同域名 ${redirectUrl}，需要你决定是否继续访问。`,
  },
};
```

**判定 🟢**：**反超**——给 LLM 自主决策权而不是硬拦截。更灵活（用户可能确实想跟随重定向），且对重定向目标也跑 `isPrivateIP` 检查（L205-209）。同样 wiring 问题：browser-tool 未用，只有 web-fetch 用了。

---

### §3.16 网站策略黑名单（website_policy）

**hermes**（`.research/22-browser-stack.md §3.12 + .research/29-security §3.4`）—— `tools/website_policy.py` 黑名单域名拒绝：

```python
# browser_navigate L1148-1177
policy_result = check_website_access(url)
if policy_result:
    return json.dumps({
        "error": f"Blocked by website policy: {policy_result['message']}",
        "rule": policy_result.get("rule"),
        "source": policy_result.get("source"),
    })
```

配置驱动（`config["browser"]["website_policy"]`），支持企业 IT 管理员 `managed.json` 强制锁定黑名单。

**EvoClaw**（`packages/core/src/tools/preapproved-domains.ts`）—— 语义相反的**白名单**（用于免权限自动放行）：

`grep preapproved` 结果显示 `preapproved-domains.ts` 用于 `permission-interceptor.ts:5`，决定**哪些域名不用问用户就放行** —— 反向语义。**无对应黑名单机制**。

**grep 零结果证据**：
- `grep -rn "check_website_access\|websitePolicy\|domain.*blocklist\|domain.*denylist" packages/core/src` → 0 处
- `NameSecurityPolicy`（CLAUDE.md §扩展安全策略）覆盖 Skills + MCP Servers 名字，**不覆盖域名**

**判定 🔴**：企业用户场景的高价值需求——IT 管理员希望限制员工用 AI agent 访问哪些网站（如禁止 ChatGPT 公共端点、内部财务系统）。补齐成本：复用 `NameSecurityPolicy` 模式扩展为 `DomainSecurityPolicy`（~1 人日）+ managed.json 配置路径（~0.5 人日）+ browser-tool / web-fetch 双侧接入（~0.5 人日）。**P1 级别**。

---

### §3.17 Snapshot 两层 redaction（pre/post LLM）

**hermes**（`.research/22-browser-stack.md §3.10`）—— `_extract_relevant_content` 中双向脱敏：

```python
def _extract_relevant_content(snapshot, user_task):
    snapshot = redact_sensitive_text(snapshot)    # Pre: 防 secret 发给辅助 LLM 服务商
    prompt = f"""...Snapshot: {snapshot}..."""
    extracted = call_llm(...)
    extracted = redact_sensitive_text(extracted)    # Post: 防 LLM echo 回 secret
    return extracted
```

适用于两种攻击面：
1. **Pre**：snapshot 里的 secret（admin panel DOM 含 API key）发给辅助 LLM 服务商（如 gemini-3-flash），服务商日志可能保留
2. **Post**：LLM 记忆训练数据 + 幻觉可能 echo 回 secret

**EvoClaw**（`browser-tool.ts:99, 130`）—— 无任何脱敏：

```typescript
// browser-tool.ts:99  navigate
return `页面: ${title}\n内容: ${(bodyText ?? '').slice(0, 10_000)}`;    // 原样返回

// browser-tool.ts:130  extract
return (text ?? '').slice(0, 10_000);    // 原样返回
```

CLAUDE.md §PII 脱敏提到日志层有 `sanitizePII()` 自动脱敏 API key / Bearer / JWT / 邮箱 / 手机号 / 密码字段——**但只在日志写入时触发，不影响返回给 LLM 的 tool_result**。

**判定 🔴**：补齐成本低但价值高——复用日志层的 `sanitizePII`，在 browser-tool 返回前调用一次（~30 分钟）。**P0 建议之一**。

---

### §3.18 Bot 检测警告（title 关键词）

**hermes**（`.research/22-browser-stack.md §3.13 L1221-1237`）:

```python
title = snapshot_result.get("title", "").lower()
if any(signal in title for signal in ["blocked", "captcha", "cloudflare", "bot"]):
    return json.dumps({
        "warning": "bot_detection_warning",
        "suggestion": "Add delays, try different page, or enable advanced stealth",
        "snapshot": ...,
    })
```

让 LLM 知道"页面可能被反爬了"，自动建议启用 Camoufox / Browserbase advanced stealth。

**EvoClaw** —— 完全没有：

**grep 零结果证据**：
- `grep -rni "captcha\|cloudflare\|bot.detect\|challenge.page" packages/core/src/tools` → 0 处

**判定 🔴**：与 §3.5 Camoufox 类似，反爬场景不是 EvoClaw 目标用户核心需求。**不建议补齐**。

---

### §3.19 多 tab / managed_persistence

**hermes**（`.research/22-browser-stack.md §3.7 browser_camofox_state.py`）—— UUID 派生 + managed_persistence：

```python
user_id = uuid.uuid5(NAMESPACE_URL, f"camofox-user:{scope_root}")
session_key = uuid.uuid5(NAMESPACE_URL, f"camofox-session:{scope_root}:{task_id}")

def camofox_soft_cleanup(session_key, managed_persistence):
    if managed_persistence:
        _release_tracking(session_key)    # 只释放 hermes 内存追踪
        # Camoufox server 保留 profile → 下次相同 session_key 时恢复
    else:
        _close_tab(session_key)    # 完全关闭
```

相同 `scope_root`（项目根目录）的不同 task 复用 profile（login state / cookies 保留）；不同 task 独立 session_key（隔离 tab）。

**EvoClaw**（`browser-tool.ts:89`）—— 单 page 抽象，每次 close 不保留 profile：

```typescript
const browser = await pw.chromium.launch({ headless: true });
const page = await browser.newPage();    // ← 每次新 page，无 storageState 持久化
// ...
await browser.close();    // ← 完全丢失
```

**判定 🔴**：multi-tab 场景（比较两个页面 / A/B 测试）无法支持；登录态持久化需要每次重新登录。补齐成本（仅本地 Playwright）：引入 `browser.storageState({ path: ... })` 保存 + `launchPersistentContext({ userDataDir: ... })` 加载（~1 人日）。**P2 级别**。

---

### §3.20 测试覆盖

**hermes**（`.research/22-browser-stack.md §6 复刻清单`）—— 10+ 个测试文件：

```
tests/tools/test_browser_camofox.py            # Camofox REST
tests/tools/test_browser_camofox_persistence.py # Managed persistence
tests/tools/test_browser_camofox_state.py      # State identity
tests/tools/test_browser_cdp_override.py       # CDP URL override
tests/tools/test_browser_cleanup.py            # 清理逻辑
tests/tools/test_browser_console.py            # JS 执行
tests/tools/test_browser_content_none_guard.py # None 守护
tests/tools/test_browser_homebrew_paths.py     # macOS PATH
tests/tools/test_browser_secret_exfil.py       # URL API key 阻止
tests/tools/test_browser_ssrf_local.py         # Local backend 免检
```

**EvoClaw** —— 0 个 browser-tool 测试文件：

**grep 零结果证据**：
- `grep -rn "browser-tool\|createBrowserTool" packages/core/src/__tests__` → 0 处（Grep 命中 0）
- 相关测试：`web-fetch.test.ts` / `web-search.test.ts` / `security/web-security.test.ts` 3 个文件，全部走 **non-browser 路径**

**判定 🔴**：测试覆盖率 0%。补齐工作量：核心 6 action 各一个单测（~1 人日）+ `validateWebURL` / `isPrivateIP` 已覆盖（无需补）。

---

## 4. 建议改造蓝图（不承诺实施）

**前提**：EvoClaw 产品定位是桌面 AI 伴侣（非 SWE agent），多数 hermes 浏览器特性与 EvoClaw 用户场景不匹配。因此改造建议聚焦**安全加固 + 基础可用性**，不推荐完整复刻 hermes 10 工具栈。

### P0 — 安全加固（**建议立即做**，总工作量 ~1 人周）

| # | 任务 | 参照 | 工作量 | ROI |
|---|---|---|---|---|
| P0.1 | `browser-tool.ts` execute 入口接入 `validateWebURL` + `upgradeToHttps` + `fetchWithSafeRedirects` 三件套 | §3.13-3.15 | 0.5 人日 | **极高**，现有 `web-security.ts` 现成可复用；wiring 问题修好三项 🟢 反超真实生效 |
| P0.2 | 新增 `URL_API_KEY_PREFIX_RE` 正则，navigate 前拒绝 `sk-*` / `sk-ant-*` / `Bearer ` token / JWT URL | §3.12 | 0.5 人日 | **极高**，堵住 secret 外泄漏洞，可复用日志层 `sanitizePII` 现有模式 |
| P0.3 | 返回内容接入 `sanitizePII`（snapshot/extract/navigate 返回前调用） | §3.17 | 0.5 人日 | **高**，和 P0.2 配套完整两层防护（入站 + 出站） |
| P0.4 | 加 5 个核心单测：URL 安全 / SSRF 重定向 / 凭据拒绝 / API key 前缀 / HTTPS 升级 | §3.20 | 1.5 人日 | **高**，当前 0% 覆盖→核心路径 80% |
| P0.5 | Playwright 可选依赖提示优化：`pnpm add -D playwright` 后增加 `postinstall` 检查，清晰引导用户 | `browser-tool.ts:50` | 0.5 人日 | **中**，UX 改进 |

### P1 — 功能补齐（可选，按用户反馈优先级）

| # | 任务 | 参照 | 工作量 | ROI |
|---|---|---|---|---|
| P1.1 | Session 复用：按 session_key 缓存 browser + page，多 action 复用（串联登录→填表场景） | §3.7, §3.8 | 3 人日 | **高**，解决"每 action 启停导致无法多步交互"的致命功能缺陷 |
| P1.2 | 拆分 10 个 ToolDefinition：独立 `scroll / back / press / get_images` 4 项（简单 Playwright API 调用） | §3.1 | 2 人日 | **中**，LLM discovery 体验改进 |
| P1.3 | `browser_vision`：合并 browser + image-tool 的一体化视觉分析工具 | §3.11 | 2 人日 | **中**，canvas/image 内容识别能力 |
| P1.4 | 域名黑名单 policy：扩展 `NameSecurityPolicy` 到 `DomainSecurityPolicy`，支持 managed.json 企业锁定 | §3.16 | 2 人日 | **中**，企业 IT 管控价值 |
| P1.5 | 后台 cleanup：session idle > 5 分钟自动 close（与 P1.1 配套） | §3.8 | 1 人日 | **中**，内存泄漏预防 |

### P2 — 按需接入（**不建议主动做**，用户明确要求再评估）

| # | 任务 | 参照 | 工作量 | ROI |
|---|---|---|---|---|
| P2.1 | Provider 抽象层 + Browserbase/Browser Use/Firecrawl 云接入 | §3.3, §3.4 | 2 人周 | **低**，企业内网用户极少需要云浏览器 |
| P2.2 | Camoufox 反检测栈 | §3.5 | 1 人周 | **低**，反爬场景非核心 |
| P2.3 | `agent-browser` CLI + `@ref` accessibility tree | §3.2, §3.6 | 3 人周 | **低**，DOM selector → ref ID 迁移成本高 |
| P2.4 | CDP override `BROWSER_CDP_URL` + 手动连接 | §3.9 | 0.5 人日 | **低**，开发者功能非企业用户 |
| P2.5 | managed_persistence UUID 派生 + profile 复用 | §3.19 | 1 人日 | **低**，跨 session 登录态持久化 |

### 不建议做

- **§3.11 的 `--annotate` 图像标注 mode**（hermes 用 agent-browser 的 CDP 协议实现，移植成本高但边际收益低）
- **§3.18 bot 检测警告**（与 Camoufox 反爬栈强绑定）
- **`browser_console` 工具 JS 执行能力**（EvoClaw 已有 `evaluate` action 覆盖 70% 场景）

### 替代方案：MCP 桥接

真正需要完整浏览器能力的企业用户，建议通过 **MCP 桥接**接入官方 `@playwright/mcp` 或第三方 Camoufox MCP 服务器（CLAUDE.md §MCP 客户端，21-mcp-gap.md），零代码成本 Day-1 可用，且 EvoClaw 的 `NameSecurityPolicy` + 企业扩展包（`evoclaw-pack.json`）可统一管理。这是相比"自建浏览器栈"**ROI 最高**的路径。

---

## 5. EvoClaw 反超点汇总

| # | 反超能力 | EvoClaw 代码证据 | hermes 对应缺失 | 价值 |
|---|---|---|---|---|
| §3.13 | SSRF 私有 IP 检测覆盖 IPv6 `::1` + IPv4 全私有段 | `packages/core/src/security/web-security.ts:92-121 isPrivateIP` | hermes 本地 backend **免 SSRF 检查**（`_is_local_backend` 返回 True 跳过），EvoClaw 始终检查 | 更保守的默认策略；IPv6 回环也覆盖 |
| §3.14 | HTTP → HTTPS 自动升级 | `packages/core/src/security/web-security.ts:129-134 upgradeToHttps` | hermes 浏览器栈**无此机制**（仅 redirect 禁止协议降级） | 避免明文 cookie + MITM |
| §3.15 | 跨主机重定向 LLM 回传（决策权交给模型而非硬拦截） | `packages/core/src/security/web-security.ts:173-230 fetchWithSafeRedirects` + `141-164 isPermittedRedirect` | hermes 同主机自动跟随，跨主机 unsafe 直接 `navigate about:blank`（无 LLM 参与） | 更灵活，LLM 可理解上下文判断是否继续；重定向目标也做 SSRF 检查 |

**重要补充**：3 项反超**仅在 web-fetch 路径生效**（`web-fetch.ts:64-89`），**browser-tool.ts 未接入**。P0.1 改造后才能让反超真实生效于浏览器路径。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（经 Read 工具验证）

| 引用 | 内容 |
|---|---|
| `packages/core/src/tools/browser-tool.ts:1-56` | `createBrowserTool` 工具定义 + 6 action 枚举 + fetch/Playwright 双路径降级 |
| `packages/core/src/tools/browser-tool.ts:59-80` | `fetchBasicMode` 基础 HTTP 模式 + 正则剥 HTML + 10000 字符截断 |
| `packages/core/src/tools/browser-tool.ts:83-146` | `executeWithPlaywright` Playwright 模式 + 每 action 启停 browser + 6 case 分发 |
| `packages/core/src/security/web-security.ts:47-83` | `validateWebURL` URL 校验（长度/协议/格式/凭据/内部域名/私有 IP） |
| `packages/core/src/security/web-security.ts:92-121` | `isPrivateIP` IPv4/IPv6 私有段检测（覆盖 127/10/172.16-31/192.168/169.254/0.x + ::1） |
| `packages/core/src/security/web-security.ts:129-134` | `upgradeToHttps` HTTP→HTTPS 自动升级 |
| `packages/core/src/security/web-security.ts:141-164` | `isPermittedRedirect` 跨主机/协议降级/端口判断 |
| `packages/core/src/security/web-security.ts:173-230` | `fetchWithSafeRedirects` 最多 10 跳安全重定向 + 跨主机 LLM 回传 |
| `packages/core/src/tools/web-fetch.ts:1-165` | `createWebFetchTool` URL→Markdown + 二级模型摘要（LLM 任务提取） |
| `packages/core/src/tools/web-fetch.ts:138-148` | `applyPromptToContent` LLM 摘要调用（task-aware 提取，浏览器栈可复用） |
| `packages/core/src/tools/web-search.ts:8-87` | `createWebSearchTool` Brave Search API |
| `packages/core/src/routes/chat.ts:736` | 主渠道注册 `enhancedTools.push(createBrowserTool())` |
| `packages/core/src/routes/channel-message-handler.ts:412` | Channel 渠道注册 `enhancedTools.push(createBrowserTool())` |
| `packages/core/src/tools/permission-interceptor.ts:110` | browser 权限分类映射 `browse: 'browser'` |
| `packages/core/src/skill/bundled/playwright/SKILL.md:1-191` | Playwright bundled skill（指令型，与 browser-tool.ts 并行）|
| `packages/core/src/skill/bundled/agent-browser-clawdbot/SKILL.md:1-30` | agent-browser 指令 skill（无代码调用，仅文档） |

### 6.2 EvoClaw grep 零结果证据

| grep 命令 | 结果 | 证明 |
|---|---|---|
| `grep -rni "camoufox\|camofox" packages/core/src` | 0 命中 | §3.5 Camoufox 反检测栈完全缺失 |
| `grep -rni "browserbase" packages/core/src` | 2 命中（均在 SKILL.md 文档） | §3.4 Browserbase 云 provider 完全缺失 |
| `grep -rni "firecrawl" packages/core/src` | 0 命中 | §3.4 Firecrawl 云 provider 完全缺失 |
| `grep -rni "browser-use" packages/core/src` | 0 命中 | §3.4 Browser Use 云 provider 完全缺失 |
| `grep -rn "CloudBrowserProvider\|BrowserProvider" packages/core/src` | 0 命中 | §3.3 Provider 抽象层完全缺失 |
| `grep -rn "check_website_access\|websitePolicy\|_active_sessions" packages/core/src` | 0 命中 | §3.7 session 注册表 + §3.16 网站黑名单完全缺失 |
| `grep -rn "_prefix_re\|api.*key.*url\|Bearer.*navigate" packages/core/src/tools/browser-tool.ts` | 0 命中 | §3.12 URL API key 前缀拒绝完全缺失 |
| `grep -rn "BROWSER_CDP_URL\|chromium.connectOverCDP" packages/core/src` | 0 命中 | §3.9 CDP override 完全缺失 |
| `grep -rn "browser-tool\|createBrowserTool" packages/core/src/__tests__` | 0 命中 | §3.20 无 browser-tool 专项测试 |
| `grep -rn "@ref\|@e1\|accessibility.tree" packages/core/src` | 3 命中（全部在 SKILL.md 文档，0 个 .ts 文件） | §3.2 accessibility tree ref ID 系统完全缺失 |

### 6.3 hermes 研究引用

- `.research/22-browser-stack.md §1` — 10 工具 + 5 执行路径分层架构
- `.research/22-browser-stack.md §2` — 数据结构全景图 mermaid
- `.research/22-browser-stack.md §3.1` — 10 个工具清单表 + 设计原则
- `.research/22-browser-stack.md §3.2` — 核心常量 / 环境变量 / registry
- `.research/22-browser-stack.md §3.3` — `CloudBrowserProvider` ABC
- `.research/22-browser-stack.md §3.4-3.6` — Browserbase / Browser Use / Firecrawl 三个 provider
- `.research/22-browser-stack.md §3.7` — Camoufox 反检测 + managed_persistence
- `.research/22-browser-stack.md §3.8` — `agent-browser` CLI + `_run_browser_command`
- `.research/22-browser-stack.md §3.9` — session 注册表 + cleanup 线程
- `.research/22-browser-stack.md §3.10` — snapshot 智能截断 + task-aware 提取
- `.research/22-browser-stack.md §3.11` — `browser_vision` 截图 + 视觉 LLM
- `.research/22-browser-stack.md §3.12` — 5 层安全检查（URL API key / SSRF / 策略 / redirect / redaction）
- `.research/22-browser-stack.md §3.13` — 错误处理（失败 / 元素不存在 / 超时 / bot detection）
- `.research/22-browser-stack.md §6` — 完整复刻清单
- `.research/22-browser-stack.md Addendum` — 基线 `b87d0028 → 00ff9a26` drift 审计（+175 净行 / 5 新特性）
- `.research/29-security-approval.md §3.3-3.4` — `url_safety.is_safe_url` + `website_policy.check_website_access`
- `.research/29-security-approval.md §3.6` — `agent/redact.py` 两层脱敏

### 6.4 关联差距章节（crosslink）

- [`09-tools-system-gap.md`](./09-tools-system-gap.md) — browser-tool 作为 EvoClaw 19+ 工具之一注册；工具 discovery 体验差异
- [`10-toolsets-gap.md`](./10-toolsets-gap.md) — hermes 10 个 browser 工具通过 toolset 组合注入，EvoClaw 无对应 toolset 分组机制
- [`11-environments-spawn-gap.md`](./11-environments-spawn-gap.md) — hermes `BaseEnvironment` 9 后端 vs EvoClaw 本地 Bun/Node 单后端，browser 作为子进程（Playwright）执行涉及进程管理
- [`21-mcp-gap.md`](./21-mcp-gap.md) — **重要替代方案**：通过 MCP 桥接 `@playwright/mcp` 获得完整浏览器能力（ROI 远高于自建），EvoClaw `NameSecurityPolicy` + 企业扩展包统一管理

---

**本差距分析结论**：🔴 整体缺失（20 项机制 17 🔴 / 3 🟢），但**绝大多数缺失与 EvoClaw 产品定位（桌面 AI 伴侣、非 SWE agent）匹配**。真正需要立即修复的是 P0 的 5 项安全加固（~1 人周），其余 P1/P2 建议按用户反馈决定。**3 项 🟢 反超**集中在 `web-security.ts` SSRF 防护层，但因 wiring 未接入 browser-tool 而未真实生效 —— P0.1 改造是让反超真实落地的关键。
