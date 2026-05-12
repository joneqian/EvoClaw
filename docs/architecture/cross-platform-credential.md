# 跨平台凭证存储架构

> **生效日期**: 2026-05-12
> **关联**: [M14-CrossPlatform-Plan.md](../iteration-plans/M14-CrossPlatform-Plan.md) §一/三/七
> **状态**: M14 Phase 1 已落地（PR-A1 #148）

---

## 一、设计目标

让 EvoClaw / HealthClaw 在 macOS / Windows / Linux 三 OS 都能存取用户凭证（LLM API Key、Bot Token 等），同时：

- 代码完全统一（无 `cfg(target_os)` 分支）
- 跨 OS 行为一致（用户切机器 / IT 部署预期 100% 可重现）
- 文件权限保护到位（仅当前用户可读写）
- 旧 macOS 用户 Keychain 凭证自动迁移（不丢数据）

---

## 二、方案选择

### 候选

| 方案 | 代码复杂度 | macOS Keychain | Win DPAPI | Linux Secret Service | 备注 |
|---|---|---|---|---|---|
| **keyring crate**（首版调研） | 高（cfg 分支） | ✅ | ✅ | ⚠️ 依赖 D-Bus | 安全级别最高 |
| **明文 JSON 文件**（本期采用） | 低（无 cfg） | ❌ | ❌ | ❌ | 100% 行为统一 |
| 混合方案（mac Keychain / Win+Linux 文件）| 中 | ✅ | ❌ | ❌ | 行为不一致 |

### 最终决策 D1

**三 OS 全明文 JSON**（用户决策，2026-05-12）。

