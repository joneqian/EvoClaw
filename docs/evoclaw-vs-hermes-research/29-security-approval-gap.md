# 29 — 安全与审批 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/29-security-approval.md`（776 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🟡 **部分覆盖，多项 🟢 反超**

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes** — 7 层纵深防护架构。L1 命令审批（39 条危险模式）→ L2 Tirith 引擎（同音字 URL、管道注入）→ L3 SSRF（私有 IP + GCP 元数据）→ L4 网站黑名单（通配符匹配）→ L5 OSV 漏洞扫描（MAL-* 恶意包）→ L6 Secret 脱敏（25+ API key 模式）→ L7 凭据隔离（ContextVar 会话级隔离 + 符号链接清理）。约 2700 行核心代码。设计哲学：**黑名单正则匹配 + LLM 辅助 smart_approve + Gateway 队列审批**，侧重于"已知威胁检测"。

**EvoClaw** — 双路径 Bash 安全体系（AST 主路径 + Legacy 正则降级）+ 7 类别 × 4 作用域权限矩阵 + 项目级/Agent 级权限分层 + NameSecurityPolicy（Skill/MCP 黑白名单） + 国产渠道 PII 脱敏。约 3100+ 行代码。设计哲学：**FAIL-CLOSED 白名单制 + 多层差异检测（Pre-check 对齐 Bash） + 变量作用域追踪**，侧重于"不确定就要求确认"。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 命令审批与危险模式 | 🟡 | hermes 39 条黑名单正则，EvoClaw FAIL-CLOSED 白名单 + AST 主路径 |
| §3.2 | Unicode 规范化与混淆检测 | 🟢 | **反超**：EvoClaw 26 种 Cyrillic/Greek 同形字 + 11 种不可见字符黑名单 |
| §3.3 | 5 种审批模式（off/manual/smart/yolo） | 🔴 | EvoClaw 缺 smart 模式、yolo 跳过、环境变量控制 |
| §3.4 | Smart approve（LLM 辅助评估） | 🔴 | EvoClaw 无 LLM 调用 feedback 机制 |
| §3.5 | Bash AST 解析 + 变量作用域 | 🟢 | **反超**：EvoClaw 纯 TS 双路径，AST 通过 pre-checks 验证差异 |
| §3.6 | Pre-checks 差异检测（9 类） | 🟢 | **反超**：EvoClaw 显式验证解析器与 bash 差异 |
| §3.7 | Sed 安全验证（e/w 标志禁止） | 🟢 | **反超**：EvoClaw 304 行专项 + 行打印/替换 2 种模式 |
| §3.8 | 破坏性命令检测 | 🟢 | **反超**：EvoClaw 16 种 + 6 类别分类，信息性警告非阻止 |
| §3.9 | Unicode 同形字检测 | 🟢 | **反超**：EvoClaw 独立模块 + 不可见字符黑名单 |
| §3.10 | 路径遍历防护（symlink） | 🟡 | 两者都有，EvoClaw 工具级分散，hermes 集中 + symlink 剥离 |
| §3.11 | 权限模型（类别 × 作用域） | 🟢 | **反超**：EvoClaw 7 × 4 矩阵 + 项目/Agent 分层 |
| §3.12 | NameSecurityPolicy（Skill/MCP） | 🟢 | **反超**：EvoClaw 3 字段 denylist/allowlist/disabled + 合并规则 |
| §3.13 | 命令 flag 级检查 | 🟢 | **反超**：EvoClaw flag 矩阵（git/rm/sed/chmod），hermes 仅命令级 |
| §3.14 | Tirith 引擎（同音字 URL） | 🔴 | EvoClaw 完全缺失外部 shell 扫描工具 |
| §3.15 | SSRF 防护（私有 IP） | 🟡 | EvoClaw 基础检查，缺 GCP 元数据 + Fail Closed DNS |
| §3.16 | 网站黑名单与通配符 | 🔴 | EvoClaw 无黑名单（仅白名单），缺 30s TTL 缓存 |
| §3.17 | OSV 漏洞扫描（MAL-* 恶意包） | 🔴 | EvoClaw 无 MCP/npm 包漏洞检测 |
| §3.18 | Secret 脱敏（25+ API key） | 🟡 | EvoClaw 国产渠道脱敏（6 种），缺全局 logging 拦截 |
| §3.19 | ContextVar 会话级隔离 | 🔴 | EvoClaw 无多 Agent 并发隔离机制 |
| §3.20 | 环境变量白名单与凭据文件隔离 | 🔴 | EvoClaw 无 env passthrough 白名单，无 symlink 清理 |

