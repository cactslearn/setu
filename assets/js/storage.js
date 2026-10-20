/**
 * Setu P2P - Storage Engine
 * Persistent local storage using IndexedDB with optional WebCrypto AES-GCM encryption.
 * Strictly zero cloud synchronization.
 */

class StorageEngine {
  constructor() {
    this.dbName = 'SetuP2P_Storage';
    this.dbVersion = 3;
    this.db = null;
    this.cryptoKey = null; // Derived AES-GCM key if encryption is unlocked
  }

  _createMissingStores(db) {
    if (!db.objectStoreNames.contains('messages')) {
      const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
      msgStore.createIndex('peerId', 'peerId', { unique: false });
      msgStore.createIndex('timestamp', 'timestamp', { unique: false });
    }
    if (!db.objectStoreNames.contains('contacts')) {
      const contactStore = db.createObjectStore('contacts', { keyPath: 'id' });
      contactStore.createIndex('label', 'label', { unique: false });
    }
    if (!db.objectStoreNames.contains('notes')) {
      db.createObjectStore('notes', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'key' });
    }
    if (!db.objectStoreNames.contains('history')) {
      const histStore = db.createObjectStore('history', { keyPath: 'id' });
      histStore.createIndex('timestamp', 'timestamp', { unique: false });
      histStore.createIndex('peerName', 'peerName', { unique: false });
    }
  }

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(this.dbName, this.dbVersion);

        request.onupgradeneeded = (event) => {
          this._createMissingStores(event.target.result);
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          
          // Self-healing check: verify all required stores exist
          const required = ['messages', 'contacts', 'notes', 'settings', 'history'];
          const missing = required.filter(s => !this.db.objectStoreNames.contains(s));
          if (missing.length > 0) {
            console.warn('[Storage] Missing stores detected (' + missing.join(', ') + '). Performing self-healing upgrade...');
            const targetVersion = (this.db.version || 2) + 1;
            this.db.close();
            this.db = null;

            const upgradeReq = indexedDB.open(this.dbName, targetVersion);
            upgradeReq.onupgradeneeded = (upEvent) => {
              this._createMissingStores(upEvent.target.result);
            };
            upgradeReq.onsuccess = (upEvent) => {
              this.db = upEvent.target.result;
              this.dbVersion = targetVersion;
              console.log('[Storage] Self-healing upgrade successful. Active stores:', Array.from(this.db.objectStoreNames).join(', '));
              resolve(this.db);
            };
            upgradeReq.onerror = (upEvent) => {
              console.error('[Storage] Upgrade error:', upEvent.target.error);
              resolve(null);
            };
            return;
          }

          resolve(this.db);
        };

        request.onerror = (event) => {
          console.error('IndexedDB open error:', event.target.error);
          resolve(null);
        };
      } catch (err) {
        console.error('IndexedDB init exception:', err);
        resolve(null);
      }
    });
  }

  // --- WebCrypto Encryption Support ---
  async deriveKeyFromPassphrase(passphrase, salt = 'SetuP2PSalt_2026') {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    this.cryptoKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode(salt),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return true;
  }

  async encryptText(plainText) {
    if (!this.cryptoKey) return plainText;
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.cryptoKey,
      enc.encode(plainText)
    );
    return {
      ciphertext: Array.from(new Uint8Array(encrypted)),
      iv: Array.from(iv),
      encrypted: true
    };
  }

  async decryptText(data) {
    if (!data || typeof data === 'string' || !data.encrypted) return data;
    if (!this.cryptoKey) return '[Encrypted Message - Enter Passphrase]';
    try {
      const dec = new TextDecoder();
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(data.iv) },
        this.cryptoKey,
        new Uint8Array(data.ciphertext)
      );
      return dec.decode(decrypted);
    } catch (e) {
      return '[Decryption Failed: Invalid Passphrase]';
    }
  }

  // --- Messages Store ---
  async saveMessage(msg) {
    await this.init();
    return new Promise(async (resolve, reject) => {
      let contentToStore = msg.content;
      let isEncrypted = false;
      if (this.cryptoKey) {
        contentToStore = await this.encryptText(msg.content);
        isEncrypted = true;
      }

      const record = {
        id: msg.id || 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        peerId: msg.peerId || 'anonymous',
        sender: msg.sender, // 'local' or 'remote'
        senderName: msg.senderName || 'Peer',
        content: contentToStore,
        isEncrypted: isEncrypted,
        timestamp: msg.timestamp || Date.now()
      };

      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async getMessages(peerId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('timestamp');
      const req = index.getAll();

      req.onsuccess = async () => {
        let results = req.result || [];
        if (peerId) {
          results = results.filter(m => m.peerId === peerId || m.peerId === 'anonymous');
        }
        // Decrypt if necessary
        for (let item of results) {
          if (item.isEncrypted && typeof item.content === 'object') {
            item.content = await this.decryptText(item.content);
          }
        }
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async searchMessages(query, peerId) {
    const all = await this.getMessages(peerId);
    if (!query || !query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter(m => String(m.content).toLowerCase().includes(q));
  }

  async clearMessages(peerId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      if (!peerId) {
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      } else {
        const index = store.index('peerId');
        const req = index.openCursor(IDBKeyRange.only(peerId));
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve(true);
          }
        };
        req.onerror = () => reject(req.error);
      }
    });
  }

  // --- Contacts Store ---
  async saveContact(contact) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('contacts', 'readwrite');
      const store = tx.objectStore('contacts');
      const record = {
        id: contact.id || 'contact_' + Date.now(),
        label: contact.label || 'Unnamed Contact',
        fingerprint: contact.fingerprint || '',
        verified: !!contact.verified,
        lastSeen: contact.lastSeen || Date.now(),
        notes: contact.notes || ''
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async getContacts() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('contacts', 'readonly');
      const store = tx.objectStore('contacts');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteContact(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('contacts', 'readwrite');
      const store = tx.objectStore('contacts');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Settings Store ---
  async setSetting(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.put({ key, value });
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  }

  async getSetting(key, defaultValue = null) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? req.result.value : defaultValue);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // --- User Profile & Global Settings ---
  async getUserProfile() {
    return await this.getSetting('user_profile', {
      displayName: 'You',
      avatarDataUrl: '',
      defaultMuteAudio: false,
      defaultMutedAudio: false,
      defaultMuteVideo: false,
      defaultMutedVideo: false,
      noiseSuppression: true,
      echoCancellation: true,
      preferredTheme: 'dark',
      historyRetentionDays: 30,
      cameraQuality: '720p',
      screenShareMode: 'sharpness',
      autoReduceQuality: true,
      audioOnlyFallback: false,
      turnServerUrl: '',
      turnUsername: '',
      turnCredential: '',
      personalRoomCode: ''
    });
  }

  async saveUserProfile(profile) {
    return await this.setSetting('user_profile', profile);
  }

  async getOrCreatePersonalRoomCode() {
    const profile = await this.getUserProfile();
    if (profile && profile.personalRoomCode && profile.personalRoomCode.trim()) {
      return profile.personalRoomCode.trim();
    }
    let newCode = '';
    if (typeof window !== 'undefined' && window.setuRoomSignaling && window.setuRoomSignaling.generateRoomCode) {
      newCode = window.setuRoomSignaling.generateRoomCode();
    } else {
      newCode = 'room-' + Math.random().toString(36).slice(2, 6) + '-' + Math.random().toString(36).slice(2, 6);
    }
    profile.personalRoomCode = newCode;
    await this.saveUserProfile(profile);
    return newCode;
  }

  async setPersonalRoomCode(code) {
    const profile = await this.getUserProfile();
    profile.personalRoomCode = (code || '').trim();
    return await this.saveUserProfile(profile);
  }

  // --- Custom API Gateway Settings ---
  async getApiSignalingSettings() {
    return await this.getSetting('api_signaling_settings', {
      enabled: false,
      endpoint: '',
      secretKey: '',
      pollIntervalSec: 3
    });
  }

  async saveApiSignalingSettings(settings) {
    const current = await this.getApiSignalingSettings();
    const updated = {
      ...current,
      enabled: !!settings.enabled,
      endpoint: (settings.endpoint || '').trim(),
      secretKey: (settings.secretKey !== undefined ? settings.secretKey : current.secretKey || '').trim(),
      pollIntervalSec: Math.max(1, Math.min(10, parseInt(settings.pollIntervalSec, 10) || 3))
    };
    return await this.setSetting('api_signaling_settings', updated);
  }

  // --- Meeting History Archive ---
  _getFallbackHistory() {
    try {
      const raw = localStorage.getItem('setu_meeting_history_fallback');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  _saveFallbackHistory(records) {
    try {
      localStorage.setItem('setu_meeting_history_fallback', JSON.stringify(records));
    } catch (e) {}
  }

  async saveMeeting(meetingRecord) {
    const chats = meetingRecord.chats || meetingRecord.chatMessages || [];
    const files = meetingRecord.files || meetingRecord.sharedFiles || [];
    const durationSec = meetingRecord.durationSec || meetingRecord.durationSeconds || 0;
    const durationFormatted = meetingRecord.durationFormatted || (durationSec > 0 ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}` : '00:00');

    const record = {
      id: meetingRecord.id || 'meet_' + Date.now(),
      timestamp: meetingRecord.timestamp || Date.now(),
      dateStr: meetingRecord.dateStr || new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      timeStr: meetingRecord.timeStr || new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      durationSec,
      durationSeconds: durationSec,
      durationFormatted,
      peerName: meetingRecord.peerName || 'Remote Peer',
      peerFingerprint: meetingRecord.peerFingerprint || '',
      notes: meetingRecord.notes || '',
      chats,
      chatMessages: chats,
      files,
      sharedFiles: files,
      stats: meetingRecord.stats || {}
    };

    // 1. Synchronously persist to fallback storage first
    try {
      const fallbackList = this._getFallbackHistory().filter(m => m.id !== record.id);
      fallbackList.unshift(record);
      this._saveFallbackHistory(fallbackList);
    } catch (e) {}

    // 2. Persist to IndexedDB
    try {
      await this.init();
      if (this.db && this.db.objectStoreNames.contains('history')) {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction('history', 'readwrite');
          const store = tx.objectStore('history');
          const req = store.put(record);
          req.onsuccess = () => resolve(record);
          req.onerror = () => reject(req.error);
        });
      }
    } catch (e) {
      console.warn('[Storage] Could not write meeting to IndexedDB, fallback storage maintained:', e);
    }

    return record;
  }

  async getAllMeetings() {
    let dbMeetings = [];
    try {
      await this.init();
      if (this.db && this.db.objectStoreNames.contains('history')) {
        dbMeetings = await new Promise((resolve, reject) => {
          const tx = this.db.transaction('history', 'readonly');
          const store = tx.objectStore('history');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      }
    } catch (e) {
      console.warn('[Storage] Error reading meetings from IndexedDB:', e);
    }

    // Merge with fallback cache
    const fallbackList = this._getFallbackHistory();
    const map = new Map();
    (dbMeetings || []).forEach(m => { if (m && m.id) map.set(m.id, m); });
    (fallbackList || []).forEach(m => {
      if (m && m.id && !map.has(m.id)) map.set(m.id, m);
    });

    const combined = Array.from(map.values());
    combined.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // Keep fallback in sync with all found meetings
    if (combined.length > 0) {
      this._saveFallbackHistory(combined);
    }

    return combined;
  }

  async deleteMeeting(id) {
    // 1. Remove from fallback
    try {
      const filtered = this._getFallbackHistory().filter(m => m.id !== id);
      this._saveFallbackHistory(filtered);
    } catch (e) {}

    // 2. Remove from IndexedDB
    try {
      await this.init();
      if (this.db && this.db.objectStoreNames.contains('history')) {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction('history', 'readwrite');
          const store = tx.objectStore('history');
          const req = store.delete(id);
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        });
      }
    } catch (e) {
      console.warn('[Storage] Error deleting meeting from IndexedDB:', e);
    }
    return true;
  }

  async clearAllMeetings() {
    // 1. Clear fallback
    try {
      localStorage.removeItem('setu_meeting_history_fallback');
    } catch (e) {}

    // 2. Clear IndexedDB
    try {
      await this.init();
      if (this.db && this.db.objectStoreNames.contains('history')) {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction('history', 'readwrite');
          const store = tx.objectStore('history');
          const req = store.clear();
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        });
      }
    } catch (e) {
      console.warn('[Storage] Error clearing meetings from IndexedDB:', e);
    }
    return true;
  }

  async searchMeetings(query) {
    try {
      const all = await this.getAllMeetings();
      if (!query || !query.trim()) return all;
      const q = query.toLowerCase().trim();

      return all.filter(m => {
        const matchPeer = (m.peerName || '').toLowerCase().includes(q);
        const matchDate = (m.dateStr || '').toLowerCase().includes(q);
        const matchNotes = (m.notes || '').toLowerCase().includes(q);
        const matchChats = (m.chats || []).some(c => (c.text || '').toLowerCase().includes(q) || (c.sender || '').toLowerCase().includes(q));
        const matchFiles = (m.files || []).some(f => (f.name || '').toLowerCase().includes(q));
        return matchPeer || matchDate || matchNotes || matchChats || matchFiles;
      });
    } catch (e) {
      console.warn('[Storage] searchMeetings error:', e);
      return [];
    }
  }

  // --- Export and Panic Wipe ---
  async exportAllData() {
    const messages = await this.getMessages();
    const contacts = await this.getContacts();
    const meetings = await this.getAllMeetings();
    return {
      appName: 'Setu P2P',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      messages,
      contacts,
      meetings
    };
  }

  async purgeAllData() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(this.dbName);
      req.onsuccess = () => {
        localStorage.clear();
        sessionStorage.clear();
        resolve(true);
      };
      req.onerror = () => reject(req.error);
    });
  }
}

// Global instance
window.setuStorage = new StorageEngine();
