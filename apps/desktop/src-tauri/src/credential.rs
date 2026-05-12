//! M14 PR-A1: 凭证存储 — 文件实现，跨平台（macOS / Windows / Linux 统一）
//!
//! 原 macOS Keychain 实现（security-framework）已移除，三 OS 全部走 JSON 文件：
//!   - 数据文件: `{home}/.{brand}/credentials.json`
//!   - 权限:
//!       - Unix (macOS + Linux): chmod 0o600
//!       - Windows: 文件位于用户 home 目录，依赖 NTFS ACL（默认仅当前用户可访问）
//!   - 格式: 平铺 `{ "{prefix}.{service}::{account}": "value" }` map
//!   - 写入: 原子化（写 .tmp → rename），全局 Mutex 防并发竞态
//!
//! 设计取舍详见 docs/iteration-plans/M14-CrossPlatform-Plan.md D1 决策（抄 Hermes 100%）。
//! 旧 macOS Keychain 凭证由 `credential_migration` 模块在 setup 阶段一次性迁移。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::permission::{check_credential_access, PermissionState};

/// Service 前缀 — 构建时 Tauri 注入 identifier，回退到默认值
pub(crate) const SERVICE_PREFIX: &str = match option_env!("TAURI_ENV_IDENTIFIER") {
    Some(id) => id,
    None => "com.evoclaw.app",
};

/// 全局文件锁 — 避免并发 read-modify-write 竞态
static FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialResult {
    pub success: bool,
    pub value: Option<String>,
    pub error: Option<String>,
}

/// 从 SERVICE_PREFIX 派生 brand 数据目录名
/// 例：`com.evoclaw.app` → `.evoclaw`，`com.healthclaw.app` → `.healthclaw`
fn brand_dir_name() -> String {
    SERVICE_PREFIX
        .split('.')
        .nth(1)
        .filter(|s| !s.is_empty())
        .map(|brand| format!(".{}", brand))
        .unwrap_or_else(|| ".evoclaw".to_string())
}

/// 用户 home 目录（跨平台）
/// Unix 优先 `$HOME`，Windows 优先 `%USERPROFILE%`
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// 数据目录绝对路径：`{home}/.{brand}/`
pub(crate) fn data_dir() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(brand_dir_name())
}

/// credentials.json 完整路径
pub(crate) fn credentials_path() -> PathBuf {
    data_dir().join("credentials.json")
}

/// 组合 key：`{SERVICE_PREFIX}.{service}::{account}`
/// 用 `::` 分隔 service 和 account，因 service 自身可能含 `.`
fn make_key(service: &str, account: &str) -> String {
    format!("{}.{}::{}", SERVICE_PREFIX, service, account)
}

/// 读取整个 credentials.json
/// 文件不存在 / 解析失败时返回空 map（容错），仅日志记录不上抛错误
pub(crate) fn read_store_at(path: &std::path::Path) -> BTreeMap<String, String> {
    if !path.exists() {
        return BTreeMap::new();
    }
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|err| {
            eprintln!(
                "[credential] credentials.json 解析失败，使用空 map: {}",
                err
            );
            BTreeMap::new()
        }),
        Err(err) => {
            eprintln!("[credential] credentials.json 读取失败: {}", err);
            BTreeMap::new()
        }
    }
}

fn read_store() -> BTreeMap<String, String> {
    read_store_at(&credentials_path())
}

/// 原子写入 credentials.json
/// 1. 序列化为 pretty JSON
/// 2. 写入 `.tmp` 文件
/// 3. Unix 上设权限 0o600
/// 4. rename 到目标路径（原子操作）
pub(crate) fn write_store_at(
    path: &std::path::Path,
    store: &BTreeMap<String, String>,
) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "credentials_path 缺 parent 目录".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("创建数据目录失败 {:?}: {}", dir, e))?;

    let json = serde_json::to_string_pretty(store).map_err(|e| format!("序列化失败: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &json).map_err(|e| format!("写 tmp 文件失败 {:?}: {}", tmp, e))?;

    // Unix 系列（macOS + Linux）设权限 0o600
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perm = fs::Permissions::from_mode(0o600);
        if let Err(e) = fs::set_permissions(&tmp, perm) {
            // 不阻断（部分文件系统不支持 chmod），仅警告
            eprintln!("[credential] 设置 0o600 失败 {:?}: {}", tmp, e);
        }
    }

    fs::rename(&tmp, path).map_err(|e| format!("rename {:?} → {:?} 失败: {}", tmp, path, e))?;
    Ok(())
}

fn write_store(store: &BTreeMap<String, String>) -> Result<(), String> {
    write_store_at(&credentials_path(), store)
}

/// 存储凭证到本地文件
#[tauri::command]
pub fn credential_set(
    state: State<PermissionState>,
    service: String,
    account: String,
    value: String,
    agent_id: Option<String>,
) -> CredentialResult {
    if let Some(ref aid) = agent_id {
        if let Err(e) = check_credential_access(&state, aid) {
            return CredentialResult {
                success: false,
                value: None,
                error: Some(e),
            };
        }
    }
    let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut store = read_store();
    store.insert(make_key(&service, &account), value);
    match write_store(&store) {
        Ok(()) => CredentialResult {
            success: true,
            value: None,
            error: None,
        },
        Err(e) => CredentialResult {
            success: false,
            value: None,
            error: Some(e),
        },
    }
}