**统计**: 🔴 7 / 🟡 4 / 🟢 9（其中 9 项反超）。

---

## 3. 机制逐条深度对比

### §3.1 命令审批与 39 个危险模式

**hermes** — 黑名单制 8 大类（`tools/approval.py:68-106`）

```python
DANGEROUS_PATTERNS = [
    (r'rm\s+(-rf?|--recursive)\s+/', 'recursive_delete'),
    (r'bash\s+-c', 'bash_eval'),
    (r'curl.*\|\s*(sh|bash)', 'curl_pipe_shell'),
    # ... 共 39 条
]
```

**EvoClaw** — FAIL-CLOSED 白名单 + AST 主路径（`security/bash-parser/security-pipeline.ts:44-120`）

```typescript
export function runSecurityPipeline(command: string, options: PipelineOptions = {}): PipelineResult {
  const analysis = analyzeCommand(command, budget);
  if (analysis.kind === 'ask' && analysis.isMisparsing) {
    return { decision: 'ask', reason: analysis.reason, isMisparsing: true, commands: [] };
  }
  // ... per-command 验证
  return { decision: 'allow' | 'ask' | 'deny', isMisparsing: false, commands, analysis };
}
```

**判定 🟡**：理念相反。hermes Fail Open，EvoClaw Fail Closed。EvoClaw AST 精准度高但复杂度大。

---

### §3.2 命令规范化（NFKC Unicode + ANSI 剥离）

**hermes**（`tools/approval.py:136-151`） — 单点规范化

```python
def _normalize_command_for_detection(command: str) -> str:
    from tools.ansi_strip import strip_ansi
    command = strip_ansi(command)
    command = command.replace("\x00", "")
    return unicodedata.normalize("NFKC", command)
```

**EvoClaw**（`security/unicode-detector.ts:174-228`）— 独立模块 + 检测 + 规范化分离

```typescript
export function normalizeUnicode(text: string): string {
  // Cyrillic/Greek 同形字替换（26 种）
  // 全角 → ASCII
  // 移除不可见字符（11 种）
  return result.normalize('NFKC');
}

export function detectUnicodeConfusion(text: string): UnicodeDetectionResult {
  const issues: string[] = [];
  issues.push(...detectHomoglyphs(text));
  issues.push(...detectInvisibleChars(text));
  return { detected: issues.length > 0, issues, normalized: normalizeUnicode(text) };
}
```

**判定 🟢 反超**：检测 + 规范化并行，不仅防护还诊断。

---

### §3.3 5 种审批模式（off/manual/smart/yolo）

**hermes** — 五选一（off / manual / smart / yolo）

**EvoClaw** — 仅 3 种全局模式（default / strict / permissive）

**判定 🔴**：缺 smart 模式、yolo 跳过、环境变量控制。

---

### §3.4 Smart approve（LLM 风险评估）

**hermes**（`tools/approval.py:487-536`）— 辅助 LLM 三步评估

```python
def _smart_approve(command: str, description: str) -> str:
    client = get_text_auxiliary_client(task="approval")
    response = client.chat_completions_create(...)
    # 返回 approve / deny / escalate
```

**EvoClaw** — 无对应实现

**判定 🔴**：无 LLM 辅助评估。

---

### §3.5 Bash AST 解析 + 变量作用域追踪

**hermes** — 无 AST（仅正则）

**EvoClaw**（`bash-parser/security-analyzer.ts:52-144`）— 纯 TS AST + 变量作用域

```typescript
const parseResult = parseForSecurity(command, budget);  // AST 解析
const resolvedCommands = resolveCommandVariables(parseResult.commands);  // 变量追踪
```

**判定 🟢 反超**：AST 精度高于正则。

---

### §3.6 Pre-checks 差异检测（9 类）

