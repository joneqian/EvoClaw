use base64::{Engine as _, engine::general_purpose};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct CryptoResult {
    pub success: bool,
    pub data: Option<String>,
    pub error: Option<String>,
}

/// AES-256-GCM 加密
/// key: base64 encoded 32-byte key
/// plaintext: string to encrypt
/// Returns: base64(nonce + ciphertext)
#[tauri::command]
pub fn encrypt(key: String, plaintext: String) -> CryptoResult {
    match encrypt_impl(&key, &plaintext) {
        Ok(data) => CryptoResult {
            success: true,
            data: Some(data),
            error: None,
        },
        Err(e) => CryptoResult {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

/// AES-256-GCM 解密
/// key: base64 encoded 32-byte key
/// ciphertext: base64(nonce + ciphertext)
#[tauri::command]
pub fn decrypt(key: String, ciphertext: String) -> CryptoResult {
    match decrypt_impl(&key, &ciphertext) {
        Ok(data) => CryptoResult {
            success: true,
            data: Some(data),
            error: None,
        },
        Err(e) => CryptoResult {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

fn encrypt_impl(key_b64: &str, plaintext: &str) -> Result<String, String> {
    let key_bytes = general_purpose::STANDARD
        .decode(key_b64)
        .map_err(|e| format!("密钥解码失败: {}", e))?;

    let unbound_key =
        UnboundKey::new(&AES_256_GCM, &key_bytes).map_err(|_| "无效密钥长度".to_string())?;
    let key = LessSafeKey::new(unbound_key);

    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| "随机数生成失败".to_string())?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);

    let mut in_out = plaintext.as_bytes().to_vec();
    key.seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| "加密失败".to_string())?;

    // Prepend nonce to ciphertext
    let mut result = nonce_bytes.to_vec();
    result.extend_from_slice(&in_out);

    Ok(general_purpose::STANDARD.encode(&result))
}

fn decrypt_impl(key_b64: &str, ciphertext_b64: &str) -> Result<String, String> {
    let key_bytes = general_purpose::STANDARD
        .decode(key_b64)
        .map_err(|e| format!("密钥解码失败: {}", e))?;

    let unbound_key =
        UnboundKey::new(&AES_256_GCM, &key_bytes).map_err(|_| "无效密钥长度".to_string())?;
    let key = LessSafeKey::new(unbound_key);

    let data = general_purpose::STANDARD
        .decode(ciphertext_b64)
        .map_err(|e| format!("密文解码失败: {}", e))?;

    if data.len() < NONCE_LEN {
        return Err("密文过短".to_string());
    }

    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let nonce = Nonce::assume_unique_for_key(nonce_bytes.try_into().unwrap());

    let mut in_out = ciphertext.to_vec();
    let plaintext = key
        .open_in_place(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| "解密失败".to_string())?;

    String::from_utf8(plaintext.to_vec()).map_err(|e| format!("UTF-8 解码失败: {}", e))
}

/// 生成随机 AES-256 密钥（base64 编码）
#[tauri::command]
pub fn generate_key() -> CryptoResult {
    let rng = SystemRandom::new();
    let mut key_bytes = [0u8; 32]; // 256 bits
    match rng.fill(&mut key_bytes) {
        Ok(()) => CryptoResult {
            success: true,
            data: Some(general_purpose::STANDARD.encode(&key_bytes)),
            error: None,
        },
        Err(_) => CryptoResult {
            success: false,
            data: None,
            error: Some("密钥生成失败".to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key_result = generate_key();
        assert!(key_result.success);
        let key = key_result.data.unwrap();

        let plaintext = "Hello, EvoClaw!";
        let encrypted = encrypt_impl(&key, plaintext).unwrap();
        let decrypted = decrypt_impl(&key, &encrypted).unwrap();

        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_invalid_key() {
        let result = encrypt_impl("not-valid-base64!", "test");
        assert!(result.is_err());
    }

    #[test]
    fn test_wrong_key_fails_decrypt() {
        let key1 = generate_key().data.unwrap();
        let key2 = generate_key().data.unwrap();

        let encrypted = encrypt_impl(&key1, "secret").unwrap();
        let result = decrypt_impl(&key2, &encrypted);
        assert!(result.is_err());
    }

    #[test]
    fn test_short_ciphertext() {
        let key = generate_key().data.unwrap();
        let result = decrypt_impl(&key, &general_purpose::STANDARD.encode([0u8; 5]));
        assert!(result.is_err());
    }
}