/// 从本地文件获取凭证
#[tauri::command]
pub fn credential_get(
    state: State<PermissionState>,
    service: String,
    account: String,
    agent_id: Option<String>,
) -> CredentialResult {
    if let Some(ref aid) = agent_id {
        if let Err(e) = check_credential_access(&state, aid) {
            return CredentialResult {
                success: false,
                value: None,
                error: Some(e),
            };
        }
    }
    let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let store = read_store();
    match store.get(&make_key(&service, &account)) {
        Some(v) => CredentialResult {
            success: true,
            value: Some(v.clone()),
            error: None,
        },
        None => CredentialResult {
            success: false,
            value: None,
            error: Some("not found".into()),
        },
    }
}

/// 从本地文件删除凭证（不存在视为成功，idempotent）
#[tauri::command]
pub fn credential_delete(
    state: State<PermissionState>,
    service: String,
    account: String,
    agent_id: Option<String>,
) -> CredentialResult {
    if let Some(ref aid) = agent_id {
        if let Err(e) = check_credential_access(&state, aid) {
            return CredentialResult {
                success: false,
                value: None,
                error: Some(e),
            };
        }
    }
    let _lock = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut store = read_store();
    let key = make_key(&service, &account);
    if store.remove(&key).is_some() {
        match write_store(&store) {
            Ok(()) => CredentialResult {
                success: true,
                value: None,
                error: None,
            },
            Err(e) => CredentialResult {
                success: false,
                value: None,
                error: Some(e),
            },
        }
    } else {
        // 删除不存在的 key 视为成功，符合幂等语义
        CredentialResult {
            success: true,
            value: None,
            error: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;
    use tempfile::TempDir;

    // 所有测试串行执行，避免并发覆写共享的 tmp 目录环境变量
    static TEST_LOCK: StdMutex<()> = StdMutex::new(());

    /// 测试夹具：临时目录 + 隔离的 store path（不污染真实 ~/.{brand}/）
    fn with_temp_store<F: FnOnce(&std::path::Path)>(f: F) {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = TempDir::new().expect("create tempdir");
        let store_path = tmp.path().join("credentials.json");
        f(&store_path);
    }

    #[test]
    fn brand_dir_name_parses_service_prefix() {
        // SERVICE_PREFIX 默认 com.evoclaw.app → .evoclaw
        let name = brand_dir_name();
        assert!(
            name.starts_with('.'),
            "brand_dir_name should start with '.', got {}",
            name
        );
        assert!(
            name.len() > 1,
            "brand_dir_name should be non-empty after dot, got {}",
            name
        );
    }

    #[test]
    fn make_key_formats_correctly() {
        let key = make_key("anthropic", "default");
        assert!(key.starts_with(SERVICE_PREFIX));
        assert!(key.contains(".anthropic::default"));
    }

    #[test]
    fn write_then_read_roundtrip() {
        with_temp_store(|path| {
            let mut store = BTreeMap::new();
            store.insert("foo".to_string(), "bar".to_string());
            store.insert("baz".to_string(), "qux".to_string());

            write_store_at(path, &store).expect("write ok");
            assert!(path.exists(), "credentials.json should exist after write");

            let read_back = read_store_at(path);
            assert_eq!(read_back.len(), 2);
            assert_eq!(read_back.get("foo"), Some(&"bar".to_string()));
            assert_eq!(read_back.get("baz"), Some(&"qux".to_string()));
        });
    }

    #[test]
    fn read_nonexistent_returns_empty() {
        with_temp_store(|path| {
            let store = read_store_at(path);
            assert!(store.is_empty());
        });
    }

    #[test]
    fn read_corrupt_returns_empty_no_panic() {
        with_temp_store(|path| {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "{ not json at all").unwrap();
            let store = read_store_at(path);
            assert!(
                store.is_empty(),
                "corrupt JSON should yield empty map, not panic"
            );
        });
    }

    #[test]
    fn write_overwrites_atomically() {
        with_temp_store(|path| {
            let mut v1 = BTreeMap::new();
            v1.insert("a".to_string(), "1".to_string());
            write_store_at(path, &v1).expect("write v1");

            let mut v2 = BTreeMap::new();
            v2.insert("a".to_string(), "2".to_string());
            v2.insert("b".to_string(), "3".to_string());
            write_store_at(path, &v2).expect("write v2");

            let read = read_store_at(path);
            assert_eq!(read.get("a"), Some(&"2".to_string()));
            assert_eq!(read.get("b"), Some(&"3".to_string()));
        });
    }

    #[cfg(unix)]
    #[test]
    fn unix_permissions_are_0600() {
        use std::os::unix::fs::PermissionsExt;

        with_temp_store(|path| {
            let mut store = BTreeMap::new();
            store.insert("k".to_string(), "v".to_string());
            write_store_at(path, &store).expect("write ok");

            let meta = fs::metadata(path).expect("stat ok");
            let mode = meta.permissions().mode() & 0o777;
            assert_eq!(
                mode, 0o600,
                "credentials.json must be 0o600 (got 0o{:o})",
                mode
            );
        });
    }

    #[test]
    fn delete_missing_key_is_idempotent() {
        with_temp_store(|path| {
            let mut store = BTreeMap::new();
            store.insert("exists".to_string(), "v".to_string());
            write_store_at(path, &store).expect("write ok");

            // 模拟删除不存在的 key（直接操作 store）
            let mut read = read_store_at(path);
            assert!(read.remove("nonexistent").is_none());
            assert_eq!(read.len(), 1, "existing key untouched");
        });
    }
}
