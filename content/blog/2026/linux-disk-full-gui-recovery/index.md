---
title: "How I Recovered My Linux GUI After a Full Disk Killed LightDM"
images: ["social-fallback.png"]
date: 2026-06-22
draft: false
slug: "linux-disk-full-gui-recovery"
aliases:
  - "/blog/how-i-recovered-my-linux-gui-after-a-full-disk-killed-lightdm/"
description: "A real-world walkthrough of diagnosing and fixing a Linux system stuck on tty1 — caused by a completely full root filesystem that silently broke LightDM, Xorg, and the entire graphical session."
summary: "My Linux desktop dropped to tty1 with no GUI. LightDM was failing, but the real culprit was a 100% full root disk. Here's exactly how I diagnosed it from the terminal and brought the system back — step by step."
tags: ["linux", "troubleshooting", "lightdm", "systemd", "disk-management", "sysadmin", "debian"]
categories: ["Tutorials"]
---

I booted my Linux system and instead of the usual login screen — nothing. Just a blinking cursor on `tty1`. No graphical desktop, no LightDM greeter, no error dialog. Just a text terminal.

This is the story of how I diagnosed the problem from tty1, discovered the real root cause, and fixed it — all without reinstalling anything.

**Setup:** Debian 13 (Trixie) with Cinnamon desktop, running as a KVM virtual machine with a 28 GB virtual disk and LightDM as the display manager.

{{< alert >}}
**Spoiler:** It wasn't a display manager bug. It was a full disk pretending to be a GUI problem.
{{< /alert >}}

---

## The Symptom: Stuck on tty1

After logging in on tty1, I tried switching to the graphical session with **Ctrl+Alt+F7**. Instead of the desktop, I saw:

```
Failed to start postgresql@17-main.service
```

PostgreSQL failing was a red herring — it had nothing to do with the GUI. But it was a hint that something deeper was wrong.

---

## Step 1: Check the Display Manager

First, I checked whether the display manager service was running:

```bash
systemctl status display-manager
```

**Result:** The service was **failed** but **enabled** — meaning it was supposed to start at boot, but something prevented it.

Next, I confirmed which display manager was in use:

```bash
ls -l /etc/systemd/system/display-manager.service
```

```
... -> /lib/systemd/system/lightdm.service
```

So the system uses **LightDM**. Let's dig deeper.

---

## Step 2: Investigate LightDM

```bash
sudo systemctl status lightdm
```

LightDM was in a failed state. I tried reconfiguring it:

```bash
sudo dpkg-reconfigure lightdm
```

Then attempted a restart:

```bash
sudo systemctl restart lightdm
```

Still failing. The status output wasn't giving much detail, so I checked the full logs:

```bash
sudo systemctl status lightdm --no-pager
sudo journalctl -xeu lightdm --no-pager
```

The journal showed:

```
lightdm.service: Triggering OnFailure=dependencies
```

That's a generic systemd message — it means the service failed, but the *reason* could be anything. Time to look at the system itself.

---

## Step 3: The Real Culprit — Disk Full

```bash
df -h /
```

```
Filesystem   Size   Used   Avail   Use%   Mounted on
/dev/vda1    28G    27G    0       100%   /
```

**The root filesystem was completely full.** Zero bytes available.

This is the kind of failure that breaks everything silently. When Linux can't write to disk, services fail in confusing ways — no clear error, just "failed."

### Why a Full Disk Breaks the GUI

LightDM, Xorg, and the login session all need to write files at startup:

| Component | What It Writes | Where |
|---|---|---|
| LightDM | Session state, PID files | `/var/run/`, `/tmp/` |
| Xorg | Display server logs, sockets | `/var/log/`, `/tmp/.X11-unix/` |
| systemd | Service status, runtime data | `/run/` |
| Login session | Authentication tokens | `/var/`, `/tmp/` |

When any of these writes fail, the service crashes. But the error message rarely says "disk full" — it usually says something vague like "failed to start" or "OnFailure=dependencies."

---

## Step 4: Free Up Disk Space

With the root cause identified, I needed to free space from the terminal. Here's what I did:

### Clean the APT Package Cache

```bash
sudo apt clean
```

This removes all cached `.deb` files from `/var/cache/apt/archives/`. On a system that's had many package installations, this directory can grow to **several gigabytes** without you realizing it.

### Remove Unused Packages

```bash
sudo apt autoremove --purge
```

This removes orphaned dependencies — packages that were installed automatically but are no longer needed by anything. The `--purge` flag also removes their configuration files.

### Check System Journal Size

