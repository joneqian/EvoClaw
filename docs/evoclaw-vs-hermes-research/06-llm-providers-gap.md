# 06 — LLM Provider 路由 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/06-llm-providers.md`（~600 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`agent/smart_model_routing.py` + `models_dev.py` + `credential_pool.py` + `auxiliary_client.py` + `hermes_cli/providers.py` / `auth.py`
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`packages/core/src/provider/{model-fetcher,extensions}.ts` + `agent/llm-client.ts` + `routes/provider.ts` + `agent/kernel/stream-client.ts`
> **综合判定**: 🟡 **provider 抽象方向相似但深度悬殊**，hermes 有完整的**四策略 Credential Pool + 三 provider OAuth + models.dev 4000 模型目录 + 智能路由 + fallback 链**，EvoClaw 有**双协议抽象 + 国产模型统一接入 + 二级模型 fallback 映射**但缺 Credential Pool / OAuth / 智能路由

**档位图例**:
- 🔴 EvoClaw 明显落后
- 🟡 部分覆盖 / 形态差异
- 🟢 EvoClaw 对齐或反超

---

## 1. 定位

**hermes Provider 系统**（`.research/06-llm-providers.md §1`）回答 6 个问题:

1. Provider 身份 — `hermes_cli/providers.py` `HermesOverlay` + `ProviderDef`（冻结 dataclass）
2. 模型目录 — `agent/models_dev.py` 从 models.dev 拿 4000+ 模型元数据（context_window 等）
3. 凭据管理 — `agent/credential_pool.py` 四策略 + OAuth 刷新 + lease
4. API 请求构造 — `run_agent.py:_build_api_kwargs` 构造 provider-specific payload
5. 智能路由 — `agent/smart_model_routing.py` 在"便宜模型"和"主模型"之间切换
6. 失败转移 — `_try_activate_fallback` + `_restore_primary_runtime` + `_try_recover_primary_transport`

覆盖 9+ provider:
- 聚合器：OpenRouter / Nous Portal
- 原生：OpenAI / Anthropic / Gemini / Grok / Kimi / MiniMax / z.ai / Codex OAuth
- 社区：HuggingFace / Groq / DeepSeek / Mistral / 等

**EvoClaw Provider 系统**:
- 双协议抽象（`api: 'anthropic-messages' | 'openai-completions'`）
- 国产模型统一走 `openai-completions + 自定义 baseUrl`（Qwen / GLM / Doubao / Kimi / DeepSeek / MiniMax 等）
- 动态模型列表拉取（`packages/core/src/provider/model-fetcher.ts fetchModelsFromApi`）
- 二级模型 SECONDARY_MODEL_FALLBACK 映射（`llm-client.ts:19-32`）——同 Provider 最便宜模型用于摘要/提取

**关键范式差异**:

| 维度 | hermes | EvoClaw |
|---|---|---|
| Provider 声明 | 集中式 `ProviderDef` dataclass 清单 + 别名映射 | 运行时 `registerProvider(id, config)` + 扩展机制 |
| Transport 类型 | 3 种（`openai_chat` / `anthropic_messages` / `codex_responses`） | 2 种（`anthropic-messages` / `openai-completions`） |
| 模型元数据源 | models.dev（~4000 模型）+ 3 层缓存（内存/磁盘/网络）+ 5 级 context probe | Provider API 动态拉取（`/v1/models`）+ 硬编码 fallback |
| 凭据池 | 完整实现（四策略 + OAuth 刷新 + 并发 lease + ASCII 清理） | 无 |
| OAuth | Anthropic/Codex/Nous 三 provider 完整 device code flow | 无 |
| 智能路由 | `smart_model_routing.py` 便宜 vs 主模型自动切 | `ModelRouter`（Agent 偏好 → 系统默认 → 硬编码 gpt-4o-mini） |
| 辅助 LLM | `auxiliary_client.py` 带 fallback 链 | `callLLMSecondary` + SECONDARY_MODEL_FALLBACK 映射 |
| API 请求构造 | `_build_api_kwargs`（可能跨 500+ 行 provider-specific 分支） | `buildAnthropicRequest` + `buildOpenAIRequest`（stream-client.ts） |

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Provider 身份声明 | 🟡 | hermes 集中 dataclass 清单 + 别名 vs EvoClaw 运行时 registerProvider 扩展 |
| §3.2 | Transport 类型 | 🟡 | 3 种（含 Codex Responses）vs 2 种（双协议），EvoClaw 不支持 Codex Responses |
| §3.3 | 模型目录来源 | 🟡 | models.dev 4000 模型 + 3 层缓存 vs API `/v1/models` 动态拉取 + 硬编码 fallback |
| §3.4 | Context length lookup | 🔴 | hermes 4 层降级（config/models.dev/DEFAULT 表/128K fallback）+ 5 级 probe，EvoClaw 依赖 Provider 配置 |
| §3.5 | URL → Provider 推断 | 🔴 | hermes `_URL_TO_PROVIDER` 10+ hostname 映射 vs EvoClaw 需用户手动填 provider |
| §3.6 | Credential Pool | 🔴 | hermes 四策略 + OAuth 刷新 + 并发 lease（见 05 §3.7）vs EvoClaw 无 |
| §3.7 | OAuth device code flow | 🔴 | hermes Anthropic/Codex/Nous 三 provider 完整 vs EvoClaw 无 |
| §3.8 | API 请求构造 | 🟢 | **反超**: EvoClaw stream-client.ts 双协议分支清晰 vs hermes `_build_api_kwargs` 500+ 行单巨函数 |
| §3.9 | Fallback 机制 | 🟡 | hermes `_try_activate_fallback + _restore_primary_runtime` 单轮作用域恢复 vs EvoClaw 一次性 fallbackActivated |
| §3.10 | 智能路由（便宜 vs 主） | 🟡 | hermes `smart_model_routing.py` 自动判断 vs EvoClaw ModelRouter 四层（Agent/用户/系统/硬编码） |
| §3.11 | 辅助 LLM（摘要/提取） | 🟢 | EvoClaw SECONDARY_MODEL_FALLBACK 8 国产模型映射，覆盖度更广 |
| §3.12 | 国产模型接入 | 🟢 | **反超**: EvoClaw `openai-completions + 自定义 baseUrl` 统一入口，hermes 需 [alibaba][zai][minimax] 等分散 extras |
| §3.13 | GLM JWT 认证 | 🟢 | **反超**: EvoClaw `buildAuthHeaders()` 专门处理 `from id.secret` JWT，hermes 无原生支持 |
| §3.14 | 非 ASCII key 清理 | 🔴 | hermes 强制清理防崩溃 vs EvoClaw 无（见 05 §3.5） |

**统计**: 🔴 6 / 🟡 4 / 🟢 4（其中 3 项反超）。

---

## 3. 机制逐条深度对比

### §3.1 Provider 身份声明

**hermes** （`.research/06-llm-providers.md §3.1` + `hermes_cli/providers.py:32-154`）:

```python
@dataclass(frozen=True)
class HermesOverlay:
    transport: str              # openai_chat | anthropic_messages | codex_responses
    is_aggregator: bool
    auth_type: str               # api_key | oauth_device_code | oauth_external | external_process
    extra_env_vars: Tuple[str, ...]
    base_url_override: str
    base_url_env_var: str

@dataclass
class ProviderDef:
    id: str
    name: str
    transport: str
    api_key_env_vars: Tuple[str, ...]
    base_url: str = ""
    base_url_env_var: str = ""
    is_aggregator: bool = False
    auth_type: str = "api_key"

# 别名
ALIASES = {
    "openai": "openrouter",
    "glm": "zai",
    "kimi": "kimi-for-coding",
    "minimax-china": "minimax-cn",
    # ...
}
```

- **一等公民 dataclass** + 别名映射
- 加新 provider = 加一行 `ProviderDef`
- 24+ 内置 provider（openrouter / nous-portal / openai / anthropic / gemini / grok / kimi / minimax / zai / codex / alibaba / ...）

**EvoClaw** （`packages/core/src/routes/provider.ts:146-182` + `packages/core/src/provider/extensions/`）:

- **运行时 `registerProvider(id, config)`** —— Provider 通过 HTTP API 动态注册（CRUD 存 SQLite）
- 用户在 GUI 上添加 provider，保存到 `evoclaw.db` 的 `model_configs` 表
- 无硬编码 provider 清单（只有**二级模型 fallback** 映射硬编码在 `llm-client.ts:19-32`）
- 无"别名"机制（每个 provider id 是独立的）

