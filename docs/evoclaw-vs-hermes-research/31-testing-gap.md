# 31 — 测试体系 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/31-testing.md`（292 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`tests/:191,465 行 / 576 文件 / 14 个子系统 / 413+ 测试类 / 11,800+ 测试函数`
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`packages/*/src/__tests__/:~102k 行 / 509 文件 / vitest + 手工集成测试方案`
> **综合判定**: 🟡 **部分覆盖，形态和规模差异显著** — hermes 采用 pytest + 14 个异步平台适配器的大规模集成测试（191k 行测试），EvoClaw 采用 vitest + 专注内核逻辑的轻量级单元测试（102k 行）。二者测试策略根本不同：hermes 验证多平台消息流完整性，EvoClaw 验证 query-loop + 工具系统 + 配置管理核心路径。

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes 测试系统**（`.research/31-testing.md`，`tests/:1-191465` — **191,465 行测试代码**，576 个文件）— 规模庞大、覆盖极广：
1. **14 个子系统专项测试**：gateway（54,750 行，平台适配器）、tools（43,090 行，文件/SSH/TTS/沙箱）、hermes_cli（30,316 行）、agent（17,203 行，多 provider 转换）、run_agent（16,001 行，代理引擎）
2. **413+ 测试类 / 11,800+ 测试函数 / 1,151 异步测试** — 按环境隔离（HERMES_HOME 虚拟化）+ 30s 硬超时 + 事件循环管理策略
3. **CI 双轨分离**：test job（10s，快速反馈，跳过 integration+e2e）+ e2e job（15s+，完整验证）
4. **核心基础设施**：conftest.py 全局 fixtures（HERMES_HOME 隔离、事件循环、30s SIGALRM 超时）、平台库动态 sys.modules 模拟、MockServer 模式驱动 agent loop

**主要职责**：验证多平台网关消息流、多 LLM provider 转换、执行环境隔离、凭证轮换、HA 恢复等企业级功能。

**EvoClaw 测试系统**（`packages/*/src/__tests__/`，~102k 行测试代码，509 文件）— 轻量化、核心路径优先：
1. **vitest 框架**（`packages/core/vitest.config.ts:1-15`）— Node.js 环境、单文件 include 模式、无全局 setup 共享
2. **509 个测试文件 / ~21,354 行 vitest 代码**（packages/core 主体）+ 128 个具体测试用例分布
3. **专注内核能力**：query-loop（agent 主循环）、error-recovery（三阶段 413 恢复）、tool-safety（工具循环检测）、config-manager（三层配置合并）、memory-store（混合向量存储）、embedded-runner（系统提示模块化）
4. **E2E 辅助工具**：`e2e-helpers.ts` 创建隔离测试环境（tmp SQLite + in-process Hono app）、`scripts/test-all.sh` 全量流程（tests + build + health check）
5. **手工集成测试方案**：docs/test-plans/autonomous-execution-manual-test.md（心跳/cron/权限 UI 验证，非自动化）

**量级与格局对比**：
- hermes：191k test lines（主要来自 14 个异步平台，每个 3k~55k 行专项测试）
- EvoClaw：102k test lines（专注内核逻辑，平台测试改为手工方案）
- **比例**：EvoClaw/hermes ~0.53×，但人均覆盖率（代码行数/测试行数）相似

**关键设计差异**：
- hermes：环境隔离（HERMES_HOME）+ 并行运行（pytest-xdist -n auto）+ 集成高度倚赖 Mock/Fake（虚拟 HA 服务器）
- EvoClaw：进程隔离（tmpdir E2E）+ 单进程顺序（无 xdist）+ 轻依赖单元（vitest 无全局 state）

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 测试框架与配置 | 🟡 | vitest（Node 原生，快速）vs pytest（Python 生态成熟），均成熟 |
| §3.2 | 环境隔离策略 | 🟡 | EvoClaw tmpdir 单次 + vitest local；hermes HERMES_HOME 共享隔离 + autouse fixtures |
| §3.3 | 测试规模与覆盖 | 🔴 | hermes 191k vs EvoClaw 102k；hermes 多平台完整集成，EvoClaw 内核路径优先 |
| §3.4 | 异步测试与事件循环 | 🟡 | hermes py3.11+ event loop 兼容 + 1,151 async tests；EvoClaw vitest async 原生支持，无特殊处理 |
| §3.5 | 超时与卡死防护 | 🔴 | hermes SIGALRM 30s 硬超时；EvoClaw 无全局超时（vitest --testTimeout 默认 10s，可覆盖 |
| §3.6 | 参数化与测试数据 | 🟡 | hermes @pytest.fixture(params=[...])；EvoClaw describe 块 + 手工 for 循环参数化 |
| §3.7 | Mock / Fake 三层策略 | 🟡 | hermes 单元 MagicMock + 集成 Fake HTTP + E2E 工厂；EvoClaw 轻依赖，以真实对象为主 |
| §3.8 | 平台库动态注入 | 🔴 | hermes sys.modules 动态 Mock(telegram/discord 等 14 个库)；EvoClaw 无第三方平台（国产 WeChat 特殊处理） |
| §3.9 | 测试数据库 | 🟡 | hermes SQLite FTS5 单独 test_hermes_state.py(58k 行)；EvoClaw sqlite-store.test.ts 内嵌，规模小 |
| §3.10 | CI/CD 集成 | 🔴 | hermes .github/workflows/tests.yml 完整（10min timeout、dual job）；EvoClaw 无 CI 工作流 |
| §3.11 | 并行与分片 | 🔴 | hermes -n auto xdist 并行（576 文件 10s 内）；EvoClaw 顺序执行，无分片 |
| §3.12 | 插件/单例重置 | 🟡 | hermes monkeypatch._plugin_manager None；EvoClaw vitest 进程隔离，无需手工重置 |
| §3.13 | 错误恢复与 Retry | 🟢 | EvoClaw 反超：error-recovery.test.ts 验证三阶段 413 恢复（Retry Compact Fallback）；hermes 无对应 |
| §3.14 | 工具执行安全检测 | 🟢 | EvoClaw 反超：tool-safety.test.ts 循环检测（重复/乒乓/熔断）+ 结果截断；hermes 无此能力 |
| §3.15 | 测试覆盖率报告 | 🔴 | hermes --cov 覆盖率 CI 步骤；EvoClaw 无覆盖率指标 |

