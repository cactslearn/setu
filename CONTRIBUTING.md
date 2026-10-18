# Contributing to Setu P2P

Thank you for your interest in contributing to Setu P2P! We welcome community contributions, bug reports, feature discussions, and documentation improvements.

---

## 🏛️ Core Architectural Invariants

Before submitting pull requests, please ensure your changes adhere strictly to the foundational architectural principles of this project:

1. **Strictly Serverless Application Architecture:**
   - All application logic must run directly in the user's browser.
   - Do NOT introduce any central signaling server, backend API, authentication server, or project-operated cloud database.
2. **Standard WebRTC & Browser APIs:**
   - Rely on native browser standards (`RTCPeerConnection`, `MediaRecorder`, `IndexedDB`, `WebCrypto`).
   - Keep the core codebase lightweight, dependency-free, and directly hostable on GitHub Pages.
3. **Local Data Ownership & Privacy:**
   - Any persisted state must live exclusively in browser-controlled storage (`IndexedDB` / `localStorage`).
   - Zero default telemetry, trackers, or external logging.
4. **Mutual Consent & Transparency:**
   - Features involving recording, file transmission, or shared page interaction must require explicit, visible user consent.

---

## 🛠️ Development & Testing Workflow

### 1. Local Setup
Setu P2P requires no compiler, bundler, or build step. Simply clone the repository and serve it over a local HTTPS or `localhost` server:

```bash
python -m http.server 8000
# Or using Node:
npx serve .
```

### 2. Testing Two Peers Locally
1. Open `http://localhost:8000` in Browser A (e.g. Chrome / Brave).
2. Open `http://localhost:8000` in Browser B (e.g. Firefox or an Incognito Window).
3. Test the full Host & Join flow:
   - Host generates code -> Copy -> Paste in Joiner.
   - Joiner generates reply -> Copy -> Paste in Host.
   - Verify SAS emoji and digit code.
   - Verify bidirectional audio/video, DataChannel chat, and chunked file transfer.

---

## 📋 Pull Request Guidelines

- Provide a clear, descriptive title and summary of changes.
- Explain how your change respects the serverless architecture.
- Verify that your code adheres to standard vanilla JavaScript (ES6+) and accessible HTML5 semantics.
- Document any new browser compatibility requirements or known edge cases.