**判定 🟡**：两种风格各有优劣：
- hermes 静态清单 —— 文档清晰，所有 provider 一目了然
- EvoClaw 动态注册 —— 对企业用户自助添加私有 LLM endpoint 友好（无需修改源码）

---

### §3.2 Transport 类型

**hermes** （`.research/06-llm-providers.md §3.1` L44-130）:

- **`openai_chat`** — OpenAI 兼容 Chat Completions API（OpenRouter / Z.AI / Kimi / DeepSeek / Alibaba / Gemini / Ollama / 本地）
- **`anthropic_messages`** — Anthropic 原生 Messages API（Anthropic / MiniMax Anthropic-compat / Moonshot 等）
- **`codex_responses`** — OpenAI Codex Responses API（GitHub Copilot / ChatGPT Codex）

**EvoClaw** （`packages/core/src/agent/kernel/types.ts:360`）:

```typescript
export type ApiProtocol = 'anthropic-messages' | 'openai-completions';
```

- **双协议**，对应 hermes 前两种
- **无 Codex Responses 支持**

**判定 🟡**：EvoClaw 缺 Codex Responses 协议意味着**不能直接用 GitHub Copilot / ChatGPT Codex 作为 LLM provider**。但这些 provider 对**国内企业用户市场无价值**（面向 Copilot/Codex 订阅用户），此差距属于**战略合理缺失**。

---

### §3.3 模型目录来源

**hermes** （`.research/06-llm-providers.md §3.2` + `agent/models_dev.py:49-300`）:

```python
@dataclass
class ModelInfo:
    id: str
    name: str
    family: str
    provider_id: str
    context_window: int
    cost_input: float
    cost_output: float
    reasoning: bool
    tool_call: bool
    attachment: bool
    temperature: bool
    structured_output: bool
    input_modalities: Tuple[str, ...]
    output_modalities: Tuple[str, ...]
```

- 从 **https://models.dev/api.json** 拉 4000+ 模型元数据
- 三层缓存：内存（TTL 3600s）→ 磁盘 `~/.hermes/models_dev_cache.json` → 网络
- `PROVIDER_TO_MODELS_DEV` 别名映射（hermes internal name → models.dev key）
- `fetch_models_dev(force_refresh)` 失败时 5 分钟重试窗口

**EvoClaw** （`packages/core/src/provider/model-fetcher.ts:1-80+`）:

```typescript
export async function fetchModelsFromApi(
  baseUrl: string,
  apiKey: string,
  providerId: string,
  timeoutMs = 10_000,
): Promise<FetchModelsResult> {
  // 拉取 baseUrl/v1/models
  // 转换为 ModelConfig 格式
  // 与硬编码 fallback 合并
}
```

- 直接调 Provider 的 `/v1/models` 端点（OpenAI 兼容规范）
- 每个 Provider 独立拉取 + 本地缓存
- **无跨 Provider 的统一目录**（如 models.dev）

**判定 🟡**：两种路线取向不同:
- hermes 集中目录 —— 单一数据源，方便对比成本/能力
- EvoClaw 分散拉取 —— 每 Provider 权威，无第三方依赖

对**成本敏感的企业用户**，hermes 的集中目录更友好；对**私有化部署或保密需求**，EvoClaw 的分散拉取更适合。

---

### §3.4 Context length lookup

**hermes** （`.research/06-llm-providers.md §3.3` + `agent/model_metadata.py:75-218`）:

**4 层降级 lookup**:

1. **用户 config override** — `cli-config.yaml` 的 `context_length_override`
2. **models.dev 查询** — `lookup_models_dev_context(provider, model)`
3. **`DEFAULT_CONTEXT_LENGTHS` 硬编码表** — 约 50 个主流模型
   ```python
   DEFAULT_CONTEXT_LENGTHS = {
       "claude-opus-4-6": 1_000_000,
       "claude-sonnet-4-6": 1_000_000,
       "gemini": 1_048_576,
       "deepseek": 128_000,
       "llama": 131_072,
       # ...
   }
   ```
4. **最后 fallback** — `DEFAULT_FALLBACK_CONTEXT = 128_000`

