# Setu Companion (Native Remote Control Daemon)

Setu Companion is a lightweight, cross-platform background service that enables remote input control during screen sharing sessions on Setu.

## Security Model

1. **Localhost Binding:** Binds strictly to `127.0.0.1` and never exposes ports to external network interfaces.
2. **Pre-Shared Passkey Authentication:** Every connection requires a matching security passkey. Unauthorized connection attempts are dropped immediately.
3. **Configurable Port:** Default port is `49152`. Can be changed to any port between `1024` and `65535` via CLI arguments, `config.json`, or in Setu Settings.
4. **Host Supremacy:** If the host physically moves their mouse or presses a key, incoming remote commands are paused for 2.0 seconds.

## Requirements

- **Windows:** Windows 10/11 (x64)
- **macOS:** macOS 11+ (Apple Silicon or Intel, requires Accessibility permissions in System Settings)
- **Linux:** X11 or Wayland with uinput / libxtst

## Running via Native Binary

Run with default settings:
```bash
./setu-companion
```

Run with custom port and passkey:
```bash
./setu-companion --port 52100 --key "your_secret_passkey"
```

Using a configuration file:
Create `config.json` alongside the executable:
```json
{
  "port": 49152,
  "passkey": "setu_sec_your_secret_passkey"
}
```

## Building from Source

Ensure Rust and Cargo are installed (Rust 1.75+):
```bash
cd companion
cargo build --release
```

The optimized binary will be created at:
- Windows: `target/release/setu-companion.exe`
- macOS / Linux: `target/release/setu-companion`

## Immediate Testing with Node.js

Setu Companion also includes a standalone runner for quick local verification without compiling Rust:
```bash
node companion/setu-companion.js --port 49152 --key "your_secret_passkey"
```