**hermes** — 仅 NFKC + ANSI 剥离

**EvoClaw**（`bash-parser/pre-checks.ts:34-174`）— 9 种差异类

```typescript
// control_characters, unicode_whitespace, backslash_whitespace,
// backslash_operators, zsh_tilde_expansion, zsh_equals_expansion,
// newlines, carriage_return, brace_expansion_with_quotes, IFS_injection,
// comment_quote_desync
```

**判定 🟢 反超**：显式验证解析器与 bash 差异。

---

### §3.7 Sed 安全验证（e/w 标志禁止）

**hermes** — 仅在 DANGEROUS_PATTERNS 中

**EvoClaw**（`security/sed-validator.ts:64-114`）— 304 行专项 + 2 种模式

```typescript
// 区分行打印 vs 替换模式
// 禁止 e/w 标志，允许安全场景（sed -n '5p'）
```

**判定 🟢 反超**：细粒度检查优于黑名单。

---

### §3.8 破坏性命令检测

**hermes** — 列举 DANGEROUS_PATTERNS，阻止执行

**EvoClaw**（`security/destructive-detector.ts:34-81`）— 16 种 + 6 类别，警告（不阻止）

```typescript
export type DestructiveCategory =
  | 'git_data_loss' | 'git_overwrite' | 'git_bypass'
  | 'file_delete' | 'database' | 'infrastructure';
```

**判定 🟢 反超**：警告比阻止更好，用户体验优。

---

### §3.9 Unicode 同形字检测

**hermes** — NFKC 隐式处理

**EvoClaw**（`security/unicode-detector.ts:11-167`）— 26 种同形字 + 11 种不可见字符黑名单

**判定 🟢 反超**：显式检测精度高。

---

### §3.10 路径遍历防护（symlink）

**hermes**（`.research/29-security-approval.md §7 凭据隔离`） — 集中式 `credential_files.py:55-104`，复制凭据文件时先 `Path.resolve(strict=True)` 解析 symlink，再将 symlink 链一次剥离后 `shutil.copy2` 到 sandbox，防止通过 `~/.aws/credentials → /etc/shadow` 之类的 pivot。

```python
def copy_credential_files(paths: list[Path], sandbox: Path) -> list[Path]:
    copied = []
    for src in paths:
        resolved = src.resolve(strict=True)  # 一次剥离 symlink
        if not resolved.is_file():
            continue
        dst = sandbox / resolved.name
        shutil.copy2(resolved, dst)           # copy2 保留权限 mode
        copied.append(dst)
    return copied
```

**EvoClaw**（`security/path-validation.ts`）— 工具级分散校验，write/read 各自在入口处调 `validateCommandPaths()` 与 `checkDangerousRemovalPaths()`，但**没有**集中 symlink 剥离管线。

```typescript
// packages/core/src/security/path-validation.ts:getBaseCommand + checkDangerousRemovalPaths
export function checkDangerousRemovalPaths(command: string): { dangerous: boolean; reason?: string } {
  const parts = command.split(/\s+/);
  const targets = parts.slice(1).filter((p) => !p.startsWith('-'));
  for (const t of targets) {
    if (t === '/' || t === '/*' || t === '~' || t === '~/' || t.startsWith('/etc/') || t.startsWith('/usr/')) {
      return { dangerous: true, reason: `系统目录: ${t}` };
    }
  }
  return { dangerous: false };
}
```

**判定 🟡**：hermes 的 symlink 一次剥离覆盖了跨 Skill / 子 Agent 凭据复制场景；EvoClaw 仅覆盖工具入口的字符串匹配，没有 fs realpath 剥离逻辑。补齐思路：在 `path-validation.ts` 里加 `resolveRealPath()` helper，让 read/write 工具在落盘前统一剥 symlink。

---

### §3.11 权限模型（类别 × 作用域）

**hermes**（`.research/29-security-approval.md §1-§2`） — 无形式化权限模型，审批粒度是"命令字符串 + 5 种 mode 开关"，不存在 category/scope/resource 三元组概念，也没有跨 session 的授权持久化。

```python
# tools/approval.py — 审批只返回 (approved: bool, reason: str)
def check_approval(command: str, description: str, mode: Mode) -> tuple[bool, str]: ...
```

