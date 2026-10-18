# Setu P2P — Serverless Peer-to-Peer Communication Platform

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Hosting](https://img.shields.io/badge/Hosting-GitHub_Pages-black.svg)](https://pages.github.com/)
[![Architecture](https://img.shields.io/badge/Architecture-Strictly_Serverless-emerald.svg)](#architecture)

**Setu P2P** is an open-source, strictly serverless, zero-backend WebRTC communication platform running entirely inside your browser. It provides one-to-one encrypted audio and video meetings, screen sharing, real-time chat with persistent local history, chunked peer-to-peer file transfer, collaborative workspaces, and consensual local recording without requiring account creation, central signaling infrastructure, or cloud databases.

---

## 🌟 Key Capabilities

- **Strictly Serverless Architecture:** Hosted statically on GitHub Pages or any static web host. Zero project-operated signaling servers, presence services, account databases, or cloud storage.
- **Manual & QR Code Connection Exchange:** Simple, guided copy-and-paste or camera-scanned QR code exchange with automatic non-trickle ICE gathering.
- **DTLS/SRTP WebRTC Encryption:** Audio, video, and data channels are end-to-end encrypted across standard browser WebRTC APIs.
- **Short Authentication String (SAS) Verification:** Generates cryptographic emoji tokens and 6-digit confirmation codes from DTLS fingerprints to prevent man-in-the-middle attacks over a secondary trusted channel.
- **Real-Time DataChannel Chat:** Markdown-enabled messaging with local persistence in browser IndexedDB, search, export to JSON, and optional WebCrypto AES-GCM local passphrase encryption.
- **Chunked P2P File Transfers:** Transfer files of any type in 64KB chunks with backpressure management, mutual consent prompts, and cryptographic SHA-256 integrity checks before saving.
- **Consensual Local Recording:** Audio/video compositing and Web Audio mixing via browser `MediaRecorder`. Both participants must grant consent before recording commences. Recordings stay on the local device.
- **Shared Collaborative Workspace:** Synchronized drawing whiteboard and collaborative scratchpad with explicit host-controlled permissions and instant revoke.
- **Live Diagnostics & Network Health:** Continuous real-time monitor for round-trip latency (RTT), packet loss percentage, resolution, framerate, and candidate topology.
- **Privacy & Storage Management Console:** Real-time data audit, configurable auto-retention pruning, and one-click Panic Wipe to permanently erase all local storage.

---

## 📁 Repository Structure

```text
setu/
├── index.html                  # Semantic, accessible HTML5 single-page application
├── assets/
│   ├── css/
│   │   └── app.css             # Glassmorphic dark/light design system
│   └── js/
│       ├── app.js              # Coordinator, message dispatcher & shortcuts
│       ├── storage.js          # IndexedDB engine with AES-GCM encryption
│       ├── signaling.js        # Non-trickle ICE payload packaging & validation
│       ├── identity.js         # SAS cryptographic verification & fingerprints
│       ├── webrtc.js           # RTCPeerConnection, tracks & DataChannels
│       ├── presence.js         # Availability statuses & idle detection
│       ├── chat.js             # DataChannel chat, Markdown & export
│       ├── file-transfer.js    # Chunked file streaming & SHA-256 validation
│       ├── recording.js        # Consensual MediaRecorder & Web Audio mixer
│       ├── diagnostics.js      # WebRTC getStats() latency & quality monitor
│       ├── qr-exchange.js      # Visual QR code generation & camera scanner
│       ├── shared-page.js      # Collaborative whiteboard with host permissions
│       ├── privacy.js          # Privacy auditor, retention & panic wipe
│       ├── connection-ui.js    # 4-step guided Host/Join connection wizard
│       └── meeting.js          # Media controls, 1-hour session timer & PIP
├── docs/
│   ├── ARCHITECTURE.md         # Deep-dive system architecture & data flows
│   ├── PRIVACY.md              # Local storage, WebRTC traffic & metadata
│   ├── DISCLAIMER.md           # As-is warranty & liability limitations
│   ├── DEPLOYMENT.md           # Static deployment guide (GitHub Pages)
│   ├── RECORDING.md            # Consensual recording policy & technical limits
│   └── SECURITY.md             # Security architecture & vulnerability reporting
├── LICENSE                     # Apache License 2.0
├── NOTICE                      # Copyright & third-party notices
├── README.md                   # Project overview & documentation
└── CONTRIBUTING.md             # Contribution guidelines
```

---

## 🚀 Quick Start (Local Development)

Because Setu P2P is a static web application, no build steps or backend servers are required.

### 1. Clone the repository
```bash
git clone https://github.com/your-username/setu.git
cd setu
```

### 2. Serve locally via any static server
Browsers require a secure context (`https://` or `http://localhost`) to access camera, microphone, and display media APIs.

Using Python 3:
```bash
python -m http.server 8000
```

Using Node.js (`npx serve`):
```bash
npx serve .
```

Then navigate to `http://localhost:8000` in two separate browser tabs or windows to test connection exchange!

---

## 🔄 Establishing a Connection

1. **Host a Meeting:**
   - Click **"Host a Meeting"**.
   - Setu will gather public network routes (STUN) and create an invitation code starting with `SETU-v1:`.
   - Click **"Copy Code"** (or display the QR code) and send it to your peer via your preferred messaging app.
2. **Join a Meeting:**
   - The other participant opens Setu, clicks **"Join a Meeting"**, and pastes the code.
   - Setu automatically generates a reply answer code. The joiner copies and sends this back to the host.
3. **Connect & Verify:**
   - The host pastes the joiner's reply code.
   - Both participants review their 6-digit verification code and 4-emoji SAS tokens over voice to ensure authentic end-to-end communication.
   - Click **"Join Call Now"** to enter the meeting!

---

## 🔒 Security & Privacy Guarantees

- **No Intermediate Servers:** Audio, video, files, and chat messages travel exclusively across encrypted peer-to-peer WebRTC connections.
- **Local Data Ownership:** All chat logs, contacts, and preferences remain solely inside your browser's IndexedDB. Clearing your local data never impacts the remote participant's copy.
- **Zero Telemetry:** No analytics scripts, tracking cookies, or external trackers are included.
- **Third-Party Services:** The only external network requests occur during the initial connection phase to public STUN servers (`stun.l.google.com:19302` or `stun.cloudflare.com:3478`) for NAT traversal candidate discovery.

For more information, see [docs/PRIVACY.md](docs/PRIVACY.md) and [docs/SECURITY.md](docs/SECURITY.md).

---

## 📄 License

Licensed under the Apache License, Version 2.0 (the "License"). You may obtain a copy of the License in the [LICENSE](LICENSE) file.
