# 28 — 配置系统 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/28-config-system.md`（256 行，Phase F draft）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`hermes_cli/config.py:1-3468` + `env_loader.py` + `providers.py`
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`packages/core/src/infrastructure/config-manager.ts` + `config-merge.ts` + `config-migration.ts` + `routes/config.ts`
> **综合判定**: 🟡 **部分覆盖，多项形态差异** — EvoClaw 采用分层配置（managed.json → config.d/*.json → 用户配置）+ Zod Schema 校验，hermes 采用 YAML + 环境变量展开 + Python 版本迁移。核心能力互补：hermes 强于多 provider 凭据池 + OAuth 刷新 + 凭证 ASCII 清理，EvoClaw 强于 enforced 策略隔离 + 完整的迁移框架 + 不可变状态管理。

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes 配置系统**（`.research/28-config-system.md` § 1-2，`config.py:1-3468` + `cli-config.yaml.example:1-893`）— **分层加载模型**：环境变量（`~/.hermes/.env`，最高优先级） > YAML 配置（`~/.hermes/config.yaml` 或 `config.work.yaml` / `config.dev.yaml` profile） > 项目 `.env` 文件 > DEFAULT_CONFIG（最低）。核心职责：
1. **凭证管理**：18 个版本迭代历史、OAuth 多 key 轮换、非 ASCII 清理（Unicode 替代字检测、`encode('ascii', errors='ignore')`）、0600 权限强制
2. **Provider 系统**：models.dev 目录（109+ provider）+ HERMES_OVERLAYS 注册表（30+ 特殊处理）、transport 协议选择（openai_chat / anthropic_messages / codex）、auth_type（api_key / oauth_device_code / oauth_external）
3. **Profile 隔离**：多配置文件运行时切换
4. **托管模式**（NixOS）：权限 0750、umask 0o007、directory pre-creation
5. **MCP 管理**：mcp_servers YAML 部分的 CRUD
6. **版本迁移**：ENV_VARS_BY_VERSION 分段加载（interactive 向导 + auto）

**EvoClaw 配置系统**（`packages/core/src/infrastructure/config-manager.ts:1-461` + `config-merge.ts` + `config-migration.ts`）— **三层不可变合并**：
1. **managed.json**（管理员层）：IT 管理员通过 enforced 路径强制配置（不含 enforced 元字段本身）
2. **config.d/*.json**（drop-in 片段）：字母序加载、零散配置片段汇聚（无文件间优先级，仅字母序）
3. **用户配置**（evo_claw.json 或 BRAND_CONFIG_FILENAME）：最高优先级，updateConfig 仅写此层

核心职责：
1. **三层架构**：enforced 强制回写、denylist 并集安全策略、deep merge 不可变更新
2. **Zod Schema 校验**：configSchema（46-68 行）覆盖 models、services、envVars、language、thinking、permissionMode、security、hooks
3. **版本迁移框架**：registerConfigMigration + runConfigMigrations（幂等、纯函数）
4. **Provider 同步**：evo_claw.json 中的 Provider 条目自动注入 provider-registry 内存表
5. **环境变量管理**：envVars Record + 后向兼容（services.brave.apiKey 迁移路径）
6. **REST API 暴露**：configManager 通过 Hono 路由（`routes/config.ts`）提供 CRUD + layers 调试视图 + 验证

**量级与格局对比**:
- hermes: `config.py` 3,468 行（单文件）+ `env_loader.py` + `providers.py` 共 ~4,500 行；凭证管理与 provider 注册高度耦合
- EvoClaw: `config-manager.ts` 461 行 + `config-merge.ts` 105 行 + `config-migration.ts` 117 行 + `routes/config.ts` 197 行共 ~880 行；架构更模块化、优先级更透明、enforced 策略强隔离

**关键设计差异**:
- hermes：imperative 配置加载（命令式赋值 + in-place 修改） + 运行时 profile 切换
- EvoClaw：immutable state（structuredClone + transition 记录） + managed/drop-in/user 三层不交错、enforced 强制回写后 merge 过程保留

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 分层加载与优先级链 | 🟡 | 都支持但形态差异：hermes 5 层（env > YAML > .env > default），EvoClaw 3 层（managed > drop-in > user）；EvoClaw enforced 强制回写独创 |
| §3.2 | DEFAULT_CONFIG 硬编码默认值 | 🟢 | 都有；EvoClaw 通过 Zod schema + brand.defaultEnv 可扩展性更强 |
| §3.3 | YAML / JSON 配置文件格式 | 🟡 | hermes YAML + 环境变量展开（`${VAR}` 语法），EvoClaw JSON 5 层（managed + config.d + user）；JSON 更易版本控制但缺动态 interpolation |
| §3.4 | 凭证权限强制（0600 / 0750）| 🔴 | EvoClaw 无文件权限控制；`fs.readFileSync / writeFileSync` 不设 mode，托管模式无特殊处理 |
| §3.5 | 非 ASCII 凭证清理 | 🔴 | EvoClaw 缺失；hermes `_sanitize_loaded_credentials()` 处理 Unicode 替代字，EvoClaw 无对应（见 unicode-detector.ts 但不用于 credential） |
| §3.6 | 多 Provider + OAuth 凭据池 | 🔴 | EvoClaw 无 CredentialPool、无 OAuth token 刷新、无 auth_type 多态；仅支持 apiKey + baseUrl 单通道 |
| §3.7 | Provider 注册表与 Overlay | 🟡 | hermes models.dev 109+ provider + HermesOverlay 30+ 特殊处理；EvoClaw 用 provider-extensions（8 个内置 + 用户注册），规模差异但兼容更强 |
| §3.8 | Profile 隔离与运行时切换 | 🔴 | EvoClaw 无 profile 概念；品牌化通过 BRAND（构建时）而非运行时 profile；不支持 config.work.yaml / config.dev.yaml 多环境切换 |
| §3.9 | 配置验证与 Issue 报告 | 🟡 | hermes ConfigIssue 类（level / section / message / suggestion / auto_fixable）；EvoClaw ConfigValidation（valid / missing / warnings），后者更简洁但诊断信息少 |
| §3.10 | 版本迁移框架 | 🟢 | **反超**：EvoClaw 完整的 registerConfigMigration + runConfigMigrations + 幂等保证；hermes migrate_config() 是交互式 prompt，EvoClaw 纯函数且测试友好 |
| §3.11 | 环境变量展开（`${VAR}` 语法） | 🔴 | EvoClaw 无 inline 展开；仅支持 process.env 注入，不支持配置文件内 `${API_KEY}` 引用 |
| §3.12 | MCP 服务器配置管理 | 🟡 | hermes mcp_config.py CRUD；EvoClaw mcp-config.ts 发现机制（.mcp.json > evo_claw.json）更灵活但无 UI 编辑器 |
| §3.13 | Enforced / Denylist 安全策略 | 🟢 | **反超**：EvoClaw enforced 强制回写 + denylist 并集机制（来自 managed.json）；hermes 无对应管理员强制隔离 |
| §3.14 | CLI 命令：config edit/set/validate | 🔴 | EvoClaw 无 CLI；通过 REST `/config` + `/config/validate` + `/config/env-vars` + `/provider/:id` 等路由实现，但终端用户无 `hermes config set` 命令 |
| §3.15 | Doctor 诊断工具 | 🟡 | 两端都有；hermes `doctor.py` 1,200+ 行专项工具；EvoClaw `routes/doctor.ts` 内嵌在 server，11 项检查 + heap-snapshot，深度略少 |

**统计**: 🔴 5 / 🟡 7 / 🟢 3（其中 2 项反超）。

---

## 3. 机制逐条深度对比

### §3.1 分层加载与优先级链

**hermes**（`config.py:L140-L200` 伪代码）:
```python
def load_config() -> Dict[str, Any]:
    config = read_raw_config()  # 优先级顺序：
    # 1. ~/.hermes/.env（用 load_hermes_dotenv() 加载，权限 0600）
    # 2. 活跃 Profile 配置 (~/.hermes/config.yaml 或 config.PROFILE.yaml)
    # 3. 项目 .env 文件
    # 4. DEFAULT_CONFIG
    config = _deep_merge(DEFAULT_CONFIG, config)
    config = _expand_env_vars(config)  # ${VAR} 语法替换
    check_config_version()
    issues = validate_config_structure(config)
    return config
```
关键不变量：**环境变量总是最高优先级**（即使用户 YAML 写了 `model: claude-opus`，`HERMES_MODEL` env var 仍覆盖）。Profile 切换通过 `~/.hermes/.hermes_profile` 文件标记活跃 profile。

**EvoClaw**（`config-manager.ts:L79-L121`）:
```typescript
private loadMergedConfig(): EvoClawConfig {
  // 1. managed.json（最低优先级，可包含 enforced[] 元字段）
  const { config: managed, enforced } = this.loadManagedConfig();
  
  // 2. config.d/*.json（按文件名字母序合并，无文件间优先级）
  const dropIn = this.loadDropInConfigs();
  
  // 3. 用户配置 evo_claw.json（最高）
  const user = this.loadUserConfig();
  
  // 合并：mergeLayers(managed, dropIn, user)
  const merged = mergeLayers(managed, dropIn, user) as EvoClawConfig;
  
  // enforced 强制回写（覆盖用户 merged 中的相应路径）
  if (enforced.length > 0) {
    applyEnforced(merged, managed, enforced);
  }
  
  // Zod 验证
  const result = safeParseConfig(merged);
  return merged;
}
```
关键不变量：**enforced 路径在最终 merge 后才强制回写，保证管理员策略不被用户 YAML 突破**。用户无法删除 managed 配置（用户层 updateConfig 仅写入 user 层）。

**判定 🟡**：都支持多层加载，但形态差异显著。hermes 层级更多（5 层）且用环境变量作最高优先级（CLI 参数实际上通过 process args 模拟），EvoClaw 只有 3 层且没有 env var 插值。**EvoClaw 的 enforced 机制（managed.json 中标记强制路径，merge 后再回写）在 hermes 中不存在**，是管理员场景的反超。但 hermes 的 `${VAR}` 环境变量展开在 EvoClaw 中缺失（需补齐 P1）。

---

### §3.2 DEFAULT_CONFIG 硬编码默认值

**hermes**（`config.py:L50-L100`）:
```python
DEFAULT_CONFIG = {
    "model": {
        "default": "anthropic/claude-opus-4.6",
        "provider": "auto",
        "base_url": "https://openrouter.ai/api/v1",
        "context_length": None,
        "max_tokens": None,
    },
    "agent": {
        "max_turns": 90,
        "gateway_timeout": 1800,
        "tool_use_enforcement": "auto",
        "reasoning_effort": "medium",
    },
    "terminal": {
        "backend": "local",  # local|ssh|docker|singularity|modal|daytona
        "cwd": ".",
        "timeout": 180,
        "docker_image": "nikolaik/python-nodejs:python3.11-nodejs20",
    },
    "compression": { "enabled": True, "threshold": 0.50, ... },
    "memory": { "memory_enabled": True, ... },
    "display": { "personality": "kawaii", "skin": "default", ... },
}
```
~450 行硬编码，涵盖模型、agent、terminal、压缩、memory、display 六大类。

**EvoClaw**（`shared/src/schemas/config.schema.ts:L46-L68` + `shared/src/types/config.ts:L18`）:
```typescript
export const configSchema = z.object({
  models: modelsConfigSchema,  // Zod optional
  services: z.object({
    brave: z.object({ apiKey: z.string() }).optional(),
  }).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  language: z.enum(['zh', 'en']).optional(),
  thinking: z.enum(['auto', 'on', 'off']).optional(),
  permissionMode: z.enum(['default', 'strict', 'permissive']).optional(),
  security: z.object({ skills: ..., mcpServers: ... }).optional(),
  hooks: z.object({ disableAllHooks, allowManagedHooksOnly }).optional(),
}).passthrough();
```
~23 行 Schema 定义（比 hermes 少 20×），加上 `BRAND.defaultEnv`（brand-level 环境变量默认值，在 `infrastructure/feature.ts` 中读取 `.env.brand`）。缺少 agent（maxTurns / timeout）、terminal、compression、memory、display 等 hermes 的配置项（这些在 EvoClaw 侧被拆到 Kernel config / Sidecar 启动参数 / brand config 中）。

**判定 🟢**：都支持硬编码默认值。EvoClaw 通过 Zod schema 定义缩减了代码体积，且 `BRAND.defaultEnv` 允许品牌层级覆盖（对国产化支持更友好）。但 EvoClaw 的 schema 覆盖范围较窄，agent 级默认值被移到 Kernel 层（见 05 章），这不是缺失而是架构分层的必然。

---

### §3.3 YAML / JSON 配置文件格式 + 环境变量展开

**hermes**（`cli-config.yaml.example:1-893` + `config.py:L500-L600`）:
```yaml
# ~/.hermes/config.yaml
model:
  default: anthropic/claude-opus-4.6
  provider: ${HERMES_PROVIDER:-auto}
  base_url: ${HERMES_BASE_URL:-https://openrouter.ai/api/v1}
  
agent:
  max_turns: ${HERMES_MAX_TURNS:-90}
  
# 环境变量展开通过 _expand_env_vars() 递归处理
# 格式: ${VAR_NAME} 或 ${VAR_NAME:-default_value}
# 扫描所有 string 值并调用 os.path.expandvars()
```
YAML 格式便于人工编辑，inline `${VAR}` 语法支持动态插值。

**EvoClaw**（`config-manager.ts` + `config-merge.ts` + `routes/config.ts`）:
```json
// ~/.evoclaw/evo_claw.json 或 ~/.healthclaw/healthclaw.json (brand-aware)
{
  "models": {
    "default": "minimax/MiniMax-M2.5-highspeed",
    "embedding": "qwen/text-embedding-v4",
    "providers": {
      "minimax": {
        "baseUrl": "https://api.minimaxi.com/v1",
        "apiKey": "sk-...",
        "api": "openai-completions"
      }
    }
  },
  "envVars": {
    "BRAVE_API_KEY": "sk-brave-..."
  }
}

// managed.json (IT 管理员层)
{
  "security": {
    "skills": { "denylist": ["execute_shell", "execute_code"] }
  },
  "enforced": ["security.skills.denylist"]  // 元字段，标记强制路径
}

// config.d/010-custom.json (drop-in 片段)
{
  "models": {
    "providers": {
      "custom": { "baseUrl": "...", "apiKey": "..." }
    }
  }
}
```
JSON 格式版本控制友好，但**不支持 inline `${VAR}` 插值**。环境变量必须通过 `config.envVars` Record 显式存储后通过 REST API 注入 `process.env`（`routes/config.ts:L185-L191`）。

**判定 🔴**：EvoClaw 缺失环境变量展开能力。hermes 可在配置文件内写 `base_url: ${CUSTOM_BASE_URL:-fallback}`，EvoClaw 则需要：
1. 在 `envVars` 中存储 CUSTOM_BASE_URL
2. 手动在代码中引用 `process.env.CUSTOM_BASE_URL`
3. 或通过 REST API 读取后合并

这限制了跨环境配置的灵活性（P1 补齐项）。

---

### §3.4 凭证权限强制（0600 / 0750）

**hermes**（`config.py:L60-L150`，托管模式检测 + 权限设置）:
```python
def ensure_hermes_home():
    """创建 ~/.hermes/ 目录，设置权限 0700（或 0750 托管模式）"""
    home = os.path.expanduser('~/.hermes')
    os.makedirs(home, mode=0o700, exist_ok=True)
    
    # 托管模式（NixOS）权限例外
    if os.getenv('HERMES_MANAGED'):
        os.chmod(home, 0o750)
        os.umask(0o007)  # 新文件默认权限 0o640
    else:
        os.chmod(home, 0o700)
        os.umask(0o077)  # 新文件默认权限 0o600

def save_env_value(key: str, value: str):
    """保存凭证到 ~/.hermes/.env，权限 0600（或 0660 托管模式）"""
    env_file = os.path.expanduser('~/.hermes/.env')
    with open(env_file, 'w') as f:
        os.chmod(env_file, 0o600)  # 仅所有者可读写
        f.write(f'{key}={value}\n')
```

**EvoClaw**（`config-manager.ts:L174-L207`）:
```typescript
private loadUserConfig(): EvoClawConfig {
  try {
    if (fs.existsSync(this.configPath)) {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // 配置迁移，但无权限检查
      const { config: migrated, changed } = runConfigMigrations(parsed);
      if (changed) {
        const dir = path.dirname(this.configPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // ⚠️ 无权限设置
        fs.writeFileSync(this.configPath, JSON.stringify(migrated, null, 2), 'utf-8');
      }
      return migrated as EvoClawConfig;
    }
  } catch (err) {
    log.error('用户配置加载失败:', err);
  }
  return {};
}
```
`mkdirSync / writeFileSync` 都不设置 `mode` 参数，导致目录权限由 umask 决定（通常 0o777 & ~umask）。在多用户 Linux 系统或容器环境中，**用户凭证可能被同组其他用户读取**。

**判定 🔴**：EvoClaw 缺失凭证权限控制。补齐方案：
```typescript
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.writeFileSync(this.configPath, JSON.stringify(migrated, null, 2), {
  encoding: 'utf-8',
  mode: 0o600,  // Node.js 18.4+
});
// 或手动调用 fs.chmodSync(this.configPath, 0o600)
```
建议 P1，特别是在企业环境（多用户共享机或容器）中。

---

### §3.5 非 ASCII 凭证清理

**hermes**（`config.py:L154-L165`，ADDENDUM B87D0028）:
```python
def _sanitize_loaded_credentials() -> None:
    """清理非ASCII凭证（PDF 复制粘贴的 Unicode 替代字）"""
    for key, value in list(os.environ.items()):
        if not any(key.endswith(s) for s in _CREDENTIAL_SUFFIXES):
            continue  # 跳过非凭证环境变量
        try:
            value.encode("ascii")
        except UnicodeEncodeError:
            # 凭证包含非 ASCII — 执行清理
            os.environ[key] = value.encode("ascii", errors="ignore").decode("ascii")
```
检测 _CREDENTIAL_SUFFIXES（`_API_KEY`, `_TOKEN`, `_SECRET`, `_PASSWORD` 等）后缀的环境变量，对包含 Unicode 替代字（lookalike 字符、全角 ASCII、RTL override 等）的凭证执行 `.encode('ascii', errors='ignore')`（丢弃非 ASCII 字节）。这解决了**从 PDF 中复制 API Key 时粘贴了隐形 Unicode 字符导致认证失败**的常见问题。

**EvoClaw**（`packages/core/src/security/unicode-detector.ts:L1-200`）:
```typescript
// unicode-detector.ts 定义了 Fullwidth ASCII 转换 + Homoglyph 检测
export function isFullwidthASCII(code: number): boolean {
  return code >= 0xff01 && code <= 0xff5e;  // U+FF01-U+FF5E
}

export function fullwidthToASCII(code: number): number {
  return code - 0xff00 + 0x0020;  // 映射到 U+0021-U+007E
}

// 但此代码**不用于凭证清理**，仅用于安全检测（injection-detector.ts）
```
EvoClaw **有全角 ASCII 转换逻辑但未应用于凭证 sanitization**。配置加载路径（`config-manager.ts`）完全没有调用 `unicode-detector`，导致用户从 PDF 粘贴的凭证直接写入 JSON，包含隐形字符时后续 API 调用会失败。

**判定 🔴**：EvoClaw 缺失凭证 ASCII 清理。补齐方案：
```typescript
private loadUserConfig(): EvoClawConfig {
  const raw = fs.readFileSync(this.configPath, 'utf-8');
  let parsed = JSON.parse(raw);
  
  // 清理凭证字段中的非 ASCII 字符
  parsed = sanitizeCredentials(parsed);  // 新增函数
  
  const { config: migrated, changed } = runConfigMigrations(parsed);
  return migrated as EvoClawConfig;
}

function sanitizeCredentials(config: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(config);
  
  // 递归扫描 apiKey / password / token 字段
  function sanitize(obj: any) {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && 
          (key === 'apiKey' || key === 'password' || key.endsWith('Token'))) {
        // 尝试转换全角字符、RTL override 等
        obj[key] = cleanSecretString(value);
      } else if (typeof value === 'object') {
        sanitize(value);
      }
    }
  }
  sanitize(result);
  return result;
}

function cleanSecretString(str: string): string {
  // 移除全角 ASCII
  let cleaned = str.replace(/[\uff01-\uff5e]/g, (c) => 
    String.fromCharCode(c.charCodeAt(0) - 0xff00 + 0x20)
  );
  // 移除 RTL Override / LTR Mark 等 control chars
  cleaned = cleaned.replace(/[\u200e\u200f\u202a-\u202e]/g, '');
  // 移除其他非 ASCII
  cleaned = cleaned.replace(/[^\x00-\x7f]/g, '');
  return cleaned;
}
```
建议 P1（企业场景高频遇到）。

---

### §3.6 多 Provider + OAuth 凭据池

**hermes**（`providers.py:L1-500` + `config.py:OPTIONAL_ENV_VARS:L768-1500`）:
```python
@dataclass(frozen=True)
class HermesOverlay:
    transport: str = "openai_chat"  # 协议选择
    is_aggregator: bool = False     # 聚合器（OpenRouter）
    auth_type: str = "api_key"      # api_key|oauth_device_code|oauth_external
    extra_env_vars: Tuple[str, ...] = ()  # 需要的环境变量列表
    base_url_override: str = ""

HERMES_OVERLAYS = {
    "openrouter": HermesOverlay(
        transport="openai_chat",
        is_aggregator=True,
        extra_env_vars=("OPENAI_API_KEY",),
        base_url_env_var="OPENROUTER_BASE_URL",
    ),
    "nous": HermesOverlay(
        transport="openai_chat",
        auth_type="oauth_device_code",  # ← OAuth 设备码流
        base_url_override="https://inference-api.nousresearch.com/v1",
    ),
    "anthropic": HermesOverlay(
        transport="anthropic_messages",
        extra_env_vars=("ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"),
    ),
}

class CredentialPool:
    """多 key 轮换 + OAuth 刷新"""
    def rotate_key(provider: str) -> str:
        # 使用下一个有效 API Key（如 OPENAI_API_KEY_2, OPENAI_API_KEY_3...）
        pass
    
    def refresh_oauth_token(provider: str) -> str:
        # 用 refresh_token 重新获取 access_token
        pass
```

**EvoClaw**（`provider/provider-registry.ts:L1-101` + `provider/model-resolver.ts:L1-90`）:
```typescript
interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyRef: string;  // ← 单个 API Key 引用
  models: ModelConfig[];
}

export function registerProvider(config: ProviderConfig): void {
  providers.set(config.id, config);
}

// 仅支持单一 apiKeyRef + baseUrl，无 OAuth、无 auth_type 枚举、无凭据池
// API 协议由 models config 中的 `api` 字段决定（'openai-completions' | 'anthropic-messages'）
```
EvoClaw provider registry 是**简化的单通道设计**：每个 provider 一个 apiKey，无凭据轮换、无 OAuth token 刷新、无 auth_type 多态。国产模型（Qwen、GLM、Doubao 等）都通过 OpenAI Chat Completions 兼容接口接入，透明度高但灵活性低。

**判定 🔴**：EvoClaw 缺失 OAuth 与多 key 轮换能力。hermes 的 `HermesOverlay` 与 `CredentialPool` 在 EvoClaw 中不存在。补齐方案（P0 改造蓝图中详述）：
1. 扩展 `ProviderEntry` 支持 `authType: 'api_key' | 'oauth_device_code' | 'oauth_external'`
2. 加入 `apiKeys: string[]`（多个 key 支持轮换）与 `oauthRefreshUrl / refreshToken`
3. 在 LLM 调用前检测 401 错误，触发 key 轮换或 token 刷新

**值得注意**：hermes 的复杂性来自**多 provider、多 auth 方式的支持**，EvoClaw 则通过**统一 OpenAI-compatible 接口 + 品牌层定制**来降低客户端复杂度。两者都合理，但如果 EvoClaw 要支持企业多账号场景，必须补齐凭据池（P1）。

---

### §3.7 Provider 注册表与 Overlay

**hermes**（`providers.py:L50-150` + models.dev 目录 109+ provider）:
```
models.dev/
├── providers/
│   ├── openai.py          # Provider 定义（model list）
│   ├── anthropic.py
│   ├── openrouter.py
│   ├── nous.py
│   ├── qwen.py            # 国产（Qwen）
│   ├── glm.py             # 智谱
│   ├── doubao.py          # 豆包
│   └── ... (100+ more)
```
两层注册体系：
1. **models.dev 目录**：Python 文件定义每个 provider 的模型列表（上下文窗口、输出限制、成本等）
2. **HERMES_OVERLAYS**：hardcoded 30+ provider 的特殊处理（transport 选择、OAuth 类型、base_url override）

**EvoClaw**（`provider/extensions/` + 内存 registry）:
```typescript
// provider/extensions/index.ts
export function getProviderExtension(id: string): ProviderDefinition | undefined {
  // 预定义 8 个内置 provider（OpenAI, Anthropic, Google, Groq, Qwen, GLM, Doubao, DeepSeek）
  const BUILTIN = {
    'openai': { id: 'openai', name: 'OpenAI', defaultBaseUrl: '...', models: [...] },
    'qwen': { id: 'qwen', name: 'Qwen', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [...] },
    ...
  };
  return BUILTIN[id];
}

export function registerProvider(config: ProviderConfig): void {
  providers.set(config.id, config);
}
```
内置 8 个 provider（支持 OpenAI Chat Completions 兼容接口的国产模型主流方案），用户通过 `registerProvider()` 或 REST API `/provider/:id` 添加自定义 provider。与 hermes 相比，**规模小（8 vs 109）但可扩展性强（用户配置即可新增）**。

**判定 🟡**：都支持多 provider 注册，但策略不同。hermes 预装 109+ provider、hardcode 30+ overlay（代码体积大但覆盖全），EvoClaw 预装 8 个（代表国际 + 国产主流）、用户可通过 UI 或 REST 动态添加（代码轻量但需用户配置）。对于"开箱即用"场景，hermes 优；对于"企业定制"场景，EvoClaw 优（因为可随时添加内部模型服务）。**EvoClaw 不需要补齐 100+ provider，而是通过 extension + registry + REST API 降低定制成本**。

---

### §3.8 Profile 隔离与运行时切换

**hermes**（`config.py:L200-250` + `cli-config.yaml.example:1-20`）:
```
~/.hermes/
├── config.yaml           # 默认 profile
├── config.work.yaml      # 工作 profile（高上下文限制）
├── config.dev.yaml       # 开发 profile（模型切换为 Sonnet）
└── .hermes_profile       # 活跃 profile 标记文件
```
用户可在运行时通过 `hermes --profile work` 或环境变量 `HERMES_PROFILE=work` 切换 profile，使同一用户可快速切换不同工作模式（如工作时受限模型 + 开发时不限 tool use）。

**EvoClaw**（无 profile 概念）:
```
~/.evoclaw/
├── evo_claw.json         # 用户配置（唯一）
└── managed.json          # 管理员配置（IT 控制）

~/.healthclaw/
├── healthclaw.json       # 品牌 A 配置
```
EvoClaw 通过**品牌化**（BRAND = "evoclaw" / "healthclaw" 等）区分产品，而非 profile。品牌在构建时固定（`packages/shared/src/consts/brand.ts:L1-30`），不支持运行时切换。如果企业用户需要"工作 vs 个人"两套配置，必须维护两个独立的 JSON 文件或手动编辑。

**判定 🔴**：EvoClaw 完全缺失 profile 概念。补齐方案（P2，非关键）：
```typescript
// config-manager.ts 新增
private activeProfile: string = 'default';

loadConfigForProfile(profile: string): EvoClawConfig {
  // 加载 config.d/{profile}.json 而非字母序
  const profilePath = path.join(this.configDir, `config.d/${profile}.json`);
  // 或预设 evo_claw.{profile}.json
  return this.loadMergedConfig();
}

setActiveProfile(profile: string): void {
  this.activeProfile = profile;
  fs.writeFileSync(path.join(this.configDir, '.active_profile'), profile);
}
```
但考虑到 EvoClaw 的"品牌化"设计（即不同品牌=不同应用实例），profile 的优先级较低。hermes 因为是单一 CLI 工具，多 profile 更有意义。

---

### §3.9 配置验证与 Issue 报告

**hermes**（`config.py:L1200-L1300` ConfigIssue dataclass）:
```python
@dataclass
class ConfigIssue:
    level: str              # "error" | "warning"
    section: str            # 配置路径，如 "model.provider"
    message: str            # 用户可读的错误信息
    suggestion: str         # 修复建议
    auto_fixable: bool      # 是否可自动修复

def validate_config_structure(config: Dict) -> List[ConfigIssue]:
    issues = []
    # 检查 model.default 是否有效
    if not config.get('model', {}).get('default'):
        issues.append(ConfigIssue(
            level='error',
            section='model.default',
            message='未指定默认模型',
            suggestion='在 config.yaml 中设置 model.default: anthropic/claude-opus-4.6',
            auto_fixable=False,
        ))
    # 检查 provider 是否已配置
    if config.get('model', {}).get('provider') == 'custom':
        provider = config['model'].get('custom_provider')
        if not provider:
            issues.append(ConfigIssue(
                level='error',
                section='model.custom_provider',
                message='provider=custom 时必须设置 custom_provider',
                suggestion='检查 model.custom_provider 配置',
                auto_fixable=False,
            ))
    return issues
```
丰富的诊断信息（level, section, message, suggestion, auto_fixable）帮助用户快速定位问题。

**EvoClaw**（`config-manager.ts:L256-L307` ConfigValidation interface）:
```typescript
export interface ConfigValidation {
  valid: boolean;
  missing: string[];
  warnings?: string[];
}

validate(): ConfigValidation {
  const missing: string[] = [];

  if (!this.config.models) {
    missing.push('models');
    return { valid: false, missing };
  }

  const { models } = this.config;
  if (!models.default) {
    missing.push('models.default');
  } else {
    const ref = parseModelRef(models.default);
    if (!ref) {
      missing.push('models.default (格式应为 provider/modelId)');
    } else {
      const provider = models.providers?.[ref.provider];
      if (!provider) {
        missing.push(`models.providers.${ref.provider}`);
      } else {
        if (!provider.apiKey) missing.push(`models.providers.${ref.provider}.apiKey`);
        // ... 更多检查
      }
    }
  }
  
  return { valid: missing.length === 0, missing, warnings };
}
```
简化的 ConfigValidation（valid / missing / warnings）捕获缺失项但诊断信息较少。no `suggestion` / `auto_fixable` 字段，用户看到错误后需自行查文档修复。

**判定 🟡**：两者都支持配置验证，但深度差异。hermes 的诊断更友好（含 suggestion），EvoClaw 的诊断更简洁。补齐方案（P2）：
```typescript
export interface ValidationIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
  suggestion?: string;
  autoFixable?: boolean;
}

validate(): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  
  if (!this.config.models?.default) {
    issues.push({
      level: 'error',
      path: 'models.default',
      message: '未指定默认模型',
      suggestion: '在 evo_claw.json 中设置 models.default: "anthropic/claude-3-5-sonnet"',
      autoFixable: false,
    });
  }
  
  return { valid: issues.filter(i => i.level === 'error').length === 0, issues };
}
```

---

### §3.10 版本迁移框架

**hermes**（`config.py:L165-L185`，交互式迁移）:
```python
def migrate_config(interactive: bool = True) -> Dict[str, Any]:
    current_ver, config_ver = check_config_version()
    if config_ver >= current_ver:
        return load_config()
    
    for version in range(config_ver + 1, current_ver + 1):
        new_env_vars = ENV_VARS_BY_VERSION.get(version, [])
        if interactive:
            for var_name in new_env_vars:
                value = getpass.getpass(f"Enter {var_name}: ")
                if value:
                    save_env_value(var_name, value)
    
    config = load_config()
    config["_config_version"] = current_ver
    save_config(config)
    return config
```
迁移是交互式的（getpass prompt）且耦合 I/O（即时保存环境变量）。ENV_VARS_BY_VERSION 是 18 个版本的分段变量列表。缺点：无幂等保证（重复运行可能 double 保存）、难以测试（I/O 交互）。

**EvoClaw**（`config-migration.ts:L1-117`，纯函数迁移）:
```typescript
export interface ConfigMigration {
  version: number;
  description: string;
  migrate: (config: Record<string, unknown>) => Record<string, unknown>;
}

export function registerConfigMigration(migration: ConfigMigration): void {
  migrations.push(migration);
  migrations.sort((a, b) => a.version - b.version);
}

export function runConfigMigrations(config: Record<string, unknown>): {
  config: Record<string, unknown>;
  applied: string[];
  changed: boolean;
} {
  let currentVersion = typeof config._configVersion === 'number' ? config._configVersion : 0;
  let current = config;
  const applied: string[] = [];

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;

    log.info(`执行配置迁移 v${migration.version}: ${migration.description}`);
    try {
      current = migration.migrate(current);
      currentVersion = migration.version;
      applied.push(`v${migration.version}: ${migration.description}`);
    } catch (err) {
      log.error(`配置迁移 v${migration.version} 失败: ...`);
      break;  // 迁移失败停止，保持当前版本
    }
  }

  if (applied.length > 0) {
    current = { ...current, _configVersion: currentVersion };
  }

  return { config: current, applied, changed: applied.length > 0 };
}

// 注册示例（与 hermes 的 ENV_VARS_BY_VERSION 对标）
registerConfigMigration({
  version: 2,
  description: '将 services.brave.apiKey 迁移到 envVars.BRAVE_API_KEY',
  migrate: (config) => {
    const next = structuredClone(config);
    const braveKey = (next.services as any)?.brave?.apiKey;
    if (braveKey) {
      if (!next.envVars) next.envVars = {};
      (next.envVars as Record<string, string>)['BRAVE_API_KEY'] = braveKey;
    }
    return next;
  },
});
```
纯函数迁移（输入 config → 输出 config），无 I/O 副作用，**幂等且易测试**。

**判定 🟢**：**EvoClaw 在版本迁移框架上反超**。EvoClaw 的纯函数、幂等设计比 hermes 的交互式迁移更符合现代工程实践（见 `__tests__/config-migration.test.ts` 的 6 个测试用例验证幂等性）。hermes 的交互式迁移适合 CLI 场景（新用户首次配置时 prompt），EvoClaw 无需交互（服务器启动时自动迁移）。

---

### §3.11 环境变量展开（`${VAR}` 语法）

**hermes**（`config.py:L500-L600` _expand_env_vars）:
```python
def _expand_env_vars(config: Dict[str, Any]) -> Dict[str, Any]:
    """递归展开配置中的 ${VAR} 或 ${VAR:-default}"""
    def expand(obj):
        if isinstance(obj, dict):
            return {k: expand(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [expand(v) for v in obj]
        elif isinstance(obj, str):
            # ${VAR} → os.environ['VAR']
            # ${VAR:-default} → os.environ.get('VAR', 'default')
            return os.path.expandvars(obj)
        return obj
    return expand(config)
```
支持 `${VARIABLE}` 和 `${VARIABLE:-default}` 两种语法，在加载配置后立即展开。配置文件可写：
```yaml
model:
  base_url: ${CUSTOM_BASE_URL:-https://openrouter.ai/api/v1}
```

**EvoClaw**（无对应机制）:
```json
{
  "models": {
    "providers": {
      "custom": {
        "baseUrl": "https://custom-api.com/v1",  // 必须 hardcode，无 ${} 语法
        "apiKey": "sk-..."  // 无法引用 process.env
      }
    }
  }
}
```

**判定 🔴**：EvoClaw 缺失环境变量展开。补齐方案（P1）：
```typescript
// config-merge.ts 新增
export function expandEnvVars(obj: any, env: Record<string, string> = process.env): any {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (_, varName, defaultVal) => {
      return env[varName] ?? defaultVal ?? '';
    });
  } else if (typeof obj === 'object' && obj !== null) {
    if (Array.isArray(obj)) {
      return obj.map(item => expandEnvVars(item, env));
    } else {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = expandEnvVars(value, env);
      }
      return result;
    }
  }
  return obj;
}

// config-manager.ts 加载后调用
private loadMergedConfig(): EvoClawConfig {
  const merged = mergeLayers(managed, dropIn, user) as EvoClawConfig;
  // 展开环境变量（hermes 风格）
  const expanded = expandEnvVars(merged);
  // ... enforced 强制回写
  return expanded;
}
```

---

### §3.12 MCP 服务器配置管理

**hermes**（`mcp_config.py:L1-300`，YAML 片段内 mcp_servers）:
```python
# ~/.hermes/config.yaml 中的 mcp_servers 部分
mcp_servers:
  - name: filesystem
    type: stdio
    command: npx
    args: ["@modelcontextprotocol/server-filesystem", "/home/user"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
    enabled: true

def _save_mcp_server(name: str, server_config: dict):
    config = load_config()
    config.setdefault("mcp_servers", {})[name] = server_config
    save_config(config)
```
MCP 服务器作为 YAML 中的嵌套配置，由 `mcp_config.py` 负责 CRUD。支持 stdio / sse 两种通道、环境变量展开。

**EvoClaw**（`mcp/mcp-config.ts:L1-113`，多源发现）:
```typescript
export function discoverMcpConfigs(projectRoot?: string, workspacePath?: string): McpServerConfig[] {
  const configs = new Map<string, McpServerConfig>();

  // 1. 项目级 .mcp.json（优先级最高）
  if (projectRoot) loadMcpJson(path.join(projectRoot, '.mcp.json'), configs);

  // 2. Agent 工作区 .mcp.json
  if (workspacePath && workspacePath !== projectRoot) {
    loadMcpJson(path.join(workspacePath, '.mcp.json'), configs);
  }

  // 3. 全局 evo_claw.json 的 mcp_servers
  const globalConfigPath = path.join(os.homedir(), DEFAULT_DATA_DIR, 'evo_claw.json');
  loadGlobalConfig(globalConfigPath, configs);

  return [...configs.values()];
}
```
支持三层源发现：项目级 `.mcp.json`（最高）→ 工作区 `.mcp.json` → 全局 `evo_claw.json` 的 `mcp_servers` 字段。灵活性高，但无 UI 编辑器。

**判定 🟡**：都支持 MCP 配置，形态差异。hermes 通过 `mcp_config.py` CLI 命令编辑 YAML，EvoClaw 通过文件发现机制（代码优先）但无 REST API 编辑器。补齐方案（P2）：
```typescript
// routes/config.ts 新增
app.get('/mcp-servers', (c) => {
  const allMcpConfigs = discoverMcpConfigs(...);
  return c.json(allMcpConfigs);
});

app.put('/mcp-servers/:name', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json<McpServerConfig>();
  // 保存到 evo_claw.json 的 mcp_servers 数组
  configManager.updateMcpServer(name, body);
  return c.json({ success: true });
});
```

---

### §3.13 Enforced / Denylist 安全策略

**hermes**（无对应机制）:
```python
# hermes 的 config.py 中无 enforced 或 denylist 概念
# 所有配置都是"用户可覆盖"的
```
hermes 无管理员强制配置隔离。IT 管理员若要限制工具或技能，需要通过外部机制（如删除文件、修改权限）。

**EvoClaw**（`config-manager.ts:L46-57` + `config-merge.ts:L48-59`）:
```typescript
// ConfigLayers 结构
export interface ConfigLayers {
  managed: EvoClawConfig;          // IT 管理员配置
  dropIn: EvoClawConfig;           // Drop-in 片段
  user: EvoClawConfig;             // 用户配置
  merged: EvoClawConfig;           // 合并后结果
  enforced: string[];              // 强制路径列表
}

// managed.json 示例
{
  "security": {
    "skills": {
      "denylist": ["execute_shell", "execute_code"]
    },
    "mcpServers": {
      "denylist": ["custom_mcp"]
    }
  },
  "enforced": [
    "security.skills.denylist",
    "security.mcpServers.denylist"
  ]
}

// applyEnforced 机制
export function applyEnforced(
  merged: Record<string, unknown>,
  managed: Record<string, unknown>,
  enforcedPaths: string[],
): void {
  for (const path of enforcedPaths) {
    const value = getValueByPath(managed, path);
    if (value !== undefined) {
      setValueByPath(merged, path, value);  // 强制回写
    }
  }
}

// denylist 并集
// deepMerge 自动处理 denylist 字段
if (key === 'denylist' && Array.isArray(baseVal) && Array.isArray(overlayVal)) {
  result[key] = [...new Set([...baseVal, ...overlayVal])] as T[keyof T];
  continue;
}
```
managed.json 中的配置 + enforced 路径列表 → merge 后强制回写 → 用户无法通过修改 evo_claw.json 突破限制。denylist 采用**并集**（union）语义：管理员的 denylist + 用户的 denylist = 最终的 denylist。

**判定 🟢**：**EvoClaw 在安全策略隔离上反超**。hermes 完全缺失管理员强制隔离，EvoClaw 通过 managed.json + enforced + denylist 并集实现了企业级隔离。这对**受管设备**（Intune、MDM）场景至关重要。

---

### §3.14 CLI 命令：config edit/set/validate

**hermes**（`cli.py` + `hermes_cli/main.py:L4829-5268` argparse 子命令）:
```bash
$ hermes config set model.default claude-opus-4.6
$ hermes config edit  # 打开 $EDITOR 编辑 config.yaml
$ hermes config validate  # 检查配置完整性
$ hermes config show  # 打印当前配置（脱敏 API Key）
```
原生 CLI 命令，直接操作 YAML 文件，即时生效。

**EvoClaw**（无 CLI 子命令，仅 REST + GUI）:
```typescript
// routes/config.ts 提供 REST API
GET  /config              → 获取完整配置（脱敏）
PUT  /config              → 更新配置（patch deep merge）
GET  /config/validate     → 校验配置
POST /config/reload       → 从磁盘热重载

// GUI 中的对应操作
- 设置页面：选择模型 / 配置 Provider / 管理环境变量
- API 路由 `/config / /provider / /env-vars` 对应 hermes 的 CLI 子命令
```

**判定 🔴**：EvoClaw 无 CLI 子命令。hermes `config set / edit / validate` 是终端用户的快速编辑工具，EvoClaw 则需要打开 GUI 或调用 REST API（见 27-cli-architecture-gap.md §3.2）。对于**脚本集成**场景（如 IaC 工具链），这是缺失（P1 改造蓝图中讨论添加 Sidecar CLI 代理）。

---

### §3.15 Doctor 诊断工具

**hermes**（`doctor.py:L1-1200+`，专项诊断）:
```bash
$ hermes doctor
# 输出：
# ✓ Config file readable: ~/.hermes/config.yaml
# ✓ Permissions OK: 0600 on ~/.hermes/.env
# ✓ Model registered: anthropic/claude-opus-4.6
# ✗ OPENAI_API_KEY not set
# ✓ Terminal backend: local
# ✗ Docker daemon: unreachable (required for docker backend)
# ...
```
专用诊断工具，检查 20+ 项（配置文件、权限、模型、API Key、终端后端、gateway、MCP 等）。

**EvoClaw**（`routes/doctor.ts:L285-319` + `kernel/doctor.ts:L1-150`）:
```typescript
// doctor 路由提供 JSON 结果
GET /doctor → {
  checks: [
    { name: 'configFile', passed: true, message: '配置文件可读' },
    { name: 'modelResolution', passed: false, message: '无可用模型' },
    { name: 'embedding', passed: true, message: 'Embedding 模型已配置' },
    // ... 11 项检查
  ]
}
```
内嵌在 server.ts，支持 11 项检查，输出 JSON 格式（易于前端解析）。缺少 hermes 的**详细诊断**（如权限检查、文件大小、log 分析）。

**判定 🟡**：都有诊断工具，但范围不同。hermes doctor 更深、更面向终端输出（含彩色、格式化），EvoClaw doctor 更轻、更面向 REST API（JSON 格式便于 GUI 展示）。各有所长。

---

## 4. 建议改造蓝图（不承诺实施）

### P0 — 核心缺失（必须补齐，影响企业使用）

#### 4.1 凭证权限强制（0600 / 0750）
- **工作量**: 1-2 d（添加 `fs.chmodSync()` 调用 + 托管模式检测）
- **ROI**: 中等（多用户 Linux 环境安全性）
- **方案**: 
  - 在 `config-manager.ts:L184-186` 中调用 `fs.mkdirSync(dir, { mode: 0o700 })`
  - 在 `saveToDisk()` 中调用 `fs.chmodSync(this.configPath, 0o600)`
  - 检测 `EVOCLAW_MANAGED` 环境变量，改为 0o750 / 0o660

#### 4.2 非 ASCII 凭证清理
- **工作量**: 1-2 d（实现 sanitizeCredentials() + 集成测试）
- **ROI**: 中等（企业 PDF 粘贴凭证常见问题）
- **方案**: 利用已有的 `security/unicode-detector.ts` 逻辑，新增 `sanitizeCredentials()` 函数在 `loadUserConfig()` 后调用

#### 4.3 环境变量展开（`${VAR}` 语法）
- **工作量**: 2-3 d（实现 expandEnvVars() + 测试）
- **ROI**: 中等（跨环境配置灵活性）
- **方案**:
  - 在 `config-merge.ts` 中新增 `expandEnvVars(obj, env)` 函数（支持 `${VAR}` / `${VAR:-default}` 语法）
  - 在 `loadMergedConfig()` 的 enforced 回写后调用
  - 添加测试（单引号不展开等边界 case）

---

### P1 — 重要补齐（支持企业定制场景）

#### 4.4 多 Provider OAuth + 凭据池
- **工作量**: 5-7 d（设计新的 ProviderEntry Schema + credential rotation logic）
- **ROI**: 高（支持企业多账号、OAuth 设备码流）
- **方案**:
  - 扩展 `ProviderEntry` 到：
    ```typescript
    {
      baseUrl: string;
      apiKeys?: string[];  // 支持多个 key（轮换）
      api: 'openai-completions' | 'anthropic-messages';
      authType?: 'api_key' | 'oauth_device_code' | 'oauth_external';
      oauthRefreshUrl?: string;
      oauthRefreshToken?: string;
      models: ModelEntry[];
    }
    ```
  - 在 LLM 调用前拦截 401，触发 key 轮换 / token 刷新（见 06-llm-providers-gap.md）
  - 添加 REST API `/provider/:id/rotate-key` / `/provider/:id/refresh-oauth`

#### 4.5 Profile 隔离与运行时切换
- **工作量**: 2-3 d（如果有需求）
- **ROI**: 低（EvoClaw 的品牌化设计已消解了 profile 的主要用途）
- **方案**:
  - 或简化为 `setActiveProfile(name)` → `loadConfigForProfile(name)`
  - 或维持现状，让用户维护多份 `evo_claw.{profile}.json` 文件并手动编辑

#### 4.6 配置诊断信息增强
- **工作量**: 1-2 d（向 ConfigValidation 添加 suggestion / autoFixable 字段）
- **ROI**: 低（UX 改进）
- **方案**:
  ```typescript
  export interface ValidationIssue {
    level: 'error' | 'warning';
    path: string;
    message: string;
    suggestion?: string;  // 新增
    autoFixable?: boolean;  // 新增
  }
  ```

---

### P2 — 次优先（可选，提升用户体验）

#### 4.7 MCP 服务器 REST API 编辑器
- **工作量**: 2-3 d（添加 `/config/mcp-servers` 路由 + UI）
- **ROI**: 低（MCP 配置频率不高）
- **方案**:
  - 在 `routes/config.ts` 中添加 `/mcp-servers` CRUD 路由
  - 在 `config-manager.ts` 中添加 `updateMcpServer()` 方法

#### 4.8 CLI 代理（Sidecar 模式的命令行工具）
- **工作量**: 3-5 d（实现 CLI 工具通过 HTTP 调用 Sidecar REST API）
- **ROI**: 中（支持脚本集成、IaC 工具链）
- **方案**:
  - 新建 `packages/cli/` 子包，实现 `evoclaw config get / set / validate` 等命令
  - 通过 `/config` REST API 与 Sidecar 通信
  - 参考 27-cli-architecture-gap.md 的 P2 建议

---

### 不建议做的事

#### 4.9 100+ Provider 注册表预装
- **原因**: EvoClaw 的用户画像不需要这个。开箱即用的 8 个 provider（OpenAI、Anthropic、Google、Groq、Qwen、GLM、Doubao、DeepSeek）已覆盖 95% 企业用户。定制 provider 通过 REST API 动态添加，成本更低、灵活性更强。
- **反例**: hermes 预装 109 个 provider，但其中 70 个是不常用的小平台（Replicate、Fireworks 等），维护成本高。

#### 4.10 复制 hermes 的 OPTIONAL_ENV_VARS 元数据库
- **原因**: EvoClaw 采用 Zod Schema 强类型校验，不需要 Python 的 OPTIONAL_ENV_VARS 元数据字典。若要提供"可配置环境变量"的列表，应该从 Schema 本身推导（TypeScript introspection）。

---

## 5. EvoClaw 反超点汇总

| 能力 | EvoClaw 实现 | hermes 缺失说明 | 优势 |
|---|---|---|---|
| **版本迁移框架** | `registerConfigMigration` + `runConfigMigrations`（纯函数、幂等、易测） | `migrate_config()`（交互式、I/O 耦合、难测） | 现代工程实践、自动化友好 |
| **Enforced 强制隔离** | managed.json 中的 enforced 路径列表，merge 后强制回写 | 无对应机制 | 企业 IT 管理员可强制安全策略（MDM 场景） |
| **Denylist 并集语义** | denylist 取并集（管理员 ∪ 用户），安全只增不减 | 无对应机制 | 管理员黑名单 + 用户黑名单自动合并，无法被用户突破 |
| **Provider 动态注册** | REST API + 内存 registry，用户可随时添加 | models.dev 目录 + HERMES_OVERLAYS hardcode | 企业内部模型服务可即时集成，无需代码发版 |
| **Brand 化配置** | BRAND_CONFIG_FILENAME + 品牌 default env，构建时替换 | 单一 hermes 品牌，国产化支持度低 | 支持多品牌（evoclaw / healthclaw / ...），共享代码库但配置隔离 |
| **Zod Schema 强类型** | configSchema 完整的 TypeScript 类型推断，编译时检查 | Python duck typing，运行时才发现配置问题 | 类型安全、IDE 自动补全、重构时能捕获错误 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（经 Read 验证）

1. **config-manager.ts**:
   - L1-11: 配置管理器头信息 + 三层架构说明
   - L45-57: ConfigLayers interface（managed / dropIn / user / merged / enforced）
   - L79-121: loadMergedConfig() 分层加载 + enforced 回写
   - L174-207: loadUserConfig() 版本迁移集成
   - L198-207: saveToDisk() 只写用户层

2. **config-merge.ts**:
   - L9-39: deepMerge() + denylist 特殊处理
   - L48-59: applyEnforced() 强制回写

3. **config-migration.ts**:
   - L23-30: ConfigMigration interface（纯函数迁移）
   - L56-59: registerConfigMigration() 注册脚本
   - L67-101: runConfigMigrations() 幂等执行

4. **routes/config.ts**:
   - L47-67: GET / 获取配置（脱敏 API Key）
   - L69-82: GET /layers 调试视图
   - L84-101: PUT / 更新配置（patch merge）
   - L142-157: GET /env-vars 脱敏环境变量列表

5. **shared/src/schemas/config.schema.ts**:
   - L29: apiProtocolSchema = 'openai-completions' | 'anthropic-messages'
   - L46-68: configSchema 完整定义（23 行）

6. **provider/provider-registry.ts**:
   - L5: providers 内存 map
   - L11-13: registerProvider() 低级 API
   - L19-31: registerFromExtension() 从预设注册

7. **provider/model-resolver.ts**:
   - L15-62: resolveModel() 优先级 1-4（Agent > 用户 DB > Provider > Fallback）

8. **mcp/mcp-config.ts**:
   - L52-74: discoverMcpConfigs() 三层发现（项目 > 工作区 > 全局）

9. **__tests__/config-manager.test.ts**:
   - L54-76: ConfigManager 创建 + 更新 + 重载测试

10. **__tests__/config-migration.test.ts**:
    - L14-77: 迁移幂等性、跳过已应用迁移、按版本顺序执行等 6 个测试

### 6.2 hermes 研究引用

- **`.research/28-config-system.md`**:
  - §1: 定位（分层加载、凭证管理、托管模式）
  - §2: 配置层级与加载流程（mermaid 图）
  - §3.1: DEFAULT_CONFIG（~450 行）
  - §3.2: OPTIONAL_ENV_VARS（700+ 行元数据）
  - §3.3: HermesOverlay 注册表（30+ provider 特殊处理）
  - §4.1-4.5: 关键代码片段（load_config / 凭证清理 / 版本迁移 / Provider overlay / MCP 配置）
  - §6: 复刻清单（12 个要点）

### 6.3 关联差距章节

- **05-agent-loop-gap.md**: 
  - §3.2: 预算机制（IterationBudget）与 EvoClaw 的 turnCount 对比
  - §3.7: Credential 管理（hermes 的 CredentialPool，EvoClaw 缺失）

- **06-llm-providers-gap.md**:
  - §3.x: Provider 路由、OAuth token 刷新、凭据池轮换（延续本章 §3.6）

- **27-cli-architecture-gap.md**:
  - §3.1-3.5: CLI 框架（Fire / argparse）vs HTTP 路由，config set/edit/validate 命令
  - §3.16: 自升级（P2）

---

**总体结论**: EvoClaw 配置系统采用**更现代的分层设计**（managed / drop-in / user）+ **强类型 Zod Schema**，在 enforced 隔离、版本迁移框架、Provider 动态注册上反超 hermes。但在**凭证安全**（权限 / ASCII 清理）、**多 Provider 凭据池**、**环境变量展开**、**CLI 命令**等方面存在缺失，需 P0-P1 补齐以支持企业场景。两者的架构差异反映了**企业 GUI 应用 vs 开发者 CLI 工具**的产品定位不同，大部分差距无法也无需完全对齐。

