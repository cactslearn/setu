# Support and Help Center for Setu P2P

Thank you for using Setu P2P. This document provides troubleshooting steps, support resources, and channels for asking questions or seeking assistance.

---

## Getting Help

### 1. Documentation
Before opening an issue, please check the project documentation:
- [Architecture & Design](docs/ARCHITECTURE.md): Deep-dive explanation of zero-server WebRTC data channels and signaling.
- [Remote Control Guide](docs/REMOTE_CONTROL.md): Setu Companion daemon setup, passkey authentication, and loopback security.
- [Privacy & Local Storage](docs/PRIVACY.md): IndexedDB data handling, AES-GCM encryption, and panic wipe.

### 2. Frequently Asked Troubleshooting Scenarios

#### Connecting Peers Fails or Hangs on "Connecting..."
- **Symmetric NATs / Strict Enterprise Firewalls:** Setu P2P uses public STUN servers for direct peer-to-peer UDP punch-through. If both peers are located behind strict symmetric NATs or corporate enterprise firewalls that block peer-to-peer UDP traffic, connection establishment may fail. In such environments, connecting via a standard VPN resolves the NAT restriction.
- **ICE Candidate Exchange:** Ensure that both the offer payload and the answer payload are completely copied and pasted without missing characters, or use camera-scanned QR codes / 8-character smart room codes.

#### Camera or Microphone Not Detected
- Check your browser site permissions to confirm that camera and microphone access is allowed for the origin.
- On mobile devices, ensure no other application is holding exclusive access to the hardware camera sensor. If switching between front and back camera, Setu will automatically release the previous camera sensor before activating the new one.

#### Setu Companion Shows "Disconnected" During Screen Sharing
- Ensure the native Setu Companion background application is running on your machine.
- Verify that the port configured in Setu Settings matches the port used by the daemon (default: `49152`).
- Verify that the pre-shared security passkey configured in Settings matches the passkey provided to the daemon.
- Confirm that your browser has permission to connect to loopback WebSocket addresses (`ws://127.0.0.1:49152`).

---

## Community Channels

- **Bug Reports:** If you discover a functional bug, please file a detailed report using our [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md).
- **Feature Requests:** Propose new ideas using our [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.md).
- **Security Vulnerabilities:** Follow our private reporting procedure outlined in [SECURITY.md](SECURITY.md). Do not submit security vulnerabilities to public issue trackers.
- **Accessibility Inquiries:** File an issue with the label `accessibility` as detailed in [ACCESSIBILITY.md](ACCESSIBILITY.md).