**5 级 probe tiers**（当全都查不到时逐级试）:
```python
CONTEXT_PROBE_TIERS = [128_000, 64_000, 32_000, 16_000, 8_000]
```

**EvoClaw**（`packages/core/src/provider/model-fetcher.ts:12-26`）:

- 从 Provider API 返回的模型元数据取 `max_context_length` / `context_window` 字段
- 部分 Provider 支持这些字段，部分不支持
- **无降级表 + 无 probe**

**判定 🔴**：EvoClaw context length 管理**依赖 Provider API 返回的字段**，但:
- 国产模型（Qwen / GLM / Doubao）的 `/v1/models` 响应**通常不返回** context_window
- 用户需要在 UI 上**手动配置**每个模型的 context length，否则默认值可能不准
- 无 probe 机制兜底

**建议**：引入类似 hermes 的 `DEFAULT_CONTEXT_LENGTHS` 硬编码表 + 5 级 probe，特别为国产模型补齐 context 长度（0.5d 实现）。

---

### §3.5 URL → Provider 推断

**hermes** （`agent/model_metadata.py:182-218`）:

```python
_URL_TO_PROVIDER = {
    "api.openai.com": "openai",
    "api.anthropic.com": "anthropic",
    "dashscope.aliyuncs.com": "alibaba",
    "api.deepseek.com": "deepseek",
    # ... 10+ 映射
}
def _infer_provider_from_url(base_url: str) -> Optional[str]: ...
```

用户只填 baseURL 时自动从 hostname 推断 provider 类型。

**EvoClaw** —— 无此机制。`registerProvider(id, config)` 要求用户显式提供 provider id（和 `api: 'anthropic-messages' | 'openai-completions'`）。

**判定 🔴**：EvoClaw 缺 URL→Provider 推断，用户添加 Provider 时**手动选择协议类型**。对非技术企业用户不够友好。**建议**：添加 hostname → protocol 推断（0.5d）。

---

### §3.6 Credential Pool

见 [`05-agent-loop-gap.md §3.7`](./05-agent-loop-gap.md) 深度讨论，本节补充细节。

**hermes 四策略**:

| 策略 | 适合场景 |
|---|---|
| `FILL_FIRST` | 主 key + 备用 key |
| `ROUND_ROBIN` | 多 key 均摊 |
| `RANDOM` | 防缓存踩踏 |
| `LEAST_USED` | 基于 request_count 负载均衡 |

**OAuth 刷新**（`.research/06-llm-providers.md §3.4 L482-615`）:
- Anthropic: `refresh_anthropic_oauth_pure(refresh_token)`
- Anthropic 只有 `source == "claude_code"` 才写回 `~/.claude/.credentials.json`（与 Claude Code 共享）
- OpenAI Codex: `refresh_codex_oauth_pure`
- Nous: `refresh_nous_oauth_from_state`（含 agent_key mint/续期）

**刷新时机**（`_entry_needs_refresh` L617-635）:
- Anthropic 离到期 2 分钟内刷新（`expires_at_ms <= now + 120_000`）
- OpenAI Codex 基于 token 解码判断

**并发 lease**（L768-807）:
- `acquire_lease(id)` → 选 `_active_leases` 最低的 credential
- `release_lease(id)` → 减计数
- 超过 `_max_concurrent` 时切换另一个 key

**EvoClaw** —— 完全无此能力。

**判定 🔴**：P0 优先级，~3-4d 实现。详见 [`05-agent-loop-gap.md §3.7`](./05-agent-loop-gap.md) 和 [`04-core-abstractions-gap.md §3.12`](./04-core-abstractions-gap.md)。

---

### §3.7 OAuth device code flow

**hermes** （`hermes_cli/auth.py`）:

三 provider 完整 OAuth 设备码流:
1. **Anthropic**（Claude OAuth）—— device code + refresh token + 与 Claude CLI 共享 credentials 文件
2. **OpenAI Codex**（GitHub Copilot）—— OAuth 2.0 + Codex Responses API endpoint
3. **Nous**（Nous Portal）—— Nous 自家 OAuth + agent_key

**EvoClaw** —— 无 OAuth 支持。用户必须手动获取 API Key 并填入 GUI。

