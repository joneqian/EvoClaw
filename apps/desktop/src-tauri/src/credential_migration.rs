//! M14 PR-A1: macOS Keychain → JSON 文件一次性迁移
//!
//! 仅 macOS 编译进来；Win/Linux 模块为 no-op。
//!
//! 触发时机：Tauri setup 阶段（一次）。
//! 防重入：通过 marker 文件 `{data_dir}/.credentials-migrated` 判断已迁移。
//! 失败策略：单条迁移失败不阻塞其他条目，错误仅日志记录，不上抛。
//!
//! 已知迁移条目（`LEGACY_KEYCHAIN_ITEMS`）需要随凭证调用点扩展同步追加。
//! 当前 EvoClaw 仅前端 `ExpertSettingsPanel.tsx` 中 1 处 credential_set 调用，
//! service=`weixin` / account=`bot_token`。

use std::collections::BTreeMap;

use crate::credential::{credentials_path, data_dir, read_store_at, write_store_at, SERVICE_PREFIX};

/// Marker 文件名 — 存在则跳过迁移
const MIGRATION_MARKER: &str = ".credentials-migrated";

/// 已知需迁移的 Keychain 条目清单（service, account）
/// 实际 Keychain service 字段 = `{SERVICE_PREFIX}.{service}`
///
/// 新加凭证调用点（grep `credential_set` / `credential_get`）时**必须**同步更新此清单。
#[cfg(target_os = "macos")]
const LEGACY_KEYCHAIN_ITEMS: &[(&str, &str)] = &[
    ("weixin", "bot_token"),
    // ↑ 新增条目格式: ("service", "account"),
];

/// 公开入口 — Tauri setup 阶段调用
///
/// macOS：执行实际迁移逻辑
/// Win/Linux：no-op，仅打日志
pub fn migrate_from_keychain_if_needed() {
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = run_macos_migration() {
            eprintln!("[credential-migration] 迁移失败: {}", e);
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // 非 macOS 平台：marker 文件不存在则直接写 marker（避免每次启动重复检查）
        let marker = data_dir().join(MIGRATION_MARKER);
        if !marker.exists() {
            if let Some(parent) = marker.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&marker, b"non-macos-noop");
        }
    }
}

/// macOS 实际迁移：读 Keychain → 写 JSON → 删 Keychain → 写 marker
#[cfg(target_os = "macos")]
fn run_macos_migration() -> Result<(), String> {
    use security_framework::passwords::{delete_generic_password, get_generic_password};

    let marker = data_dir().join(MIGRATION_MARKER);
    if marker.exists() {
        // 已迁移过，跳过
        return Ok(());
    }

    eprintln!(
        "[credential-migration] 开始 macOS Keychain → JSON 迁移 (prefix={})",
        SERVICE_PREFIX
    );

    let path = credentials_path();
    let mut store: BTreeMap<String, String> = read_store_at(&path);
    let mut migrated_count = 0usize;
    let mut skipped_count = 0usize;

    for (service, account) in LEGACY_KEYCHAIN_ITEMS {
        let full_service = format!("{}.{}", SERVICE_PREFIX, service);

        // 1. 尝试读旧 Keychain
        match get_generic_password(&full_service, account) {
            Ok(bytes) => {
                let value = match String::from_utf8(bytes.to_vec()) {
                    Ok(s) => s,
                    Err(_) => {
                        // 非 UTF-8 → base64 编码保留
                        use base64::{engine::general_purpose, Engine as _};
                        general_purpose::STANDARD.encode(&bytes)
                    }
                };

                // 2. 写入新 JSON store（用与 credential.rs 一致的 key 格式）
                //    用 Entry API：新文件已有同 key（用户在新版本里又设置过）则不覆盖
                let key = format!("{}.{}::{}", SERVICE_PREFIX, service, account);
                use std::collections::btree_map::Entry;
                match store.entry(key) {
                    Entry::Occupied(occupied) => {
                        eprintln!(
                            "[credential-migration] {} 新文件已有，跳过 Keychain 值覆盖",
                            occupied.key()
                        );
                        skipped_count += 1;
                    }
                    Entry::Vacant(vacant) => {
                        vacant.insert(value);
                        migrated_count += 1;
                    }
                }

                // 3. 删旧 Keychain 条目（即使新文件已有，也清理掉旧条目）
                if let Err(e) = delete_generic_password(&full_service, account) {
                    eprintln!(
                        "[credential-migration] 删除 Keychain {}::{} 失败: {}",
                        full_service, account, e
                    );
                    // 不算迁移失败，继续
                }
            }
            Err(_) => {
                // Keychain 没有此条目（用户从未设置）— 跳过即可，不算失败
                skipped_count += 1;
            }
        }
    }

    // 4. 把累积的 store 写回（仅当真有迁移条目时才写）
    //    写入失败不写 marker，下次启动重试
    if migrated_count > 0 {
        if let Err(e) = write_store_at(&path, &store) {
            eprintln!("[credential-migration] 写入新 JSON 失败: {}", e);
            return Err(format!("写入失败，不写 marker，下次重试: {}", e));
        }
    }

    // 5. 写 marker 文件防重复迁移
    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建数据目录失败: {}", e))?;
    }
    std::fs::write(&marker, format!("migrated_at={}", chrono_now_iso()))
        .map_err(|e| format!("写 marker 失败: {}", e))?;

    eprintln!(
        "[credential-migration] 完成: migrated={} skipped={}",
        migrated_count, skipped_count
    );
    Ok(())
}

/// 当前时间 ISO-8601 字符串（不引入 chrono crate，用 SystemTime 简单格式化）
#[cfg(target_os = "macos")]
fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => format!("epoch_secs={}", d.as_secs()),
        Err(_) => "unknown".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证 marker 已存在时 migrate 直接跳过（idempotent）
    /// 注意：本测试不验证真实 macOS Keychain 调用 — 那需要 GUI 授权弹窗，
    /// 单元测试环境跑不通。Keychain 实际迁移依赖 PR 的手动验证步骤。
    #[test]
    fn migrate_skips_when_marker_exists() {
        // 预先写 marker 文件，模拟"已迁移"状态
        let marker = data_dir().join(MIGRATION_MARKER);
        if let Some(parent) = marker.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&marker, b"test-marker-pre-existing").unwrap();

        // 跑迁移 — 应该立即返回，不触发任何 Keychain 调用
        migrate_from_keychain_if_needed();

        // marker 仍然存在且内容未被覆盖
        assert!(marker.exists(), "marker 文件应保留");
        let content = std::fs::read_to_string(&marker).unwrap();
        assert_eq!(
            content, "test-marker-pre-existing",
            "已存在 marker 不应被覆盖（说明 migrate 跳过了写入步骤）"
        );

        // 清理测试 marker 避免污染下次手动测试
        let _ = std::fs::remove_file(&marker);
    }
}
