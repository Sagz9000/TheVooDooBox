use winapi::um::fileapi::{CreateFileA, OPEN_EXISTING};
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::ioapiset::DeviceIoControl;
use winapi::um::winnt::{FILE_ATTRIBUTE_NORMAL, GENERIC_READ, GENERIC_WRITE};
use std::ptr;

// IOCTL for Mallab Anti-Tamper
// CTL_CODE(FILE_DEVICE_UNKNOWN, 0x800, METHOD_BUFFERED, FILE_ANY_ACCESS)
const IOCTL_PROTECT_PROCESS: u32 = 0x222003; 

pub struct KernelBridge {
    handle: winapi::um::winnt::HANDLE,
}

impl KernelBridge {
    pub fn new() -> Option<Self> {
        unsafe {
            let path = b"\\\\.\\MallabFilter\0";
            let handle = CreateFileA(
                path.as_ptr() as *const i8,
                GENERIC_READ | GENERIC_WRITE,
                0,
                ptr::null_mut(),
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                ptr::null_mut(),
            );

            if handle == INVALID_HANDLE_VALUE {
                None
            } else {
                Some(KernelBridge { handle })
            }
        }
    }

    pub fn protect_process(&self, pid: u32) -> bool {
        unsafe {
            let mut bytes_returned = 0;
            let result = DeviceIoControl(
                self.handle,
                IOCTL_PROTECT_PROCESS,
                &pid as *const _ as *mut _,
                std::mem::size_of::<u32>() as u32,
                ptr::null_mut(),
                0,
                &mut bytes_returned,
                ptr::null_mut(),
            );
            result != 0
        }
    }
}

impl Drop for KernelBridge {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle);
        }
    }
}
