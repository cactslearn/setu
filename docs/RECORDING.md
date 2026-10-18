# Setu P2P — Consensual Recording Guide

Setu P2P includes an in-app meeting recording module designed from the ground up around user privacy and mutual consent.

---

## 1. Ethical Recording Architecture & Mutual Consent

- **Disabled by Default:** The recording feature is inactive when a meeting starts.
- **Dual-Party Consent Protocol:**
  1. When a participant clicks the **Record** button, an internal request packet (`recording-consent-request`) is transmitted over the encrypted WebRTC control channel.
  2. The other participant is shown a modal: *"Remote peer wishes to record this meeting. Do you grant consent?"*
  3. If granted, the initiator's browser starts the `MediaRecorder` engine. Both participants see an active red pulsing badge with the label **REC ACTIVE** on their screens.
  4. If declined, recording is canceled immediately.

---

## 2. Technical Recording Implementation

- **Web Audio API Mixing:**
  The recorder accesses local microphone tracks and inbound remote audio tracks, feeding both into an in-memory `AudioContext.createMediaStreamDestination()`. This creates a unified stereo mix without feedback loops.
- **Video Compositing:**
  A 720p (1280x720) canvas composites the remote participant's video as the primary stage, overlaid with the local participant's video in the bottom-right Picture-in-Picture position.
- **Encoding:**
  The composite stream is passed to the browser's native `MediaRecorder` API using the `video/webm;codecs=vp9,opus` container (falling back to standard `video/webm` on browsers that do not support VP9).

---

## 3. Storage Destinations & Zero Cloud Upload

- Recordings are buffered exclusively inside temporary browser RAM.
- When recording is stopped, the user is presented with a prompt:
  - **Save to Computer:** Triggers a browser download of the `.webm` file to the user's chosen folder.
  - **Discard without Saving:** Immediately releases memory buffers and discards the recording chunks.
- No recording data ever touches a remote server or cloud bucket.