**判定 🔴**：OAuth 缺失对**面向消费级用户**的产品是硬伤（Claude Pro 用户希望一键登录就能用）。对 EvoClaw 面向企业用户（企业 API 配额统一发放）**不是阻塞**，但支持 Claude OAuth 可降低"如何获取 key"的使用门槛。

**建议**：P1 优先级，Claude OAuth 设备码流实施（~2d），利用 Rust 侧 Keychain 存 refresh_token。

---

### §3.8 API 请求构造

**hermes** （`run_agent.py:5426-5676` 约 250 行 `_build_api_kwargs`）:

**巨型单函数**：根据 provider / model / transport / reasoning_config / cache_control / tools / stream / retry context 等组合参数，构建 provider-specific API kwargs。含各种 provider 兼容补丁（Moonshot `reasoning_content` / OpenRouter `cache_control` / Grok `x-grok-conv-id` header / Codex Responses output_item.done 等）。

**EvoClaw** （`packages/core/src/agent/kernel/stream-client.ts:240-315`）:

**两个清晰函数**:
```typescript
function buildAnthropicRequest(config: StreamConfig): RequestSpec {
  // Anthropic 构建 system blocks + cache_control + messages + tools + thinking
  // ~75 行
}

function buildOpenAIRequest(config: StreamConfig): RequestSpec {
  // OpenAI 构建 messages（system 前缀）+ tools + stream
  // ~55 行
}
```

**判定 🟢 反超**：EvoClaw 的**双协议双函数**比 hermes 的 500+ 行单巨函数**可读性好很多**。hermes 承认这是**历史包袱**（`.research/05-agent-loop.md §7` "为什么 `run_agent.py` 有 9,811 行？")。

---

### §3.9 Fallback 机制

见 [`05-agent-loop-gap.md §3.6`](./05-agent-loop-gap.md)，补充 hermes 特性:

**hermes 三级恢复**:
1. `_try_activate_fallback()`（`run_agent.py:4924-5058`）—— 激活备选 provider，切换 client + base_url + api_key
2. `_restore_primary_runtime()`（`run_agent.py:5989` ADDENDUM 后）—— fallback 单轮作用域恢复
3. `_try_recover_primary_transport()` —— transport 层网络错误恢复

**EvoClaw** —— `fallbackActivated: boolean` 持久（本轮对话不切回），**无 `_restore_primary_runtime` 等价**。

**判定 🟡**：见 05 章。

---

### §3.10 智能路由（便宜 vs 主模型）

**hermes** （`agent/smart_model_routing.py:1-194`）:

- 根据任务复杂度自动选择便宜模型（辅助任务）vs 主模型（主对话）
- `smart_model_routing.py` 有独立的"能力评估"逻辑

**EvoClaw** （`CLAUDE.md §关键架构模式` ModelRouter）:

**四层优先级**:
1. Agent 配置（Agent 级 provider/model 偏好）
2. 用户偏好（全局默认）
3. 系统默认
4. 硬编码 fallback（gpt-4o-mini）

**判定 🟡**：两种路线:
- hermes 智能路由 —— 自动根据任务判断
- EvoClaw ModelRouter —— 显式优先级链，决策明确

EvoClaw 的四层链对**企业审计**更友好（"为什么用了这个模型"可追溯），hermes 的自动路由对**成本优化**更激进。

---

### §3.11 辅助 LLM（摘要/提取/压缩）

**hermes** （`agent/auxiliary_client.py:1-200`）:

辅助 LLM 带 fallback 链：主 LLM 失败时降级到 OpenRouter 免费层或 Nous Portal MiMo v2 Pro 免费版（RELEASE_v0.8.0.md highlight #2）。

**EvoClaw** （`packages/core/src/agent/llm-client.ts:19-32`）:

```typescript
const SECONDARY_MODEL_FALLBACK: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',         // Haiku 4.5 ($1/M)
  openai:    'gpt-4.1-nano',                      // GPT-4.1 Nano ($0.10/M)
  qwen:      'qwen-turbo-latest',                 // 通义千问 Turbo
  doubao:    'doubao-seed-2-0-mini-260215',        // 豆包 Seed 2.0 Mini
  glm:       'glm-4-flash-250414',                // 智谱 GLM-4 Flash (免费)
  deepseek:  'deepseek-chat',                     // DeepSeek V3
  minimax:   'MiniMax-M2.5',                      // MiniMax M2.5
  moonshot:  'kimi-k2-turbo-preview',             // Kimi K2 Turbo
  zhipu:     'glm-4-flash-250414',
};

export async function callLLMSecondary(...): Promise<string> { /* 使用同 provider 最便宜模型 */ }
```

