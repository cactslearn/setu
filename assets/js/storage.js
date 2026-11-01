/**
 * Setu P2P - Storage Engine
 * Persistent local storage using IndexedDB with optional WebCrypto AES-GCM encryption.
 * Strictly zero cloud synchronization.
 */

class StorageEngine {
  constructor() {
    this.dbName = 'SetuP2P_Storage';
    this.dbVersion = 5;
    this.db = null;
    this.cryptoKey = null; // Derived AES-GCM key if encryption is unlocked
    this.isSyncApplying = false; // Flag to prevent change recording loopback during remote sync ingestion
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
    if (!db.objectStoreNames.contains('schedules')) {
      const schedStore = db.createObjectStore('schedules', { keyPath: 'id' });
      schedStore.createIndex('startTime', 'startTime', { unique: false });
      schedStore.createIndex('roomCode', 'roomCode', { unique: false });
    }
    if (!db.objectStoreNames.contains('sync_changelog')) {
      const chgStore = db.createObjectStore('sync_changelog', { keyPath: 'changeId' });
      chgStore.createIndex('timestamp', 'timestamp', { unique: false });
      chgStore.createIndex('status', 'status', { unique: false });
      chgStore.createIndex('store', 'store', { unique: false });
    }
    if (!db.objectStoreNames.contains('sync_tombstones')) {
      const tombStore = db.createObjectStore('sync_tombstones', { keyPath: 'recordId' });
      tombStore.createIndex('store', 'store', { unique: false });
      tombStore.createIndex('deletedAt', 'deletedAt', { unique: false });
    }
    if (!db.objectStoreNames.contains('sync_devices')) {
      const devStore = db.createObjectStore('sync_devices', { keyPath: 'deviceId' });
      devStore.createIndex('lastSeen', 'lastSeen', { unique: false });
    }
    if (!db.objectStoreNames.contains('sync_meta')) {
      db.createObjectStore('sync_meta', { keyPath: 'key' });
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
          const required = ['messages', 'contacts', 'notes', 'settings', 'history', 'schedules', 'sync_changelog', 'sync_tombstones', 'sync_devices', 'sync_meta'];
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
      req.onsuccess = () => {
        this.recordChange('messages', record.id, 'upsert', record);
        resolve(record);
      };
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
      req.onsuccess = () => {
        this.recordChange('contacts', record.id, 'upsert', record);
        resolve(record);
      };
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
      req.onsuccess = () => {
        this.recordChange('contacts', id, 'delete', null);
        resolve(true);
      };
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
      personalRoomCode: '',
      meetingSounds: true
    });
  }

  async saveUserProfile(profile) {
    const res = await this.setSetting('user_profile', profile);
    this.recordChange('settings', 'user_profile', 'upsert', profile);
    return res;
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
      pollIntervalSec: Math.max(1, Math.min(60, parseInt(settings.pollIntervalSec, 10) || 3))
    };
    return await this.setSetting('api_signaling_settings', updated);
  }

  // --- Remote Control & Companion Settings ---
  async getRemoteControlSettings() {
    return await this.getSetting('remote_control_settings', {
      companionPort: 49152,
      companionPasskey: 'setu_remote_access_key',
      allowRemoteControl: false
    });
  }

  async saveRemoteControlSettings(settings) {
    const current = await this.getRemoteControlSettings();
    const updated = {
      ...current,
      companionPort: Math.max(1024, Math.min(65535, parseInt(settings.companionPort, 10) || 49152)),
      companionPasskey: (settings.companionPasskey !== undefined && settings.companionPasskey !== null ? settings.companionPasskey : (current.companionPasskey || 'setu_remote_access_key')).trim(),
      allowRemoteControl: settings.allowRemoteControl !== undefined ? !!settings.allowRemoteControl : current.allowRemoteControl
    };
    return await this.setSetting('remote_control_settings', updated);
  }

  // --- Multi-Device Sync Settings ---
  async getSyncSettings() {
    return await this.getSetting('multi_device_sync_settings', {
      enabled: false,
      endpoint: '',
      accountId: '',
      authToken: '',
      masterPassphrase: '',
      pollIntervalSec: 15,
      lastSyncTimestamp: 0,
      lastSyncCursor: 0,
      deviceId: '',
      deviceLabel: ''
    });
  }

  async saveSyncSettings(settings) {
    const current = await this.getSyncSettings();
    const updated = {
      ...current,
      ...settings
    };
    return await this.setSetting('multi_device_sync_settings', updated);
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
          req.onsuccess = () => {
            this.recordChange('history', record.id, 'upsert', record);
            resolve(record);
          };
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
          req.onsuccess = () => {
            this.recordChange('history', id, 'delete', null);
            resolve(true);
          };
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

  // --- Scheduled Meetings Store ---
  _getFallbackSchedules() {
    try {
      const raw = localStorage.getItem('setu_schedules_fallback');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  _saveFallbackSchedules(list) {
    try {
      localStorage.setItem('setu_schedules_fallback', JSON.stringify(list));
    } catch (e) {}
  }

  async saveSchedule(schedule) {
    if (!schedule) return null;
    const item = {
      id: schedule.id || 'sched_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      title: (schedule.title || 'Setu Meeting').trim(),
      roomCode: (schedule.roomCode || '').trim(),
      startTime: schedule.startTime || new Date().toISOString(),
      durationMinutes: parseInt(schedule.durationMinutes, 10) || 30,
      notes: (schedule.notes || '').trim(),
      location: schedule.location || '',
      createdAt: schedule.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 1. Fallback sync
    try {
      const current = this._getFallbackSchedules().filter(s => s.id !== item.id);
      current.push(item);
      current.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      this._saveFallbackSchedules(current);
    } catch (e) {}

    // 2. Save in IndexedDB
    try {
      await this.init();
      if (this.db && this.db.objectStoreNames.contains('schedules')) {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction('schedules', 'readwrite');
          const store = tx.objectStore('schedules');
          const req = store.put(item);
          req.onsuccess = () => {
            this.recordChange('schedules', item.id, 'upsert', item);
            resolve(true);
          };
          req.onerror = () => reject(req.error);
        });
      }
    } catch (e) {
      console.warn('[Storage] Error saving schedule to IndexedDB:', e);
    }

    return item;
  }

  async getAllSchedules() {
    let items = [];
    try {
      await this.init();
      if (this.db && this.db.objectStoreNames.contains('schedules')) {
        items = await new Promise((resolve, reject) => {
          const tx = this.db.transaction('schedules', 'readonly');
          const store = tx.objectStore('schedules');
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      }
    } catch (e) {
      console.warn('[Storage] Error fetching schedules from IndexedDB:', e);
    }

    if (!items || items.length === 0) {
      items = this._getFallbackSchedules();
    }

    // Sort chronologically ascending
    items.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    return items;
  }

  async getSchedule(id) {
    if (!id) return null;
    try {
      await this.init();
      if (this.db && this.db.objectStoreNames.contains('schedules')) {
        const item = await new Promise((resolve, reject) => {
          const tx = this.db.transaction('schedules', 'readonly');
          const store = tx.objectStore('schedules');
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
        if (item) return item;
      }
    } catch (e) {
      console.warn('[Storage] Error reading schedule from IndexedDB:', e);
    }

    const fallbackList = this._getFallbackSchedules();
    return fallbackList.find(s => s.id === id) || null;
  }

  async deleteSchedule(id) {
    if (!id) return false;
    // 1. Fallback update
    try {
      const filtered = this._getFallbackSchedules().filter(s => s.id !== id);
      this._saveFallbackSchedules(filtered);
    } catch (e) {}

    // 2. Remove from IndexedDB
    try {
      await this.init();
      if (this.db && this.db.objectStoreNames.contains('schedules')) {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction('schedules', 'readwrite');
          const store = tx.objectStore('schedules');
          const req = store.delete(id);
          req.onsuccess = () => {
            this.recordChange('schedules', id, 'delete', null);
            resolve(true);
          };
          req.onerror = () => reject(req.error);
        });
      }
    } catch (e) {
      console.warn('[Storage] Error deleting schedule from IndexedDB:', e);
    }
    return true;
  }

  async clearAllSchedules() {
    try {
      localStorage.removeItem('setu_schedules_fallback');
    } catch (e) {}

    try {
      await this.init();
      if (this.db && this.db.objectStoreNames.contains('schedules')) {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction('schedules', 'readwrite');
          const store = tx.objectStore('schedules');
          const req = store.clear();
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        });
      }
    } catch (e) {
      console.warn('[Storage] Error clearing schedules from IndexedDB:', e);
    }
    return true;
  }

  // --- Multi-Device Sync Change Tracking & Anti-Replay Ledger ---
  async getDeviceId() {
    let devId = localStorage.getItem('setu_sync_device_id');
    if (!devId) {
      const isMobile = (typeof navigator !== 'undefined' && /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent));
      devId = 'dev_' + (isMobile ? 'mob' : 'desk') + '_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('setu_sync_device_id', devId);
    }
    return devId;
  }

  async getNextDeviceSeq() {
    let seq = parseInt(localStorage.getItem('setu_sync_device_seq') || '0', 10);
    seq += 1;
    localStorage.setItem('setu_sync_device_seq', String(seq));
    return seq;
  }

  async recordChange(storeName, recordId, action, rawData = null) {
    if (this.isSyncApplying) return; // Prevent loopback when applying remote deltas
    try {
      await this.init();
      if (!this.db || !this.db.objectStoreNames.contains('sync_changelog')) return;

      const deviceId = await this.getDeviceId();
      const seq = await this.getNextDeviceSeq();
      const timestamp = Date.now();
      const changeId = 'chg_' + timestamp + '_' + Math.random().toString(36).substring(2, 8);

      const entry = {
        changeId,
        originDeviceId: deviceId,
        seq,
        timestamp,
        store: storeName,
        recordId: String(recordId),
        action, // 'upsert' or 'delete'
        rawData: action === 'delete' ? null : rawData,
        status: 'pending' // 'pending' | 'synced'
      };

      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('sync_changelog', 'readwrite');
        const store = tx.objectStore('sync_changelog');
        const req = store.put(entry);
        req.onsuccess = () => resolve(entry);
        req.onerror = () => reject(req.error);
      });

      if (action === 'delete') {
        await this.recordTombstone(storeName, recordId, timestamp);
      }

      // Notify sync engine if active
      if (typeof window !== 'undefined' && window.setuSyncEngine && typeof window.setuSyncEngine.onLocalChangeRecorded === 'function') {
        window.setuSyncEngine.onLocalChangeRecorded(entry);
      }
    } catch (err) {
      console.warn('[Storage] recordChange error:', err);
    }
  }

  async recordTombstone(storeName, recordId, deletedAt = Date.now()) {
    try {
      await this.init();
      if (!this.db || !this.db.objectStoreNames.contains('sync_tombstones')) return;
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('sync_tombstones', 'readwrite');
        const store = tx.objectStore('sync_tombstones');
        const req = store.put({
          recordId: String(recordId),
          store: storeName,
          deletedAt
        });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('[Storage] recordTombstone error:', err);
    }
  }

  async isTombstoned(recordId, incomingTimestamp = 0) {
    try {
      await this.init();
      if (!this.db || !this.db.objectStoreNames.contains('sync_tombstones')) return false;
      return await new Promise((resolve) => {
        const tx = this.db.transaction('sync_tombstones', 'readonly');
        const store = tx.objectStore('sync_tombstones');
        const req = store.get(String(recordId));
        req.onsuccess = () => {
          if (!req.result) return resolve(false);
          resolve(req.result.deletedAt >= incomingTimestamp);
        };
        req.onerror = () => resolve(false);
      });
    } catch (_) {
      return false;
    }
  }

  async getPendingChanges(limit = 100) {
    try {
      await this.init();
      if (!this.db || !this.db.objectStoreNames.contains('sync_changelog')) return [];
      return await new Promise((resolve) => {
        const tx = this.db.transaction('sync_changelog', 'readonly');
        const store = tx.objectStore('sync_changelog');
        const index = store.index('status');
        const req = index.getAll(IDBKeyRange.only('pending'));
        req.onsuccess = () => {
          const list = (req.result || []).slice(0, limit);
          resolve(list);
        };
        req.onerror = () => resolve([]);
      });
    } catch (e) {
      return [];
    }
  }

  async markChangesSynced(changeIds, serverCursor = 0) {
    if (!changeIds || changeIds.length === 0) return;
    try {
      await this.init();
      if (!this.db || !this.db.objectStoreNames.contains('sync_changelog')) return;
      await new Promise((resolve) => {
        const tx = this.db.transaction('sync_changelog', 'readwrite');
        const store = tx.objectStore('sync_changelog');
        let done = 0;
        changeIds.forEach(id => {
          const getReq = store.get(id);
          getReq.onsuccess = () => {
            if (getReq.result) {
              getReq.result.status = 'synced';
              getReq.result.serverCursor = serverCursor;
              store.put(getReq.result);
            }
            done++;
            if (done === changeIds.length) resolve(true);
          };
          getReq.onerror = () => {
            done++;
            if (done === changeIds.length) resolve(true);
          };
        });
      });
    } catch (e) {
      console.warn('[Storage] markChangesSynced error:', e);
    }
  }

  /**
   * Scans all local records in history, contacts, schedules, and settings.
   * If any record is not in sync_changelog (or was marked synced with serverCursor <= 0),
   * enqueues it as a pending change so it pushes to the sync server.
   */
  async ensureAllRecordsEnqueuedForSync() {
    if (this.isSyncApplying) return 0;
    try {
      await this.init();
      if (!this.db || !this.db.objectStoreNames.contains('sync_changelog')) return 0;

      // 1. Get existing change entries mapped by store:recordId
      const existingMap = await new Promise((resolve) => {
        const tx = this.db.transaction('sync_changelog', 'readonly');
        const store = tx.objectStore('sync_changelog');
        const req = store.getAll();
        req.onsuccess = () => {
          const map = new Map();
          (req.result || []).forEach(entry => {
            const key = `${entry.store}:${entry.recordId}`;
            // If already pending or synced with a real server cursor > 0, consider it enqueued
            if (entry.status === 'pending' || (entry.status === 'synced' && entry.serverCursor > 0)) {
              map.set(key, true);
            }
          });
          resolve(map);
        };
        req.onerror = () => resolve(new Map());
      });

      let enqueuedCount = 0;

      // 2. Check history (meetings)
      const meetings = await this.getAllMeetings();
      for (const m of meetings) {
        if (!m || !m.id) continue;
        const key = `history:${m.id}`;
        if (!existingMap.has(key)) {
          await this.recordChange('history', m.id, 'upsert', m);
          enqueuedCount++;
        }
      }

      // 3. Check schedules
      const schedules = await this.getAllSchedules();
      for (const s of schedules) {
        if (!s || !s.id) continue;
        const key = `schedules:${s.id}`;
        if (!existingMap.has(key)) {
          await this.recordChange('schedules', s.id, 'upsert', s);
          enqueuedCount++;
        }
      }

      // 4. Check contacts
      const contacts = await this.getContacts();
      for (const c of contacts) {
        if (!c || !c.id) continue;
        const key = `contacts:${c.id}`;
        if (!existingMap.has(key)) {
          await this.recordChange('contacts', c.id, 'upsert', c);
          enqueuedCount++;
        }
      }

      // 5. Check messages
      const messages = await this.getMessages();
      for (const msg of messages) {
        if (!msg || !msg.id) continue;
        const key = `messages:${msg.id}`;
        if (!existingMap.has(key)) {
          await this.recordChange('messages', msg.id, 'upsert', msg);
          enqueuedCount++;
        }
      }

      // 6. Check user profile
      const profile = await this.getUserProfile();
      if (profile) {
        const key = 'settings:user_profile';
        if (!existingMap.has(key)) {
          await this.recordChange('settings', 'user_profile', 'upsert', profile);
          enqueuedCount++;
        }
      }

      return enqueuedCount;
    } catch (err) {
      console.warn('[Storage] ensureAllRecordsEnqueuedForSync error:', err);
      return 0;
    }
  }

  async pruneTombstones(maxAgeMs = 30 * 24 * 3600 * 1000) {
    try {
      await this.init();
      if (!this.db || !this.db.objectStoreNames.contains('sync_tombstones')) return;
      const cutoff = Date.now() - maxAgeMs;
      const tx = this.db.transaction('sync_tombstones', 'readwrite');
      const store = tx.objectStore('sync_tombstones');
      const index = store.index('deletedAt');
      const range = IDBKeyRange.upperBound(cutoff);
      const req = index.openCursor(range);
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    } catch (e) {}
  }

  // --- Export and Panic Wipe ---
  async exportAllData() {
    const messages = await this.getMessages();
    const contacts = await this.getContacts();
    const meetings = await this.getAllMeetings();
    const schedules = await this.getAllSchedules();
    return {
      appName: 'Setu P2P',
      version: '1.1.0',
      exportedAt: new Date().toISOString(),
      messages,
      contacts,
      meetings,
      schedules
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
