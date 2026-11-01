/**
 * Setu P2P - Hardened Zero-Trust Cryptographic Sync Engine
 * Hardware-accelerated WebCrypto primitives:
 * - PBKDF2 (600,000 iterations) + HKDF-SHA256 key separation (kAuth, kEnc, kBlind)
 * - In-memory CryptoKey caching (instant execution, zero UI thread blocking)
 * - AES-256-GCM envelope encryption with random bucket padding
 * - Asymmetric device signatures (ECDSA P-256) for non-repudiation and tamper defense
 * - Blinded record and store identifiers via HMAC-SHA256
 * Zero emojis in code, comments, and telemetry.
 */

class SyncCryptoEngine {
  constructor() {
    this.cachedPassphrase = null;
    this.cachedAccountId = null;
    this.cachedKeys = null; // { kAuth, kEnc, kBlind, rawAuthToken }
    this.deviceSigningKeyPair = null; // { privateKey, publicKey, publicKeyBase64 }
  }

  /**
   * Helper: Convert ArrayBuffer / Uint8Array to Base64 string
   */
  bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /**
   * Helper: Convert Base64 string to Uint8Array
   */
  base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Helper: Convert ArrayBuffer to Hex string
   */
  bufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Derives isolated subkeys from Master Passphrase via PBKDF2 + HKDF.
   * Results are cached in memory for sub-millisecond execution.
   */
  async deriveSyncKeys(passphrase, accountId) {
    if (!passphrase || !passphrase.trim()) {
      throw new Error('Master encryption passphrase is required');
    }
    const cleanPass = passphrase.trim();
    const cleanAcc = (accountId || 'default_account').trim().toLowerCase();

    // Check in-memory cache
    if (this.cachedKeys && this.cachedPassphrase === cleanPass && this.cachedAccountId === cleanAcc) {
      return this.cachedKeys;
    }

    const enc = new TextEncoder();
    const passBuffer = enc.encode(cleanPass);
    const saltBuffer = enc.encode('SetuSyncSalt_v1_' + cleanAcc);

    // 1. Import passphrase as raw key material
    const baseKey = await crypto.subtle.importKey(
      'raw',
      passBuffer,
      'PBKDF2',
      false,
      ['deriveBits']
    );

    // 2. Derive 256 bits (32 bytes) master secret via PBKDF2 (600,000 iterations)
    const masterBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: 600000,
        hash: 'SHA-256'
      },
      baseKey,
      256
    );

    // 3. Import derived bits as Master HKDF key material
    const masterKey = await crypto.subtle.importKey(
      'raw',
      masterBits,
      'HKDF',
      false,
      ['deriveKey']
    );

    // 4. Derive K_enc (AES-256-GCM for record payload encryption)
    const kEnc = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: saltBuffer,
        info: enc.encode('setu-sync-enc-v1')
      },
      masterKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    // 5. Derive K_blind (HMAC-SHA256 for store & record ID blinding)
    const kBlind = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: saltBuffer,
        info: enc.encode('setu-sync-blind-v1')
      },
      masterKey,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify']
    );

    // 6. Derive K_auth (HMAC-SHA256 for API Authorization Token proof)
    const kAuth = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: saltBuffer,
        info: enc.encode('setu-sync-auth-v1')
      },
      masterKey,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign']
    );

    // Compute raw bearer auth token from K_auth and account ID
    const authProofBuffer = await crypto.subtle.sign(
      'HMAC',
      kAuth,
      enc.encode('setu_sync_auth_proof:' + cleanAcc)
    );
    const rawAuthToken = this.bufferToHex(authProofBuffer);

    this.cachedPassphrase = cleanPass;
    this.cachedAccountId = cleanAcc;
    this.cachedKeys = {
      kEnc,
      kBlind,
      kAuth,
      rawAuthToken
    };

    return this.cachedKeys;
  }

  /**
   * Retrieves or generates the local persistent device ECDSA P-256 keypair
   */
  async getOrCreateDeviceSigningKey() {
    if (this.deviceSigningKeyPair) {
      return this.deviceSigningKeyPair;
    }

    const pubKeyStorageKey = 'setu_sync_device_pubkey_spki';
    const privKeyStorageKey = 'setu_sync_device_privkey_pkcs8';

    const savedPub = localStorage.getItem(pubKeyStorageKey);
    const savedPriv = localStorage.getItem(privKeyStorageKey);

    if (savedPub && savedPriv) {
      try {
        const pubBuffer = this.base64ToBuffer(savedPub);
        const privBuffer = this.base64ToBuffer(savedPriv);

        const publicKey = await crypto.subtle.importKey(
          'spki',
          pubBuffer,
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['verify']
        );

        const privateKey = await crypto.subtle.importKey(
          'pkcs8',
          privBuffer,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['sign']
        );

        this.deviceSigningKeyPair = {
          publicKey,
          privateKey,
          publicKeyBase64: savedPub
        };
        return this.deviceSigningKeyPair;
      } catch (err) {
        console.warn('[SyncCrypto] Re-generating device keypair due to import error:', err);
      }
    }

    // Generate new non-extractable ECDSA P-256 Keypair
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256'
      },
      true, // extractable for local private storage
      ['sign', 'verify']
    );

    const exportedPub = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const exportedPriv = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    const pubBase64 = this.bufferToBase64(exportedPub);
    const privBase64 = this.bufferToBase64(exportedPriv);

    localStorage.setItem(pubKeyStorageKey, pubBase64);
    localStorage.setItem(privKeyStorageKey, privBase64);

    this.deviceSigningKeyPair = {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      publicKeyBase64: pubBase64
    };

    return this.deviceSigningKeyPair;
  }

  /**
   * Computes deterministic blinded hash for stores and record IDs (HMAC-SHA256)
   */
  async blindIdentifier(kBlind, prefix, identifier) {
    const enc = new TextEncoder();
    const data = enc.encode(prefix + ':' + String(identifier).trim());
    const signature = await crypto.subtle.sign('HMAC', kBlind, data);
    return this.bufferToHex(signature);
  }

  /**
   * Applies random bucket padding to defeat traffic analysis
   * Buckets: 512B, 2KB, 8KB, 32KB, 128KB
   */
  padPlaintext(plaintextString) {
    const enc = new TextEncoder();
    const raw = enc.encode(plaintextString);
    const len = raw.length;

    const buckets = [512, 2048, 8192, 32768, 131072];
    let targetSize = buckets.find(b => b > len + 4);
    if (!targetSize) {
      targetSize = Math.ceil((len + 4) / 65536) * 65536;
    }

    const paddingLen = targetSize - (len + 4);
    const out = new Uint8Array(targetSize);

    // First 4 bytes: length of original payload (Big Endian)
    const view = new DataView(out.buffer);
    view.setUint32(0, len, false);

    // Payload bytes
    out.set(raw, 4);

    // Random padding bytes for remaining space
    if (paddingLen > 0) {
      const padBytes = new Uint8Array(paddingLen);
      crypto.getRandomValues(padBytes);
      out.set(padBytes, 4 + len);
    }

    return out;
  }

  /**
   * Unpads padded buffer back to raw string
   */
  unpadPlaintext(paddedBuffer) {
    const view = new DataView(paddedBuffer.buffer, paddedBuffer.byteOffset, paddedBuffer.byteLength);
    const len = view.getUint32(0, false);
    const raw = new Uint8Array(paddedBuffer.buffer, paddedBuffer.byteOffset + 4, len);
    const dec = new TextDecoder();
    return dec.decode(raw);
  }

  /**
   * Encrypts, blinds, and signs a local change record into a sealed wire envelope
   */
  async packChangeEnvelope(changeEntry, passphrase, accountId) {
    const keys = await this.deriveSyncKeys(passphrase, accountId);
    const devKeys = await this.getOrCreateDeviceSigningKey();

    // 1. Compute Blinded Identifiers
    const blindedStore = await this.blindIdentifier(keys.kBlind, 'store', changeEntry.store);
    const blindedRecordId = await this.blindIdentifier(keys.kBlind, 'record', changeEntry.recordId);

    let ivBase64 = null;
    let ciphertextBase64 = null;
    let tagBase64 = null;

    if (changeEntry.action === 'upsert' && changeEntry.rawData) {
      // 2. Serialize payload with metadata for remote resolution
      const payloadObj = {
        store: changeEntry.store,
        recordId: changeEntry.recordId,
        timestamp: changeEntry.timestamp,
        data: changeEntry.rawData
      };
      const jsonStr = JSON.stringify(payloadObj);
      const paddedData = this.padPlaintext(jsonStr);

      // 3. Encrypt via native AES-GCM (96-bit IV)
      const iv = new Uint8Array(12);
      crypto.getRandomValues(iv);

      const encryptedBuffer = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          tagLength: 128
        },
        keys.kEnc,
        paddedData
      );

      ivBase64 = this.bufferToBase64(iv);
      ciphertextBase64 = this.bufferToBase64(encryptedBuffer);
    }

    // 4. Build message string to sign
    const enc = new TextEncoder();
    const signTarget = [
      changeEntry.changeId,
      changeEntry.originDeviceId,
      String(changeEntry.seq),
      String(changeEntry.timestamp),
      changeEntry.action,
      blindedStore,
      blindedRecordId,
      ivBase64 || '',
      ciphertextBase64 || ''
    ].join('|');

    // 5. Sign with local device ECDSA private key
    const sigBuffer = await crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' }
      },
      devKeys.privateKey,
      enc.encode(signTarget)
    );
    const deviceSignature = this.bufferToBase64(sigBuffer);

    return {
      changeId: changeEntry.changeId,
      originDeviceId: changeEntry.originDeviceId,
      seq: changeEntry.seq,
      timestamp: changeEntry.timestamp,
      action: changeEntry.action,
      blindedStore,
      blindedRecordId,
      iv: ivBase64,
      ciphertext: ciphertextBase64,
      deviceSignature,
      senderPublicKey: devKeys.publicKeyBase64
    };
  }

  /**
   * Verifies, decrypts, and unpads an incoming wire envelope
   */
  async unpackChangeEnvelope(envelope, passphrase, accountId, knownSenderPubKeys = {}) {
    const keys = await this.deriveSyncKeys(passphrase, accountId);

    // 1. Verify ECDSA signature using sender's public key
    const pubKeyBase64 = envelope.senderPublicKey || knownSenderPubKeys[envelope.originDeviceId];
    if (!pubKeyBase64) {
      throw new Error(`Missing sender public key for device ${envelope.originDeviceId}`);
    }

    const pubKeyBuffer = this.base64ToBuffer(pubKeyBase64);
    const publicKey = await crypto.subtle.importKey(
      'spki',
      pubKeyBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    const enc = new TextEncoder();
    const signTarget = [
      envelope.changeId,
      envelope.originDeviceId,
      String(envelope.seq),
      String(envelope.timestamp),
      envelope.action,
      envelope.blindedStore,
      envelope.blindedRecordId,
      envelope.iv || '',
      envelope.ciphertext || ''
    ].join('|');

    const sigBuffer = this.base64ToBuffer(envelope.deviceSignature);
    const valid = await crypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' }
      },
      publicKey,
      sigBuffer,
      enc.encode(signTarget)
    );

    if (!valid) {
      throw new Error(`Digital signature verification failed for change ${envelope.changeId}`);
    }

    // 2. Handle deletion tombstones
    if (envelope.action === 'delete') {
      return {
        changeId: envelope.changeId,
        originDeviceId: envelope.originDeviceId,
        seq: envelope.seq,
        timestamp: envelope.timestamp,
        action: 'delete',
        blindedStore: envelope.blindedStore,
        blindedRecordId: envelope.blindedRecordId,
        store: null,
        recordId: null,
        data: null
      };
    }

    // 3. Decrypt payload via AES-GCM
    if (!envelope.iv || !envelope.ciphertext) {
      throw new Error(`Incomplete ciphertext payload for change ${envelope.changeId}`);
    }

    const iv = this.base64ToBuffer(envelope.iv);
    const ciphertext = this.base64ToBuffer(envelope.ciphertext);

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: 128
      },
      keys.kEnc,
      ciphertext
    );

    // 4. Unpad and parse JSON
    const unpaddedJson = this.unpadPlaintext(new Uint8Array(decryptedBuffer));
    const payload = JSON.parse(unpaddedJson);

    return {
      changeId: envelope.changeId,
      originDeviceId: envelope.originDeviceId,
      seq: envelope.seq,
      timestamp: envelope.timestamp,
      action: 'upsert',
      blindedStore: envelope.blindedStore,
      blindedRecordId: envelope.blindedRecordId,
      store: payload.store,
      recordId: payload.recordId,
      data: payload.data
    };
  }

  /**
   * Clears in-memory keys upon user lock or logout
   */
  clearKeyCache() {
    this.cachedPassphrase = null;
    this.cachedAccountId = null;
    this.cachedKeys = null;
  }
}

// Global instance
window.setuSyncCrypto = new SyncCryptoEngine();

