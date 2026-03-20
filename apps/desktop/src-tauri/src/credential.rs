use base64::{Engine as _, engine::general_purpose};
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::permission::{check_credential_access, PermissionState};

/// Keychain 服务前缀 — 构建时 Tauri 自动注入 identifier，回退到默认值
const SERVICE_PREFIX: &str = match option_env!("TAURI_ENV_IDENTIFIER") {
    Some(id) => id,
    None => "com.evoclaw.app",
};

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialResult {
    pub success: bool,
    pub value: Option<String>,
    pub error: Option<String>,
}

/// 存储凭证到 Keychain
#[tauri::command]
pub fn credential_set(
    state: State<PermissionState>,
    service: String,
    account: String,
    value: String,
    agent_id: Option<String>,
) -> CredentialResult {
    // Agent 发起的请求需要权限检查
    if let Some(ref aid) = agent_id {
        if let Err(e) = check_credential_access(&state, aid) {
            return CredentialResult { success: false, value: None, error: Some(e) };
        }
    }
    let full_service = format!("{}.{}", SERVICE_PREFIX, service);
    match set_generic_password(&full_service, &account, value.as_bytes()) {
        Ok(()) => CredentialResult {
            success: true,
            value: None,
            error: None,
        },
        Err(e) => CredentialResult {
            success: false,
            value: None,
            error: Some(e.to_string()),
        },
    }
}

/// 从 Keychain 获取凭证
#[tauri::command]
pub fn credential_get(
    state: State<PermissionState>,
    service: String,
    account: String,
    agent_id: Option<String>,
) -> CredentialResult {
    if let Some(ref aid) = agent_id {
        if let Err(e) = check_credential_access(&state, aid) {
            return CredentialResult { success: false, value: None, error: Some(e) };
        }
    }
    let full_service = format!("{}.{}", SERVICE_PREFIX, service);
    match get_generic_password(&full_service, &account) {
        Ok(bytes) => {
            let value = String::from_utf8(bytes.to_vec()).unwrap_or_else(|_| {
                general_purpose::STANDARD.encode(&bytes)
            });
            CredentialResult {
                success: true,
                value: Some(value),
                error: None,
            }
        }
        Err(e) => CredentialResult {
            success: false,
            value: None,
            error: Some(e.to_string()),
        },
    }
}

/// 从 Keychain 删除凭证
#[tauri::command]
pub fn credential_delete(
    state: State<PermissionState>,
    service: String,
    account: String,
    agent_id: Option<String>,
) -> CredentialResult {
    if let Some(ref aid) = agent_id {
        if let Err(e) = check_credential_access(&state, aid) {
            return CredentialResult { success: false, value: None, error: Some(e) };
        }
    }
    let full_service = format!("{}.{}", SERVICE_PREFIX, service);
    match delete_generic_password(&full_service, &account) {
        Ok(()) => CredentialResult {
            success: true,
            value: None,
            error: None,
        },
        Err(e) => CredentialResult {
            success: false,
            value: None,
            error: Some(e.to_string()),
        },
    }
}