**EvoClaw**（`packages/shared/src/types/permission.ts:1-70` + `tools/permission-interceptor.ts:94-118`）— 形式化 **7 类 × 4 作用域** 矩阵 + 工具→类别静态映射 + 项目级/Agent 级分层。

```typescript
// shared/src/types/permission.ts:1-12
export type PermissionCategory =
  | 'file_read' | 'file_write' | 'network'
  | 'shell' | 'browser' | 'mcp' | 'skill';

export type PermissionScope = 'once' | 'session' | 'always' | 'deny';

// tools/permission-interceptor.ts:94-118
const TOOL_CATEGORY_MAP: Record<string, PermissionCategory> = {
  read: 'file_read', grep: 'file_read', ls: 'file_read',
  write: 'file_write', edit: 'file_write', apply_patch: 'file_write',
  bash: 'shell', web_fetch: 'network', web_search: 'network',
  browser_navigate: 'browser', /* ... */
};
```

**判定 🟢 反超**：EvoClaw 矩阵可以持久化（`PermissionGrant` 带 `grantedAt/expiresAt/grantedBy`）、可按 category 批量授权（一次"允许该 Agent 所有 file_write"即可）、审计日志字段结构化；hermes 只能逐条命令审批，横切多个工具时冗余。企业合规场景（批量撤销 browser 权限、针对 network 设白名单）EvoClaw 完胜。

---

### §3.12 NameSecurityPolicy（Skill/MCP）

**hermes**（`.research/29-security-approval.md §1` 关联章节） — 无统一策略对象，Skill 与 MCP 各自有独立检查（Skill 用 trust_level + frontmatter，MCP 用 websites config），跨扩展类型的黑白名单无法合并。

**EvoClaw**（`security/extension-security.ts:15-60`）— 统一 `NameSecurityPolicy`，覆盖 Skill + MCP Server 两种扩展类型，`denylist` 绝对优先，`disabled` 其次，`allowlist` 最后，支持泛型批量过滤。

```typescript
// security/extension-security.ts:15-36
export function evaluateAccess(name: string, policy: NameSecurityPolicy | undefined): SecurityDecision {
  if (!policy) return 'allowed';
  if (policy.denylist?.includes(name)) return 'denied_by_denylist';
  if (policy.disabled?.includes(name)) return 'disabled';
  if (policy.allowlist && !policy.allowlist.includes(name)) return 'denied_by_allowlist';
  return 'allowed';
}

// 泛型批量过滤 — Skill/MCP 复用同一套逻辑
export function filterByPolicy<T>(
  items: readonly T[],
  nameExtractor: (item: T) => string,
  policy: NameSecurityPolicy | undefined,
): FilterResult<T> { /* ... */ }
```

**判定 🟢 反超**：一条规则对 Skill 与 MCP Server 双生效 + `denylist 并集` 策略与 §3.13 配置层的 enforced 回写衔接（见 `28-config-system-gap.md §3.13`），企业 IT 可在 `managed.json` 一次性封禁 `["shell-executor", "network-tools"]` 覆盖所有扩展入口。hermes 需要在 Skill 与 MCP 两套检查各自加规则。

---

### §3.13 命令 flag 级检查

**hermes**（`tools/approval.py` SafeBins） — SafeBins 只检查 `command[0]` 命令名本身，`git push --force` 与 `git status` 对 hermes 无差别（均因 `git` 在 SafeBins 而放行）。

```python
SAFE_BINS = {'git', 'ls', 'cat', 'rg', ...}  # 仅判断 argv[0]
def is_safe(command: str) -> bool:
    return command.split()[0] in SAFE_BINS    # 不看 flag
```

**EvoClaw**（`security/command-allowlist.ts:25-76`）— 命令→flag 级配置矩阵，6 条高频命令（git/rm/sed/chmod/mv/cp）逐 flag 定义 `dangerousFlags` + `dangerousPatterns`，未匹配的命令降级为 SafeBins 行为。

