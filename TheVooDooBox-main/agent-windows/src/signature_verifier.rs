use winapi::um::wintrust::{WinVerifyTrust, WINTRUST_DATA, WINTRUST_FILE_INFO, WTD_UI_NONE, WTD_REVOKE_NONE, WTD_CHOICE_FILE, WTD_STATEACTION_VERIFY, WTD_DISABLE_MD2_MD4};
use winapi::shared::guiddef::GUID;
use winapi::um::handleapi::INVALID_HANDLE_VALUE;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::ptr;
use chrono;

// Re-defining TRUST_E_PROVIDER_UNKNOWN as it might be missing in some winapi versions or requires specific feature
const TRUST_E_PROVIDER_UNKNOWN: i32 = -2146762495; // 0x800B0001 as i32
const TRUST_E_ACTION_UNKNOWN: i32 = -2146762494; // 0x800B0002
const TRUST_E_SUBJECT_FORM_UNKNOWN: i32 = -2146762493; // 0x800B0003
const TRUST_E_SUBJECT_NOT_TRUSTED: i32 = -2146762492; // 0x800B0004
const DIG_SIG_TRUST_E_EXPLICIT_NO_ICA: i32 = -2146762484; // 0x800B000C (Not exact name but close, error for no signature?)
const TRUST_E_NOSIGNATURE: i32 = -2146762496; // 0x800B0100
const CERT_E_CHAINING: i32 = -2146762486; // 0x800B010A

pub fn verify_signature(file_path: &str) -> String {
    let wide_path: Vec<u16> = OsStr::new(file_path).encode_wide().chain(std::iter::once(0)).collect();

    let mut file_info = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: wide_path.as_ptr(),
        hFile: ptr::null_mut(),
        pgKnownSubject: ptr::null_mut(),
    };

    let mut win_trust_data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        pPolicyCallbackData: ptr::null_mut(),
        pSIPClientData: ptr::null_mut(),
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        u: unsafe { std::mem::zeroed() }, // Union initialization
        dwStateAction: WTD_STATEACTION_VERIFY,
        hWVTStateData: INVALID_HANDLE_VALUE,
        pwszURLReference: ptr::null_mut(),
        dwProvFlags: WTD_DISABLE_MD2_MD4, 
        dwUIContext: 0,
        pSignatureSettings: ptr::null_mut(),
    };

    // Assign the file info to the union
    unsafe {
        *win_trust_data.u.pFile_mut() = &mut file_info;
    }

    // WINTRUST_ACTION_GENERIC_VERIFY_V2 GUID
    // {00AAC56B-CD44-11d0-8CC2-00C04FC295EE}
    let mut action_guid = GUID {
        Data1: 0x00AAC56B,
        Data2: 0xCD44,
        Data3: 0x11d0,
        Data4: [0x8C, 0xC2, 0x00, 0xC0, 0x4F, 0xC2, 0x95, 0xEE],
    };

    let status = unsafe {
        WinVerifyTrust(
            ptr::null_mut(),
            &mut action_guid,
            &mut win_trust_data as *mut _ as *mut std::ffi::c_void,
        )
    };

    // DEBUG LOGGING
    let log_folder = "C:\\Mallab";
    let log_path = "C:\\Mallab\\voodoobox_debug.log";
    let _ = std::fs::create_dir_all(log_folder);
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
        use std::io::Write;
        let _ = writeln!(file, "[{}] Checking: {} | Status: {:#x}", chrono::Local::now(), file_path, status);
    }

    // Clean up handle (though for WTD_STATEACTION_VERIFY it might not be strictly needed as we didn't open state)
    // If we used WTD_STATEACTION_VERIFY, we should technically call it again with WTD_STATEACTION_CLOSE
    // But WinVerifyTrust often handles this locally for simple verification. 
    // Best practice: Close it.
    win_trust_data.dwStateAction = winapi::um::wintrust::WTD_STATEACTION_CLOSE;
     unsafe {
        WinVerifyTrust(
            ptr::null_mut(),
            &mut action_guid,
            &mut win_trust_data as *mut _ as *mut std::ffi::c_void,
        );
    };

    match status {
        0 => "Signed (Verified)".to_string(), // ERROR_SUCCESS
        _ => {
            let err = status as i32;
            if err == TRUST_E_NOSIGNATURE {
                "Unsigned".to_string()
            } else if err == TRUST_E_SUBJECT_NOT_TRUSTED {
                "Signed (Untrusted Root)".to_string() 
            } else if err == CERT_E_CHAINING {
                "Signed (Untrusted Root - Chain Issue)".to_string()
            } else if err == TRUST_E_PROVIDER_UNKNOWN {
                "Unsigned (Unknown Provider)".to_string()
            } else {
                 format!("Unsigned (Error Code: {:#x})", status)
            }
        }
    }
}
