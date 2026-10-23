# Setu P2P — Detailed Security & Cryptographic Architecture

## 1. Cryptographic Specifications

| Component | Standard / Algorithm | Key Size / Rounds | Scope |
|:---|:---|:---|:---|
| **Audio/Video Transport** | SRTP (AES-CM) | 128-bit / 256-bit | Real-time media encryption |
| **Data Channels** | DTLS 1.2 / 1.3 | Ephemeral curve keys | Peer-to-peer data channels |
| **Peer Identity Verification** | SHA-256 + SAS Mapping | 256-bit hash -> 6-digit & token | Mitigate Man-in-the-Middle |
| **File Transfer Verification** | WebCrypto SHA-256 | Streaming 256-bit digest | End-to-end file integrity |
| **Local Storage Encryption** | WebCrypto PBKDF2 + AES-GCM | 100k rounds + 256-bit key | Browser IndexedDB messages |
| **Payload Integrity** | Adler-32 Checksum | 32-bit checksum | Detect copy-paste truncation |
| **Remote Control Auth** | WebCrypto CSPRNG | 128-bit entropy (`setu_sec_...`) | Host companion daemon auth |
| **Room Code Validation** | Strict Regex Pattern | `^SETU-[A-Z0-9]{4}-[A-Z0-9]{4}$` | API room code validation |

---

## 2. Threat Analysis & Mitigations

### 2.1 Man-in-the-Middle (MITM) on Connection Payloads
- **Threat:** An adversary intercepting the manual copy-pasted offer and answer text could replace the DTLS fingerprint with their own, establishing two separate connections and decrypting media in transit.
- **Mitigation:** The SAS (Short Authentication String) mechanism extracts the DTLS fingerprints from both ends, sorts them lexicographically, hashes them together, and renders a 6-digit verification code and visual verification tokens. Participants compare these tokens over an out-of-band channel (e.g., trusted voice call). An active attacker cannot tamper with the fingerprints without causing an immediate mismatch between the participants' tokens.

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

### 2.4 Remote Desktop Control Threat Model
- **Threat 1: Unauthorized Localhost Ingress / Drive-by Web Attacks:**
  - A malicious script running in another browser tab attempts to inject arbitrary keystrokes or mouse clicks into `ws://127.0.0.1:49152`.
  - **Mitigation:**
    1. Setu Companion binds strictly to `127.0.0.1` and immediately drops any connection lacking the valid per-session security passkey (`setu_sec_...`).
    2. The companion port is user-configurable (default 49152), avoiding predictable target endpoints.
    3. The host browser connects to the companion daemon only when the host explicitly enables "Allow Remote Control".
- **Threat 2: Malicious Peer Inputs / Host Disruption:**
  - Connected remote peer attempts unauthorized actions on the host desktop.
  - **Mitigation:**
    1. Multi-stage host consent: The peer can only request control; the host must explicitly approve via an interactive confirmation modal.
    2. Instant Revocation: A persistent "Revoke Control" toolbar button allows the host to cut remote input instantly.
    3. Host Physical Supremacy: Any physical mouse movement or keypress by the host temporarily suppresses remote inputs for 2.0 seconds.
    4. Screen Share Lifecycle: When screen sharing stops, remote control authorization is immediately revoked and the companion socket is closed.

### 2.5 API Signaling Gateway & Ephemeral Payloads
- **Threat:** Exposure of connection metadata or eavesdropping on intermediate signaling gateways.
- **Mitigation:**
  - Offer/answer payloads transmitted via the optional API signaling gateway contain only ephemeral SDP routing data and DTLS certificate hashes. Media and chat never touch the gateway.
  - Signaling polling is terminated immediately once the peer connection transitions to the connected state.

