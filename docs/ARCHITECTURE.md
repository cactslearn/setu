# Setu P2P — Architectural Specification

## 1. Architectural Philosophy

Setu P2P is built on a **strictly serverless, static website architecture**. Unlike traditional conferencing systems (which route media through central SFU/MCU servers or rely on dedicated WebSocket signaling backends), Setu executes 100% of its application logic, transport negotiations, and data persistence directly within the browser runtime.

```text
[Browser A (Host)] <======== P2P WebRTC Connection ========> [Browser B (Joiner)]
       │                      (SRTP / DTLS DataChannels)               │
       │                                                              │
       ├────── Local IndexedDB (Messages, Contacts, Notes)             ├────── Local IndexedDB
       └────── Manual / QR Code Exchange (Non-Trickle ICE)            └────── Manual / QR Code Exchange
```

---

## 2. Core Subsystems & Data Flow

### 2.1 Signaling Engine (`assets/js/signaling.js`)
Because there is no signaling server, Setu uses **Manual Non-Trickle ICE Exchange**:
1. When generating an Offer or Answer, `RTCPeerConnection` begins gathering ICE candidates from public STUN servers.
2. The engine waits until `iceGatheringState === 'complete'` (or a quiet candidate timeout). This embeds all local and server-reflexive (STUN) candidates directly inside the SDP body.
3. The complete `RTCSessionDescription` is serialized into a JSON object:
   ```json
   {
     "v": 1,
     "type": "offer",
     "sdp": "v=0\r\no=...",
     "label": "Meeting Host",
     "ts": 1729209600000
   }
   ```
4. The JSON is validated, checked with an Adler-32 checksum to prevent copy-paste truncation errors, and encoded to a Base64 string prefixed with `SETU-v1:<checksum>:<base64>`.

### 2.2 WebRTC Layer (`assets/js/webrtc.js`)
- **Transport Security:** SRTP for audio/video tracks; DTLS 1.2 for DataChannels.
- **Data Channels:**
  - `chat`: Ordered, reliable text delivery.
  - `control`: Internal protocol messaging for presence, reactions, hand raising, mutual recording consent, and collaborative whiteboard coordinates.
- **NAT Traversal & Relay Support:** 
  - By default, public STUN servers (`stun.l.google.com:19302`, `stun1.l.google.com:19302`, and `stun.cloudflare.com:3478`) determine external reflexive IP:port bindings for direct peer-to-peer hole-punching without proxying media packets.
  - **Symmetric NAT & Enterprise Firewall Limitation:** While STUN establishes direct connections for ~85% of consumer network pairings, connections between two Symmetric NATs (or strict UDP-filtered enterprise networks) cannot hole-punch directly.
  - **Optional Client-Side TURN Relay:** Users operating behind restrictive corporate firewalls or Symmetric NATs can optionally configure their own custom TURN server (URL, username, credential) in Settings. Credentials persist purely in client-side IndexedDB and are merged into `iceServers` during ICE gathering, guaranteeing 100% connectivity while preserving Setu's zero-backend architecture.

### 2.3 Peer Identity Verification (`assets/js/identity.js`)
- Transport encryption guarantees packets cannot be read by passive network observers, but cannot verify who generated the initial offer/answer payload.
- Setu computes the combined SHA-256 hash of the local and remote DTLS certificate fingerprints.
- The output produces a 6-digit numeric token and a 4-emoji Short Authentication String (SAS). When participants read these aloud over a phone call, they verify that no man-in-the-middle has modified the connection payloads.

### 2.4 Persistent Local Storage (`assets/js/storage.js`)
- Pure client-side IndexedDB database `SetuP2P_Storage`.
- Object stores:
  - `messages`: timestamped chat messages keyed by message ID.
  - `contacts`: remembered verified peer labels, fingerprints, and notes.
  - `settings`: theme preference, retention policies, and session notes.
- **Passphrase Encryption:** When enabled, message bodies are encrypted with AES-GCM (256-bit) using keys derived on-the-fly via PBKDF2 (100,000 rounds of SHA-256).

### 2.5 Chunked File Transfers (`assets/js/file-transfer.js`)
- Files are sliced into 64KB ArrayBuffers.
- The sender transmits file metadata and pauses until the receiver explicitly clicks "Accept".
- Chunks are sent with backpressure throttling (`bufferedAmountLowThreshold`) to prevent memory exhaustion.
- The receiver accumulates chunks into an in-memory Blob and computes its SHA-256 hash using the WebCrypto API. Only upon matching the sender's original digest is the file marked verified and saved.

### 2.6 Local Consensual Recording (`assets/js/recording.js`)
- Mutual consent handshake: clicking "Record" prompts the remote peer over the `control` DataChannel. Recording only starts if the remote peer accepts.
- Audio is mixed using Web Audio API `AudioContext.createMediaStreamDestination()`.
- Video is composited onto an offscreen 720p canvas showing remote video with local picture-in-picture.
- Captured using `MediaRecorder` into a local WebM blob. The file is saved directly to user downloads or discarded.

### 2.7 Collaborative Shared Workspace (`assets/js/shared-page.js`)
- Provides a purpose-built interactive whiteboard and synchronized scratchpad within the browser.
- **Host Authorization:** The session host must explicitly check "Allow Peer Drawing" to accept remote coordinates. If revoked, all inbound drawing events are ignored.
- Strictly isolated to the canvas element; zero access to operating system controls.
