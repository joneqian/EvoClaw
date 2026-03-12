mod plugins;

use plugins::keychain;
use plugins::crypto;
use std::sync::Mutex;
use tauri::{Manager, State};

struct SidecarState {
    port: Mutex<u16>,
    token: Mutex<String>,
    child: Mutex<Option<std::process::Child>>,
}

#[tauri::command]
fn get_sidecar_info(state: State<SidecarState>) -> Result<(u16, String), String> {
    let port = state.port.lock().map_err(|e| e.to_string())?;
    let token = state.token.lock().map_err(|e| e.to_string())?;
    Ok((*port, token.clone()))
}

#[tauri::command]
fn keychain_get(service: &str, account: &str) -> Result<String, String> {
    keychain::get(service, account)
}

#[tauri::command]
fn keychain_set(service: &str, account: &str, value: &str) -> Result<(), String> {
    keychain::set(service, account, value)
}

#[tauri::command]
fn keychain_delete(service: &str, account: &str) -> Result<(), String> {
    keychain::delete(service, account)
}

#[tauri::command]
fn crypto_encrypt(plaintext: &str, key_b64: &str) -> Result<String, String> {
    crypto::encrypt(plaintext.as_bytes(), key_b64)
}

#[tauri::command]
fn crypto_decrypt(ciphertext_b64: &str, key_b64: &str) -> Result<String, String> {
    let bytes = crypto::decrypt(ciphertext_b64, key_b64)?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn crypto_generate_key() -> String {
    crypto::generate_key()
}

fn generate_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&bytes)
}

fn random_port() -> u16 {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    rng.gen_range(49152..=65535)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = random_port();
    let token = generate_token();

    let sidecar_state = SidecarState {
        port: Mutex::new(port),
        token: Mutex::new(token.clone()),
        child: Mutex::new(None),
    };

    // Get or create DB encryption key from Keychain
    let db_key = match keychain::get("evoclaw", "db-encryption-key") {
        Ok(key) => key,
        Err(_) => {
            // First run: generate a 256-bit hex key and store in Keychain
            use rand::Rng;
            let mut rng = rand::thread_rng();
            let key_bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
            let key = key_bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>();
            let _ = keychain::set("evoclaw", "db-encryption-key", &key);
            key
        }
    };

    // Start Node.js sidecar
    let sidecar_child = std::process::Command::new("node")
        .arg("--experimental-specifier-resolution=node")
        .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/core/dist/server.js"))
        .env("EVOCLAW_PORT", port.to_string())
        .env("EVOCLAW_TOKEN", &token)
        .env("EVOCLAW_DB_KEY", &db_key)
        .spawn();

    match sidecar_child {
        Ok(child) => {
            if let Ok(mut lock) = sidecar_state.child.lock() {
                *lock = Some(child);
            }
            println!("Sidecar started on port {}", port);
        }
        Err(e) => {
            eprintln!("Failed to start sidecar: {}", e);
            // Continue anyway — dev mode may use separate sidecar
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(sidecar_state)
        .invoke_handler(tauri::generate_handler![
            get_sidecar_info,
            keychain_get,
            keychain_set,
            keychain_delete,
            crypto_encrypt,
            crypto_decrypt,
            crypto_generate_key,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<SidecarState>();
                let mut guard = match state.child.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                if let Some(ref mut c) = *guard {
                    let _ = c.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
