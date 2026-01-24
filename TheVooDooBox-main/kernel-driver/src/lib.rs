<<<<<<< (WDK-based Driver Skeleton) >>>>>>>
#![no_std]
extern crate alloc;

use wdk_sys::*;
use wdk_macros::wdk_main;

// IOCTL for TheVooDooBox Anti-Tamper
const IOCTL_PROTECT_PROCESS: u32 = 0x222003; 
static mut PROTECTED_PID: u32 = 0;

#[wdk_main]
pub fn driver_entry(driver_object: &mut DRIVER_OBJECT, _registry_path: &UNICODE_STRING) -> NTSTATUS {
    println!("TheVooDooBoxFilter: Kernel Anti-Tamper loading...");

    driver_object.MajorFunction[IRP_MJ_CREATE as usize] = Some(dispatch_create_close);
    driver_object.MajorFunction[IRP_MJ_CLOSE as usize] = Some(dispatch_create_close);
    driver_object.MajorFunction[IRP_MJ_DEVICE_CONTROL as usize] = Some(dispatch_device_control);
    driver_object.DriverUnload = Some(driver_unload);

    // Create Device Object
    let device_name = declare_unicode_string!(r"\Device\TheVooDooBoxFilter");
    let mut device_object: *mut DEVICE_OBJECT = core::ptr::null_mut();
    
    unsafe {
        IoCreateDevice(
            driver_object,
            0,
            &mut device_name,
            FILE_DEVICE_UNKNOWN,
            0,
            FALSE as u8,
            &mut device_object
        );

        // Create Symbolic Link for User-Mode accessibility
        let sym_link = declare_unicode_string!(r"\??\TheVooDooBoxFilter");
        IoCreateSymbolicLink(&mut sym_link, &mut device_name);
    }

    STATUS_SUCCESS
}

extern "C" fn dispatch_create_close(_device_object: &mut DEVICE_OBJECT, irp: &mut IRP) -> NTSTATUS {
    unsafe {
        (*irp.IoStatus.__bindgen_anon_1.Status_mut()) = STATUS_SUCCESS;
        irp.IoStatus.Information = 0;
        IoCompleteRequest(irp, IO_NO_INCREMENT as i8);
    }
    STATUS_SUCCESS
}

extern "C" fn dispatch_device_control(_device_object: &mut DEVICE_OBJECT, irp: &mut IRP) -> NTSTATUS {
    let stack = unsafe { IoGetCurrentIrpStackLocation(irp) };
    let ioctl_code = unsafe { (*stack).Parameters.DeviceIoControl.IoControlCode };

    if ioctl_code == IOCTL_PROTECT_PROCESS {
        let buffer = unsafe { (*irp.AssociatedIrp.SystemBuffer_mut()) as *mut u32 };
        unsafe {
            PROTECTED_PID = *buffer;
            println!("TheVooDooBoxFilter: Protecting PID {}", PROTECTED_PID);
        }
    }

    unsafe {
        (*irp.IoStatus.__bindgen_anon_1.Status_mut()) = STATUS_SUCCESS;
        irp.IoStatus.Information = 0;
        IoCompleteRequest(irp, IO_NO_INCREMENT as i8);
    }
    STATUS_SUCCESS
}

extern "C" fn driver_unload(_driver_object: &mut DRIVER_OBJECT) {
    let sym_link = declare_unicode_string!(r"\??\TheVooDooBoxFilter");
    unsafe {
        IoDeleteSymbolicLink(&mut sym_link);
        // IoDeleteDevice(device_object); // Need ref to device_object here
    }
    println!("TheVooDooBoxFilter: Kernel Anti-Tamper unloaded.");
}

// Minimal panic handler for no_std
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}
