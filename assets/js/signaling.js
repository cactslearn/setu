/**
 * Setu P2P - Manual Signaling & Payload Engine
 * Encapsulates, validates, compresses, and unpacks manual WebRTC payloads.
 * Strictly zero signaling server required.
 */

class SignalingEngine {
  constructor() {
    this.PROTOCOL_PREFIX = 'SETU-v1:';
    this.CHUNK_PREFIX = 'SETU-PART:';
  }

  /**
   * Calculates Adler-32 checksum to detect copy-paste truncation or corruption.
   */
  checksum(str) {
    let a = 1, b = 0;
    const MOD_ADLER = 65521;
    for (let i = 0; i < str.length; i++) {
      a = (a + str.charCodeAt(i)) % MOD_ADLER;
      b = (b + a) % MOD_ADLER;
    }
    return (b << 16) | a;
  }

  /**
   * Packs an RTCSessionDescription object into a formatted, safe shareable string.
   */
  packSessionDescription(desc, peerLabel = 'Anonymous') {
    if (!desc || !desc.type || !desc.sdp) {
      throw new Error('Invalid RTCSessionDescription provided for packaging');
    }

    const payloadObj = {
      v: 1,
      type: desc.type, // 'offer' or 'answer'
      sdp: desc.sdp,
      label: peerLabel,
      ts: Date.now()
    };

    const jsonStr = JSON.stringify(payloadObj);
    const chk = this.checksum(jsonStr);

    // Encode to UTF-8 safe base64
    const base64 = btoa(encodeURIComponent(jsonStr));
    return `${this.PROTOCOL_PREFIX}${chk}:${base64}`;
  }

  /**
   * Validates and unpacks a shareable string back into an RTCSessionDescription payload.
   */
  unpackSessionDescription(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return { valid: false, error: 'Empty payload provided.' };
    }

    const trimmed = rawText.trim();

    // Check if this is a multi-part chunk
    if (trimmed.startsWith(this.CHUNK_PREFIX)) {
      return { valid: false, isChunk: true, error: 'This is a multi-part QR chunk. Collect all chunks first.' };
    }

    if (!trimmed.startsWith(this.PROTOCOL_PREFIX)) {
      // Graceful fallback: check if raw JSON was pasted by advanced users
      try {
        const rawJson = JSON.parse(trimmed);
        if (rawJson.type && rawJson.sdp) {
          return {
            valid: true,
            type: rawJson.type,
            sdp: rawJson.sdp,
            label: rawJson.label || 'Direct Peer',
            timestamp: rawJson.ts || Date.now()
          };
        }
      } catch (e) {
        return { valid: false, error: 'Invalid payload format. Expected Setu P2P code starting with SETU-v1:' };
      }
    }

    try {
      const body = trimmed.substring(this.PROTOCOL_PREFIX.length);
      const colonIdx = body.indexOf(':');
      if (colonIdx === -1) {
        return { valid: false, error: 'Malformed payload: missing checksum delimiter.' };
      }

      const expectedChecksum = parseInt(body.substring(0, colonIdx), 10);
      const base64Data = body.substring(colonIdx + 1);

      const jsonStr = decodeURIComponent(atob(base64Data));
      const calculatedChecksum = this.checksum(jsonStr);

      if (expectedChecksum !== calculatedChecksum) {
        return {
          valid: false,
          error: 'Payload corruption detected. Please ensure the full code was copied without missing characters.'
        };
      }

      const parsed = JSON.parse(jsonStr);

      if (!parsed.type || !['offer', 'answer'].includes(parsed.type)) {
        return { valid: false, error: 'Invalid session type inside payload.' };
      }
      if (!parsed.sdp || typeof parsed.sdp !== 'string' || !parsed.sdp.includes('v=0')) {
        return { valid: false, error: 'Invalid or incomplete SDP data in payload.' };
      }

      // Check session age (e.g. 2 hours)
      const ageHours = (Date.now() - (parsed.ts || 0)) / (1000 * 60 * 60);
      let warning = null;
      if (ageHours > 2) {
        warning = 'Warning: This connection code was created over 2 hours ago and might have expired.';
      }

      return {
        valid: true,
        type: parsed.type,
        sdp: parsed.sdp,
        label: parsed.label || 'Remote Peer',
        timestamp: parsed.ts,
        warning
      };
    } catch (err) {
      return { valid: false, error: 'Failed to decode connection code: ' + err.message };
    }
  }

  /**
   * Divides a large payload into smaller chunks for multi-part QR code scanning.
   */
  chunkPayload(payloadStr, chunkSize = 400) {
    const chunks = [];
    const total = Math.ceil(payloadStr.length / chunkSize);
    for (let i = 0; i < total; i++) {
      const part = payloadStr.substr(i * chunkSize, chunkSize);
      chunks.push(`${this.CHUNK_PREFIX}${i + 1}/${total}:${part}`);
    }
    return chunks;
  }

  /**
   * Reassembles multi-part chunks.
   */
  assembleChunks(chunksMap, totalChunks) {
    if (Object.keys(chunksMap).length !== totalChunks) return null;
    let full = '';
    for (let i = 1; i <= totalChunks; i++) {
      full += chunksMap[i];
    }
    return full;
  }
}

// Global instance
window.setuSignaling = new SignalingEngine();
