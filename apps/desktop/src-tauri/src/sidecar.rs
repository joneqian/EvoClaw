use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct SidecarInfo {
    pub port: u16,
    pub token: String,
    pub running: bool,
}

// Global state for sidecar info
// In Sprint 1, we just provide a placeholder.
// The actual sidecar launch will read stdout JSON from the Node.js process.
static SIDECAR_INFO: Mutex<Option<SidecarInfo>> = Mutex::new(None);

/// 获取 Sidecar 连接信息
#[tauri::command]
pub fn get_sidecar_info() -> Result<SidecarInfo, String> {
    let info = SIDECAR_INFO.lock().map_err(|e| e.to_string())?;
    match info.as_ref() {
        Some(info) => Ok(info.clone()),
        None => Err("Sidecar 未启动".to_string()),
    }
}

/// 设置 Sidecar 信息（内部使用）
pub fn set_sidecar_info(port: u16, token: String) {
    let mut info = SIDECAR_INFO.lock().unwrap();
    *info = Some(SidecarInfo {
        port,
        token,
        running: true,
    });
}