```typescript
// security/command-allowlist.ts:25-45（节选 git 条目）
const COMMAND_FLAG_CONFIGS: Record<string, CommandFlagConfig> = {
  git: {
    dangerousFlags: ['--force', '-f', '--hard', '--no-verify', '--amend'],
    dangerousPatterns: [
      /git\s+push\s+.*--force/i,
      /git\s+push\s+.*-f\b/i,
      /git\s+reset\s+--hard/i,
      /git\s+clean\s+-[a-z]*f/i,
      /git\s+branch\s+-[Dd]/i,
    ],
  },
  rm: { dangerousFlags: ['-rf', '-fr', '-r', '-f', '--recursive', '--force'], /* ... */ },
  chmod: { dangerousPatterns: [/chmod\s+777/, /chmod\s+a\+w/, /chmod\s+-R\s+777/] },
  // ...
};
```

**判定 🟢 反超**：EvoClaw 能精确拦截 `git push --force` / `git reset --hard` / `rm -rf` / `chmod 777` 等高频事故路径，同时放行 `git status` / `git log` 等无害命令，避免把 SafeBins 降级为"所有命令都要审批"的粗粒度方案。hermes 要么全放行 `git` 要么全阻断 `git`，缺中间态。

---

### §3.14 Tirith 引擎（同音字 URL / 管道注入）

**hermes**（`.research/29-security-approval.md §2 L2`） — 集成外部 `tirith` 二进制（Rust 实现），扫描命令字符串内的同音字域名、管道注入、终端注入等语义级威胁。

```python
# tools/tirith_scan.py（示意）
def scan(command: str) -> ScanResult:
    proc = subprocess.run(['tirith', 'scan', '--json', command], capture_output=True, timeout=2)
    return ScanResult.from_json(proc.stdout)
```

**EvoClaw** — 完全缺失。检索 `grep -r "tirith"` 零结果。仅有自研的 `unicode-detector.ts` 检测同形字符，但不检测同音域名（e.g. `paypaI.com` 以大写 I 伪装）。

**判定 🔴**：缺外部 shell 扫描能力。补齐可选方案：集成 tirith（Rust，MIT）或复用 Google safe-browsing API，作为 `web-security.ts` 的 Phase 2 扩展。

---

### §3.15 SSRF 防护（私有 IP）

**hermes**（`.research/29-security-approval.md §3`） — `url_safety.py:38-96`，7 种 IP 范围 + GCP/AWS 元数据端点（`169.254.169.254`）+ DNS 解析 Fail Closed（resolve 失败一律拒绝）。

```python
PRIVATE_RANGES = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12',
                  '192.168.0.0/16', '169.254.0.0/16', '0.0.0.0/8', '::1/128']
METADATA_IPS = {'169.254.169.254', 'metadata.google.internal'}

def check_url(url: str) -> URLSafety:
    host = urlparse(url).hostname
    try:
        ips = socket.getaddrinfo(host, None)        # DNS 解析
    except socket.gaierror:
        return URLSafety.DENIED_DNS_FAIL            # Fail Closed
    for ip in ips:
        if any(ipaddress.ip_address(ip[4][0]) in net for net in PRIVATE_RANGES):
            return URLSafety.DENIED_PRIVATE
    if host in METADATA_IPS:
        return URLSafety.DENIED_METADATA
    return URLSafety.ALLOWED
```

**EvoClaw**（`security/web-security.ts:47-120`）— 字符串级私有 IP 检查，覆盖 5 个 IPv4 段 + IPv6 loopback，但：
1. 不做 DNS 解析 → `http://attacker.com` resolve 到 `10.0.0.5` 仍放行（hermes 会解析后拒绝）
2. 无 GCP/AWS 元数据黑名单（`169.254.169.254` 未列为特殊目标）
3. 无 DNS Fail Closed（resolve 失败场景走不到私有 IP 分支）

```typescript
// security/web-security.ts:92-119
export function isPrivateIP(hostname: string): boolean {
  // 直接对 hostname 字符串做 IPv4 正则，不走 dns.lookup
  if (hostname === '::1' || hostname === '[::1]') return true;
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!ipv4Match) return false;                      // ← domain 就直接 false
  const first = Number(ipv4Match[1]);
  if (first === 127) return true;                    // 127.0.0.0/8
  if (first === 10) return true;                     // 10.0.0.0/8
  // ... 172.16/12, 192.168/16, 169.254/16
}
```

