## Description

Please describe the changes proposed in this pull request, the rationale behind them, and which issues (if any) are closed or addressed.

Fixes #(issue)

---

## Type of Change

- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New capability / feature (non-breaking change adding functionality)
- [ ] Accessibility enhancement (WCAG compliance, screen reader or keyboard navigation fix)
- [ ] Performance optimization (Core Web Vitals, memory, or WebRTC latency)
- [ ] Documentation update

---

## Architectural Invariant Checklist

Setu P2P relies on strict foundational principles. Please verify that your submission adheres to these requirements:

- [ ] **Strictly Serverless:** The change does NOT introduce any central signaling server, project-hosted backend, cloud database, or remote telemetry/analytics service.
- [ ] **Native Web Standards:** Uses standard browser WebRTC (`RTCPeerConnection`, `MediaRecorder`, `WebCrypto`, `IndexedDB`) without introducing heavy external bundlers or non-standard dependencies.
- [ ] **Local-First Privacy:** Data remains local to the user's browser device. No telemetry, third-party trackers, or external logging scripts are bundled.
- [ ] **Consent & Security:** Features involving media recording, remote control, or file exchange require explicit, visible user consent.
- [ ] **Accessibility (a11y):** Preserves semantic HTML5 hierarchy, keyboard focus handling, ARIA attributes, and color contrast standards.
- [ ] **Multi-Platform Verification:** Tested across desktop (Chrome/Firefox/Edge/Safari) and/or mobile devices where applicable.

---

## Testing Steps

Describe how you tested these changes:
1. Open `http://localhost:8000` in Browser A.
2. Open `http://localhost:8000` in Browser B.
3. Verify connection, media streams, and the specific behavior changed.
