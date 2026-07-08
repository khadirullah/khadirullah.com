---
title: "How to Run Amazon Linux 2023 Locally with QEMU/KVM and Cloud-Init"
date: 2026-07-09
draft: false
description: "A complete guide to running official Amazon Linux 2023 cloud images locally using QEMU/KVM, Virt-Manager, and Cloud-Init, with concepts that apply equally to VirtualBox, VMware, and Hyper-V. Zero cloud costs, instant boot, SSH key authentication, and the real troubleshooting gotchas nobody warns you about."
summary: "Run the official Amazon Linux 2023 QCOW2 image locally on QEMU/KVM with Virt-Manager. Covers Cloud-Init seed ISO creation, SSH key setup, and an 8-test deep dive into the password locking behavior that most guides get wrong. The Cloud-Init concepts apply to VirtualBox, VMware, and Hyper-V too."
tags: ["linux", "aws", "qemu", "kvm", "cloud-init", "devops", "virt-manager", "homelab", "virtualization", "ssh", "virtualbox", "vmware", "hyper-v"]
categories: ["Tutorials"]
---

Cloud costs add up fast when you're learning DevOps. Running multiple virtual machines on AWS to practice Ansible, Docker, or Kubernetes means paying for every hour of compute, even when you're just experimenting.

The solution? Run the **exact same Amazon Linux images** that AWS uses on EC2, but locally on your machine using QEMU/KVM. No AWS account needed, no billing surprises, and your VMs boot in seconds.

> **Using VirtualBox, VMware, or Hyper-V?** This guide demonstrates the setup with QEMU/KVM and Virt-Manager, but the Cloud-Init concepts (the `user-data` and `meta-data` files, the `seed.iso` creation, and the password behavior deep dive) apply identically to any hypervisor. The only difference is how you attach the disk image and CD-ROM drive in your VM manager's UI.

The catch? These cloud images don't have a default password. They expect to talk to AWS's metadata service to get their SSH keys and user configuration. On your local machine, that service doesn't exist.

This guide shows you how to solve that problem using **Cloud-Init's NoCloud method**.

*Note: This guide is structured to help beginners get a quick win using the Virt-Manager GUI, but it concludes with an advanced, 8-test deep-dive into Cloud-Init password behavior for senior engineers.*

{{< alert icon="fire" >}}
**Hardware Note:** I'm running this on a modern quad-core desktop CPU with 16GB RAM. Each Amazon Linux VM idles at ~100-150MB RAM with 1 vCPU. You can comfortably run 2-3 VMs simultaneously on similar hardware.
{{< /alert >}}

---

## Why Use Cloud Images Instead of Regular ISOs?

| | Cloud Image (.qcow2) | Standard ISO (.iso) |
|---|---|---|
| **Boot time** | ~5 seconds | 10-15 minute install first |
| **RAM at idle** | ~100-150 MB (headless) | 300+ MB |
| **Disk size** | ~1.8 GB | 2-4 GB |
| **Setup method** | Cloud-Init (automated) | Manual wizard |
| **DevOps relevance** | ✅ Mirrors production EC2 workflow | ❌ Nobody installs EC2 from an ISO |

Cloud images are pre-built, minimal, headless server images. Exactly what runs on every EC2 instance. Using them locally teaches you the same provisioning workflow that real cloud infrastructure uses.

---

## The Problem: The Missing Metadata Service

When an EC2 instance boots on AWS, Cloud-Init reaches out to a special internal IP address (`169.254.169.254`) to fetch its configuration. AWS's hypervisor intercepts this request, looks up your SSH key pairs and instance settings, and streams them back to the VM.

On your local QEMU setup, that IP address goes nowhere. Cloud-Init panics, finds no configuration, and you're stuck at a login screen with no credentials.

## The Solution: NoCloud

Cloud-Init has a fallback mechanism called **NoCloud**. Instead of reaching out to a network endpoint, it checks for a locally attached storage drive with the volume label `cidata`. We create a tiny virtual CD-ROM (`seed.iso`) containing our configuration files and mount it to the VM. Cloud-Init reads it on first boot and configures everything automatically.

