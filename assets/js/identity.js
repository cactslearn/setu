/**
 * Setu P2P - Peer Identity Verification Engine
 * Generates cryptographic Short Authentication Strings (SAS) and phonetic security tokens
 * derived from WebRTC DTLS fingerprints for out-of-band verification.
 * Zero emojis are used.
 */

class IdentityEngine {
  constructor() {
    this.PHONETIC_DICTIONARY = [
      'ALFA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL',
      'INDIA', 'JULIETT', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA',
      'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO', 'UNIFORM', 'VICTOR', 'WHISKEY', 'XRAY',
      'YANKEE', 'ZULU', 'APEX', 'BEACON', 'CIPHER', 'DELTA', 'ECHO', 'FALCON'
    ];
  }

  /**
   * Extracts the DTLS fingerprint line from an SDP string.
   */
  extractFingerprint(sdp) {
    if (!sdp) return '';
    const match = sdp.match(/a=fingerprint:sha-256\s+([A-Fa-f0-9:]+)/i);
    return match ? match[1].toUpperCase() : '';
  }

  /**
   * Generates a combined cryptographic hash from local and remote fingerprints.
   */
  async generateVerificationTokens(localSdp, remoteSdp) {
    const localFp = this.extractFingerprint(localSdp);
    const remoteFp = this.extractFingerprint(remoteSdp);

    // If standard fingerprint line not matched, hash full SDP headers
    const inputA = localFp || (localSdp ? localSdp.slice(0, 100) : 'local');
    const inputB = remoteFp || (remoteSdp ? remoteSdp.slice(0, 100) : 'remote');

    // Lexicographically order inputs so both peers compute the EXACT same hash
    const combinedString = [inputA, inputB].sort().join('|');

    const enc = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(combinedString));
    const hashBytes = new Uint8Array(hashBuffer);

    // 1. Generate 6-digit numeric token
    const num = ((hashBytes[0] << 16) | (hashBytes[1] << 8) | hashBytes[2]) % 1000000;
    const numericCode = String(num).padStart(6, '0');
    const formattedCode = `${numericCode.slice(0, 3)} - ${numericCode.slice(3)}`;

    // 2. Generate 4 phonetic security words (Zero emojis)
    const dictCount = this.PHONETIC_DICTIONARY.length;
    const phoneticWords = [
      this.PHONETIC_DICTIONARY[hashBytes[3] % dictCount],
      this.PHONETIC_DICTIONARY[hashBytes[4] % dictCount],
      this.PHONETIC_DICTIONARY[hashBytes[5] % dictCount],
      this.PHONETIC_DICTIONARY[hashBytes[6] % dictCount]
    ].join(' • ');

    return {
      remoteFingerprint: remoteFp,
      localFingerprint: localFp,
      numericCode: formattedCode,
      phoneticWords: phoneticWords,
      fullHashHex: Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('')
    };
  }

  /**
   * Validates fingerprint against remembered contact data in IndexedDB.
   */
  async checkSavedIdentity(contactLabel, remoteFingerprint) {
    if (!window.setuStorage) return { status: 'new' };
    const contacts = await window.setuStorage.getContacts();
    const match = contacts.find(c => c.label.toLowerCase() === contactLabel.toLowerCase());

    if (!match) {
      return { status: 'new', contact: null };
    }

    if (match.fingerprint && match.fingerprint !== remoteFingerprint) {
      return {
        status: 'mismatch',
        contact: match,
        warning: `Security Alert: The cryptographic fingerprint for "${contactLabel}" does not match previous sessions!`
      };
    }

    return {
      status: match.verified ? 'verified' : 'unverified',
      contact: match
    };
  }

  /**
   * Marks a contact as verified with their current fingerprint.
   */
  async rememberVerifiedPeer(label, fingerprint) {
    if (!window.setuStorage) return;
    const contacts = await window.setuStorage.getContacts();
    let contact = contacts.find(c => c.label.toLowerCase() === label.toLowerCase());

    if (contact) {
      contact.fingerprint = fingerprint;
      contact.verified = true;
      contact.lastSeen = Date.now();
    } else {
      contact = {
        label: label,
        fingerprint: fingerprint,
        verified: true,
        lastSeen: Date.now()
      };
    }
    await window.setuStorage.saveContact(contact);
    return contact;
  }

  /**
   * Retrieves or creates a permanent cryptographic identity card for this device/browser.
   */
  async getOrCreatePermanentIdentity() {
    let raw = localStorage.getItem('setu_permanent_identity');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }

    // Generate persistent entropy for this peer's identity card
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const hashBuf = await crypto.subtle.digest('SHA-256', randomBytes);
    const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const shortFp = hashHex.match(/.{1,2}/g).slice(0, 16).join(':').toUpperCase();

    const identity = {
      id: 'setu-' + Math.random().toString(36).substring(2, 10),
      fingerprint: shortFp,
      fullSha256: hashHex.toUpperCase(),
      createdAt: Date.now(),
      token: `SETU-ID:${shortFp}`
    };

    localStorage.setItem('setu_permanent_identity', JSON.stringify(identity));
    return identity;
  }
}

// Global instance
window.setuIdentity = new IdentityEngine();