理由：
1. **完全抄 [hermes-desktop](https://github.com/hermes-agent/hermes-desktop)**（src/main/config.ts L399-401）— 一份成熟的参考实现，三 OS 行为完全一致
2. **代码零 cfg 分支** — 跨 OS 维护成本最低
3. **本期无证书** — 跨平台首发不阻塞，证书到位后切签名 / Updater
4. **文件权限保护够用** — 仅当前用户访问（Unix 0600 / Windows NTFS ACL）
5. **企业 IT 渠道天然适配** — `{BRAND}_HOME` 环境变量统一部署目录

代价：
- **macOS 退化**：现有用户从 Keychain → JSON 文件
- **migration 必做**：自动迁移现有 Keychain 条目，用户无感知（详见 §四）

---

## 三、文件格式

### 路径

```
{DATA_DIR}/credentials.json
```

`{DATA_DIR}` 解析（见 [`packages/core/src/infrastructure/data-dir.ts`](../../packages/core/src/infrastructure/data-dir.ts)）：

1. **优先**：`{BRAND_NAME_UPPER}_HOME` 环境变量（`EVOCLAW_HOME` / `HEALTHCLAW_HOME`）
2. **fallback**：`{home}/{BRAND_DATA_DIR}`（如 `~/.evoclaw` / `~/.healthclaw`）
   - macOS / Linux：`HOME`
   - Windows：`USERPROFILE`

### 格式

平铺 JSON map：

```json
{
  "com.evoclaw.app.weixin::bot_token": "<value>",
  "com.evoclaw.app.anthropic::default": "<value>"
}
```

Key 形态：`{SERVICE_PREFIX}.{service}::{account}`
- `SERVICE_PREFIX` = Tauri identifier，构建时注入（`com.evoclaw.app` / `com.healthclaw.app`）
- `service` = 业务层 service name（如 `weixin` / `anthropic`）
- `account` = 业务层 account name（如 `bot_token` / `default`）

### 权限保护

| OS | 实现 |
|---|---|
| **macOS / Linux** | `std::os::unix::fs::PermissionsExt::set_mode(0o600)` 原子写完后 chmod |
| **Windows** | 依赖 NTFS ACL（文件位于 `%USERPROFILE%\\.{brand}\\`，默认仅当前用户访问；可用 `icacls` 加固） |

### 原子写入

```
1. 序列化 → credentials.json.tmp
2. (Unix) chmod 0600 tmp
3. fs.rename(tmp, credentials.json)
4. 全局 Mutex 防 read-modify-write 竞态
```

读失败 / 解析失败 → fail-soft 返回空 map，日志 warn 但不上抛（避免 boot 阶段单点故障）。

---

## 四、macOS Keychain → JSON Migration

### 触发时机

Tauri `setup()` hook 阶段（应用启动），一次性自动跑。

代码位置：[`apps/desktop/src-tauri/src/credential_migration.rs`](../../apps/desktop/src-tauri/src/credential_migration.rs)

### 流程

```
┌─ 启动 ──────────────────────────────┐
│                                     │
│  检查 marker `.credentials-migrated`│
│         │                           │
│         ├─ 存在 → 跳过迁移 ✓       │
│         │                           │
│         └─ 不存在                   │
│                ↓                    │
│        cfg(target_os = "macos")     │
│                ↓                    │
│  遍历 LEGACY_KEYCHAIN_ITEMS 清单     │
│  （当前仅 weixin/bot_token 一条）   │
│                ↓                    │
│  security_framework::get_password() │
│         │                           │
│         ├─ 不存在 → 跳过该条目      │
│         │                           │
│         └─ 读出 bytes               │
│                ↓                    │
│  Entry API 写入新 JSON              │
│  （新文件已有同 key 时不覆盖）      │
│                ↓                    │
│  delete_generic_password() 删旧条目│
│                ↓                    │
│  写 marker 文件                     │
└─────────────────────────────────────┘
```

### LEGACY_KEYCHAIN_ITEMS 清单维护

随凭证调用点扩展同步更新（grep `credential_set` 是全 repo 唯一源）：

```rust
#[cfg(target_os = "macos")]
const LEGACY_KEYCHAIN_ITEMS: &[(&str, &str)] = &[
    ("weixin", "bot_token"),
    // ↑ 新增凭证调用时在此追加
];
```

当前调用方：`apps/desktop/src/components/ExpertSettingsPanel.tsx:141`（微信 bot_token）

### 非 macOS 平台

Win/Linux 写 marker 文件占位，避免每次启动重复检查（marker 内容 `"non-macos-noop"`）。

---

## 五、企业部署

### 统一数据目录（IT 强制）

| 场景 | 推荐路径 | 方式 |
|---|---|---|
| **多用户 Windows 工作站** | `C:\ProgramData\<Brand>` | GPO 推 `setx /M EVOCLAW_HOME ...` |
| **macOS 公司池机** | `/Library/Application Support/<Brand>` | MDM profile 注入环境变量 |
| **Linux 服务器** | `/opt/<brand>` | Ansible / Salt 推送 |

### 自动备份策略

- ✅ 公司备份系统备份 `{DATA_DIR}` 整目录（每日 / 周）
- ✅ 设备失败时新机装应用 → 还原 `credentials.json` 即可恢复 LLM 配置
- ⚠️ **警告**：不要让员工把 `credentials.json` 同步到 **Dropbox / iCloud Drive / OneDrive 个人版** — 第三方云盘会把明文 API Key 同步到公司外
- ✅ 公司管控的 OneDrive for Business / Google Drive Workspace 可以（审计在）

### 凭证轮换

```bash
# 列出当前所有凭证
cat ~/.evoclaw/credentials.json

# 删除指定服务的所有 key
# 暂无 CLI，目前需手工编辑 JSON 文件
# TODO（PR-A8+）：scripts/credential-clean.mjs
```

---

## 六、对比 Hermes-desktop

| 维度 | Hermes-desktop | EvoClaw (本方案) |
|---|---|---|
| 存储格式 | 明文 JSON `~/.hermes/auth.json` | 明文 JSON `~/.{brand}/credentials.json` |
| 数据结构 | `{ "credential_pool": { "anthropic": [{key, label}] } }` | 平铺 `{ "{prefix}.{service}::{account}": value }` |
| 文件权限 | 依赖 fs 默认 | 显式 chmod 0600 (Unix) |
| 跨账户 | 单文件 | 单文件 |
| migration | 无（从未支持 Keychain） | macOS Keychain → JSON 一次性自动迁移 |
| IT 部署变量 | `HERMES_HOME` | `EVOCLAW_HOME` / `HEALTHCLAW_HOME` |

Hermes 全静态明文，EvoClaw 加 Unix 权限保护 + 一次性 migration，**本质策略一致**。

---

## 七、安全边界

### 保护范围

- ✅ 同机其他用户读不到凭证文件（文件系统级隔离）
- ✅ 其他进程没 `<currentUser>` 权限读不到（Unix 0600 / Windows ACL）
- ✅ Agent 跨进程访问受 `PermissionState::check_credential_access` 门控（Skill 类别 Deny 时拒绝）
- ✅ Git diff / 日志脱敏自动跳过 credentials.json（PII Sanitizer）

### 不保护

- ❌ root / Administrator 用户能读所有用户的文件
- ❌ 物理机访问 + 单用户开机自动登录场景
- ❌ 备份介质丢失 / 公司管控不当
- ❌ 恶意软件以 `<currentUser>` 权限运行（凭证不加密，目标即可读）

### 未来加固（推迟，非本期范围）

- 使用本机 `keyring` crate 加密文件主密钥（让 keychain 仅保管 32 字节 master key，文件还是 JSON 但用 AES-256-GCM 加密）
- 集成 Windows Credential Manager API（同上，仅存 master key）
- macOS Secure Enclave 集成（同上 + TPM 等价）
- 加 audit log（凭证读写都记一笔）

加固的代价：复杂度 + 跨平台 cfg 分支，与本期"完全统一"决策冲突。等"安全合规"成强需求时再做。

---

## 八、调用方约定

### 前端
```ts
// 写入
await invoke('credential_set', {
  service: 'weixin',
  account: 'bot_token',
  value: 'xxxxx',
});

// 读取
const result = await invoke<CredentialResult>('credential_get', {
  service: 'weixin',
  account: 'bot_token',
});
```

### Rust 端 API（不变）

`apps/desktop/src-tauri/src/credential.rs` 暴露三个 `#[tauri::command]`：
- `credential_set(service, account, value, agent_id?)`
- `credential_get(service, account, agent_id?)` → 返回 `value` 或 `error`
- `credential_delete(service, account, agent_id?)`

`agent_id?` 参数：Agent 间接调用时填，触发 `PermissionState::check_credential_access` 门控。

### Rust 内部（凭证 helper）

```rust
use crate::credential::{credentials_path, data_dir};

// 拿到 ~/.{brand}/ 路径
let dir = data_dir();
// 拿到 ~/.{brand}/credentials.json 路径
let path = credentials_path();
```

---

## 九、迁移路径（未来切签名后）

当 Authenticode 商用证书到位（Phase 3）：
1. 凭证文件保持明文 JSON 不变
2. 加 Tauri Auto-Updater（需签名）实现增量升级
3. Skill 安装包加签名校验
4. 凭证文件**仍是明文**（除非用户明确反馈需要进一步加密）

凭证加密推迟，因为：
- 单用户桌面应用面临的威胁模型主要是"同机其他账户"，文件权限保护已覆盖
- 加密 vs 明文，对"恶意软件以 currentUser 身份运行"场景**没差别**
- 加密增加复杂度（key 管理）和故障点（key 丢了凭证全废）

---

## 十、相关链接

- [M14-CrossPlatform-Plan.md](../iteration-plans/M14-CrossPlatform-Plan.md) — 跨平台总方案
- [INSTALL_WINDOWS.md](../install/INSTALL_WINDOWS.md) — Windows 装机指南
- [Hermes-desktop config.ts](https://github.com/hermes-agent/hermes-desktop/blob/main/src/main/config.ts) — 设计灵感
- [credential.rs](../../apps/desktop/src-tauri/src/credential.rs) — Rust 实现
- [credential_migration.rs](../../apps/desktop/src-tauri/src/credential_migration.rs) — macOS Keychain 迁移
- [data-dir.ts](../../packages/core/src/infrastructure/data-dir.ts) — TS 端 getDataDir() helper