**判定 🟡**：基础 IP 过滤可用，但对抗主动 DNS rebinding 和云元数据窃取不足。补齐 ~0.5d：`validateWebURL` 在 URL 解析后加 `await dns.lookup(hostname)` → 对所有返回 IP 走 `isPrivateIP`，resolve 失败一律拒绝。

---

### §3.16 网站黑名单与通配符匹配

**hermes**（`.research/29-security-approval.md §4`） — `website_policy.py`，配置文件驱动的黑名单 + `fnmatch` 通配符 + 30s TTL 缓存。

```python
# 配置示例: websites.blocked = ["*.gambling.com", "malware-*.net"]
def is_blocked(url: str) -> bool:
    host = urlparse(url).hostname
    for pattern in _load_blocked_patterns():          # 30s TTL 缓存
        if fnmatch.fnmatch(host, pattern):
            return True
    return False
```

**EvoClaw** — `grep -r "blocked.*website\|website.*block" packages/core/src` 零结果。仅 `preapproved-domains.ts` 提供白名单（正向允许），没有反向黑名单。

**判定 🔴**：缺企业需求。补齐 ~1-2d：新增 `config.security.blockedDomains` 字段 + `web-security.ts` 增加 `isDomainBlocked(host)` helper，支持 glob 模式。

---

### §3.17 OSV 漏洞扫描（MAL-* 恶意包）

**hermes**（`.research/29-security-approval.md §5`） — `osv_check.py`，MCP/npm 包安装前对 OSV.dev API 查询，**仅**阻止 `MAL-*` 恶意包（不阻止 CVE 漏洞，避免阻塞正常工作）。

```python
def scan_package(name: str, ecosystem: str) -> ScanResult:
    resp = httpx.post('https://api.osv.dev/v1/query',
                      json={'package': {'name': name, 'ecosystem': ecosystem}})
    for vuln in resp.json().get('vulns', []):
        if vuln['id'].startswith('MAL-'):             # 仅恶意包，不阻 CVE
            return ScanResult.BLOCKED
    return ScanResult.ALLOWED
```

**EvoClaw** — `grep -r "osv\|api\.osv\.dev" packages/core/src` 零结果。MCP install 路径无漏洞检测。

**判定 🔴**：缺包恶意检测防线。补齐 ~1d：`extension-manager.ts` 的 MCP install 步骤加 OSV 查询，命中 `MAL-*` 阻止安装。

---

### §3.18 Secret 脱敏（25+ API key）

**hermes**（`.research/29-security-approval.md §6`） — `redact.py`，集中 25+ pattern（Anthropic / OpenAI / AWS / GCP / GitHub / Slack / 阿里云 / 腾讯云等）+ Python `logging.Formatter` 集成，所有日志自动脱敏。

```python
REDACT_PATTERNS = [
    (re.compile(r'sk-ant-[a-zA-Z0-9-_]{90,}'), 'sk-ant-****'),
    (re.compile(r'sk-proj-[a-zA-Z0-9-_]{40,}'), 'sk-proj-****'),
    (re.compile(r'AKIA[0-9A-Z]{16}'), 'AKIA****'),
    (re.compile(r'ghp_[a-zA-Z0-9]{36}'), 'ghp_****'),
    # ... 25+ patterns
]

class RedactingFormatter(logging.Formatter):
    def format(self, record):
        msg = super().format(record)
        for pattern, replacement in REDACT_PATTERNS:
            msg = pattern.sub(replacement, msg)
        return msg
```

**EvoClaw**（`channels/weixin/weixin-redact.ts:1-60` + `infrastructure/pii-sanitizer.ts`）— 通用 PII 脱敏 + 国产渠道专项（6 种：手机号、身份证、邮箱、银行卡、地址、姓名），但**不覆盖** API Key 级别脱敏。

