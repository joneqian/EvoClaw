use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};

const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::URL_SAFE_NO_PAD;

pub fn generate_key() -> String {
    let rng = SystemRandom::new();
    let mut key_bytes = [0u8; 32];
    rng.fill(&mut key_bytes).expect("Failed to generate random key");
    B64.encode(key_bytes)
}

pub fn encrypt(plaintext: &[u8], key_b64: &str) -> Result<String, String> {
    let key_bytes = B64.decode(key_b64).map_err(|e| format!("Invalid key: {}", e))?;
    let unbound_key =
        UnboundKey::new(&AES_256_GCM, &key_bytes).map_err(|e| format!("Bad key: {}", e))?;
    let key = LessSafeKey::new(unbound_key);

    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| "Failed to generate nonce".to_string())?;

    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    let mut in_out = plaintext.to_vec();
    key.seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Prepend nonce to ciphertext
    let mut result = nonce_bytes.to_vec();
    result.extend_from_slice(&in_out);
    Ok(B64.encode(result))
}

pub fn decrypt(ciphertext_b64: &str, key_b64: &str) -> Result<Vec<u8>, String> {
    let key_bytes = B64.decode(key_b64).map_err(|e| format!("Invalid key: {}", e))?;
    let unbound_key =
        UnboundKey::new(&AES_256_GCM, &key_bytes).map_err(|e| format!("Bad key: {}", e))?;
    let key = LessSafeKey::new(unbound_key);

    let data = B64
        .decode(ciphertext_b64)
        .map_err(|e| format!("Invalid ciphertext: {}", e))?;

    if data.len() < 12 {
        return Err("Ciphertext too short".to_string());
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::assume_unique_for_key(nonce_bytes.try_into().unwrap());

    let mut in_out = ciphertext.to_vec();
    let plaintext = key
        .open_in_place(nonce, Aad::empty(), &mut in_out)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    Ok(plaintext.to_vec())
}
