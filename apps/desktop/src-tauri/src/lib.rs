mod credential;
mod crypto;
mod sidecar;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 启动 Node.js Sidecar
            if let Err(e) = sidecar::spawn_sidecar(app) {
                eprintln!("[setup] Sidecar 启动失败: {}", e);
                // 不阻止应用启动，前端会显示连接失败状态
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // 主窗口关闭时清理 Sidecar
                sidecar::shutdown_sidecar(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            sidecar::get_sidecar_info,
            credential::credential_set,
            credential::credential_get,
            credential::credential_delete,
            crypto::encrypt,
            crypto::decrypt,
            crypto::generate_key,
        ])
        .run(tauri::generate_context!())
        .expect("启动 EvoClaw 失败");
}
