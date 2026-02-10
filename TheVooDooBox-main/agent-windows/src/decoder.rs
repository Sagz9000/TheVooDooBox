use base64::{Engine as _, engine::general_purpose};
use regex::Regex;

pub struct DecodeResult {
    pub original: String,
    pub decoded: String,
    pub method: String,
}

pub fn scan_and_decode(input: &str) -> Vec<DecodeResult> {
    let mut results = Vec::new();

    // 1. Base64 Detection
    // Regex for potential base64 strings (length >= 16)
    let b64_re = Regex::new(r"[A-Za-z0-9+/]{16,}={0,2}").unwrap();
    
    for mat in b64_re.find_iter(input) {
        let candidate = mat.as_str();
        if let Ok(decoded_bytes) = general_purpose::STANDARD.decode(candidate) {
            // Check if it's UTF-8
            if let Ok(decoded_str) = String::from_utf8(decoded_bytes.clone()) {
                if is_interesting(&decoded_str) {
                    results.push(DecodeResult {
                        original: candidate.to_string(),
                        decoded: decoded_str,
                        method: "Base64".to_string(),
                    });
                }
            } else {
                // Not UTF-8, maybe it's binary or XORed
                // Check if it's an MZ/PE file
                if decoded_bytes.starts_with(b"MZ") {
                     results.push(DecodeResult {
                        original: candidate.to_string(),
                        decoded: "[BINARY: PE/MZ Header Detected]".to_string(),
                        method: "Base64".to_string(),
                    });
                }
                
                // Try XOR Brute Force on the decoded bytes
                if let Some(xor_res) = xor_brute_force(&decoded_bytes) {
                    results.push(DecodeResult {
                        original: candidate.to_string(),
                        decoded: xor_res,
                        method: "Base64+XOR".to_string(),
                    });
                }
            }
        }
    }

    // 2. Direct XOR Brute Force for non-base64 blobs (e.g. hex-encoded or raw in binary)
    // This is more complex because we don't know where the blob starts.
    // For now, we only run it on the whole input if it's short, or on specific high-entropy parts.
    // Simplification: If the input itself looks like a hex string, try it.
    let hex_re = Regex::new(r"([0-9a-fA-F]{2}){10,}").unwrap();
    for mat in hex_re.find_iter(input) {
        let candidate = mat.as_str();
        if let Ok(bytes) = hex::decode(candidate) {
            if let Some(xor_res) = xor_brute_force(&bytes) {
                 results.push(DecodeResult {
                    original: candidate.to_string(),
                    decoded: xor_res,
                    method: "Hex+XOR".to_string(),
                });
            }
        }
    }

    results
}

fn is_interesting(s: &str) -> bool {
    let s_lower = s.to_lowercase();
    let keywords = vec![
        "http", "https", "ftp", "Invoke-", "PowerShell", "cmd.exe", 
        "VirtualAlloc", "WriteProcessMemory", "CreateRemoteThread",
        "temp", "AppData", "reg add", "schtasks", "net user",
        "User-Agent", "Mozilla", "Content-Type", ".exe", ".dll", ".vbs", ".js"
    ];

    keywords.iter().any(|&kw| s_lower.contains(&kw.to_lowercase()))
}

fn xor_brute_force(data: &[u8]) -> Option<String> {
    if data.len() < 10 { return None; }

    for key in 1..255u8 {
        let xored: Vec<u8> = data.iter().map(|&b| b ^ key).collect();
        if let Ok(s) = String::from_utf8(xored) {
            if is_printable(&s) && is_interesting(&s) {
                return Some(format!("[Key: 0x{:02X}] {}", key, s));
            }
        }
    }
    None
}

fn is_printable(s: &str) -> bool {
    let printable_count = s.chars().filter(|c| c.is_ascii_graphic() || c.is_ascii_whitespace()).count();
    (printable_count as f32 / s.chars().count() as f32) > 0.9
}
