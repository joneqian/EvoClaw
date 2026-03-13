mod credential;
mod crypto;
mod sidecar;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