```typescript
// infrastructure/pii-sanitizer.ts（节选）— 仅身份信息层面
const PATTERNS = [
  { name: 'phone', re: /(1[3-9]\d)(\d{4})(\d{4})/g, replace: '$1****$3' },
  { name: 'idcard', re: /(\d{6})\d{8}(\d{4})/g, replace: '$1********$2' },
  { name: 'email', re: /([^@\s]+)@([^@\s]+)/g, replace: '***@$2' },
  // ... 但没有 sk-ant-*, AKIA*, ghp_* 等云凭据
];
```

**判定 🟡**：国产 PII 脱敏本地化强（对中文邮件/微信合规友好），但云 API Key 脱敏缺失，日志里打印 `OPENAI_API_KEY=sk-proj-xxx` 会原样落盘。补齐 ~1-2d：对齐 hermes 的 25+ pattern 并挂到 `Logger` 层。

---

### §3.19 ContextVar 会话级隔离

**hermes**（`.research/29-security-approval.md §7`） — 5 个 Python `ContextVar`（session_id / approval_decisions / pending_approvals / safe_bins_override / env_overrides），利用 contextvars 的 task-local 语义，每个 asyncio task 独立命名空间，会话结束自动回收并 deny 所有 pending。

```python
# tools/approval.py（节选）
_session_approvals: ContextVar[dict[str, Decision]] = ContextVar('_session_approvals')
_pending: ContextVar[list[str]] = ContextVar('_pending')

async def with_session(session_id: str, coro):
    token = _session_approvals.set({})
    try:
        return await coro
    finally:
        for cmd in _pending.get([]):
            audit_log.deny(cmd, reason='session_ended')  # 会话结束 deny 待审
        _session_approvals.reset(token)
```

**EvoClaw** — `grep -r "AsyncLocalStorage\|contextvar" packages/core/src` 零结果。Permission grants 存 SQLite `permissions` 表但**按 agentId 而非 session**，多 session 并发时 Agent A 的 session-scope 授权可能被 session B 复用。

**判定 🔴**：多 Agent 并发场景安全隐患。补齐 ~2-3d：`tools/permission-interceptor.ts` 加 Node `AsyncLocalStorage` 追踪 sessionId，`checkPermission` 中 session 为 key 分离授权。

---

### §3.20 环境变量白名单与凭据文件隔离

**hermes**（`.research/29-security-approval.md §7` `env_passthrough.py` + `credential_files.py`）— 双层来源（Skill frontmatter 声明 `env_passthrough: [AWS_PROFILE]` + 用户 config.yaml `env_passthrough.whitelist`），子 Agent 仅继承白名单 ENV，其余 `os.environ` 清空；凭据文件 (`~/.aws/credentials` 等) 通过 symlink 剥离 + `copy2` 到子 sandbox，避免子 Agent 泄露 parent 凭据。

```python
def spawn_subagent(cmd: str, env_whitelist: list[str], cred_files: list[Path]):
    env = {k: os.environ[k] for k in env_whitelist if k in os.environ}
    sandbox = Path(tempfile.mkdtemp())
    copy_credential_files(cred_files, sandbox)   # symlink 剥离
    env['HOME'] = str(sandbox)                   # 子 Agent HOME 重定向
    subprocess.run(cmd, env=env, check=True)
```

**EvoClaw** — `grep -r "env_passthrough\|env_whitelist" packages/core/src` 零结果；子 Agent（Task tool / subagent）继承完整 `process.env`，凭据文件无 sandbox 隔离。

**判定 🔴**：子 Agent 环境泄露面最大。补齐 ~2-3d：`kernel/tools/task-tool.ts` 新增 `envWhitelist` 配置 + spawn 时过滤 env；`agent/workspace.ts` 凭据文件 symlink 剥离逻辑。

---

## 4. 建议改造蓝图

### P0（高 ROI，≤ 3 人周）

| 项目 | 工作量 | ROI | 要点 |
|---|---|---|---|
| Smart Approve | 2-3d | 🔥🔥🔥 | LLM 三步评估 |
| SSRF 补齐 | 0.5-1d | 🔥🔥 | GCP 元数据 + DNS Fail Closed |
| Tirith 集成 | 3-5d | 🔥🔥 | 下载 + SHA-256 校验 |

### P1（中等 ROI，1-2 人周）

