# Setu P2P — Remote Desktop Control & Companion Daemon Specification

## 1. Overview

Setu P2P includes a low-latency, consensual remote desktop control system designed for peer-to-peer screen sharing sessions. Because web browsers run in secure sandboxes without native operating-system input privileges, Setu pairs browser WebRTC data channels with **Setu Companion**, an unprivileged native background daemon running on the screen presenter's local machine.

```text
[Remote Controller (Browser)]
           │
           │ WebRTC 'control' DataChannel (DTLS-encrypted, peer-to-peer)
           ▼
[Presenter / Host (Browser)]
           │
           │ Local Loopback WebSocket (ws://127.0.0.1:49152, auth passkey)
           ▼
[Setu Companion (Native OS Daemon)]
           │
           │ OS Native Input APIs (SendInput / CGEvent / uinput)
           ▼
[Host Operating System Desktop]
```

---

## 2. Security Architecture & Threat Model

Remote desktop control introduces physical OS input risks. Setu implements defense-in-depth measures to ensure that unauthorized or malicious inputs cannot be executed:

### 2.1 Strict Localhost Loopback Binding
- Setu Companion binds strictly to `127.0.0.1` (IPv4 loopback) and explicitly refuses external network interfaces (`0.0.0.0` or LAN IPs).
- Network attackers on the local LAN cannot connect to or probe the companion service directly.

### 2.2 Pre-Shared Session Passkey
- Every Setu meeting session generates a cryptographically random passkey (for example, `setu_sec_1e8b62d7...`) using the browser's WebCrypto API.
- Users can view and customize this passkey in the Setu Settings dialog.
- The companion requires this passkey upon connection (either via WebSocket handshake query parameter `?passkey=...` or as the initial `auth` packet).
- Connection attempts without a matching passkey are terminated immediately without processing any input packets.

### 2.3 User-Configurable Daemon Port
- The default loopback port is `49152` (within the IANA dynamic/private port range 49152-65535).
- Users can customize this port in Setu Settings and launch the companion with `--port <number>` or via `config.json`.
- This prevents port collision and avoids hardcoded target ports on the host system.

### 2.4 Host-in-the-Loop Multi-Stage Authorization
Remote control cannot be initiated unilaterally:
1. **Explicit Feature Opt-In:** The presenter must enable "Allow Remote Control" in the control bar. By default, remote control is disabled.
2. **Interactive Request Modal:** When the remote peer clicks "Request Control", the presenter is shown an interactive modal displaying the requester's name. Control is only granted if the presenter explicitly clicks "Approve".
3. **Instant Revocation:** The presenter has a persistent, prominent "Revoke Control" button in the meeting toolbar to instantly terminate remote control at any moment.
4. **Auto-Termination on Stream End:** As soon as the presenter stops sharing their screen, remote control authorization is immediately revoked and the companion socket is disconnected.
5. **Host Supremacy Override:** If the host moves their physical mouse or presses a key, incoming remote commands are temporarily suppressed (2.0 second cooldown) to ensure the host always retains full sovereignty over their workstation.

---

## 3. Input Protocol & Coordinate Normalization

### 3.1 Relative Normalized Coordinates
Because the presenter's screen resolution (for example, 3840x2160 or 1920x1080) rarely matches the remote controller's viewport, coordinates are never transmitted in raw pixel values:
- The controller calculates cursor positions relative to the active shared video element boundaries.
- Coordinates are normalized to floating-point values between `0.0` and `1.0`:
  - `x = clamp((clientX - videoLeft) / videoWidth, 0.0, 1.0)`
  - `y = clamp((clientY - videoTop) / videoHeight, 0.0, 1.0)`
- Setu Companion maps these relative ratios to the host system's primary display dimensions:
  - `screenX = round(normalizedX * primaryDisplayWidth)`
  - `screenY = round(normalizedY * primaryDisplayHeight)`

### 3.2 Double Cursor Suppression
When remote control is active:
- The remote controller's local cursor is suppressed (`cursor: none;`) over the active shared screen area.
- Setu renders the host's actual cursor position on an interactive overlay so the controller sees only a single pointer, eliminating visual confusion.
- When the controller moves their cursor outside the video container, local OS cursor control is immediately restored.

### 3.3 Protocol Packet Structure
All control messages travel over the WebRTC `control` DataChannel and are forwarded over the loopback WebSocket to the companion daemon:

| Type | Direction | Payload Example | Purpose |
|:---|:---|:---|:---|
| `auth` | Browser -> Daemon | `{"type":"auth","passkey":"setu_sec_..."}` | Authenticates connection |
| `rc-request` | Peer -> Host | `{"type":"rc-request","requesterName":"Alice"}` | Requests remote control |
| `rc-grant` | Host -> Peer | `{"type":"rc-grant"}` | Approves remote control |
| `rc-revoke` | Host -> Peer | `{"type":"rc-revoke"}` | Terminates remote control |
| `mouse_move` | Peer -> Daemon | `{"type":"mouse_move","x":0.452,"y":0.318}` | Moves pointer |
| `mouse_down` | Peer -> Daemon | `{"type":"mouse_down","button":"left","x":0.452,"y":0.318}` | Mouse button down |
| `mouse_up` | Peer -> Daemon | `{"type":"mouse_up","button":"left","x":0.452,"y":0.318}` | Mouse button up |
| `mouse_wheel` | Peer -> Daemon | `{"type":"mouse_wheel","deltaX":0,"deltaY":-120}` | Scroll wheel action |
| `key_down` | Peer -> Daemon | `{"type":"key_down","key":"Enter","code":"Enter"}` | Key press |
| `key_up` | Peer -> Daemon | `{"type":"key_up","key":"Enter","code":"Enter"}` | Key release |

---

## 4. Platform Bundles & Installation

Pre-packaged bundles are available in the `downloads/` directory:

| Platform | Archive Name | Launch Script | Daemon Implementation |
|:---|:---|:---|:---|
| **Windows** | `setu-companion-windows.zip` | `run-companion.bat` | Rust binary (`enigo` crate) / Node.js fallback |
| **macOS** | `setu-companion-macos.zip` | `run-companion.command` | Rust binary / Node.js (`robotjs` or native) |
| **Linux** | `setu-companion-linux.zip` | `run-companion.sh` | Rust binary (`libxtst`/`uinput`) / Node.js |

### 4.1 Running via Standalone Node.js Runner
If Rust binaries are not yet compiled, the repository includes a zero-dependency standalone Node.js runner:
```bash
node companion/setu-companion.js --port 49152 --key "your_secret_passkey"
```

### 4.2 Building Native Binaries from Source
To compile native release binaries:
```bash
cd companion
cargo build --release
```
The resulting executable will be placed in `companion/target/release/setu-companion`.

---

## 5. Troubleshooting & FAQ

- **Companion shows "WebSocket connection failed":**
  - Verify that Setu Companion is running in a terminal.
  - Verify that the port configured in Setu Settings matches the port specified when starting the companion.
  - Verify that the security passkey in Setu Settings matches the companion configuration.
- **Mouse clicks are not registered on macOS:**
  - On macOS, background input tools require Accessibility permissions. Open **System Settings > Privacy & Security > Accessibility** and ensure Setu Companion (or Terminal) has permission enabled.
- **Double cursor visible during remote session:**
  - Ensure `#remoteControlOverlay` has loaded properly. The overlay applies `cursor: none;` across the shared screen container while control is active.