**判定 🟢**：EvoClaw 的**8 个国产模型 + 2 个海外模型**映射比 hermes 的 Anthropic/OpenAI + Nous MiMo 覆盖面更广。对**国内企业场景**（辅助任务成本直接决定月费）极其重要。

---

### §3.12 国产模型接入

**hermes** —— 分散 extras:

```toml
[project.optional-dependencies]
dingtalk = ["dingtalk-stream>=0.1.0,<1"]
feishu = ["lark-oapi>=1.5.3,<2"]
# alibaba / zai / minimax 通过 PROVIDER_TO_MODELS_DEV 映射 + OpenAI 兼容 transport
```

每个国产 Provider 单独处理。

**EvoClaw** （CLAUDE.md §6 + `packages/core/src/provider/model-fetcher.ts buildAuthHeaders`）:

**统一入口**:
```
Qwen / GLM / Doubao / Kimi / DeepSeek / MiniMax
  ↓ (api: 'openai-completions') + 自定义 baseUrl
  buildAuthHeaders(apiKey, kind, baseUrl) 统一构建 Authorization: Bearer ${apiKey}
```

- 一套代码路径处理所有国产 OpenAI 兼容 Provider
- 新增 Provider 只需 `registerProvider` + 填 baseUrl + 选 `openai-completions`

**判定 🟢 反超**：EvoClaw 的统一接入是**战略优势**。hermes 需要为每个国产 Provider 考虑 extras + `PROVIDER_TO_MODELS_DEV` 映射 + models.dev key，EvoClaw 一套代码覆盖。详见 [`01-tech-stack-gap.md §3.12`](./01-tech-stack-gap.md)。

---

### §3.13 GLM JWT 认证

**hermes** —— 无原生支持。GLM（智谱）通过 OpenAI 兼容 Chat Completions API + Bearer token 方式。但 GLM 的官方认证方式是 **JWT from id.secret**（将 API Key 中的 `id.secret` 两部分组合签发 JWT）。

**EvoClaw** （`packages/core/src/provider/model-fetcher.ts buildAuthHeaders`）:

```typescript
// buildAuthHeaders() 根据 apiKey 格式判断是否需要 JWT 生成
// GLM: apiKey 格式为 "id.secret"，用 HMAC 生成 JWT
if (kind === 'glm' && apiKey.includes('.')) {
  const [id, secret] = apiKey.split('.');
  // 用 createHmac('sha256', secret) 签 JWT
  const jwt = generateGLMJWT(id, secret);
  headers['Authorization'] = `Bearer ${jwt}`;
}
```

**判定 🟢 反超**：EvoClaw 原生支持 GLM 官方认证方式，hermes 只能用 GLM 的"OpenAI 兼容降级模式"（效率低 + 部分高级功能不可用）。

---

### §3.14 非 ASCII key 清理

见 [`05-agent-loop-gap.md §3.5`](./05-agent-loop-gap.md)。hermes 强制清理（`.research/06-llm-providers.md` ADDENDUM），EvoClaw 无。P0 ~0.5d。

---

## 4. 改造蓝图（不承诺实施）

### P0（高 ROI，建议尽快）

| # | 项目 | 对应差距 | 工作量 | ROI |
|---|---|---|---|---|
| 1 | API Key 非 ASCII 清理 | §3.14 | 0.5d | 🔥🔥 |
| 2 | Credential Pool + 多 key 轮换 + OAuth 刷新 | §3.6 | 3-4d | 🔥🔥🔥 |

### P1（中等 ROI）

| # | 项目 | 对应差距 | 工作量 | ROI |
|---|---|---|---|---|
| 3 | `DEFAULT_CONTEXT_LENGTHS` 硬编码表 + 5 级 probe | §3.4 | 0.5d | 🔥🔥 |
| 4 | URL → Provider 推断（hostname 映射） | §3.5 | 0.5d | 🔥 |
| 5 | Claude OAuth 设备码登录 | §3.7 | 2d | 🔥 |
| 6 | 模型降级单轮作用域恢复 | §3.9 | 1d | 🔥 |

