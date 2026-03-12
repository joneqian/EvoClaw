use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

pub fn get(service: &str, account: &str) -> Result<String, String> {
    match get_generic_password(service, account) {
        Ok(bytes) => String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string()),
        Err(e) => Err(format!("Keychain get failed: {}", e)),
    }
}

pub fn set(service: &str, account: &str, value: &str) -> Result<(), String> {
    // Try delete first to avoid duplicate errors
    let _ = delete_generic_password(service, account);
    set_generic_password(service, account, value.as_bytes())
        .map_err(|e| format!("Keychain set failed: {}", e))
}

pub fn delete(service: &str, account: &str) -> Result<(), String> {
    delete_generic_password(service, account)
        .map_err(|e| format!("Keychain delete failed: {}", e))
}
