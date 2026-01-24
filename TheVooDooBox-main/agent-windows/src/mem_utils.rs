use winapi::um::processthreadsapi::OpenProcess;
use winapi::um::psapi::{GetModuleFileNameExA, GetModuleInformation, MODULEINFO};
use winapi::um::memoryapi::ReadProcessMemory;
use winapi::um::winnt::{PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
use winapi::um::handleapi::CloseHandle;
use std::ptr;
use std::fs::File;
use std::io::Read;

pub fn scan_process_hollowing(pid: u32) -> Result<bool, String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
        if handle.is_null() {
            return Err("Failed to open process".to_string());
        }

        let mut _module_handle: winapi::shared::minwindef::HMODULE = ptr::null_mut();
        let mut _cb_needed = 0;
        
        // Use psapi to get the base address
        let mut mod_info: MODULEINFO = unsafe { std::mem::zeroed() };
        if GetModuleInformation(handle, ptr::null_mut(), &mut mod_info, std::mem::size_of::<MODULEINFO>() as u32) == 0 {
            CloseHandle(handle);
            return Err("Failed to get module info".to_string());
        }

        let base_address = mod_info.lpBaseOfDll;
        
        // 1. Read header from memory
        let mut mem_header = [0u8; 4096];
        let mut bytes_read = 0;
        if ReadProcessMemory(handle, base_address, mem_header.as_mut_ptr() as *mut _, 4096, &mut bytes_read) == 0 {
            CloseHandle(handle);
            return Err("Failed to read memory".to_string());
        }

        // 2. Read header from disk
        let mut path_buf = [0i8; 512];
        GetModuleFileNameExA(handle, ptr::null_mut(), path_buf.as_mut_ptr(), 512);
        let path = std::ffi::CStr::from_ptr(path_buf.as_ptr()).to_string_lossy().to_string();
        
        CloseHandle(handle);

        if let Ok(mut file) = File::open(&path) {
            let mut disk_header = [0u8; 4096];
            if file.read_exact(&mut disk_header).is_ok() {
                // Heuristic: Check if the entry point or section count differs
                // For simplicity, we compare the first 4KB (headers)
                // In process hollowing, the MZ/PE remains, but sections usually differ
                // Here we just check if they are significantly different
                let mut matches = 0;
                for i in 0..4096 {
                    if mem_header[i] == disk_header[i] {
                        matches += 1;
                    }
                }
                
                // If less than 80% matches in the header, it's very suspicious
                if matches < 3000 {
                    return Ok(true); 
                }
            }
        }
        
        Ok(false)
    }
}

pub fn dump_process_memory(pid: u32, output_path: &str) -> Result<(), String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
        if handle.is_null() {
            return Err("Failed to open process".to_string());
        }

        let mut mod_info: MODULEINFO = unsafe { std::mem::zeroed() };
        if GetModuleInformation(handle, ptr::null_mut(), &mut mod_info, std::mem::size_of::<MODULEINFO>() as u32) == 0 {
            CloseHandle(handle);
            return Err("Failed to get module info".to_string());
        }

        let base_address = mod_info.lpBaseOfDll;
        let image_size = mod_info.SizeOfImage;

        let mut buffer = vec![0u8; image_size as usize];
        let mut bytes_read = 0;
        
        if ReadProcessMemory(handle, base_address, buffer.as_mut_ptr() as *mut _, image_size as usize, &mut bytes_read) == 0 {
            CloseHandle(handle);
            return Err("Failed to read memory".to_string());
        }

        CloseHandle(handle);

        if let Ok(mut file) = std::fs::File::create(output_path) {
            use std::io::Write;
            let _ = file.write_all(&buffer);
            Ok(())
        } else {
            Err("Failed to create dump file".to_string())
        }
    }
}
