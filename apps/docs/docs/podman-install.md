---
title: Installing Podman
description: How to install the Podman container engine on Windows, macOS, and Linux so you can use sandboxes and run code in Agentron.
---

# Installing Podman

Agentron uses **Podman** to run sandboxes—isolated containers for code execution, custom functions, and agent tools. Install Podman on your machine using the steps below for your platform.

:::tip Need a GUI?
You can install **Podman Desktop** instead of (or in addition to) the CLI. It sets up the Podman engine and a Podman machine for you. See [Podman Desktop downloads](https://podman-desktop.io/downloads).
:::

## Windows

**Requirements:** Windows 10 Build 19043+ or Windows 11 (64-bit), 6 GB RAM for the Podman machine, administrator rights, and **WSL 2**.

### Option 1: Podman Desktop (recommended)

1. **Enable WSL 2** (if not already):
   ```powershell
   wsl --update
   wsl --install --no-distribution
   ```
   Restart your computer.

2. **Install Podman Desktop** (pick one):
   - **Installer:** [Download for Windows](https://podman-desktop.io/downloads/windows) → run the installer → choose **Windows Linux Subsystem (WSLv2)**.
   - **WinGet:** `winget install RedHat.Podman-Desktop`
   - **Chocolatey:** `choco install podman-desktop`
   - **Scoop:** `scoop bucket add extras` then `scoop install podman-desktop`

3. Open Podman Desktop and use **Set up** / **Setup Podman** to install the engine and create the Podman machine.

### Option 2: Podman CLI only

Download the Windows installer from [podman.io](https://podman.io) or [GitHub releases](https://github.com/containers/podman/releases). After installation, create and start a machine (e.g. from PowerShell):

```powershell
podman machine init
podman machine start
```

**Verify:** `podman info` or in Podman Desktop: **Settings → Resources** → Podman tile shows the running machine.

## macOS

1. **Download** the installer from [podman.io](https://podman.io) or [GitHub releases](https://github.com/containers/podman/releases). (Alternatively, `brew install podman` — community-maintained.)
2. **Create and start** a Podman machine:
   ```bash
   podman machine init
   podman machine start
   ```
3. **Verify:** `podman info`

## Linux

Install the package for your distribution. No separate “machine” is needed; Podman runs natively.

| Distro | Command |
|--------|--------|
| **Ubuntu** (20.10+) | `sudo apt-get update && sudo apt-get -y install podman` |
| **Debian** (11+) | `sudo apt-get -y install podman` |
| **Fedora** | `sudo dnf -y install podman` |
| **CentOS Stream 9+** | `sudo dnf -y install podman` |
| **Arch / Manjaro** | `sudo pacman -S podman` |
| **openSUSE** | `sudo zypper install podman` |
| **Alpine** | `sudo apk add podman` |

**Verify:** `podman run --rm docker.io/library/hello-world`

For **RHEL**, see [Red Hat solution 3650231](https://access.redhat.com/solutions/3650231). For **Linux Mint**, use the same commands as Ubuntu (or Debian for LMDE).

## After installing

Once Podman is installed and (on Windows/macOS) the Podman machine is running, you can:

- Use **sandboxes** in Agentron (create sandboxes, run code, custom functions).
- Use tools that run commands in containers (e.g. `run_container_command`, `create_sandbox`, `execute_code`).

If something fails, check that `podman info` (or `podman machine list` on Windows/macOS) shows a working setup. For more detail, see the official [Podman installation docs](https://podman.io/docs/installation) and [Podman Desktop installation](https://podman-desktop.io/docs/installation).