```bash
journalctl --disk-usage
sudo journalctl --disk-usage
```

I checked how much space system logs were consuming. If the journal had been consuming significant space, I could have reduced it with `sudo journalctl --vacuum-size=200M`.

### Investigate Where Space Was Going

I also ran a few diagnostic commands to understand the disk usage:

```bash
sudo du -xh / --max-depth=1 2>/dev/null | sort -h
```

Results after cleanup:

```
/opt    704M
/var    3.2G
/home   5.9G
/usr    8.1G
```

And checked for deleted files still held open by processes:

```bash
sudo lsof +L1
```

#### What does this command actually do?

- `lsof` = **L**ist **O**pen **F**iles — shows every file currently opened by any running process
- `+L1` = filter to show only files with a **link count less than 1** — meaning the file has been **deleted** from the filesystem but a process still has it open
- `sudo` = run as root so we can see files opened by all processes, not just our own

#### Why this matters for disk space

On Linux, deleting a file with `rm` only removes the **directory entry** (the name). If a process still has that file open, the **actual data stays on disk** until the process closes it or is restarted.

This creates a confusing gap between two tools:

| Tool | What it reports | Sees deleted-but-open files? |
|---|---|---|
| `df -h` | Filesystem-level usage | ✅ Yes — counts them as used space |
| `du -sh /` | Directory-level usage | ❌ No — can't see files with no name |

So if `df` says 27 GB used but `du` only adds up to 18 GB, the difference is likely ghost files — deleted but still consuming space because a process holds them open.

#### Real-world example

```bash
# A log file grows to 5 GB
# You delete it to free space:
rm /var/log/huge.log

# But the service that was writing to it still has it open
# df still shows 5 GB used — space NOT freed!

# lsof +L1 reveals it:
sudo lsof +L1
# COMMAND   PID   USER       FD  TYPE  SIZE/OFF  NLINK  NAME
# postgres  1234  postgres    5w  REG  5368709120  0    /var/log/huge.log (deleted)

# Fix: restart the service to release the file handle
sudo systemctl restart postgresql
# NOW the 5 GB is actually freed
```

#### How to read the output

```
COMMAND   PID   USER       FD   TYPE   SIZE/OFF  NLINK  NAME
postgres  1234  postgres    5w  REG    5368709120  0    /var/log/huge.log (deleted)
```

| Column | Meaning |
|---|---|
| `COMMAND` | The process holding the file open |
| `PID` | Process ID — use this to restart or kill it |
| `SIZE/OFF` | How much space the deleted file is still consuming |
| `NLINK` | Link count — `0` means deleted from filesystem |
| `NAME` | Original path, tagged with `(deleted)` |

#### How to fix it

Restart the process that's holding the deleted file:

```bash
sudo systemctl restart <service-name>
```

Once the process releases the file handle, the space is truly freed.

---

## Step 5: Verify and Restart

After cleanup:

```bash
df -h /
```

```
Filesystem   Size   Used   Avail   Use%   Mounted on
/dev/vda1    28G    19G    8.4G    69%    /
```

From **100% → 69%**. That's roughly **8 GB freed** — most of it from the APT cache.

Now I restarted LightDM:

```bash
sudo systemctl restart lightdm
```

**The GUI came back immediately.** LightDM loaded, the login screen appeared, and the desktop session started normally — no reboot needed.

---

## The Exact Commands I Used

Here's the complete sequence from my shell history — nothing more, nothing less:

```bash
# 1. Diagnose the display manager
systemctl status display-manager                          # 1941
ls -l /etc/systemd/system/display-manager.service          # 1942

# 2. Investigate LightDM
sudo systemctl status lightdm                              # 1943
sudo dpkg-reconfigure lightdm                              # 1944
sudo systemctl restart lightdm                             # 1945
sudo systemctl status lightdm                              # 1946
sudo systemctl status lightdm --no-pager                   # 1947
sudo journalctl -xeu lightdm --no-pager                    # 1948

# 3. Discover the root cause
df -h /                                                    # 1949

# 4. Free disk space
sudo apt clean                                             # 1950
journalctl --disk-usage                                    # 1951
sudo journalctl --disk-usage                               # 1952
sudo apt autoremove --purge                                # 1953

# 5. Investigate disk usage
du -sh ~/.cache/pip                                        # 1954
sudo du -xh / --max-depth=1 2>/dev/null | sort -h          # 1955
sudo lsof +L1                                              # 1956

# 6. Verify and recover
df -h /                                                    # 1957
sudo systemctl restart lightdm                             # 1958
```

---

## What Actually Fixed It

