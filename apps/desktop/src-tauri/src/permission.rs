use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

/// 权限作用域 — 与 Node.js 端 PermissionScope 对齐
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PermissionScope {
    Once,
    Session,
    Always,
    Deny,
}

/// 权限类别 — 与 Node.js 端 PermissionCategory 对齐
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PermissionCategory {
    FileRead,
    FileWrite,
    Network,
    Shell,
    Browser,
    Mcp,
    Skill,
}

/// 全局权限状态 — Mutex 保护的 HashMap
/// key = (agent_id, category), value = scope
pub struct PermissionState(pub Mutex<HashMap<(String, PermissionCategory), PermissionScope>>);

impl PermissionState {
    pub fn new() -> Self {
        PermissionState(Mutex::new(HashMap::new()))
    }

    /// 检查权限
    pub fn check(&self, agent_id: &str, category: &PermissionCategory) -> Option<PermissionScope> {
        let map = self.0.lock().unwrap();
        map.get(&(agent_id.to_string(), category.clone())).cloned()
    }

    /// 授予/更新权限
    pub fn grant(&self, agent_id: &str, category: PermissionCategory, scope: PermissionScope) {
        let mut map = self.0.lock().unwrap();
        map.insert((agent_id.to_string(), category), scope);
    }

    /// 撤销权限
    pub fn revoke(&self, agent_id: &str, category: &PermissionCategory) {
        let mut map = self.0.lock().unwrap();
        map.remove(&(agent_id.to_string(), category.clone()));
    }

    /// 清除所有权限（测试用）
    #[cfg(test)]
    pub fn clear_all(&self) {
        let mut map = self.0.lock().unwrap();
        map.clear();
    }

    /// 全量同步（替换所有权限）
    pub fn sync_all(&self, entries: Vec<(String, PermissionCategory, PermissionScope)>) {
        let mut map = self.0.lock().unwrap();
        map.clear();
        for (agent_id, category, scope) in entries {
            map.insert((agent_id, category), scope);
        }
    }
}

/// 检查 credential 访问权限
pub fn check_credential_access(
    state: &PermissionState,
    agent_id: &str,
) -> Result<(), String> {
    if let Some(scope) = state.check(agent_id, &PermissionCategory::Skill) {
        if scope == PermissionScope::Deny {
            return Err(format!("Agent {} 的凭证访问权限被拒绝", agent_id));
        }
    }
    Ok(())
}

/// 同步条目（用于从前端批量传入）
#[derive(Debug, Deserialize)]
pub struct SyncEntry {
    pub agent_id: String,
    pub category: PermissionCategory,
    pub scope: PermissionScope,
}

// ─── Tauri 命令 ───

/// 更新单个权限
#[tauri::command]
pub fn update_permission(
    state: State<PermissionState>,
    agent_id: String,
    category: PermissionCategory,
    scope: PermissionScope,
) -> bool {
    state.grant(&agent_id, category, scope);
    true
}

/// 撤销单个权限
#[tauri::command]
pub fn revoke_permission(
    state: State<PermissionState>,
    agent_id: String,
    category: PermissionCategory,
) -> bool {
    state.revoke(&agent_id, &category);
    true
}

/// 全量同步所有权限（启动时 / Sidecar 重启时调用）
#[tauri::command]
pub fn sync_all_permissions(
    state: State<PermissionState>,
    entries: Vec<SyncEntry>,
) -> bool {
    let converted: Vec<(String, PermissionCategory, PermissionScope)> = entries
        .into_iter()
        .map(|e| (e.agent_id, e.category, e.scope))
        .collect();
    state.sync_all(converted);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_grant_and_check() {
        let state = PermissionState::new();
        state.grant("agent-1", PermissionCategory::FileRead, PermissionScope::Always);
        assert_eq!(
            state.check("agent-1", &PermissionCategory::FileRead),
            Some(PermissionScope::Always)
        );
    }

    #[test]
    fn test_revoke() {
        let state = PermissionState::new();
        state.grant("agent-1", PermissionCategory::Shell, PermissionScope::Session);
        state.revoke("agent-1", &PermissionCategory::Shell);
        assert_eq!(state.check("agent-1", &PermissionCategory::Shell), None);
    }

    #[test]
    fn test_clear_all() {
        let state = PermissionState::new();
        state.grant("a", PermissionCategory::Network, PermissionScope::Always);
        state.grant("b", PermissionCategory::Skill, PermissionScope::Deny);
        state.clear_all();
        assert_eq!(state.check("a", &PermissionCategory::Network), None);
        assert_eq!(state.check("b", &PermissionCategory::Skill), None);
    }

    #[test]
    fn test_sync_all() {
        let state = PermissionState::new();
        state.grant("old", PermissionCategory::Browser, PermissionScope::Always);
        state.sync_all(vec![
            ("new".to_string(), PermissionCategory::FileWrite, PermissionScope::Session),
        ]);
        // old entry gone
        assert_eq!(state.check("old", &PermissionCategory::Browser), None);
        // new entry present
        assert_eq!(
            state.check("new", &PermissionCategory::FileWrite),
            Some(PermissionScope::Session)
        );
    }

    #[test]
    fn test_credential_access_denied() {
        let state = PermissionState::new();
        state.grant("agent-x", PermissionCategory::Skill, PermissionScope::Deny);
        assert!(check_credential_access(&state, "agent-x").is_err());
    }

    #[test]
    fn test_credential_access_allowed() {
        let state = PermissionState::new();
        state.grant("agent-y", PermissionCategory::Skill, PermissionScope::Always);
        assert!(check_credential_access(&state, "agent-y").is_ok());
    }
}
