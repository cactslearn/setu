# Setu P2P — Privacy Policy & Local Data Management

**Last Updated:** October 2026  
**Document Purpose:** Complete transparency regarding data storage, network traffic, and third-party metadata.

---

## 1. Zero Cloud Data Collection

Setu P2P does NOT operate any central servers, user accounts, databases, or analytics services. When using Setu P2P:
- No personal data is collected or transmitted to the creators of this project.
- No user accounts, passwords, or emails are registered.
- No meeting logs, transcripts, or recordings are uploaded to the cloud.
- No third-party analytics trackers, cookies, or telemetry scripts are executed.

---

## 2. Peer-to-Peer Communication & Network Metadata

WebRTC establishes direct browser-to-browser media and data sessions:
- **Direct Traffic:** Audio, video, screen shares, and chat messages travel directly between you and your peer. They are encrypted in transit using standard DTLS/SRTP protocols.
- **NAT Traversal & STUN:** To connect through firewalls and home routers, Setu queries public STUN servers (such as Google STUN or Cloudflare STUN). During this query, your router's external IP address and port mapping are discovered so that your peer can reach you directly. The STUN server does not inspect or relay your media.
- **IP Exposure:** By its very nature, a direct peer-to-peer connection reveals your public IP address to the connected peer. If you need IP confidentiality from your peer, you should run your browser through a Virtual Private Network (VPN).

---

## 3. Local Data Storage & IndexedDB

All persistent items (chat messages, contacts, notes) remain stored exclusively in your local web browser using the standard HTML5 `IndexedDB` API:
- **Local Scope:** Deleting or modifying messages in your browser does NOT delete or modify copies stored in the remote peer's browser.
- **Passphrase Encryption:** You can protect local chat history with a passphrase. When configured, message content is encrypted using AES-GCM (256-bit) before writing to IndexedDB.
- **Panic Wipe:** You can click the "Panic Wipe" button in the Privacy Console at any time to instantly eradicate all stored messages, contacts, notes, and session state from your browser.

---

## 4. Static Hosting Metadata

Because Setu P2P is hosted as static HTML/JS files on GitHub Pages (or an equivalent static web host), the hosting provider may log standard web server access metrics (such as the IP address requesting `index.html`, user-agent, and timestamp) in accordance with GitHub's standard privacy policies.
