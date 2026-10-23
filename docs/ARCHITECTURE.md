# Setu P2P — Architectural Specification

## 1. Architectural Philosophy

Setu P2P is built on a **strictly serverless, static website architecture**. Unlike traditional conferencing systems (which route media through central SFU/MCU servers or rely on dedicated WebSocket signaling backends), Setu executes 100% of its application logic, transport negotiations, and data persistence directly within the browser runtime.

```text
[Browser A (Host)] <======== P2P WebRTC Connection ========> [Browser B (Joiner)]
       │                      (SRTP / DTLS DataChannels)               │
       │                                                              │
       ├────── Local IndexedDB (Messages, Contacts, Notes)             ├────── Local IndexedDB
       ├────── Manual / QR / Room Code API Signaling                   ├────── Manual / QR / Room Code API Signaling
       └────── Setu Companion Daemon (ws://127.0.0.1:49152)            └────── Setu Companion Daemon (Optional)
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

### 2.8 Remote Desktop Control Subsystem (`assets/js/remote-control.js` & `companion/`)
- **Native OS Input Injection via Companion Daemon:** Browser sandboxes cannot inject OS-level clicks or keystrokes. Setu pairs the browser with Setu Companion, an unprivileged native daemon running on `127.0.0.1`.
- **Pre-Shared Session Passkey Authentication:** Connections over the loopback WebSocket (`ws://127.0.0.1:49152`) require a cryptographically randomized session passkey (`setu_sec_...`). Unauthenticated sockets are dropped immediately.
- **Normalized Floating Coordinates:** Pointer positions are calculated relative to the shared video bounding box and transmitted as normalized `0.0` to `1.0` floats, dynamically scaled to target screen dimensions by the companion.
- **Double Cursor Suppression:** Active remote control suppresses the controller's local cursor (`cursor: none;`) over the video stream, rendering only the host's actual pointer position to eliminate visual confusion.
- **Multi-Stage Host Consent:** The host must check "Allow Remote Control", approve the remote peer's request modal, and can click "Revoke Control" at any moment. Physical mouse movement by the host overrides remote input for 2.0 seconds.
- For complete specifications, see [docs/REMOTE_CONTROL.md](REMOTE_CONTROL.md).

### 2.9 Smart Room Signaling & API Fallback (`assets/js/room-signaling.js`)
- **Human-Friendly 8-Character Room Codes:** Supports simple room codes formatted as `SETU-XXXX-XXXX` for instant entry alongside manual Base64 payload exchange.
- **Automated Offer Probing & Role Resolution:** When entering a room code, Setu probes the signaling gateway with a randomized jitter window (550ms to 800ms) to detect existing host offers and avoid simultaneous collision:
  - If an active offer exists: Assumes the Joiner role, downloads the offer, and publishes an encrypted answer.
  - If no offer exists: Assumes the Host role, initializes WebRTC, and publishes an offer.
- **Bandwidth Conservation (Polling Lifecycle):** Polling against the signaling gateway is terminated immediately once the direct P2P connection reaches `connected` state.

### 2.10 Built-in Audio Notification Service (`assets/js/sound.js`)
- **Zero-Asset Web Audio API Synthesizer:** Produces clean, harmonic acoustic cues directly from browser audio synthesis without loading external MP3 or WAV files.
- **Harmonic Event Chimes:**
  - Participant Join: Upward dual-tone (C5 at 523.25 Hz to E5 at 659.25 Hz) with gentle exponential decay (0.38s).
  - Participant Disconnect: Soft downward dual-tone (E5 at 659.25 Hz to A4 at 440.00 Hz) indicating disconnection (0.38s).
  - Chat Message: Crisp high ping (A5 at 880 Hz to D6 at 1174.66 Hz, 0.20s).
  - Hand Raise: Dual-tone notification chime (G5 at 783.99 Hz to B5 at 987.77 Hz, 0.30s).
- **User Preference:** Audio notifications can be toggled on or off in the Settings dialog (`prefMeetingSoundsCheckbox`) and persist in IndexedDB.

### 2.11 Connection Resilience & Disconnect Monitoring (`assets/js/meeting.js` & `assets/js/webrtc.js`)
- **State Transition Guards:** Monitors `pc.connectionState` and `pc.iceConnectionState`. Transient network interruptions trigger visual status badges and automatic signaling retry prompts.
- **Silent Track Synthesis:** WebRTC placeholder tracks use synthesized digital silence buffers (zero amplitude with gain 0.0) to maintain valid audio clock synchronization without transmitting audible tones or 440 Hz beeps.
- **Audio Constraints:** Default capture enables acoustic echo cancellation, background noise suppression, and auto-gain control to eliminate acoustic feedback.

### 2.12 Presenter Screen Share Layout Management
- **Local Presenter Card Isolation:** When a participant shares their screen, Setu routes local presentation feedback to a dedicated `#localPresenterCard` container rather than overwriting main remote video elements. This eliminates local video flickering and preserves full visual visibility of remote participants.
- **Hardware Camera Release:** Disabling video explicitly stops underlying media stream tracks so camera hardware indicators and LED lights turn completely off.

### 2.13 Mobile Display Wake Lock & Audio Output Routing (`assets/js/meeting.js` & `assets/js/webrtc.js`)
- **Display Wake Lock:** Mobile platforms enforce aggressive 30 to 60-second display timeout policies. Setu activates the Screen Wake Lock API (`navigator.wakeLock.request('screen')`) upon meeting entry to keep displays awake indefinitely during active conferences, automatically re-requesting the lock when the browser regains visibility via the `visibilitychange` event.
- **Audio Output Transducer Switching:**
  - Android & Chromium: Supports dynamic sink switching using `HTMLMediaElement.prototype.setSinkId` and the native system output dialog (`navigator.mediaDevices.selectAudioOutput()`), enabling users to toggle between Loudspeaker, Earpiece, and paired Bluetooth headsets during active calls.
  - iOS WebKit / Safari: WebKit enforces strict anti-fingerprinting restrictions preventing programmatic `setSinkId`. Voice routing on iOS is managed cooperatively with hardware proximity sensors (holding the device to the ear switches from speakerphone to earpiece).
- **Mobile Split Controls & Camera Flipping:** Mobile meeting toolbars feature touch-accessible split controls for microphone and camera, 1-tap camera flipping (`flipCamera()` cycling front/back sensors via `facingMode`), and centered bottom popups.

### 2.14 Interactive Hardware Diagnostics Suite (`assets/js/device-test.js`)
- **Modular Tabbed Settings Architecture:** Replaces monolithic vertical dialogs with a high-performance tabbed navigation bar (`General`, `Audio`, `Video`, `Device Test`, `Network`, `Remote Control`).
- **Live Video Diagnostic Preview:** Renders camera streams directly with real-time metadata extraction, measuring actual rendering dimensions, framerate, and aspect ratio.
- **Microphone Signal Analyzer & 4-Second Voice Loopback:** Uses an `AnalyserNode` for real-time frequency-based input level metering and a 4-second `MediaRecorder` speech buffer that plays back through the chosen speaker/earpiece sink to verify audio capture fidelity.
- **Speaker Diagnostic Synthesizer:** Generates harmonic chime tones routed to the designated output sink for audible verification.
- **Strict Hardware Lifecycle Management:** All test streams and audio contexts are automatically torn down whenever the dialog is closed or tabs are changed, ensuring zero background camera/mic resource locking.