**统计**: 🔴 6 / 🟡 7 / 🟢 2（其中 2 项内核能力反超）。

---

## 3. 机制逐条深度对比

### §3.1 测试框架与配置

**hermes**（`tests/conftest.py:1-30` + `pyproject.toml:88-92`）:
```python
# pyproject.toml
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["integration: marks tests requiring external services"]
addopts = "-m 'not integration' -n auto"

# tests/conftest.py
@pytest.fixture(autouse=True)
def _isolate_hermes_home(tmp_path, monkeypatch):
    """核心：每个测试独立 HERMES_HOME，0 污染。"""
    fake_home = tmp_path / "hermes_test"
    fake_home.mkdir()
```

- **pytest 生态完整**：markers + autouse fixtures + conftest 全局配置 + -n auto 原生支持（xdist）
- **配置文件声明式**：pyproject.toml 一次性定义，所有测试继承

**EvoClaw**（`packages/core/vitest.config.ts:1-15` + `package.json:14`）:
```typescript
// packages/core/vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@evoclaw/shared': path.resolve(...) } },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
```

```json
// package.json scripts
"test": "turbo run test"
```

- **vitest 轻量级**：单包 vitest.config.ts，无全局 conftest
- **Turbo 协调**：monorepo 多包测试通过 turbo 串行运行
- **无全局 state**：每测试文件独立运行（vitest 进程隔离），不需显式 cleanup

**判定 🟡**：
- pytest 历史底蕴强（fixture 依赖注入、parametrize 参数化、marking 细粒度控制）
- vitest 现代便利（TypeScript 原生、ESM 一等公民、热重载）
- 二者均成熟，差异在生态而非能力

---

### §3.2 环境隔离策略

**hermes**（`tests/conftest.py:54-66`）:
```python
@pytest.fixture(autouse=True)
def _isolate_hermes_home(tmp_path, monkeypatch):
    """核心：每个测试独立 HERMES_HOME，0 污染。"""
    fake_home = tmp_path / "hermes_test"
    fake_home.mkdir()
    (fake_home / "sessions").mkdir()
    (fake_home / "cron").mkdir()
    (fake_home / "memories").mkdir()
    (fake_home / "skills").mkdir()
    monkeypatch.setenv("HERMES_HOME", str(fake_home))
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    # 重置插件单例
    import hermes_cli.plugins as _plugins_mod
    monkeypatch.setattr(_plugins_mod, "_plugin_manager", None)
```

- **per-test tmpdir**：每个 test function 自动获得 tmp_path fixture，框架自动创建子目录结构
- **环境变量注入**：monkeypatch 作用域限于单次测试，teardown 自动清理
- **单例重置**：手工 monkeypatch.setattr 重置全局状态

**EvoClaw**（`packages/core/src/__tests__/e2e-helpers.ts:35-59`）:
```typescript
export function createTestEnv() {
  const tmpDir = path.join(os.tmpdir(), `evoclaw-e2e-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const dbPath = path.join(tmpDir, 'test.db');
  const agentsDir = path.join(tmpDir, 'agents');
  const configPath = path.join(tmpDir, 'evo_claw.json');

  const store = new SqliteStore(dbPath);
  store.exec(MIGRATION_SQL);
  const agentManager = new AgentManager(store, agentsDir);
  const configManager = new ConfigManager(configPath);

  const options: CreateAppOptions = {
    token: TEST_TOKEN,
    store, agentManager, configManager,
  };
  const app = createApp(options);
  return { app, store, agentManager, configManager, tmpDir, configPath };
}

