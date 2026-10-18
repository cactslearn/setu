# Security Policy

Setu P2P is engineered with privacy and security as first-class primitives. This document outlines our threat model, security principles, and the responsible disclosure process for security vulnerabilities.

---

## 🔒 Security Model & Principles

1. **End-to-End Transport Encryption:**
   - All media (audio, video, screen share) is encrypted using standard WebRTC SRTP (Secure Real-time Transport Protocol).
   - Data channels are encrypted using DTLS (Datagram Transport Layer Security) with ephemeral cryptographic keys generated per session.
2. **Short Authentication String (SAS) Verification:**
   - WebRTC encryption alone does not verify the human identity of the remote participant.
   - Setu P2P generates a 6-digit verification code and a 4-emoji fingerprint derived from the combined DTLS certificate hashes. Participants should verify these tokens over an out-of-band channel (e.g., trusted phone call) to detect potential active man-in-the-middle attacks during signaling payload exchange.
3. **Local-Only Storage & WebCrypto Encryption:**
   - Chat history, notes, and contacts are stored strictly in client-side IndexedDB.
   - Optional local encryption uses AES-GCM (256-bit) with keys derived via PBKDF2 (100,000 iterations of SHA-256) from a user-supplied passphrase.
4. **Sandboxed File Transfers:**
   - Files are transferred in 64KB binary chunks directly between peers.
   - Cryptographic SHA-256 integrity verification is performed on the complete binary stream before prompting the recipient to save the file.
5. **No Telemetry or Third-Party Loggers:**
   - Zero analytics SDKs, session replay trackers, or external logging scripts are bundled.

---

## ⚠️ Known Architectural Limitations

- **Browser Profile Access:** Data stored in IndexedDB is unencrypted unless the user explicitly enables local passphrase encryption. Anyone with access to your computer's operating system or browser profile directory could inspect unencrypted browser storage.
- **NAT Traversal & IP Exposure:** During WebRTC connection establishment, IP addresses (local LAN and public IP via STUN) are exchanged inside the SDP payloads to establish peer-to-peer transport. If IP confidentiality is required, participants should use a VPN.
- **External Recording:** While Setu P2P requires mutual in-app consent for built-in recording, client-side software cannot technically prevent a participant from recording their screen with external operating-system software or a physical camera.

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability in Setu P2P, please do NOT file a public issue.

Instead, please send an encrypted or direct email to the project maintainers with:
- A detailed description of the vulnerability.
- Steps or proof-of-concept scripts to reproduce the issue.
- Potential impact and suggested mitigations.

We will acknowledge receipt within 48 hours and work with you to remediate the vulnerability responsibly before public disclosure.
