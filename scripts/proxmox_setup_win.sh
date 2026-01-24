#!/bin/bash

# VOODOOBOX v3 Proxmox Sandbox Provisioner
# This script creates a "Gold Standard" Windows VM for malware analysis.

set -e

echo "-----------------------------------------------------------"
echo "   VOODOOBOX V3 - PROXMOX SANDBOX PROVISIONER (WINDOWS 10)   "
echo "-----------------------------------------------------------"

# 1. Configuration Prompts
read -p "Enter VM ID (e.g., 210): " VMID
read -p "Enter VM Name (e.g., voodoobox-sandbox-01): " VMNAME
read -p "Storage Bridge (usually local-lvm or ceph): " STORAGE
read -p "ISO Storage (usually local): " ISO_STORAGE
read -p "Windows ISO Filename (e.g., Win10_22H2_English_x64.iso): " WIN_ISO

# 2. Virtual Hardware Settings
CORES=4
RAM=4096
BRIDGE="vmbr0"

echo "Creating VM $VMID ($VMNAME) with optimized settings..."

# Create the VM
qm create $VMID \
  --name "$VMNAME" \
  --ostype win10 \
  --memory $RAM \
  --cores $CORES \
  --cpu host \
  --net0 virtio,bridge=$BRIDGE \
  --scsihw virtio-scsi-pci \
  --boot c \
  --bootdisk scsi0 \
  --machine q35 \
  --agent 1 \
  --bios ovmf

# Add EFI disk (required for UEFI/OVMF)
echo "Adding EFI disk..."
qm set $VMID --efidisk0 $STORAGE:0,pre-enrolled-keys=1

# Add OS Drive (50GB)
echo "Creating 50GB OS disk..."
qm set $VMID --scsi0 $STORAGE:50,cache=writeback,discard=on

# Add Windows ISO
echo "Mounting Windows ISO..."
qm set $VMID --ide2 $ISO_STORAGE:iso/$WIN_ISO,media=cdrom

# Add VirtIO Drivers ISO (Highly Recommended)
# This script assumes you have it or will download it
VIRTIO_ISO="virtio-win.iso"
if [ ! -f "/var/lib/vz/template/iso/$VIRTIO_ISO" ]; then
    echo "VirtIO ISO not found. Downloading latest stable version..."
    wget -O /var/lib/vz/template/iso/$VIRTIO_ISO https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso 
fi
qm set $VMID --ide0 $ISO_STORAGE:iso/$VIRTIO_ISO,media=cdrom

echo ""
echo "-------------------------------------------------------"
echo "SUCCESS: VM $VMID created."
echo "-------------------------------------------------------"
echo "NEXT STEPS:"
echo "1. Start the VM: qm start $VMID"
echo "2. Open VNC via the VOODOOBOX v3 Dashboard."
echo "3. During Windows Setup, LOAD DRIVERS from the 'virtio-win' CD-ROM (SCSI and NetKVM)."
echo "4. After installation, install the QEMU Guest Agent."
echo "5. Disable Windows Defender and Firewall (Experimental Lab)."
echo "6. Run the VOODOOBOX Windows Agent."
echo "-------------------------------------------------------"