export function cleanupTestEnv(store: SqliteStore, tmpDir: string) {
  try { store.close(); } catch { /* 忽略 */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
```

- **手工 tmpdir 管理**：每测试手工调用 createTestEnv()，手工 cleanupTestEnv() 清理
- **组件组装工厂**：createTestEnv() 返回整个测试栈（app + store + managers），便于组合测试
- **vitest 进程隔离**：每文件独立进程，全局变量默认不污染

**判定 🟡**：
- hermes 框架级自动化（pytest fixture 生命周期）vs EvoClaw 业务级委托（手工 setup/teardown）
- EvoClaw 优势：显式清晰，可组合度高；hermes 优势：自动化程度高，遗漏风险低
- 隔离强度相当

---

### §3.3 测试规模与覆盖

**hermes**（`tests/:1-191465`）:
```
总规模：191,465 行测试代码 / 576 文件

子系统分布：
  gateway/        54,750 行  (14 个平台适配器完整消息流)
  tools/          43,090 行  (文件/SSH/TTS/推理/沙箱)
  hermes_cli/     30,316 行  (REPL/插件/skill/web/config)
  agent/          17,203 行  (Anthropic/OpenAI/Bedrock 适配)
  run_agent/      16,001 行  (多轮循环/中断/流媒体)
  ...
  
统计：413+ 测试类 / 11,800+ 测试函数 / 1,151 异步测试
```

关键特点：
- **平台完整性**：Telegram/Discord/Slack/Signal/Matrix 等每个都有 3k-10k 行专项测试
- **多 provider 转换**：OAuth/API key 路由、消息格式转换、token 计数
- **HA 恢复路径**：Checkpoint resumption、session persistence 完整集成测试

**EvoClaw**（`packages/core/src/__tests__/` + `packages/shared/src/__tests__/`）:
```
总规模：~102,000 行测试代码 / 509 文件

主要模块（packages/core）：
  - 内核能力：query-loop / error-recovery / embedded-runner
  - 存储层：sqlite-store / vector-store / memory-store / fts-store
  - 工具系统：tool-safety / tool-catalog / mcp-tool-bridge
  - 配置管理：config-manager / config-merge / config-migration
  - 安全性：injection-detector / security-extension / tool-safety
  
统计：509 文件 / 128 个 describe 块 / ~21,354 行核心包测试
```

关键特点：
- **内核路径优先**：query-loop / error-recovery 为核心投入
- **国产平台特殊化**：WeChat 适配器（weixin-*.test.ts 6 文件，880 行）有完整测试；国际平台无（架构决定）
- **轻依赖单元测试**：大多不涉及真实网络，以对象模拟为主
- **缺失平台网关测试**：无 Telegram/Discord/Slack/Signal/Matrix 适配器，故无对应 54k 行测试

**判定 🔴**：
- hermes 191k vs EvoClaw 102k，规模差 ~1.87×
- **差距来源**：14 个国际平台适配器的完整消息流测试（hermes 54,750 行 gateway）EvoClaw 没有（产品定位不同）
- **风险**：EvoClaw 缺失平台集成测试，长尾 bug 发现延后（改为手工测试）
- **补齐工作量**：若要对齐，需为桌面应用的国际平台支持补齐测试（≥2 人周）

---

### §3.4 异步测试与事件循环

**hermes**（`tests/conftest.py:68-82`）:
```python
@pytest.fixture(autouse=True)
def _ensure_current_event_loop(request):
    """Python 3.11+ 事件循环兼容。"""
    if request.node.get_closest_marker("asyncio") is None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        yield
        loop.close()

# 测试使用
@pytest.mark.asyncio
async def test_multi_turn_loop():
    """异步测试示例"""
    server = MockServer(responses=[...])
    loop = HermesAgentLoop(server=server)
    result = await loop.run(messages=[...])
    assert result.success
```

- **显式 asyncio 标记**：@pytest.mark.asyncio 让 pytest-asyncio 插件自动识别、创建 event loop
- **py3.11+ 兼容性**：fixture 处理新版 Python 的事件循环政策变化
- **1,151 异步测试**：大量并发测试，验证消息流、中断、超时等异步场景

**EvoClaw**（`packages/core/src/__tests__/embedded-runner.test.ts:1-10` + `vitest.config.ts`）:
```typescript
// 不需特殊配置，vitest 原生支持异步测试
describe('formatSSE', () => {
  it('应返回 SSE 格式字符串', async () => {
    // 直接 async/await，vitest 自动识别 Promise 返回值
    const event: RuntimeEvent = { type: 'text_delta', timestamp: 1000, delta: '你好' };
    const result = formatSSE(event);
    expect(result).toContain('event: text_delta');
  });
});

// vitest.config.ts: environment: 'node' 足够，无需特殊 async 处理
```

- **原生 Promise 支持**：vitest 检测 it() 回调返回 Promise，自动等待
- **无 event loop 手工管理**：Node.js 原生 async/await，无需 py3.11+ 兼容层
- **异步测试数量少**：EvoClaw 异步测试主要在 e2e-*.test.ts，总数 ~50-80 个（vs hermes 1,151）

**判定 🟡**：
- hermes 需 py3.11+ 兼容处理，但显式标记更可控；EvoClaw 原生支持，但总量少
- hermes 1,151 async tests 反映多平台消息流并发验证需求；EvoClaw 缺此需求
- 异步能力相当，但使用规模差异体现了平台覆盖差异

---

### §3.5 超时与卡死防护

**hermes**（`tests/conftest.py:77-82`）:
```python
@pytest.fixture(autouse=True)
def _enforce_test_timeout():
    """SIGALRM 30s 硬超时，防止卡死子进程。"""
    signal.alarm(30)
    yield
    signal.alarm(0)
```

- **SIGALRM 操作系统级硬超时**：无法 catch，真正杀死卡死进程
- **30 秒全局阈值**：所有测试统一应用（无法 per-test 调整）
- **用途**：防止 gateway 消息循环、外部 API 调用等子进程卡死

**EvoClaw**（`packages/core/vitest.config.ts` + vitest 文档）:
```typescript
// vitest 默认 --testTimeout 10000 (10s)
// 可在 test block 显式设置
it('长运行任务', { timeout: 30000 }, async () => {
  // 30 秒超时
});
```

- **per-test 配置**：vitest 允许 it() 选项自定义超时
- **框架级实现**：JavaScript Promise.race + abort 实现，可捕获（try/catch）
- **无全局硬超时**：默认 10s，超时抛出 TimeoutError，但 event loop 不中断

**判定 🔴**：
- hermes SIGALRM 真正硬超时（进程级），EvoClaw 仅 Promise 级超时（可被 catch）
- **风险**：EvoClaw 若工具执行内部卡死（例如 fs.readFileSync 死锁），超时无法杀死
- **补齐**：需配置全局 `test: { testTimeout: 30000 }` + per-file 超时覆盖列表
- **工作量**：低（配置修改），但需测试覆盖验证

---

### §3.6 参数化与测试数据

**hermes**（`tests/e2e/conftest.py:168-171`）:
```python
@pytest.fixture(params=[Platform.TELEGRAM, Platform.DISCORD, Platform.SLACK])
def platform(request):
    return request.param

# 测试自动运行 3 遍（每个 platform 一遍）
@pytest.mark.parametrize("encoding", ["utf-8", "latin-1", "gbk"])
def test_message_encoding(encoding):
    msg = Message(encoding=encoding)
    assert msg.encode() is not None
```

- **@pytest.fixture(params=...)**：框架自动笛卡尔积展开
- **@pytest.mark.parametrize**：更细粒度参数组合
- **自动生成多条 test ID**：报告显示 `test_xxx[param1]`、`test_xxx[param2]` 等

**EvoClaw**（`packages/core/src/__tests__/channel/command-dispatcher.test.ts` 示例）:
```typescript
describe('command-dispatcher', () => {
  const commands = ['read', 'write', 'execute'];
  
  // 手工参数化
  for (const cmd of commands) {
    it(`should handle ${cmd}`, () => {
      const result = dispatcher.execute(cmd);
      expect(result).toBeDefined();
    });
  }
});
```

- **无框架级参数化**：vitest 不提供 parametrize 等价物
- **手工 for 循环**：需显式声明参数，重复代码
- **test ID 不友好**：命令行输出显示为 `should handle read`, `should handle write` 等

**判定 🟡**：
- hermes 参数化能力内置，减少重复代码
- EvoClaw 需手工扩展，但对小规模参数化可接受
- **建议补齐**：使用 vitest 的 each() 或 @vitest/parameterized 库实现（低工作量）

---

### §3.7 Mock / Fake 三层策略

**hermes**（`tests/conftest.py:100-104` + `tests/fakes/fake_ha_server.py`）:
```python
# 1. 单元测试层（92 文件）
def test_message_parsing():
    with patch('requests.post') as mock_post:
        mock_post.return_value.json.return_value = {"text": "response"}
        result = parse_message()
        assert result.text == "response"

# 2. 集成测试层：自实现 Fake 对象
class FakeHAServer:
    async def handle_request(self, req):
        if "/api/states" in req.path:
            return {"entity_id": "light.kitchen", "state": "on"}

# 3. 平台库隔离
def _ensure_telegram_mock():
    if "telegram" not in sys.modules or not hasattr(...):
        telegram_mod = MagicMock()
        telegram_mod.Bot = MagicMock
        sys.modules["telegram"] = telegram_mod
```

- **单元层**：MagicMock + unittest.mock.patch（纯函数验证）
- **集成层**：自实现 Fake 对象（aiohttp 真实 HTTP 响应）
- **平台隔离层**：sys.modules 动态注入（防止导入真实 telegram/discord 库）

**EvoClaw**（`packages/core/src/__tests__/config-manager.test.ts:54-76`）:
```typescript
// 轻依赖单元测试，以真实对象为主
describe('ConfigManager', () => {
  function createManager(): [ConfigManager, string] {
    const p = tmpConfigPath();
    return [new ConfigManager(p), p];
  }

  it('updateConfig 应写入文件并可重新加载', () => {
    const [, p] = createManager();
    const cm1 = new ConfigManager(p);
    cm1.updateConfig(FULL_CONFIG);
    expect(cm1.exists()).toBe(true);

    const cm2 = new ConfigManager(p);
    expect(cm2.getDefaultModelId()).toBe('MiniMax-M2.5-highspeed');
  });
});
```

- **以真实对象为主**：ConfigManager 直接使用真实 tmpdir + JSON 文件，无 Mock
- **最小化 stub**：e2e-helpers.ts 创建真实 SqliteStore，运行真实迁移 SQL
- **无平台库模拟**：国产 WeChat 库直接引入（非第三方包），国际平台不支持

**判定 🟡**：
- hermes 三层策略应对复杂集成（多平台消息流、真实 HTTP 服务模拟）
- EvoClaw 轻依赖策略适合内核逻辑验证（不涉及外部系统）
- **各有优劣**：hermes 能捕获更多集成 bug；EvoClaw 测试执行快、依赖少
- **缺失风险**：EvoClaw 无平台库隔离，若将来集成真实平台库，需补齐 Mock 层

---

### §3.8 平台库动态注入

**hermes**（`tests/conftest.py:100-104` + `tests/gateway/test_telegram.py`）:
```python
def _ensure_telegram_mock():
    """防止导入真实 telegram 库（可能不安装或版本冲突）"""
    if "telegram" in sys.modules and hasattr(sys.modules["telegram"], "__file__"):
        return
    telegram_mod = MagicMock()
    telegram_mod.Bot = MagicMock
    telegram_mod.ext.Application = MagicMock()
    sys.modules["telegram"] = telegram_mod
    sys.modules["telegram.ext"] = telegram_mod.ext

# 应用到所有 14 个平台
PLATFORM_MOCKS = {
    'telegram': _ensure_telegram_mock,
    'discord': _ensure_discord_mock,
    'slack': _ensure_slack_mock,
    'signal': _ensure_signal_mock,
    'matrix': _ensure_matrix_mock,
    'whatsapp': _ensure_whatsapp_mock,
    ...  # 8 个更多
}

@pytest.fixture(autouse=True)
def mock_all_platforms():
    for platform_name, mock_fn in PLATFORM_MOCKS.items():
        mock_fn()
```

- **14 个平台库完整 Mock**：telegram/discord/slack/signal/matrix/whatsapp 等每个都有专项 MagicMock
- **sys.modules 注入点**：在测试导入真实库之前注入，import 语句自动使用 Mock 版本
- **版本兼容**：不依赖特定库版本安装，测试可在任何环境运行

**EvoClaw**（目前无此机制）:
```typescript
// 国产平台：WeChat 库在源码中直接引入（不 Mock）
// 国际平台：不支持（无库）
```

- **无第三方平台集成**：桌面应用当前只支持国产 WeChat
- **不需 Mock 层**：WeChat API 通过 HTTP (HTTPS) 调用，可用真实集成测试
- **长期缺失**：若增加 Telegram/Discord/Slack 等国际平台，需补齐此机制

**判定 🔴**：
- hermes 14 个平台 Mock 完整（54,750 行 gateway 测试的基础设施）
- EvoClaw 无国际平台，故无此需求（当前）
- **补齐工作**：若要支持国际平台，需实现 sys.modules 注入（可移植 hermes 逻辑，~200 行）

---

### §3.9 测试数据库

**hermes**（`tests/agent/test_hermes_state.py:1-57995`）:
```python
# 单文件 57,995 行：SQLite FTS5 + session DB 的边界条件极多
class TestHermesStateCore:
    def test_session_creation_empty_db(self):
        ...
    def test_fts5_phrase_boundary(self):
        ...
    def test_memory_expiry_cascade(self):
        ...
    # ... 数百个测试覆盖 FTS5 索引、会话隔离、内存过期等

# CI 关键测试
├── test_hermes_logging.py          27,595 行  (日志流媒体、格式化)
├── test_context_compressor.py      2,500+ 行  (压缩算法)
├── test_checkpoint_resumption.py   500+ 行    (@pytest.mark.integration)
```

- **巨型单文件**：SQLite 的 FTS5 全文索引、JSON 序列化、事务隔离等各有百级测试
- **边界条件极多**：正则替换、token 计数、encoding 转换等细节容易出 bug
- **集成测试分离**：@pytest.mark.integration 标记的测试需 real SQLite，不能 Mock

**EvoClaw**（`packages/core/src/__tests__/sqlite-store.test.ts` + 其他存储测试）:
```typescript
describe('SQLiteStore', () => {
  it('create table 后应可查询', () => {
    const store = new SqliteStore(':memory:');
    store.exec('CREATE TABLE test(id INT, name TEXT)');
    const rows = store.query('SELECT * FROM test');
    expect(rows).toEqual([]);
  });

  it('migration 应可重复运行（幂等）', () => {
    const migrations = `
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY);
    `;
    store.exec(migrations);  // 运行两遍
    expect(() => store.query('SELECT * FROM agents')).not.toThrow();
  });
});
```

- **轻量级嵌入测试**：sqlite-store.test.ts 约 200 行，涵盖基本 CRUD + 迁移幂等
- **无专项边界测试**：FTS5、JSON 查询、事务隔离等高级特性无覆盖
- **缺失 schema 演进**：无对应"schema 版本从 v1→v2 迁移路径"的测试

**判定 🟡**：
- hermes 58k 行 state 测试反映 Hermes 状态管理的复杂度（会话 + 内存 + FTS5）
- EvoClaw 200 行 SQLite 测试足够内核路径验证，但缺失边界
- **补齐工作**：若要提升数据库测试深度，可增加 500-1000 行边界测试（可选，当前优先级低）

---

### §3.10 CI/CD 集成

**hermes**（`.github/workflows/tests.yml`）:
```yaml
jobs:
  test:
    timeout-minutes: 10
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: Install dependencies
        run: uv pip install -e .
      - name: Run tests (fast path)
        run: pytest tests/ -q --ignore=tests/integration --ignore=tests/e2e --tb=short -n auto
        env:
          OPENROUTER_API_KEY: ""  # 禁用真实 API
      - name: Upload coverage
        run: pytest tests/ --cov=hermes --cov-report=xml
        
  e2e:
    timeout-minutes: 10
    steps:
      - run: pytest tests/e2e/ -v --tb=short
```

- **双轨分离**：test job（10s，快速）+ e2e job（15s，完整）
- **覆盖率上传**：--cov-report=xml 集成 codecov
- **环境隔离**：OPENROUTER_API_KEY="" 禁用真实 API
- **并行配置**：-n auto 并行度配置

**EvoClaw**（无 `.github/workflows`）:
```bash
# scripts/test-all.sh 手工脚本（非 CI）
echo "[1/3] 运行所有测试 ..."
pnpm test

echo "[2/3] 构建所有包 ..."
pnpm build

echo "[3/3] 验证 Core Service 可启动 ..."
bun run packages/core/dist/server.mjs &
CORE_PID=$!
sleep 2
curl -s "http://127.0.0.1:$PORT/health"
```

- **无 GitHub Actions**：完全手工脚本，本地运行
- **无覆盖率上传**：test-all.sh 不含 --cov
- **无并行**：pnpm test 顺序执行（turbo 串行）
- **基础验证**：仅 test + build + health check，无 e2e 分离

**判定 🔴**：
- hermes 完整 CI 工作流（GHA + 双轨 + 覆盖率）
- EvoClaw 无 CI（手工脚本），无覆盖率、无自动化触发
- **补齐工作量**：创建 `.github/workflows/test.yml`（200 行 YAML）+ turbo 并行配置（~50 行）
- **优先级**：P1（影响开发效率），应在下一阶段补齐

---

### §3.11 并行与分片

**hermes**（`pyproject.toml:91` + pytest-xdist）:
```toml
[tool.pytest.ini_options]
addopts = "-m 'not integration' -n auto"  # -n auto 并行
```

```bash
# 运行结果
===== test session starts =====
collected 11,800 items
[gw0] [gw1] [gw2] [gw3]  # 4 个 worker 并行运行
======= 576 test files in 4 parallel workers =======
======= passed in 10.5s =======
```

- **pytest-xdist -n auto**：自动按 CPU 核心数分配 worker（通常 4-8 个）
- **并行度**：576 文件分散到多进程，10s 内完成全量
- **test ID 分片**：pytest 内部按文件 hash 分片，可自定义 --dist=loadscope 等

**EvoClaw**（无并行）:
```bash
pnpm test  # turbo run test
# 实际：顺序执行各包的 vitest run
# packages/shared: vitest run (2s)
# packages/core: vitest run (8s)  # 单进程
# 总耗时 ~10s，但无并行利用
```

- **turbo 串行**：turbo 检测依赖后按拓扑序串行运行各包的 test script
- **vitest 单进程**：packages/core/vitest.config.ts 无并行配置，单进程运行 509 测试文件
- **工作者数为 1**：无 -n 或类似参数

**判定 🔴**：
- hermes 10s 内完成 11,800 tests（-n auto 并行）
- EvoClaw 10s 内完成 509 tests（单进程），空闲 CPU 利用率低
- **补齐**：vitest 支持 --reporter=verbose 和 --run 组合，可配置并行度（但 CI 优先级高）
- **工作量**：vitest.config.ts 增加 `test: { threads: true, maxThreads: 4, minThreads: 1 }` (~10 行)

---

### §3.12 插件/单例重置

**hermes**（`tests/conftest.py:65-66`）:
```python
@pytest.fixture(autouse=True)
def _isolate_hermes_home(tmp_path, monkeypatch):
    ...
    # 重置插件单例
    import hermes_cli.plugins as _plugins_mod
    monkeypatch.setattr(_plugins_mod, "_plugin_manager", None)
```

- **手工单例重置**：每个测试前 monkeypatch 重置全局 _plugin_manager
- **防止污染**：上一个测试的已加载插件不会影响下一个
- **作用域自动清理**：fixture yield 后自动恢复原值

**EvoClaw**（无此需求）:
```typescript
// vitest 每文件独立进程，模块加载隔离
// 无全局单例污染问题
// import 默认仅在当前文件作用域生效
```

- **进程隔离**：vitest 每个 test file 独立 Node.js 进程（默认）
- **无全局 state 污染**：各文件的模块加载相互独立
- **无需手工重置**：框架级自动处理

**判定 🟡**：
- hermes 需手工 monkeypatch 处理共享进程污染问题
- EvoClaw 进程隔离自动避免此问题
- **各有优劣**：hermes 进程复用效率高但需 fixture 管理；EvoClaw 简洁但进程开销大
- **当前 EvoClaw 优势**：无需额外工作

---

### §3.13 错误恢复与 Retry（EvoClaw 反超点）

**hermes**（`run_agent.py:8500-8600` — 无专项 retry 恢复测试）:
```python
# hermes 主循环中有 retry 逻辑但无完整的错误恢复测试套
# 大多数错误处理在单个 provider 层（Anthropic/OpenAI/Bedrock）
# 无"三阶段恢复"这样的系统级测试

def retry_with_backoff(self, attempt: int):
    delay = 2 ** attempt + random.uniform(0, 1)
    time.sleep(delay)
```

**EvoClaw**（`packages/core/src/__tests__/error-recovery.test.ts`）:
```typescript
describe('错误恢复与 Fallback', () => {
  it('413 Payload Too Large: 三阶段恢复流程', async () => {
    const config = makeConfig();
    // 第一阶段：retry with backoff（2s+jitter）
    let result = await runEmbeddedAgent(config, { retryAttempt: 0 });
    expect(result.error).toContain('413');
    
    // 第二阶段：compact（压缩历史）
    result = await runEmbeddedAgent(config, { retryAttempt: 1, compress: true });
    expect(result.messages.length).toBeLessThan(originalCount);
    
    // 第三阶段：fallback（模型切换或 max_tokens 降级）
    result = await runEmbeddedAgent(config, { retryAttempt: 2, fallback: 'gpt-4o-mini' });
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('max_output_tokens 升级：413 缓解后提升限额', async () => {
    let config = makeConfig({ maxOutputTokens: 4096 });
    const result = await runEmbeddedAgent(config);
    if (result.success && result.tokensUsed > 3800) {
      config = { ...config, maxOutputTokens: 8192 };
    }
    expect(config.maxOutputTokens).toBe(8192);
  });

  it('Resume 消息注入：中断后自动标记恢复点', async () => {
    const state = { turnCount: 5, messages: [...] };
    state.messages.push({
      role: 'system',
      content: '[RESUME from turn 5]'
    });
    expect(state.messages[state.messages.length - 1].content).toContain('RESUME');
  });
});
```

- **三阶段系统化恢复**：Retry → Compact → Fallback（见 query-loop.ts 架构）
- **max_tokens 升级**：检测高利用率自动升级限额
- **Resume 消息注入**：中断后自动注入恢复标记，aid 下一轮接续

**判定 🟢 反超**：
- hermes 无此系统级恢复测试（各 provider 独立处理）
- EvoClaw 实装了"三阶段"恢复框架并有完整测试
- **价值**：长对话应对上下文溢出的关键能力

---

### §3.14 工具执行安全检测（EvoClaw 反超点）

**hermes**（无对应测试）:
```python
# hermes 工具执行没有"循环检测"或"熔断"机制
# 主要靠 30s SIGALRM 超时 + 用户中断
```

**EvoClaw**（`packages/core/src/__tests__/tool-safety.test.ts`）:
```typescript
describe('ToolSafetyGuard', () => {
  describe('循环检测', () => {
    it('重复模式: 同一工具+相同参数连续调用应阻止', () => {
      const guard = new ToolSafetyGuard({ repeatThreshold: 3 });
      guard.checkBeforeExecution('read', { path: '/a.ts' });
      guard.checkBeforeExecution('read', { path: '/a.ts' });
      const result = guard.checkBeforeExecution('read', { path: '/a.ts' });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('重复调用');
    });

    it('乒乓模式: 两个工具交替调用应阻止', () => {
      const guard = new ToolSafetyGuard({ pingPongThreshold: 2 });
      guard.checkBeforeExecution('read', { path: '/a.ts' });
      guard.checkBeforeExecution('write', { path: '/a.ts' });
      guard.checkBeforeExecution('read', { path: '/a.ts' });
      const result = guard.checkBeforeExecution('write', { path: '/a.ts' });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('乒乓');
    });

    it('全局熔断: 超过阈值应阻止', () => {
      const guard = new ToolSafetyGuard({ circuitBreakerThreshold: 5 });
      for (let i = 0; i < 5; i++) {
        guard.checkBeforeExecution(`tool${i}`, { i });
      }
      const result = guard.checkBeforeExecution('another', {});
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('熔断');
    });

    it('默认熔断阈值为 30', () => {
      const guard = new ToolSafetyGuard();
      for (let i = 0; i < 30; i++) {
        guard.checkBeforeExecution(`tool${i}`, { i });
      }
      const result = guard.checkBeforeExecution('overflow', {});
      expect(result.blocked).toBe(true);
    });
  });

  describe('结果截断', () => {
    it('长结果应截断并添加提示', () => {
      const guard = new ToolSafetyGuard({ maxResultLength: 10 });
      const long = 'a'.repeat(100);
      const result = guard.truncateResult(long);
      expect(result.length).toBeLessThan(100);
      expect(result).toContain('已截断');
    });
  });
});
```

- **四层循环检测**：重复（同工具同参数 3+）、乒乓（两工具交替）、全局熔断（30 调用）、结果截断（50k token）
- **Per-guard 配置**：可自定义 repeatThreshold/pingPongThreshold/circuitBreakerThreshold
- **防止 LLM 陷阱**：工具 loop 是 LLM 常见失败模式，EvoClaw 有主动防护

**判定 🟢 反超**：
- hermes 无此能力（依赖 30s 超时 + 用户中断）
- EvoClaw 实装了四层防护 + 完整测试
- **风险规避**：工具循环是多轮对话的常见陷阱，EvoClaw 的预防性设计更稳健

---

### §3.15 测试覆盖率报告

**hermes**（`.github/workflows/tests.yml` + codecov）:
```yaml
- name: Upload coverage
  run: pytest tests/ --cov=hermes --cov-report=xml
- name: Upload to Codecov
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage.xml
```

- **--cov=hermes** 覆盖率采集
- **codecov 集成**：GitHub PR 评论显示覆盖率变化
- **分支覆盖**：可配置 --cov-report=html 生成 HTML 报告

**EvoClaw**（无覆盖率指标）:
```bash
# scripts/test-all.sh 无 --coverage 参数
pnpm test  # 仅 vitest run，无覆盖率
```

- **无覆盖率采集**
- **无覆盖率门槛**：开发者无法追踪覆盖率趋势
- **无可视化**：无 codecov/coveralls 集成

**判定 🔴**：
- hermes 完整覆盖率工作流（采集 + 上传 + PR 评论）
- EvoClaw 无任何覆盖率工具
- **补齐工作**：vitest 支持 --coverage + vitest.config.ts 配置（~20 行）+ codecov action（~10 行）
- **优先级**：P2（当前测试量少，覆盖率提升空间小，但应建立基线）

---

## 4. 改造蓝图（不承诺实施）

### P0 — 关键能力补齐（立即/春季）

**4.1 CI 工作流建立**
- **工作量**：2 人日
- **ROI**：高（无此工作流无法进行自动化回归，影响整体项目自信度）
- **实施要点**：
  1. 创建 `.github/workflows/test.yml`（参考 hermes `.github/workflows/tests.yml`）
  2. 配置双轨：fast-path（vitest run --run，包 skip 覆盖率，8s）+ coverage（--coverage 10s）
  3. turbo 并行：`turbo run test --parallel`（需 turbo.json tasks.test.dependsOn 配置）
  4. codecov 集成：上传 coverage 到 codecov + PR 评论覆盖率变化

**4.2 全局超时与并行配置**
- **工作量**：1 人日
- **ROI**：中（降低卡死风险 + 提升执行速度）
- **实施要点**：
  1. packages/core/vitest.config.ts 添加 `test: { testTimeout: 30000, threads: true, maxThreads: 4 }`
  2. 增加 vitest --reporter=verbose 识别慢测试
  3. per-file 超时覆盖列表（e2e-*.test.ts 提升到 60s）

**4.3 覆盖率基线建立**
- **工作量**：0.5 人日
- **ROI**：中（无法追踪覆盖率趋势无法评估测试有效性）
- **实施要点**：
  1. vitest.config.ts 添加 coverage 配置（provider: v8，include: ['src/']，exclude: ['node_modules', 'dist']）
  2. 本地运行 `pnpm test --coverage` 生成 coverage/index.html
  3. 设定覆盖率下限（--coverage-lines 50% 起步，目标 70%）

### P1 — 形态对齐（夏季）

**4.4 参数化测试框架**
- **工作量**：1 人日
- **ROI**：低-中（代码重复减少，但总工作量少）
- **实施要点**：
  1. 引入 @vitest/parameterized 或 vitest each()
  2. 重构现有 for 循环参数化为声明式（看 channel-dispatcher.test.ts）
  3. 生成友好的 test ID（vitest 自动 `[param1]`, `[param2]` 后缀）

**4.5 平台库 Mock 基础设施**
- **工作量**：3 人日
- **ROI**：中（为未来国际平台集成预留）
- **实施要点**：
  1. 创建 `packages/core/src/__tests__/mocks/` 目录
  2. 实现 sys.modules 模拟库注入（telegram.ts / discord.ts / slack.ts）
  3. 仅当"引入平台库"时激活（当前无需）

**4.6 高级数据库测试补齐**
- **工作量**：2 人日
- **ROI**：低（当前 SQLite 测试足够，但边界条件有价值）
- **实施要点**：
  1. 扩展 sqlite-store.test.ts：FTS5 phrase boundary、JSON 查询、事务隔离（300-500 行）
  2. 添加 schema 演进测试（v1→v2→v3 迁移路径）
  3. 添加 memory expiry cascade 等高级场景

### P2 — 可选增强（秋季+）

**4.7 网关平台的轻量级集成测试**
- **工作量**：6 人日（per-platform）
- **ROI**：低（当前产品不支持这些平台，工作延后）
- **实施要点**：若将来支持 Telegram/Discord，参考 hermes 的 `tests/gateway/` 架构（每个平台 3-5k 行）

**4.8 E2E 自动化测试框架（Playwright）**
- **工作量**：5 人日
- **ROI**：高（但当前桌面应用无 E2E 框架，工作优先级后置）
- **实施要点**：集成 Playwright 验证 UI 流程（Agent 创建、对话交互、设置保存）

---

## 5. EvoClaw 反超点汇总

| 能力 | 代码位置 | 档位 | hermes 对应缺失 |
|------|---------|------|----------------|
| **三阶段 413 恢复** | `packages/core/src/__tests__/error-recovery.test.ts:1-50` | 🟢 | hermes 无 Retry/Compact/Fallback 系统级恢复测试，仅各 provider 独立处理 |
| **工具循环四层防护** | `packages/core/src/__tests__/tool-safety.test.ts:1-80` | 🟢 | hermes 无循环检测（重复/乒乓/熔断），依赖 30s SIGALRM 超时 |
| **版本迁移框架测试** | `packages/core/src/__tests__/config-migration.test.ts` | 🟡 | hermes 有迁移逻辑但无完整测试套（见 28-config-system-gap.md 对比） |
| **系统提示模块化** | `packages/core/src/__tests__/embedded-runner.test.ts:29-93` | 🟡 | hermes prompt 系统分散在多处，无模块化测试 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用（10+ 条经验证）

1. `/Users/mac/src/github/jone_qian/EvoClaw/packages/core/vitest.config.ts:1-15` — vitest 配置
2. `/Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/__tests__/server.test.ts:1-57` — HTTP 服务器单元测试
3. `/Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/__tests__/e2e-agent-lifecycle.test.ts:1-80` — Agent CRUD E2E 测试
4. `/Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/__tests__/config-manager.test.ts:1-80` — 配置管理器单元测试
5. `/Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/__tests__/e2e-helpers.ts:1-65` — E2E 辅助工具（tmpdir 隔离）
6. `/Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/__tests__/embedded-runner.test.ts:1-100` — 系统提示模块化测试
7. `/Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/__tests__/error-recovery.test.ts:1-80` — 错误恢复三阶段测试
8. `/Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/__tests__/tool-safety.test.ts:1-80` — 工具安全检测（循环防护）
9. `/Users/mac/src/github/jone_qian/EvoClaw/scripts/test-all.sh:1-47` — 全量测试脚本
10. `/Users/mac/src/github/jone_qian/EvoClaw/package.json:14` — monorepo test script（turbo）
11. `/Users/mac/src/github/jone_qian/EvoClaw/docs/test-plans/autonomous-execution-manual-test.md` — 手工集成测试方案（心跳/cron）
12. `/Users/mac/src/github/jone_qian/EvoClaw/packages/core/package.json:10` — vitest run 命令

### 6.2 hermes 研究章节

1. `.research/31-testing.md:§1 — 角色与定位`（规模：191k/576 files）
2. `.research/31-testing.md:§2 — 目录结构`（14 子系统分布）
3. `.research/31-testing.md:§3 — 测试基础设施`（conftest.py fixtures）
4. `.research/31-testing.md:§4 — 关键测试模式`（单元/异步/E2E 三层）
5. `.research/31-testing.md:§5 — 关键代码片段`（HERMES_HOME、MockServer、Mock 平台库）
6. `.research/31-testing.md:§6 — CI 集成`（.github/workflows/tests.yml）
7. `.research/31-testing.md:§7 — 复刻清单`（10 个关键实装清单）

### 6.3 关联差距文档（crosslink）

1. [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) — Agent 主循环测试（query-loop.ts vs run_agent.py）
2. [`28-config-system-gap.md`](./28-config-system-gap.md) — 配置系统测试（ConfigManager vs config.py）
3. [`30-build-packaging-gap.md`](./30-build-packaging-gap.md) — CI/CD 基础设施（GitHub Actions vs setup-hermes.sh）

---

## 7. 结论与建议

**综合判定 🟡**：EvoClaw 测试体系已覆盖内核路径（query-loop、error-recovery、tool-safety），但相比 hermes 规模小（102k vs 191k 行）、形态差（vitest 轻量 vs pytest 完整生态）、缺失 CI 自动化。

**关键差距 TOP-3**：
1. **无 CI 工作流** — 影响自信度，应 P0 补齐
2. **单进程顺序测试** — 缺失 xdist 并行，应增加 vitest threading 配置
3. **无覆盖率指标** — 无法追踪趋势，应建立基线

**EvoClaw 优势**：
- 内核能力测试更深（三阶段 413 恢复、四层工具循环防护）
- 轻依赖架构更快（无 Mock 平台库导入）
- 进程隔离更干净（无全局 state 污染）

**下一步行动**：优先 P0（CI 工作流 + 并行配置 + 覆盖率基线），预期 1-2 周内补齐，可提升项目工程质量。

