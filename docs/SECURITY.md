# Setu P2P — Detailed Security & Cryptographic Architecture

## 1. Cryptographic Specifications

| Component | Standard / Algorithm | Key Size / Rounds | Scope |
|:---|:---|:---|:---|
| **Audio/Video Transport** | SRTP (AES-CM) | 128-bit / 256-bit | Real-time media encryption |
| **Data Channels** | DTLS 1.2 / 1.3 | Ephemeral curve keys | Peer-to-peer data channels |
| **Peer Identity Verification** | SHA-256 + SAS Mapping | 256-bit hash -> 6-digit & 4-emoji | Mitigate Man-in-the-Middle |
| **File Transfer Verification** | WebCrypto SHA-256 | Streaming 256-bit digest | End-to-end file integrity |
| **Local Storage Encryption** | WebCrypto PBKDF2 + AES-GCM | 100k rounds + 256-bit key | Browser IndexedDB messages |
| **Payload Integrity** | Adler-32 Checksum | 32-bit checksum | Detect copy-paste truncation |

---

## 2. Threat Analysis & Mitigations

### 2.1 Man-in-the-Middle (MITM) on Connection Payloads
- **Threat:** An adversary intercepting the manual copy-pasted offer and answer text could replace the DTLS fingerprint with their own, establishing two separate connections and decrypting media in transit.
- **Mitigation:** The SAS (Short Authentication String) mechanism extracts the DTLS fingerprints from both ends, sorts them lexicographically, hashes them together, and renders a 6-digit code and a 4-emoji token (e.g. 🦊 ⚡ 🌊 💎). Participants compare these tokens over an out-of-band channel (e.g., trusted voice call). An active attacker cannot tamper with the fingerprints without causing an immediate mismatch between the participants' tokens.

### 2.2 Payload Malformation & Injection
- **Threat:** Malformed, oversized, or malicious strings pasted into the payload textarea could crash the browser or cause prototype pollution.
- **Mitigation:**
  - `signaling.js` verifies checksums before decoding Base64 data.
  - JSON parsing is performed within `try/catch` boundaries.
  - Validates that `type` is strictly `'offer'` or `'answer'`, and that `sdp` contains standard SDP headers (`v=0\r\n`).

### 2.3 File Transfer Exploits
- **Threat:** Delivery of corrupted files or unbounded buffer consumption leading to browser crash.
- **Mitigation:**
  - Strict mutual consent required before transfer begins.
  - Backpressure flow control prevents buffers from exceeding 512KB.
  - Files are verified with SHA-256 before saving. Corrupted transfers are aborted with alerts.