Let's be precise. The fix was **not** restarting LightDM. The fix was **freeing disk space** so that LightDM *could* start.

| Action | Effect |
|---|---|
| `sudo apt clean` | Removed cached `.deb` files (likely several GB) |
| `sudo apt autoremove --purge` | Removed unused packages and configs |
| Disk: 100% → 69% | ~8 GB freed |
| `sudo systemctl restart lightdm` | Restarted the now-functional service |

No reboot was needed. Once disk space was available, a simple service restart brought the GUI back immediately.

The PostgreSQL failure I saw earlier? Also caused by the full disk — it just happened to display first because it starts before LightDM in the boot sequence.

---

## Lessons Learned

### 1. "Service failed" Often Means "Disk Full"

When multiple services fail at boot with vague errors, check `df -h /` before anything else. A full disk is one of the most common — and most misleading — causes of service failures on Linux.

### 2. APT Cache Can Grow Silently

Every time you run `apt install`, the downloaded `.deb` file is cached in `/var/cache/apt/archives/`. Over months of installing packages, this can consume gigabytes. Unlike pip or npm, APT doesn't auto-clean by default.

**Prevention:** Add periodic cleanup to your routine:

```bash
# Clean APT cache
sudo apt clean

# Remove unused packages
sudo apt autoremove --purge

# Limit journal size
sudo journalctl --vacuum-size=500M
```

### 3. `du` and `df` Can Disagree

If `df` shows more used space than `du` reports, look for deleted-but-open files:

```bash
sudo lsof +L1
```

This finds files that have been deleted from the filesystem but are still held open by a running process. The space won't be freed until the process is killed or restarted.

### 4. Keep a Safety Margin

A Linux system needs free disk space to function. When the root filesystem hits 100%, things break in unpredictable ways — services fail, logs can't be written, even `apt` can't install fixes.

**Rule of thumb:** Keep at least **2–5 GB free** on the root filesystem at all times.

### 5. Monitor Disk Usage

A simple check you can run anytime:

```bash
df -h /
```

For a more detailed breakdown:

```bash
sudo du -xh / --max-depth=1 2>/dev/null | sort -h
```

---

## Quick Reference: Emergency Disk Cleanup

If you're stuck on tty with a full disk, here's a fast recovery checklist:

```bash
# 1. Confirm disk is full
df -h /

# 2. Quick wins (usually frees 1-5+ GB)
sudo apt clean
sudo apt autoremove --purge
sudo journalctl --vacuum-size=200M

# 3. Find biggest directories
sudo du -xh / --max-depth=1 2>/dev/null | sort -h

# 4. Find biggest files
sudo find / -xdev -type f -size +500M -ls 2>/dev/null | sort -k7 -n

# 5. Check for deleted-but-open files
sudo lsof +L1

# 6. Check common caches
du -sh ~/.cache/pip 2>/dev/null
du -sh ~/.cache/huggingface 2>/dev/null
du -sh ~/.ollama 2>/dev/null

# 7. Verify space freed
df -h /

# 8. Restart services or reboot
sudo systemctl restart lightdm   # or your display manager
sudo reboot
```

---

## Final Thought

This wasn't a LightDM bug. It wasn't a driver issue. It wasn't a broken configuration.

It was a **full disk** — and every confusing error message was just a downstream symptom of that one simple problem.

In my case, just two commands did the job:

```bash
sudo apt clean
sudo apt autoremove --purge
```

That freed ~8 GB of cached packages and unused dependencies — more than enough to get the system working again.

### But What If Cleanup Isn't Enough?

Not every full-disk situation can be solved by clearing caches. If your disk is genuinely running out of space because your data, applications, or workloads have outgrown it, cleanup will only buy you time. In those cases, you'll need to **extend the disk itself**:

| Scenario | Solution |
|---|---|
| **Cloud VM** (AWS, GCP, Azure, etc.) | Expand the volume in the cloud console, then run `sudo growpart /dev/vda 1` and `sudo resize2fs /dev/vda1` |
| **Local VM** (VirtualBox, KVM, Proxmox) | Increase the virtual disk size in the hypervisor settings, then grow the partition from inside the VM |
| **LVM** | Add a new physical volume or extend the logical volume with `lvextend` + `resize2fs` |
| **Physical server** | Add a new disk, mount it, and move large directories (like `/home` or `/var`) to it |

The key takeaway: **always diagnose first.** Run `df -h /` to confirm the disk is full, then decide — is this a cleanup problem or a capacity problem?

If `apt clean` and `autoremove` free enough space, great. If not, it's time to give your system more room to breathe.