### P2（长期）

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 7 | Codex Responses 协议支持（若进入 Copilot 集成场景） | §3.2 | 3d |
| 8 | 对标 models.dev 的集中模型目录（跨 Provider 成本对比） | §3.3 | 5d |
| 9 | 智能模型路由（任务复杂度 → 模型选择） | §3.10 | 3d |

### 不建议做

| # | 项目 | 理由 |
|---|---|---|
| — | 引入 dingtalk-stream / lark-oapi 官方 SDK | EvoClaw HTTP 直调在国产场景更灵活 |
| — | 重新把 SECONDARY_MODEL_FALLBACK 改到 auxiliary_client 风格 | EvoClaw 当前映射更清晰 |

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | 双协议双函数 API 请求构造（可读性高） | `kernel/stream-client.ts:240-315 buildAnthropicRequest/buildOpenAIRequest` | `_build_api_kwargs` 500+ 行单函数 |
| 2 | 8 个国产模型 + 2 海外模型 SECONDARY fallback 映射 | `llm-client.ts:19-32 SECONDARY_MODEL_FALLBACK` | auxiliary_client 仅 Anthropic/OpenAI + Nous MiMo |
| 3 | 统一 openai-completions 接入所有国产 Provider | `provider/model-fetcher.ts buildAuthHeaders` | 需 PROVIDER_TO_MODELS_DEV 映射 + extras |
| 4 | GLM JWT（id.secret → JWT）原生支持 | `model-fetcher.ts buildAuthHeaders` GLM 分支 | 无原生支持，仅 OpenAI 兼容降级 |
| 5 | ModelRouter 四层优先级链（Agent/用户/系统/硬编码）显式可审计 | `CLAUDE.md §ModelRouter` | `smart_model_routing.py` 自动判断，审计难 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（2026-04-16 验证）

- `packages/core/src/agent/llm-client.ts:19-32` ✅ SECONDARY_MODEL_FALLBACK 映射（8 国产 + 2 海外）
- `packages/core/src/agent/kernel/types.ts:360` ✅ `ApiProtocol = 'anthropic-messages' | 'openai-completions'`
- `packages/core/src/agent/kernel/stream-client.ts:240-315` ✅ buildAnthropicRequest + buildOpenAIRequest
- `packages/core/src/provider/model-fetcher.ts:49-80` ✅ fetchModelsFromApi
- `packages/core/src/routes/provider.ts:146-182` ✅ registerProvider（runtime 注册）

### 6.2 hermes 研究引用

- `.research/06-llm-providers.md §1, §2` — provider 层全景图
- `.research/06-llm-providers.md §3.1` — ProviderDef + HermesOverlay + ALIASES
- `.research/06-llm-providers.md §3.2` — models.dev + 三层缓存
- `.research/06-llm-providers.md §3.3` — context length 四层降级 + 5 级 probe
- `.research/06-llm-providers.md §3.4` — credential_pool 四策略 + OAuth 刷新
- `.research/06-llm-providers.md §3.5` — smart_model_routing
- `.research/06-llm-providers.md §3.6` — fallback 三级恢复

### 6.3 关联 gap 章节

- [`01-tech-stack-gap.md`](./01-tech-stack-gap.md) §3.7, §3.12 — openai/anthropic SDK vs HTTP 直调 / 国产模型统一接入
- [`04-core-abstractions-gap.md`](./04-core-abstractions-gap.md) §3.12 — CredentialPool 类型层缺失
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.5, §3.6, §3.7, §3.14 — 非 ASCII 清理 / Fallback / Credential Pool / retry 等（已深挖）

---

**本章完成**。LLM Provider 系统对比：**hermes 在 Credential Pool / OAuth / models.dev 目录三个维度深度压倒 EvoClaw**（P0/P1 补齐路径明确），EvoClaw 在**双协议清晰 / 国产模型统一接入 / GLM JWT / SECONDARY fallback 映射 / ModelRouter 四层链**五项反超。两者在**战略市场**上服务不同客户，能力互补性 > 对齐必要性。
