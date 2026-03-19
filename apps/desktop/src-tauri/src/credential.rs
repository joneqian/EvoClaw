use base64::{Engine as _, engine::general_purpose};
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
use serde::{Deserialize, Serialize};

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
pub fn credential_set(service: String, account: String, value: String) -> CredentialResult {
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
pub fn credential_get(service: String, account: String) -> CredentialResult {
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
pub fn credential_delete(service: String, account: String) -> CredentialResult {
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