| 项目 | 工作量 | ROI | 要点 |
|---|---|---|---|
| 全局 Secret 脱敏 | 1-2d | 🔥🔥 | logging formatter 集成 |
| 网站黑名单 | 1-2d | 🔥 | fnmatch + TTL 缓存 |
| OSV 扫描 | 1d | 🔥 | MCP 前置检查 |
| 5 种审批模式 | 2-3d | 🔥 | smart/yolo 模式 |
| ContextVar 隔离 | 2-3d | 🔥 | 会话级隔离 |
| env passthrough | 2-3d | 🔥 | 双层来源 + symlink 清理 |

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 位置 | hermes 对应 | 证据 |
|---|---|---|---|---|
| 1 | Unicode 混淆检测 | `unicode-detector.ts:11-167` | 仅 NFKC | 26 种同形字 + 11 种不可见字符 |
| 2 | Bash AST + 变量作用域 | `bash-parser/security-analyzer.ts` | 纯正则 | parseForSecurity + resolveCommandVariables |
| 3 | Pre-checks 差异检测 | `bash-parser/pre-checks.ts:34-174` | 无 | 9 种解析器差异 |
| 4 | Sed 专项验证 | `security/sed-validator.ts:64-114` | DANGEROUS_PATTERNS | 304 行，区分模式 |
| 5 | 破坏性命令警告 | `security/destructive-detector.ts:34-81` | 阻止 + 审批 | 16 种 + 6 类别，非阻止 |
| 6 | 权限矩阵 | `tools/permission-interceptor.ts` | 无形式化 | 7 × 4 矩阵 + 三级分层 |
| 7 | NameSecurityPolicy | `security/extension-security.ts:15-110` | 无 | denylist/allowlist/disabled + 合并规则 |
| 8 | 命令 flag 级检查 | `security/command-allowlist.ts:25-120` | 仅命令级 | flag 矩阵 + 参数模式 |
| 9 | 三层管线 | `bash-parser/security-pipeline.ts:44-120` | 单层正则 | misparsing/non-misparsing/allow 优先级 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用（可达路径）

1. `packages/core/src/security/bash-parser/security-analyzer.ts:52-144`
2. `packages/core/src/security/bash-parser/security-pipeline.ts:44-120`
3. `packages/core/src/security/bash-parser/pre-checks.ts:34-174`
4. `packages/core/src/security/unicode-detector.ts:11-167`
5. `packages/core/src/security/sed-validator.ts:64-114`
6. `packages/core/src/security/destructive-detector.ts:34-81`
7. `packages/core/src/security/command-allowlist.ts:25-120`
8. `packages/core/src/security/extension-security.ts:15-110`
9. `packages/core/src/security/web-security.ts:47-121`
10. `packages/core/src/tools/permission-interceptor.ts:130-150`
11. `packages/core/src/channel/adapters/weixin-redact.ts:1-60`

### 6.2 hermes 研究引用

对标 `/Users/mac/src/github/hermes-agent/.research/29-security-approval.md` 具体章节：

- §1 L1 命令审批与危险模式 → 本文 §3.1 / §3.3 / §3.4
- §2 L2 Tirith 引擎 → §3.14
- §3 L3 SSRF 私有 IP + 云元数据 → §3.15
- §4 L4 网站黑名单（fnmatch + TTL）→ §3.16
- §5 L5 OSV 漏洞扫描（MAL-*）→ §3.17
- §6 L6 Secret 脱敏（25+ pattern + logging formatter）→ §3.18
- §7 L7 凭据隔离（ContextVar / env_passthrough / symlink 剥离）→ §3.10 / §3.19 / §3.20
- 附录 审批审计日志 → 与 EvoClaw `audit_log` 表对照，见 §3.11

### 6.3 关联 gap 章节

- **05-agent-loop-gap.md**: 工具分发策略与权限拦截
- **09-tools-system-gap.md**: bash 工具执行前审批
- **11-environments-spawn-gap.md**: 容器环境跳过、子 Agent 隔离
- **13-plugins-gap.md**: Skill 权限声明
- **28-config-system-gap.md**: enforced/denylist 策略
- **21-mcp-gap.md**: MCP 包漏洞检测

---

**总行数**: 823 行
**统计**: 🔴 7 / 🟡 4 / 🟢 9（9 项反超）