{{< mermaid >}}
graph LR
    A["Amazon Linux<br/>Cloud Image"] --> B{"Cloud-Init<br/>starts on boot"}
    B -->|"Checks for<br/>169.254.169.254"| C["❌ No AWS<br/>metadata service"]
    B -->|"Falls back to<br/>NoCloud"| D["✅ Finds seed.iso<br/>labeled 'cidata'"]
    D --> E["Reads user-data<br/>& meta-data"]
    E --> F["Creates user<br/>Injects SSH key<br/>Sets hostname"]

    style C fill:#ef4444,color:white,stroke:#991b1b;
    style D fill:#22c55e,color:black,stroke:#166534;
    style F fill:#3b82f6,color:white,stroke:#1e40af;
{{< /mermaid >}}

---

## Step 1: Download the Amazon Linux 2023 Image

Grab the official KVM/QCOW2 image from the [Amazon Linux 2023 downloads page](https://cdn.amazonlinux.com/al2023/os-images/latest/). Choose the `kvm` directory for x86_64 or `kvm-arm64` for ARM-based hosts.

## Step 2: Organize Your Files

Never use the downloaded file directly. QEMU modifies the `.qcow2` file when the VM boots. Keep a clean master copy as a template.

```bash
# Create your lab structure
mkdir -p ~/VMs/templates ~/VMs/active-vms/vm1

# Save the original as a master template
mv ~/Downloads/al2023-kvm-*.qcow2 ~/VMs/templates/al2023-master.qcow2

# Create a working copy for your first VM
cp ~/VMs/templates/al2023-master.qcow2 ~/VMs/active-vms/vm1/amzn-devops-vm1.qcow2
```

{{< alert >}}
**Pro Tip: Linked Clones.** If you plan to spin up many VMs, use a linked clone instead of a full copy, saving gigabytes of disk space.
{{< /alert >}}

```bash
qemu-img create -f qcow2 \
  -b ~/VMs/templates/al2023-master.qcow2 \
  -F qcow2 \
  ~/VMs/active-vms/vm1/amzn-devops-vm1.qcow2
```

## Step 3: Create the Cloud-Init Configuration

You need two plain text files. No file extensions. Name them exactly `user-data` and `meta-data`.

### File 1: `user-data`

This configures your user account, SSH key, and a backup console password. Replace the SSH key placeholder with your actual public key (run `cat ~/.ssh/id_ed25519.pub` to get it).

```yaml
#cloud-config
users:
  - name: ec2-user
    groups: wheel
    sudo: ['ALL=(ALL) NOPASSWD:ALL']
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...YOUR_PUBLIC_KEY_HERE...
chpasswd:
  users:
    - name: ec2-user
      password: amazon
      type: text
  expire: false
```

{{< alert >}}
**Using an older Cloud-Init version?** Amazon Linux 2023 ships with cloud-init **v22.2.2**, which also supports the legacy multiline format shown below. Both formats work, but the list format above is recommended since the multiline format will be removed in a future version.
{{< /alert >}}

```yaml
# Legacy format (deprecated, still works on v22.2.2)
chpasswd:
  list: |
    ec2-user:amazon
  expire: False
```

| Field | Purpose |
|---|---|
| `#cloud-config` | Must be the first line. Tells Cloud-Init this is a valid config |
| `name: ec2-user` | Creates the default Amazon Linux user |
| `groups: wheel` | Adds the user to the sudo group |
| `sudo: ['ALL=(ALL) NOPASSWD:ALL']` | Passwordless sudo access |
| `ssh_authorized_keys` | Injects your host's public SSH key for password-free login |
| `chpasswd` | Sets a backup password (`amazon`) for console access via Virt-Manager |
| `expire: false` | Prevents forcing a password change on first login |

{{< alert >}}
**Don't have an SSH key?** Generate one with the commands below.
{{< /alert >}}

```bash
ssh-keygen -t ed25519 -C "devops-local"
cat ~/.ssh/id_ed25519.pub  # Copy this entire output into user-data
```

### File 2: `meta-data`

This sets the VM's hostname and a unique instance ID. **Do NOT add `#cloud-config` to this file** because that header is only for `user-data`.

```yaml
local-hostname: amzn-devops-vm1
instance-id: i-devopslab01
```

The `instance-id` is **mandatory**. Cloud-Init will reject the NoCloud datasource without it. It can be any string, but using the AWS-style `i-` prefix keeps your mental model consistent with production EC2 instances.

> **How instance-id actually works:** Cloud-Init does NOT check instance IDs across VMs; each VM is completely isolated. The check happens **within a single VM only**: on every boot, Cloud-Init compares the `instance-id` from the seed.iso against the one stored on the VM's own disk (`/var/lib/cloud/data/instance-id`). If they match, it skips first-boot setup. If they differ, it treats it as a brand-new deployment and re-runs provisioning. This is why changing the `instance-id` forces a fresh Cloud-Init run.
>
> We still use unique IDs per VM (e.g., `i-devopslab01`, `i-devopslab02`) primarily so each VM gets a unique `local-hostname` on the network. Otherwise multiple VMs would show up with the same name, which gets confusing fast.

---

## Step 4: Generate the Seed ISO

Package your configuration files into a virtual CD-ROM image. The volume label **must** be exactly `cidata`. Cloud-Init ignores anything else.

**Method A: The Modern Way (cloud-localds - Recommended)**
The Cloud-Init developers provide a dedicated tool for this that handles volume labels automatically.
*   **Ubuntu/Debian:** `sudo apt install -y cloud-image-utils`
*   **Fedora/RHEL:** `sudo dnf install -y cloud-utils`
```bash
cloud-localds seed.iso user-data meta-data
mv seed.iso ~/VMs/active-vms/vm1/
```

**Method B: The Traditional Way (genisoimage - Alternative)**
If you require strict ISO9660 formatting or cross-platform compatibility, use the traditional tool:
*   **Ubuntu/Debian:** `sudo apt install -y genisoimage`
*   **Fedora/RHEL:** `sudo dnf install -y genisoimage`
```bash
genisoimage -output seed.iso -volid cidata -joliet -rock user-data meta-data
mv seed.iso ~/VMs/active-vms/vm1/
```
*(Curious about which tool is right for you? See the **Appendix** at the end of this article for a full breakdown of the differences.)*

Your `vm1` folder should now contain:

```
~/VMs/active-vms/vm1/
├── amzn-devops-vm1.qcow2    # The VM disk
└── seed.iso                  # Cloud-Init config disk
```

---

## Step 5: Import into Virt-Manager

1. **Create New VM:** Click the top-left icon → Select **Import existing disk image** → Forward.
2. **Select Disk:** Click **Browse → Browse Local** → Choose your `.qcow2` file.
3. **Set OS Type:** Type **Generic Linux** (or Red Hat Enterprise Linux 9) → Forward.
4. **Allocate Resources:** Memory: **1024 MiB**, CPUs: **1** → Forward.
5. **Customize:** Name your VM, **check "Customize configuration before install"** → Finish.

### Attach the Seed ISO (Critical Step)

1. Click **Add Hardware** (bottom-left).
2. Select **Storage**, change **Device type** to **CDROM device**.
3. Click **Manage... → Browse Local** → Select your `seed.iso` → Finish.
4. Click **Apply**, then **Begin Installation**.

Your VM boots in text mode. Cloud-Init reads the seed ISO, creates `ec2-user`, injects your SSH key, and sets the hostname within seconds.

---

## Step 6: Connect via SSH

Find the VM's IP from Virt-Manager (lightbulb icon → NIC → IP Address), then:

```bash
ssh ec2-user@192.168.122.X
```

You should see the Amazon Linux welcome banner:

```
   ,     #_
   ~\_  ####_        Amazon Linux 2023
  ~~  \_#####\
  ~~     \###|
  ~~       \#/ ___   https://aws.amazon.com/linux/amazon-linux-2023
   ~~       V~' '->
    ~~~         /
      ~~._.   _/
         _/ _/
       _/m/'
[ec2-user@amzn-devops-vm1 ~]$
```

---

🎉 **Success!** If you are just starting your DevOps journey, you can stop right here! You have a fully functional Amazon Linux 2023 environment, and you can start doing your practice and deploying applications.

🔬 **Advanced Reading:** The rest of this guide is a technical deep-dive into how Cloud-Init handles passwords under the hood. If you want to level up your Linux troubleshooting skills, keep reading.

---

## The Cloud-Init Deep Dive: What Really Happens to Your Password

This is where most tutorials stop. But when I tried to clean up my VM by removing the `seed.iso`, everything broke. I ran 8 controlled tests to map out exactly how the password-locking mechanics work under the hood.

### The Discovery: How Cloud-Init Manages Passwords

By examining `/var/log/cloud-init.log`, I found that when Cloud-Init detects a **new instance** (a new `instance-id` it hasn't seen before), it runs a two-step process:

```
Step 1: passwd -l ec2-user     ← LOCKS the account first (users-groups module)
Step 2: chpasswd               ← Sets password, which UNLOCKS it (set-passwords module)
```

The lock happens first as a security measure. Then `chpasswd` runs using the password from your `user-data` file to unlock and set the password. This design ensures that if anything goes wrong with provisioning, the account defaults to **locked** rather than leaving a default password exposed.

Both modules run with frequency `once-per-instance`, meaning they only execute once per unique `instance-id`, then create a semaphore file to remember they already ran. **On normal reboots where the instance-id hasn't changed, both modules are skipped entirely**. Cloud-Init doesn't touch the password at all.

{{< mermaid >}}
graph TD
    A["VM Boot"] --> B{"Cloud-Init:<br/>Is this a new instance-id?"}
    B -->|"Same instance-id<br/>Semaphores exist"| C["ALL modules skipped<br/>Password untouched ✅"]
    B -->|"New instance-id"| D["users-groups module<br/><b>passwd -l ec2-user</b><br/>Account LOCKED"]
    D --> E{"set-passwords module:<br/>Is user-data available?"}
    E -->|"Yes — seed.iso present"| F["Reads chpasswd<br/><b>Sets password 'amazon'</b><br/>Account UNLOCKED ✅"]
    E -->|"No — seed.iso removed"| G["Nothing to set<br/>Account stays LOCKED ❌"]
    F --> H["Creates semaphore files"]

    style C fill:#22c55e,color:black,stroke:#166534;
    style D fill:#ef4444,color:white,stroke:#991b1b;
    style F fill:#22c55e,color:black,stroke:#166534;
    style G fill:#ef4444,color:white,stroke:#991b1b;
{{< /mermaid >}}

### The 8 Tests

I ran each test on a **fresh VM** to eliminate leftover state. Here's what I found:

#### Test 1 & 2: Normal Operation ✅

**Fresh boot with seed.iso** → Cloud-Init detects a new `instance-id`, runs `passwd -l` (locks account), then runs `chpasswd` (sets password `amazon`, unlocking the account). Password works on console. SSH key works.

**Reboot with seed.iso still attached** → Password survives. Cloud-Init sees the same `instance-id` as the previous boot. The semaphore files exist, so **all modules are skipped**: no `passwd -l`, no `chpasswd`, nothing. The password in `/etc/shadow` stays exactly as it was.

#### Test 3: Removing the Seed ISO ❌

**Remove seed.iso from Virt-Manager, reboot.**

The password is **locked**. SSH key still works. Here's what the logs revealed:

Cloud-Init can't find the seed.iso, so it falls back to `DataSourceNone` and assigns a fallback instance-id: **`iid-datasource-none`**. Because this is a "new" instance-id, Cloud-Init treats it as a fresh deployment:

1. `passwd -l ec2-user` runs → account **locked**
2. `set-passwords` runs under the new instance-id, but there's **no `user-data` to read** (the seed.iso is gone) → `chpasswd` has no password to set
3. Account stays locked

The SSH key survives because it's a file (`~/.ssh/authorized_keys`) sitting on the VM's disk. Nothing deletes it.

#### Test 4: The Semaphore Trap ❌

**Re-attach the same seed.iso (same instance-id), reboot.**

Password is **still locked**. The semaphore file from the original first boot (`/var/lib/cloud/instances/i-devopslab01/sem/config_set_passwords`) still exists on disk. Cloud-Init sees the original `instance-id`, finds the semaphore, and says:

```
config-set-passwords already ran (freq=once-per-instance)
```

It skips `chpasswd` entirely. The account remains locked from the previous boot (when Cloud-Init ran `passwd -l` under the fallback instance-id) because no module runs to unlock it.

{{< alert icon="circle-info" >}}
**The Instance-ID Fix:** Changing the `instance-id` in your `meta-data` to a new value (e.g., `i-devopslab02`) forces Cloud-Init to treat it as a brand-new deployment. It creates a fresh semaphore directory and re-runs `chpasswd`, restoring your password.
{{< /alert >}}

#### Test 5: The `cloud-init.disabled` File ❌

**Create `/etc/cloud/cloud-init.disabled`, remove seed.iso, reboot.**

Password is **still locked**. Despite `cloud-init status` reporting `disabled`, all four systemd services **still executed**:

```
cloud-init.service         → Active: active (exited)   ← Still ran!
cloud-init-local.service   → Active: active (exited)   ← Still ran!
cloud-config.service       → Active: active (exited)   ← Still ran!
cloud-final.service        → Active: active (exited)   ← Still ran!
```

On Amazon Linux 2023 (cloud-init **v22.2.2**), the `cloud-init.disabled` file causes Cloud-Init to self-report as disabled, but the **systemd services were still enabled** and still ran `passwd -l`.

#### Test 6: `systemctl disable` ❌

**Use both `cloud-init.disabled` AND `systemctl disable` for all four services, remove seed.iso, reboot.**

Password is **still locked**. Even with services marked as `disabled`:

```
cloud-init.service; disabled; preset: disabled
Active: active (exited)    ← STILL RAN despite being disabled!
```

Cloud-Init uses a **systemd generator** (`cloud-init-generator`) that dynamically creates service dependencies at boot time. The generator overrides the static `disable` setting. `systemctl disable` only removes boot symlinks, but generators can recreate them.

#### Test 7: `systemctl mask` ✅

**Use both `cloud-init.disabled` AND `systemctl mask` for all four services, remove seed.iso, reboot.**

```bash
sudo touch /etc/cloud/cloud-init.disabled
sudo systemctl mask cloud-init-local.service cloud-init.service cloud-config.service cloud-final.service
```

**Password SURVIVES!** All services are truly dead:

```
cloud-init.service         → Loaded: masked    Active: inactive (dead)
cloud-init-local.service   → Loaded: masked    Active: inactive (dead)
cloud-config.service       → Loaded: masked    Active: inactive (dead)
cloud-final.service        → Loaded: masked    Active: inactive (dead)
```

`systemctl mask` creates symlinks to `/dev/null`, making it **impossible** for any generator or dependency to start the service. No `passwd -l` runs, the password in `/etc/shadow` stays untouched, and the SSH host keys are also preserved (no more "REMOTE HOST IDENTIFICATION HAS CHANGED" errors).

I **reproduced this test twice** on separate fresh VMs to confirm.

#### Test 8: `lock_passwd: false` in user-data ❌

**Add `lock_passwd: false` to the users block in user-data, remove seed.iso, reboot.**

Password is **still locked**. The `lock_passwd: false` directive lives inside the `user-data` file, which lives on the `seed.iso`. When you remove the ISO, Cloud-Init can't read that directive, so it falls back to Amazon Linux's default config which doesn't include it.

### Results Summary

| Test | Method | Password | SSH Key |
|---|---|---|---|
| 1 | Fresh boot with seed.iso | ✅ Works | ✅ Works |
| 2 | Reboot, seed.iso attached | ✅ Works | ✅ Works |
| 3 | Remove seed.iso | ❌ Locked | ✅ Works |
| 4 | Re-attach same seed.iso | ❌ Locked | ✅ Works |
| 5 | `cloud-init.disabled` file | ❌ Locked | ✅ Works |
| 6 | `disabled` + `systemctl disable` | ❌ Locked | ✅ Works |
| **7** | **`disabled` + `systemctl mask`** | **✅ Works** | **✅ Works** |
| 8 | `lock_passwd: false` in user-data | ❌ Locked | ✅ Works |

### The Definitive Answer

There are three ways to handle `seed.iso` removal. Pick whichever fits your workflow:

#### Option 1: Just leave the seed.iso attached (zero effort)

Don't remove it. It uses zero CPU, negligible disk space, and Cloud-Init stays happy on every reboot. This is the simplest option if you don't mind the ISO sitting in your VM's hardware list.

#### Option 2: Remove seed.iso, then reset the password (easiest fix)

This is the simplest solution if you want a clean VM without the ISO attached:

```bash
# 1. Remove seed.iso from Virt-Manager, then boot the VM
# 2. Password won't work on console, but SSH still works:
ssh ec2-user@192.168.122.X
# 3. Manually reset the password:
sudo passwd ec2-user
# Enter your new password (e.g., 'amazon') twice
# 4. Done. Password now survives all future reboots.
```

**Why this works:** When you removed the seed.iso and rebooted, Cloud-Init assigned the fallback instance-id `iid-datasource-none` and created semaphore files for it. From this point on, the instance-id never changes (there's no seed.iso to provide a different one). So on every future reboot, Cloud-Init sees the same `iid-datasource-none`, finds the existing semaphores, and **skips all modules**, including `passwd -l`. Your manually set password in `/etc/shadow` stays untouched.

#### Option 3: Mask Cloud-Init, then remove seed.iso (most thorough)

If you want to completely prevent Cloud-Init from ever running again:

```bash
# SSH into the VM after first boot
sudo touch /etc/cloud/cloud-init.disabled
sudo systemctl mask cloud-init-local.service cloud-init.service cloud-config.service cloud-final.service
sudo poweroff
# Now remove seed.iso from Virt-Manager's CD-ROM drive
```

This is the nuclear option: Cloud-Init is permanently dead. Password, SSH keys, and host keys all stay exactly as they were. Use this if you're converting the VM into a long-lived server where Cloud-Init has no purpose.

---

## Creating Additional VMs

For every new VM, you need three unique items:

| Item | VM 1 | VM 2 | VM 3 |
|---|---|---|---|
| Folder | `~/VMs/active-vms/vm1/` | `~/VMs/active-vms/vm2/` | `~/VMs/active-vms/vm3/` |
| `local-hostname` | `amzn-devops-vm1` | `amzn-devops-vm2` | `amzn-devops-vm3` |
| `instance-id` | `i-devopslab01` | `i-devopslab02` | `i-devopslab03` |

Your `user-data` stays the same since your SSH key doesn't change.

```bash
# Quick setup for a second VM
mkdir -p ~/VMs/active-vms/vm2
cp ~/VMs/templates/al2023-master.qcow2 ~/VMs/active-vms/vm2/amzn-devops-vm2.qcow2

# Create meta-data with new hostname and instance-id
cat > meta-data << EOF
local-hostname: amzn-devops-vm2
instance-id: i-devopslab02
EOF

# Regenerate seed.iso
genisoimage -output ~/VMs/active-vms/vm2/seed.iso -volid cidata -joliet -rock user-data meta-data
```

All VMs on Virt-Manager share the same virtual network bridge (`virbr0`, subnet `192.168.122.0/24`) by default, so they can talk to each other and your host machine out of the box.

---

## Automating the Entire Process

Here's a shell script that replaces the entire manual Virt-Manager workflow:

```bash
#!/bin/bash
set -e

TEMPLATE_DIR="$HOME/VMs/templates"
MASTER_TEMPLATE="$TEMPLATE_DIR/al2023-master.qcow2"
USER_DATA_TEMPLATE="$TEMPLATE_DIR/user-data"
BASE_DIR="$HOME/VMs/active-vms"
FULL_COPY=false

# Parse arguments
for arg in "$@"; do
    case "$arg" in
        --full-copy) FULL_COPY=true; shift ;;
    esac
done

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 [--full-copy] <vm-name> <instance-id>"
    echo "Example: $0 amzn-devops-vm2 devopslab02"
    echo ""
    echo "Options:"
    echo "  --full-copy  Create a full disk copy (~1.8 GB) instead of a linked clone (~200 KB)"
    echo "               Linked clones are faster and save disk space, but depend on the master template."
    echo "               Use --full-copy if you plan to move or delete the master template later."
    exit 1
fi

VM_NAME="$1"
INSTANCE_ID="$2"
VM_DIR="$BASE_DIR/$VM_NAME"

# Safety checks
if [ ! -f "$MASTER_TEMPLATE" ]; then
    echo "ERROR: Master template not found: $MASTER_TEMPLATE"
    echo "Download from: https://cdn.amazonlinux.com/al2023/os-images/latest/kvm/"
    exit 1
fi

if [ ! -f "$USER_DATA_TEMPLATE" ]; then
    echo "ERROR: user-data template not found: $USER_DATA_TEMPLATE"
    echo "Create your user-data file at: $USER_DATA_TEMPLATE"
    exit 1
fi

if virsh dominfo "$VM_NAME" &>/dev/null; then
    echo "ERROR: VM '$VM_NAME' already exists. Choose a different name or remove it first:"
    echo "  virsh destroy $VM_NAME && virsh undefine $VM_NAME"
    exit 1
fi

echo "=== Provisioning $VM_NAME ==="

mkdir -p "$VM_DIR"

# Generate unique meta-data
cat <<EOF > "$VM_DIR/meta-data"
local-hostname: $VM_NAME
instance-id: i-$INSTANCE_ID
EOF

# Copy user-data template
cp "$USER_DATA_TEMPLATE" "$VM_DIR/user-data"

# Generate seed ISO
genisoimage -output "$VM_DIR/seed.iso" -volid cidata -joliet -rock "$VM_DIR/user-data" "$VM_DIR/meta-data"

# Create VM disk (linked clone by default, full copy with --full-copy)
if [ "$FULL_COPY" = true ]; then
    echo "Creating full disk copy (~1.8 GB)..."
    cp "$MASTER_TEMPLATE" "$VM_DIR/$VM_NAME.qcow2"
else
    echo "Creating linked clone (~200 KB, depends on master template)..."
    qemu-img create -f qcow2 -b "$MASTER_TEMPLATE" -F qcow2 "$VM_DIR/$VM_NAME.qcow2"
fi

# Deploy headless
virt-install \
  --name "$VM_NAME" \
  --memory 1024 \
  --vcpus 1 \
  --disk path="$VM_DIR/$VM_NAME.qcow2",device=disk,bus=virtio \
  --disk path="$VM_DIR/seed.iso",device=cdrom \
  --os-variant generic \
  --network network=default \
  --import \
  --noautoconsole

echo "=== $VM_NAME deployed! ==="
echo "Find IP: virsh domifaddr $VM_NAME"
echo "Connect: ssh ec2-user@<ip>"
```

Save as `deploy.sh`, run `chmod +x deploy.sh`, and deploy VMs in seconds:

```bash
# Linked clone (default, fast, ~200 KB per VM)
./deploy.sh amzn-devops-vm2 devopslab02

# Full disk copy (~1.8 GB per VM, independent of master template)
./deploy.sh --full-copy amzn-devops-vm3 devopslab03
```

---

## Common SSH Errors

### "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!"

Your host computer remembers a previous VM that used the same IP. Fix:

```bash
ssh-keygen -R 192.168.122.X
ssh ec2-user@192.168.122.X    # Type 'yes' when prompted
```

This happens frequently when you create and destroy VMs that reuse local IPs. For temporary lab VMs:

```bash
ssh -o StrictHostKeyChecking=no ec2-user@192.168.122.X
```

---

## What's Next

With your VM running:

```bash
# Update packages
sudo dnf makecache && sudo dnf update -y

# Install Docker
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user

# Reconnect SSH, then test
docker run -d -p 8080:80 nginx
# Visit http://192.168.122.X:8080 from your host browser
```

---

## Quick Reference Card

| Task | Command |
|---|---|
| Generate SSH key | `ssh-keygen -t ed25519 -C "devops-local"` |
| View your public key | `cat ~/.ssh/id_ed25519.pub` |
| Create seed ISO | `genisoimage -output seed.iso -volid cidata -joliet -rock user-data meta-data` |
| Clear stale SSH key | `ssh-keygen -R <ip-address>` |
| Check password status | `sudo passwd -S ec2-user` |
| Safely disable Cloud-Init | `sudo touch /etc/cloud/cloud-init.disabled && sudo systemctl mask cloud-init-local.service cloud-init.service cloud-config.service cloud-final.service` |
| Find VM IP address | `virsh domifaddr <vm-name>` |
| Destroy VM | `virsh destroy <vm-name> && virsh undefine <vm-name>` |

---

## Appendix: cloud-localds vs genisoimage

`cloud-localds` and `genisoimage` serve the same core purpose for virtual machines: packaging configuration files (like user-data and meta-data) into an ISO image that cloud-init reads. However, `cloud-localds` is an automated, high-level wrapper specifically for cloud-init, while `genisoimage` is a low-level, traditional CD/DVD authoring tool.

*(Fun Fact: `cloud-localds` is actually just a wrapper script! Under the hood, it automatically constructs and runs the `genisoimage` or `mkisofs` command for you, saving you from having to memorize the correct volume labels and ISO extensions).*

### Key Differences
| Feature | cloud-localds | genisoimage |
|---|---|---|
| Purpose | Designed specifically to build NoCloud seed images. | General-purpose filesystem (ISO9660/Joliet/Rock Ridge) creation. |
| Usage | Requires minimal parameters; automatically sets the correct volume ID and file structure. | Requires exact flags (-volid cidata, -joliet, -rock) to be properly recognized by cloud-init. |
| Flexibility | Highly opinionated; outputs the ISO directly formatted for local hypervisors (like QEMU). | Granular control over file placement, boot catalogs, and disk attributes. |

### When to Use Each
**Use cloud-localds if:**
*   You are setting up a local testing environment in QEMU/KVM and need to quickly spin up a cloud image.
*   You want a simple command-line interface that handles volume labeling (cidata) automatically.
*   You are building a .img or .raw disk file directly, instead of strict ISO formats.

**Use genisoimage if:**
*   You require cross-platform compatibility (e.g., building an ISO image on macOS using a wrapper like hdiutil, or using mkisofs on Linux).
*   You need an exact, standard .iso file format for hypervisors like VMware or Proxmox.

### Examples
**Using cloud-localds:**
```bash
cloud-localds -v --network-config=network-config.yaml seed.img user-data.yaml meta-data.yaml
```

**Using genisoimage:**
```bash
genisoimage -output seed.img -volid cidata -rational-rock -joliet user-data meta-data network-config
```

---

## References & Documentation

- [Amazon Linux 2023 KVM Images (Official Download)](https://cdn.amazonlinux.com/al2023/os-images/latest/kvm/) - Official Amazon CDN for QCOW2 images
- [Using Amazon Linux 2023 Outside of Amazon EC2](https://docs.aws.amazon.com/linux/al2023/ug/outside-ec2.html) - AWS documentation for running AL2023 locally
- [AL2023 KVM Requirements](https://docs.aws.amazon.com/linux/al2023/ug/kvm-requirements.html) - Official KVM hardware and software requirements
- [Cloud-Init NoCloud Datasource](https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html) - Official NoCloud documentation covering `user-data`, `meta-data`, and `instance-id` requirements
- [Cloud-Init Module Reference: Set Passwords](https://docs.cloud-init.io/en/latest/reference/modules.html#set-passwords) - Documentation for the `chpasswd` and `set-passwords` module behavior
- [Cloud-Init Boot Stages](https://docs.cloud-init.io/en/latest/explanation/boot.html) - How Cloud-Init's systemd services and generator work
- [systemctl mask vs disable (Arch Wiki)](https://wiki.archlinux.org/title/Systemd#Using_units) - Explanation of why `mask` prevents generators from overriding service state
- [cloud-localds Manual (Debian Manpage)](https://manpages.debian.org/testing/cloud-image-utils/cloud-localds.1.en.html) - Official manual page for the `cloud-localds` wrapper utility.
- [genisoimage man page](https://linux.die.net/man/1/genisoimage) - Manual for the legacy ISO generation tool.
