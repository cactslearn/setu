/**
 * Setu P2P - High-Performance Standard Sync Client Engine
 * Provider-Independent Multi-Device Synchronization Engine.
 * Features:
 * - 1.5s debounced write coalescing (eliminates network spam)
 * - Page Visibility & battery-aware adaptive polling
 * - Hardware-accelerated zero-knowledge envelope encryption
 * - Monotonic cursor delta pull & anti-replay sequence verification
 * - Last-Write-Wins (LWW) conflict resolution with deletion tombstones
 * - Zero emojis in code, comments, and UI.
 */

class SyncEngine {
  constructor() {
    this.storage = window.setuStorage;
    this.crypto = window.setuSyncCrypto;

    this.settings = null;
    this.pollTimer = null;
    this.debounceTimer = null;
    this.isSyncing = false;
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    this.knownDevicePubKeys = {}; // deviceId -> base64 SPKI
    this.lastSeenSeqs = {}; // deviceId -> maxSeqSeen

    // Status metrics for UI
    this.status = 'idle'; // 'idle' | 'syncing' | 'connected' | 'error' | 'disabled'
    this.lastSyncTime = null;
    this.lastErrorMessage = null;
    this.activeDeviceCount = 1;

    this._bindLifecycleListeners();
  }

  _bindLifecycleListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      this.isOnline = true;
      if (this.settings && this.settings.enabled) {
        this.triggerSyncNow();
      }
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.status = 'offline';
      this._emitStatusChange();
    });

    // Page Visibility API adaptive polling
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Tab brought to foreground: immediately trigger check and restore normal poll frequency
        if (this.settings && this.settings.enabled && this.isOnline) {
          this.triggerSyncNow();
          this._scheduleNextPoll();
        }
      } else {
        // Tab backgrounded: throttle polling frequency
        this._scheduleNextPoll();
      }
    });
  }

  async init() {
    if (!this.storage) this.storage = window.setuStorage;
    if (!this.crypto) this.crypto = window.setuSyncCrypto;

    try {
      this.settings = await this.storage.getSyncSettings();
    } catch (_) {
      this.settings = { enabled: false };
    }

    if (this.settings && this.settings.enabled && this.settings.endpoint && this.settings.masterPassphrase) {
      this.status = 'idle';
      this._scheduleNextPoll(1000); // Initial sync after 1 second
    } else {
      this.status = 'disabled';
    }

    this._emitStatusChange();
  }

  /**
   * Refreshes active settings from storage
   */
  async reloadSettings() {
    this.settings = await this.storage.getSyncSettings();
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.settings && this.settings.enabled && this.settings.endpoint && this.settings.masterPassphrase) {
      this.status = 'idle';
      this.triggerSyncNow();
      this._scheduleNextPoll();
    } else {
      this.status = 'disabled';
      this._emitStatusChange();
    }
  }

  /**
   * Adaptive polling timer scheduler (respects tab visibility and offline state)
   */
  _scheduleNextPoll(overrideDelayMs = null) {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (!this.settings || !this.settings.enabled || !this.isOnline) return;

    let delayMs = overrideDelayMs;
    if (delayMs === null) {
      const configuredSec = Math.max(5, parseInt(this.settings.pollIntervalSec, 10) || 15);
      if (document.visibilityState === 'hidden') {
        // Throttle to 60 seconds when tab is hidden to preserve battery
        delayMs = Math.max(configuredSec * 1000, 60000);
      } else {
        delayMs = configuredSec * 1000;
      }
    }

    this.pollTimer = setTimeout(async () => {
      await this.syncCycle();
      this._scheduleNextPoll();
    }, delayMs);
  }

  /**
   * Hook called by storage.js when a local record is saved or deleted
   */
  onLocalChangeRecorded(changeEntry) {
    if (!this.settings || !this.settings.enabled || !this.isOnline) return;

    // 1.5s Debounce Batcher: wait for user to finish rapid edits before firing HTTP request
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.triggerSyncNow();
    }, 1500);
  }

  /**
   * Manual or programmatically triggered immediate synchronization cycle
   */
  async triggerSyncNow(forceManual = true, forceResetCursor = false) {
    if (this.isSyncing) return;
    if (!this.isOnline) {
      this.status = 'offline';
      this.lastErrorMessage = 'Device is currently offline';
      this._emitStatusChange();
      return;
    }
    await this.syncCycle(forceManual, forceResetCursor);
  }

  /**
   * Resets local synchronization cursor to 0 and re-downloads all records from server
   */
  async resyncAllData() {
    if (!this.storage) this.storage = window.setuStorage;
    if (!this.settings) {
      this.settings = await this.storage.getSyncSettings();
    }
    this.settings.lastSyncCursor = 0;
    await this.storage.saveSyncSettings(this.settings);
    this.knownDevicePubKeys = {};
    this.lastSeenSeqs = {};
    return await this.syncCycle(true, true);
  }

  /**
   * Full bidirectional synchronization cycle
   */
  async syncCycle(forceManual = false, forceResetCursor = false) {
    if (!this.storage) this.storage = window.setuStorage;
    if (!this.crypto) this.crypto = window.setuSyncCrypto;

    if (!this.settings || !this.settings.endpoint || !this.settings.masterPassphrase) {
      try {
        this.settings = await this.storage.getSyncSettings();
      } catch (_) {}
    }

    if (!this.settings) {
      if (forceManual) {
        this.status = 'error';
        this.lastErrorMessage = 'Multi-device sync settings not configured';
        this._emitStatusChange();
      }
      return;
    }

    if (!forceManual && !this.settings.enabled) return;

    if (!this.settings.endpoint || !this.settings.masterPassphrase) {
      if (forceManual) {
        this.status = 'error';
        this.lastErrorMessage = 'Sync endpoint URL or master passphrase missing';
        this._emitStatusChange();
      }
      return;
    }

    if (this.isSyncing) return;

    this.isSyncing = true;
    this.status = 'syncing';
    this._emitStatusChange();

    try {
      // 1. Ensure device is registered with backend
      await this._ensureDeviceRegistered();

      // 2. Scan and enqueue any local records that have not been uploaded
      if (typeof this.storage.ensureAllRecordsEnqueuedForSync === 'function') {
        await this.storage.ensureAllRecordsEnqueuedForSync();
      }

      // 3. Push pending local changes to remote
      const pushedCount = await this._pushPendingChanges();

      // 4. Pull incoming remote changes
      const pulledCount = await this._pullRemoteChanges(forceResetCursor);

      this.status = 'connected';
      this.lastSyncTime = Date.now();
      this.lastErrorMessage = null;
      this.lastSyncStats = { pushed: pushedCount || 0, pulled: pulledCount || 0 };
      this.settings.lastSyncTimestamp = this.lastSyncTime;
      await this.storage.saveSyncSettings(this.settings);
    } catch (err) {
      console.warn('[SyncEngine] Synchronization cycle error:', err);
      this.status = 'error';
      this.lastErrorMessage = err.message || 'Sync failed';
    } finally {
      this.isSyncing = false;
      this._emitStatusChange();
    }
  }

  /**
   * Builds common headers including Bearer Auth
   */
  async _getHeaders() {
    const keys = await this.crypto.deriveSyncKeys(this.settings.masterPassphrase, this.settings.accountId);
    const deviceId = await this.storage.getDeviceId();

    const headers = {
      'Content-Type': 'application/json',
      'X-Setu-Account-Id': this.settings.accountId || 'default_account',
      'X-Setu-Device-Id': deviceId
    };

    if (this.settings.authToken && this.settings.authToken.trim()) {
      headers['Authorization'] = 'Bearer ' + this.settings.authToken.trim();
    } else if (keys.rawAuthToken) {
      headers['Authorization'] = 'Bearer ' + keys.rawAuthToken;
    }

    return headers;
  }

  /**
   * Checks if an endpoint points to a Google Apps Script Web App
   */
  _isGoogleAppsScript(endpoint = null) {
    const ep = endpoint || (this.settings && this.settings.endpoint) || '';
    return ep.includes('script.google.com/macros/s/');
  }

  /**
   * Helper: Normalized endpoint URL with Google Apps Script Web App compatibility
   */
  _normalizeEndpoint(path, baseOverride = null, tokenOverride = null) {
    let cleanBase = (baseOverride || (this.settings && this.settings.endpoint) || '').trim();
    // Strip existing query string or hash fragment from base endpoint
    const qIdx = cleanBase.indexOf('?');
    if (qIdx !== -1) cleanBase = cleanBase.substring(0, qIdx);
    const hIdx = cleanBase.indexOf('#');
    if (hIdx !== -1) cleanBase = cleanBase.substring(0, hIdx);
    cleanBase = cleanBase.replace(/\/+$/, '');

    const cleanPath = path.startsWith('/') ? path : '/' + path;
    const token = tokenOverride !== null ? tokenOverride : (this.settings && this.settings.authToken) || '';

    // Google Apps Script Web App URL support: https://script.google.com/macros/s/.../exec
    if (cleanBase.includes('script.google.com/macros/s/')) {
      const execBase = cleanBase.endsWith('/exec') ? cleanBase : cleanBase + '/exec';
      const url = new URL(execBase);
      const action = cleanPath.replace(/^\/+/, '');
      url.searchParams.set('action', action);
      if (token && token.trim()) {
        url.searchParams.set('secretKey', token.trim());
      }
      return url.toString();
    }

    return cleanBase + cleanPath;
  }

  /**
   * Registers current device with backend if needed
   */
  async _ensureDeviceRegistered() {
    const isGas = this._isGoogleAppsScript();
    const deviceId = await this.storage.getDeviceId();
    const devKeys = await this.crypto.getOrCreateDeviceSigningKey();
    const isMobile = (typeof navigator !== 'undefined' && /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent));

    const payload = {
      deviceId,
      deviceLabel: this.settings.deviceLabel || (isMobile ? 'Mobile PWA' : 'Desktop Browser'),
      deviceType: isMobile ? 'mobile' : 'desktop',
      publicKey: devKeys.publicKeyBase64,
      registeredAt: Date.now(),
      secretKey: this.settings.authToken || '',
      accountId: this.settings.accountId || 'default_account'
    };

    // For GAS, use text/plain;charset=utf-8 to ensure CORS Simple Request (bypasses OPTIONS preflight)
    const headers = isGas
      ? { 'Content-Type': 'text/plain;charset=utf-8' }
      : await this._getHeaders();

    const res = await fetch(this._normalizeEndpoint('/sync/register'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    if (!res.ok) {
      throw new Error(`Device registration rejected (${res.status})`);
    }

    const data = await res.json();
    if (!data || data.success === false) {
      throw new Error(data?.error || `Device registration rejected (${res.status})`);
    }
    if (data.activeDevices) {
      this.activeDeviceCount = data.activeDevices;
    }
  }

  /**
   * Pushes pending local changes in a debounced batch
   */
  async _pushPendingChanges() {
    const isGas = this._isGoogleAppsScript();
    const deviceId = await this.storage.getDeviceId();
    const pending = await this.storage.getPendingChanges(100);
    if (!pending || pending.length === 0) return 0;

    const envelopes = [];
    for (const change of pending) {
      try {
        const envelope = await this.crypto.packChangeEnvelope(
          change,
          this.settings.masterPassphrase,
          this.settings.accountId
        );
        envelopes.push(envelope);
      } catch (packErr) {
        console.warn('[SyncEngine] Failed to pack envelope for change:', change.changeId, packErr);
      }
    }

    if (envelopes.length === 0) return 0;

    const payload = {
      batchId: 'batch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      clientTimestamp: Date.now(),
      changes: envelopes,
      secretKey: this.settings.authToken || '',
      accountId: this.settings.accountId || 'default_account',
      deviceId: deviceId
    };

    const headers = isGas
      ? { 'Content-Type': 'text/plain;charset=utf-8' }
      : await this._getHeaders();

    const res = await fetch(this._normalizeEndpoint('/sync/changes'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    if (!res.ok) {
      throw new Error(`Failed to submit changes (${res.status})`);
    }

    const data = await res.json();
    if (!data || data.success === false) {
      throw new Error(data?.error || `Failed to submit changes to server`);
    }

    const newCursor = data.newCursor || 0;

    // Mark local changes as synced
    const changeIds = pending.map(p => p.changeId);
    await this.storage.markChangesSynced(changeIds, newCursor);
    return envelopes.length;
  }

  /**
   * Pulls incremental remote changes using monotonic cursor pagination
   */
  async _pullRemoteChanges(forceResetCursor = false) {
    const isGas = this._isGoogleAppsScript();
    let cursor = parseInt(this.settings.lastSyncCursor || 0, 10);
    if (isNaN(cursor) || forceResetCursor) cursor = 0;

    const deviceId = await this.storage.getDeviceId();

    // If local records are empty (e.g. fresh browser or InPrivate), ensure we pull from cursor 0
    if (cursor > 0) {
      const localMeetings = await this.storage.getAllMeetings();
      const localContacts = await this.storage.getContacts();
      const localSchedules = await this.storage.getAllSchedules();
      if (localMeetings.length === 0 && localContacts.length === 0 && localSchedules.length === 0) {
        cursor = 0;
      }
    }

    const url = new URL(this._normalizeEndpoint('/sync/changes'));
    url.searchParams.set('since', String(cursor));
    url.searchParams.set('limit', '100');
    if (isGas) {
      url.searchParams.set('accountId', this.settings.accountId || 'default_account');
      url.searchParams.set('deviceId', deviceId);
    }

    const headers = isGas ? undefined : await this._getHeaders();

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers,
      redirect: 'follow',
      cache: 'no-store'
    });

    if (!res.ok) {
      throw new Error(`Failed to retrieve changes (${res.status})`);
    }

    const data = await res.json();
    if (!data || data.success === false) {
      throw new Error(data?.error || `Failed to retrieve changes from server`);
    }

    const changes = data.changes || [];
    let updatedStores = new Set();
    let appliedCount = 0;
    let failedCount = 0;
    let lastUnpackError = null;

    if (changes.length > 0) {
      // Ingest incoming changes with loopback flag active
      this.storage.isSyncApplying = true;
      try {
        for (const envelope of changes) {
          // Skip self-authored echoes from this exact device
          if (envelope.originDeviceId === deviceId) continue;

          // Store sender public key if included
          if (envelope.senderPublicKey) {
            this.knownDevicePubKeys[envelope.originDeviceId] = envelope.senderPublicKey;
          }

          try {
            const unpacked = await this.crypto.unpackChangeEnvelope(
              envelope,
              this.settings.masterPassphrase,
              this.settings.accountId,
              this.knownDevicePubKeys
            );

            await this._applyRemoteRecord(unpacked);
            appliedCount++;
            if (unpacked.store) updatedStores.add(unpacked.store);
          } catch (unpackErr) {
            failedCount++;
            lastUnpackError = unpackErr;
            console.warn('[SyncEngine] Envelope verification/decryption failed for record:', envelope.changeId, unpackErr);
          }
        }
      } finally {
        this.storage.isSyncApplying = false;
      }

      // If changes were received from other devices but all failed to unpack or decrypt:
      // DO NOT advance the cursor! Report the exact error so user knows Master Passphrase or Account ID is wrong.
      const candidateChanges = changes.filter(e => e.originDeviceId !== deviceId);
      if (candidateChanges.length > 0 && failedCount > 0 && appliedCount === 0) {
        throw new Error(
          `Decryption failed for ${failedCount} record(s): ${lastUnpackError?.message || 'Check passphrase'}. Ensure your Master Passphrase and Account ID match your other device.`
        );
      }

      // Only advance cursor if we successfully applied records OR if all incoming records were our own echoes
      if (data.cursor !== undefined && (appliedCount > 0 || candidateChanges.length === 0)) {
        this.settings.lastSyncCursor = data.cursor;
        await this.storage.saveSyncSettings(this.settings);

        // Acknowledge processed cursor for server pruning
        await this._acknowledgeCursor(data.cursor);
      }

      // Trigger targeted UI refreshes
      this._notifyUiUpdates(updatedStores);
    }

    return appliedCount;
  }

  /**
   * Applies an unpacked remote record into IndexedDB
   */
  async _applyRemoteRecord(record) {
    if (!record || !record.store || !record.recordId) return;

    if (record.action === 'delete') {
      await this.storage.recordTombstone(record.store, record.recordId, record.timestamp);
      if (record.store === 'contacts') {
        await this.storage.deleteContact(record.recordId);
      } else if (record.store === 'schedules') {
        await this.storage.deleteSchedule(record.recordId);
      } else if (record.store === 'history') {
        await this.storage.deleteMeeting(record.recordId);
      } else if (record.store === 'messages') {
        await this.storage.clearMessages(record.recordId);
      }
      return;
    }

    // Check if record was already tombstoned locally
    const isTombstoned = await this.storage.isTombstoned(record.recordId, record.timestamp);
    if (isTombstoned) {
      return; // Local deletion takes precedence
    }

    if (record.store === 'contacts') {
      await this.storage.saveContact(record.data);
    } else if (record.store === 'schedules') {
      await this.storage.saveSchedule(record.data);
    } else if (record.store === 'history') {
      await this.storage.saveMeeting(record.data);
    } else if (record.store === 'messages') {
      await this.storage.saveMessage(record.data);
    } else if (record.store === 'settings' && record.recordId === 'user_profile') {
      await this.storage.saveUserProfile(record.data);
    }
  }

  /**
   * Confirms processed cursor with server
   */
  async _acknowledgeCursor(acknowledgedCursor) {
    try {
      const isGas = this._isGoogleAppsScript();
      const deviceId = await this.storage.getDeviceId();
      const headers = isGas
        ? { 'Content-Type': 'text/plain;charset=utf-8' }
        : await this._getHeaders();

      await fetch(this._normalizeEndpoint('/sync/acknowledge'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          acknowledgedCursor,
          timestamp: Date.now(),
          secretKey: this.settings.authToken || '',
          accountId: this.settings.accountId || 'default_account',
          deviceId: deviceId
        }),
        redirect: 'follow'
      });
    } catch (_) {}
  }

  /**
   * Dispatches custom events to trigger targeted UI updates without full reloads
   */
  _notifyUiUpdates(updatedStores) {
    if (!updatedStores || updatedStores.size === 0) return;

    if (updatedStores.has('schedules')) {
      window.dispatchEvent(new CustomEvent('setu-sync-schedules-updated'));
      if (window.setuSchedule && typeof window.setuSchedule.renderUpcomingList === 'function') {
        window.setuSchedule.renderUpcomingList();
        window.setuSchedule.renderCalendarGrid();
      }
    }

    if (updatedStores.has('contacts')) {
      window.dispatchEvent(new CustomEvent('setu-sync-contacts-updated'));
    }

    if (updatedStores.has('history')) {
      window.dispatchEvent(new CustomEvent('setu-sync-history-updated'));
    }

    if (updatedStores.has('messages')) {
      window.dispatchEvent(new CustomEvent('setu-sync-messages-updated'));
    }

    window.dispatchEvent(new CustomEvent('setu-sync-updated', {
      detail: { stores: Array.from(updatedStores) }
    }));
  }

  /**
   * Diagnostic test connection helper for Settings UI
   */
  async testConnection(endpoint, accountId, authToken, masterPassphrase) {
    if (!endpoint || !endpoint.trim()) {
      throw new Error('Please enter a Synchronization Endpoint URL');
    }
    if (!masterPassphrase || !masterPassphrase.trim()) {
      throw new Error('Please enter your Master Encryption Passphrase');
    }

    const cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
    const cleanAccount = (accountId || 'default_account').trim().toLowerCase();
    const cleanPass = masterPassphrase.trim();

    // 1. Test Key Derivation
    const keys = await this.crypto.deriveSyncKeys(cleanPass, cleanAccount);

    // 2. Perform test GET request to /sync/status
    // For Google Apps Script, do NOT pass custom headers (Authorization, X-Setu-*, application/json),
    // because GAS does not handle CORS OPTIONS preflight. Simple GET request bypasses preflight.
    const isGas = this._isGoogleAppsScript(cleanEndpoint);
    let headers = undefined;

    if (!isGas) {
      headers = {
        'Content-Type': 'application/json',
        'X-Setu-Account-Id': cleanAccount,
        'X-Setu-Device-Id': await this.storage.getDeviceId()
      };
      if (authToken && authToken.trim()) {
        headers['Authorization'] = 'Bearer ' + authToken.trim();
      } else if (keys.rawAuthToken) {
        headers['Authorization'] = 'Bearer ' + keys.rawAuthToken;
      }
    }

    const testUrl = this._normalizeEndpoint('/sync/status', cleanEndpoint, authToken);
    const res = await fetch(testUrl, {
      method: 'GET',
      headers,
      redirect: 'follow',
      cache: 'no-store'
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('Authentication failed: Invalid secret key or token');
      }
      throw new Error(`Sync server responded with HTTP status ${res.status}`);
    }

    const data = await res.json().catch(() => ({}));
    if (data.success === false && data.error) {
      throw new Error(data.error);
    }
    return {
      success: true,
      message: 'Connected successfully to sync endpoint',
      serverTime: data.serverTime || Date.now(),
      devices: data.devices || [],
      currentCursor: data.currentCursor || 0
    };
  }

  _emitStatusChange() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('setu-sync-status-change', {
        detail: {
          status: this.status,
          lastSyncTime: this.lastSyncTime,
          lastErrorMessage: this.lastErrorMessage,
          activeDeviceCount: this.activeDeviceCount
        }
      }));
    }
  }
}

// Global instance
window.setuSyncEngine = new SyncEngine();

