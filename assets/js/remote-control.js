/**
 * Setu P2P - Remote Control Module
 * Client-side coordinator for low-latency WebRTC Remote Control via Setu Companion.
 * Uses existing WebRTC 'control' DataChannel.
 * Zero external servers, strictly authenticated via user-configured passkey.
 */

class RemoteControlModule {
  constructor() {
    this.companionPort = 49152;
    this.companionPasskey = 'setu_remote_access_key';
    this.allowRemoteControl = false;
    this.ws = null;
    this.pollTimer = null;
    this.isViewerActive = false;
    this.isLocalSharing = false;
    this.isRemoteSharing = false;
    this.rafId = null;
    this.pendingMove = null;

    // Bound event handlers for clean attach/detach
    this.onOverlayMouseMove = this.handleOverlayMouseMove.bind(this);
    this.onOverlayMouseDown = this.handleOverlayMouseDown.bind(this);
    this.onOverlayMouseUp = this.handleOverlayMouseUp.bind(this);
    this.onOverlayWheel = this.handleOverlayWheel.bind(this);
    this.onOverlayKeyDown = this.handleOverlayKeyDown.bind(this);
    this.onOverlayKeyUp = this.handleOverlayKeyUp.bind(this);
    this.onOverlayMouseLeave = this.handleOverlayMouseLeave.bind(this);
    this.onWindowKeyDown = this.handleWindowKeyDown.bind(this);
    this.onWindowKeyUp = this.handleWindowKeyUp.bind(this);
    this.onOverlayContextMenu = (e) => e.preventDefault();
  }

  async init() {
    await this.loadSettings();
    this.bindSettingsUI();
    this.bindMeetingUI();
    console.log('[RemoteControl] Module initialized. Configured Port:', this.companionPort);
  }

  async loadSettings() {
    if (window.setuStorage && window.setuStorage.getRemoteControlSettings) {
      try {
        const s = await window.setuStorage.getRemoteControlSettings();
        this.companionPort = s.companionPort || 49152;
        this.companionPasskey = (s.companionPasskey && s.companionPasskey.trim()) ? s.companionPasskey.trim() : 'setu_remote_access_key';
        this.allowRemoteControl = !!s.allowRemoteControl;
      } catch (err) {
        console.warn('[RemoteControl] Error loading settings:', err);
      }
    }
  }

  bindSettingsUI() {
    const portInput = document.getElementById('settingCompanionPort');
    const passkeyInput = document.getElementById('settingCompanionPasskey');
    const togglePasskeyBtn = document.getElementById('togglePasskeyVisibilityBtn');
    const generatePasskeyBtn = document.getElementById('generatePasskeyBtn');
    const copyPasskeyBtn = document.getElementById('copyPasskeyBtn');
    const testConnBtn = document.getElementById('testCompanionConnectionBtn');
    const downloadFromSettingsBtn = document.getElementById('downloadCompanionFromSettingsBtn');
    const statusBadge = document.getElementById('companionSettingsStatusBadge');

    if (portInput) portInput.value = this.companionPort;
    if (passkeyInput) passkeyInput.value = this.companionPasskey;

    if (togglePasskeyBtn && passkeyInput) {
      togglePasskeyBtn.onclick = () => {
        const isPassword = passkeyInput.type === 'password';
        passkeyInput.type = isPassword ? 'text' : 'password';
        togglePasskeyBtn.textContent = isPassword ? 'Hide' : 'Show';
      };
    }

    if (generatePasskeyBtn && passkeyInput) {
      generatePasskeyBtn.onclick = () => {
        const generated = this.generateRandomPasskey();
        passkeyInput.value = generated;
        this.companionPasskey = generated;
        if (window.showToast) window.showToast('Generated fresh security passkey');
      };
    }

    if (copyPasskeyBtn && passkeyInput) {
      copyPasskeyBtn.onclick = async () => {
        const val = passkeyInput.value.trim();
        if (!val) {
          if (window.showToast) window.showToast('No passkey to copy');
          return;
        }
        try {
          await navigator.clipboard.writeText(val);
          if (window.showToast) window.showToast('Security passkey copied to clipboard');
        } catch (_) {
          passkeyInput.select();
          document.execCommand('copy');
          if (window.showToast) window.showToast('Security passkey copied to clipboard');
        }
      };
    }

    if (testConnBtn) {
      testConnBtn.onclick = async () => {
        const port = parseInt(portInput?.value, 10) || this.companionPort;
        const passkey = passkeyInput?.value.trim() || '';
        if (statusBadge) {
          statusBadge.textContent = 'Testing...';
          statusBadge.className = 'badge badge-warning';
        }
        const result = await this.testCompanionConnection(port, passkey);
        if (statusBadge) {
          if (result.success) {
            statusBadge.textContent = 'Connected';
            statusBadge.className = 'badge badge-success';
          } else if (result.reason === 'passkey_mismatch') {
            statusBadge.textContent = 'Passkey Mismatch';
            statusBadge.className = 'badge badge-danger';
          } else {
            statusBadge.textContent = 'Disconnected';
            statusBadge.className = 'badge badge-secondary';
          }
        }
        if (window.showToast) window.showToast(result.message);
      };
    }

    if (downloadFromSettingsBtn) {
      downloadFromSettingsBtn.onclick = () => {
        this.triggerBundleDownload();
      };
    }
  }

  bindMeetingUI() {
    const allowCheckbox = document.getElementById('allowRemoteControlCheckbox');
    const requestBtn = document.getElementById('requestRemoteControlBtn');
    const releaseBtn = document.getElementById('releaseRemoteControlBtn');

    if (allowCheckbox) {
      allowCheckbox.checked = this.allowRemoteControl;
      allowCheckbox.onchange = async () => {
        this.allowRemoteControl = !!allowCheckbox.checked;
        if (window.setuStorage && window.setuStorage.saveRemoteControlSettings) {
          await window.setuStorage.saveRemoteControlSettings({
            companionPort: this.companionPort,
            companionPasskey: this.companionPasskey,
            allowRemoteControl: this.allowRemoteControl
          });
        }
        if (this.allowRemoteControl) {
          this.startHostCompanionBridge();
        } else {
          this.stopHostCompanionBridge();
          if (window.setuWebRTC) {
            window.setuWebRTC.sendData('control', JSON.stringify({ type: 'rc-revoke' }));
          }
        }
      };
    }

    if (requestBtn) {
      requestBtn.onclick = () => {
        if (this.isViewerActive) {
          this.stopViewerControl();
          if (window.setuWebRTC) {
            window.setuWebRTC.sendData('control', JSON.stringify({ type: 'rc-revoke' }));
          }
        } else {
          if (window.setuWebRTC) {
            window.setuWebRTC.sendData('control', JSON.stringify({ type: 'rc-request' }));
            requestBtn.disabled = true;
            const reqText = document.getElementById('requestRemoteControlText');
            if (reqText) reqText.textContent = 'Requesting...';
            setTimeout(() => {
              if (!this.isViewerActive && reqText) {
                requestBtn.disabled = false;
                reqText.textContent = 'Request Control';
              }
            }, 6000);
          }
        }
      };
    }

    if (releaseBtn) {
      releaseBtn.onclick = (e) => {
        e.stopPropagation();
        this.stopViewerControl();
        if (window.setuWebRTC) {
          window.setuWebRTC.sendData('control', JSON.stringify({ type: 'rc-revoke' }));
        }
      };
    }
  }

  generateRandomPasskey() {
    const buffer = new Uint8Array(16);
    crypto.getRandomValues(buffer);
    const hex = Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
    return 'setu_sec_' + hex;
  }

  detectPlatform() {
    const ua = navigator.userAgent || '';
    if (/macintosh|mac os x/i.test(ua)) return 'macos';
    if (/linux/i.test(ua)) return 'linux';
    return 'windows';
  }

  getPlatformBundleInfo() {
    const platform = this.detectPlatform();
    switch (platform) {
      case 'macos':
        return {
          platform: 'macos',
          name: 'macOS',
          filename: 'setu-companion-macos.zip',
          url: 'downloads/setu-companion-macos.zip'
        };
      case 'linux':
        return {
          platform: 'linux',
          name: 'Linux',
          filename: 'setu-companion-linux-x64.tar.gz',
          url: 'downloads/setu-companion-linux-x64.tar.gz'
        };
      case 'windows':
      default:
        return {
          platform: 'windows',
          name: 'Windows',
          filename: 'setu-companion-windows-x64.zip',
          url: 'downloads/setu-companion-windows-x64.zip'
        };
    }
  }

  triggerBundleDownload() {
    const bundle = this.getPlatformBundleInfo();
    const a = document.createElement('a');
    a.href = bundle.url;
    a.download = bundle.filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (window.showToast) {
      window.showToast(`Downloading Setu Companion for ${bundle.name}. Launch it to enable remote control.`);
    }
  }

  async testCompanionConnection(port, passkey) {
    const targetPort = port || this.companionPort;
    const targetKey = passkey !== undefined ? passkey : this.companionPasskey;

    return new Promise((resolve) => {
      let resolved = false;
      let socket = null;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { socket && socket.close(); } catch (_) {}
          resolve({
            success: false,
            reason: 'timeout',
            message: `Connection timed out on port ${targetPort}. Ensure Setu Companion is running.`
          });
        }
      }, 3500);

      try {
        const wsUrl = `ws://127.0.0.1:${targetPort}?key=${encodeURIComponent(targetKey)}`;
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
          socket.send(JSON.stringify({ type: 'rc-auth', passkey: targetKey }));
        };

        socket.onmessage = (event) => {
          if (resolved) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'rc-auth-success') {
              resolved = true;
              clearTimeout(timer);
              socket.close();
              resolve({
                success: true,
                message: `Setu Companion verified and active on port ${targetPort}.`
              });
            } else if (data.type === 'rc-auth-failed') {
              resolved = true;
              clearTimeout(timer);
              socket.close();
              resolve({
                success: false,
                reason: 'passkey_mismatch',
                message: 'Companion found, but security passkey did not match. Check passkey.'
              });
            }
          } catch (_) {}
        };

        socket.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve({
              success: false,
              reason: 'unreachable',
              message: `Could not connect on port ${targetPort}. Ensure Setu Companion is started.`
            });
          }
        };

        socket.onclose = (e) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            if (e.code === 4001 || e.code === 4003) {
              resolve({
                success: false,
                reason: 'passkey_mismatch',
                message: 'Companion rejected connection due to invalid passkey.'
              });
            } else {
              resolve({
                success: false,
                reason: 'closed',
                message: `Connection closed by host on port ${targetPort}.`
              });
            }
          }
        };
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({
            success: false,
            reason: 'exception',
            message: `WebSocket error: ${err.message}`
          });
        }
      }
    });
  }

  startHostCompanionBridge() {
    this.stopHostCompanionBridge();

    const badge = document.getElementById('companionActiveStatusBadge');
    if (badge) {
      badge.textContent = 'Connecting...';
      badge.className = 'badge badge-warning';
    }

    const wsUrl = `ws://127.0.0.1:${this.companionPort}?key=${encodeURIComponent(this.companionPasskey)}`;
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[RemoteControl] Local companion WebSocket opened.');
        this.ws.send(JSON.stringify({ type: 'rc-auth', passkey: this.companionPasskey }));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'rc-auth-success') {
            console.log('[RemoteControl] Companion authentication successful.');
            if (badge) {
              badge.textContent = 'Active';
              badge.className = 'badge badge-success';
            }
            if (this.pollTimer) {
              clearInterval(this.pollTimer);
              this.pollTimer = null;
            }
          } else if (msg.type === 'rc-auth-failed') {
            console.warn('[RemoteControl] Companion passkey mismatch.');
            if (badge) {
              badge.textContent = 'Key Mismatch';
              badge.className = 'badge badge-danger';
            }
            if (window.showToast) window.showToast('Companion passkey mismatch. Update passkey in Settings.');
          } else if (msg.type === 'rc-override') {
            if (window.showToast) window.showToast('Host moved physical mouse: remote input paused');
          }
        } catch (_) {}
      };

      this.ws.onerror = () => {
        console.warn('[RemoteControl] Companion WebSocket error. Companion may not be running.');
        if (badge) {
          badge.textContent = 'Disconnected';
          badge.className = 'badge badge-secondary';
        }
      };

      this.ws.onclose = () => {
        console.log('[RemoteControl] Companion WebSocket closed.');
        if (this.allowRemoteControl && this.isLocalSharing && !this.pollTimer) {
          this.startCompanionPolling();
        }
      };
    } catch (err) {
      console.warn('[RemoteControl] Failed to create WebSocket:', err);
      if (this.allowRemoteControl && this.isLocalSharing) {
        this.startCompanionPolling();
      }
    }
  }

  startCompanionPolling() {
    if (this.pollTimer) return;
    if (!this.allowRemoteControl || !this.isLocalSharing) return;

    const badge = document.getElementById('companionActiveStatusBadge');
    if (badge) {
      badge.textContent = 'Waiting for app...';
      badge.className = 'badge badge-warning';
    }

    this.pollTimer = setInterval(async () => {
      if (!this.allowRemoteControl || !this.isLocalSharing) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
        return;
      }
      const test = await this.testCompanionConnection(this.companionPort, this.companionPasskey);
      if (test.success) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
        this.startHostCompanionBridge();
        if (window.showToast) window.showToast('Setu Companion connected and ready for remote control');
      }
    }, 2500);
  }

  stopHostCompanionBridge() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    const badge = document.getElementById('companionActiveStatusBadge');
    if (badge) {
      badge.textContent = 'Disconnected';
      badge.className = 'badge badge-secondary';
    }
  }

  // Handle incoming packets from peer over existing WebRTC 'control' DataChannel
  handleControlPacket(packet) {
    if (!packet || !packet.type) return;

    switch (packet.type) {
      case 'rc-request': {
        console.log('[RemoteControl] Remote peer requested control.');
        const isReady = this.allowRemoteControl && this.ws && this.ws.readyState === WebSocket.OPEN;
        if (isReady) {
          if (window.setuWebRTC) {
            window.setuWebRTC.sendData('control', JSON.stringify({ type: 'rc-grant', enabled: true }));
          }
          if (window.showToast) window.showToast('Remote control access granted to peer');
        } else {
          let reason = 'Host has not enabled remote control.';
          if (this.allowRemoteControl && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
            reason = 'Host companion is not currently connected.';
          }
          if (window.setuWebRTC) {
            window.setuWebRTC.sendData('control', JSON.stringify({ type: 'rc-grant', enabled: false, reason }));
          }
          if (window.showToast) window.showToast('Declined remote control request (companion inactive)');
        }
        break;
      }

      case 'rc-grant': {
        const reqBtn = document.getElementById('requestRemoteControlBtn');
        const reqText = document.getElementById('requestRemoteControlText');
        if (reqBtn) reqBtn.disabled = false;

        if (packet.enabled) {
          this.startViewerControl();
          if (reqText) reqText.textContent = 'Release Control';
          if (window.showToast) window.showToast('Remote control active: Click on shared screen to interact');
        } else {
          this.stopViewerControl();
          if (reqText) reqText.textContent = 'Request Control';
          if (window.showToast) window.showToast(packet.reason || 'Remote control request declined');
        }
        break;
      }

      case 'rc-revoke': {
        this.stopViewerControl();
        const reqText = document.getElementById('requestRemoteControlText');
        const reqBtn = document.getElementById('requestRemoteControlBtn');
        if (reqText) reqText.textContent = 'Request Control';
        if (reqBtn) reqBtn.disabled = false;
        if (window.showToast) window.showToast('Remote control was ended');
        break;
      }

      case 'rc-input': {
        // Forward input commands strictly if host has authorized remote control and companion is connected
        if (this.allowRemoteControl && this.ws && this.ws.readyState === WebSocket.OPEN) {
          try {
            this.ws.send(JSON.stringify(packet));
          } catch (err) {
            console.warn('[RemoteControl] Error forwarding command to companion:', err);
          }
        }
        break;
      }
    }
  }

  // --- Remote Viewer Mode (Input Capture & Normalization) ---
  startViewerControl() {
    this.isViewerActive = true;
    const overlay = document.getElementById('remoteControlOverlay');
    if (!overlay) return;

    overlay.style.display = 'block';
    overlay.focus();

    overlay.addEventListener('mousemove', this.onOverlayMouseMove, { passive: true });
    overlay.addEventListener('mouseleave', this.onOverlayMouseLeave);
    overlay.addEventListener('mousedown', this.onOverlayMouseDown);
    overlay.addEventListener('mouseup', this.onOverlayMouseUp);
    overlay.addEventListener('wheel', this.onOverlayWheel, { passive: false });
    overlay.addEventListener('contextmenu', this.onOverlayContextMenu);

    // Window-level keyboard listeners ensure typing works even if overlay element loses focus
    window.addEventListener('keydown', this.onWindowKeyDown, true);
    window.addEventListener('keyup', this.onWindowKeyUp, true);
  }

  stopViewerControl() {
    if (!this.isViewerActive) return;
    this.isViewerActive = false;

    const overlay = document.getElementById('remoteControlOverlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.style.cursor = 'default';
      overlay.removeEventListener('mousemove', this.onOverlayMouseMove);
      overlay.removeEventListener('mouseleave', this.onOverlayMouseLeave);
      overlay.removeEventListener('mousedown', this.onOverlayMouseDown);
      overlay.removeEventListener('mouseup', this.onOverlayMouseUp);
      overlay.removeEventListener('wheel', this.onOverlayWheel);
      overlay.removeEventListener('contextmenu', this.onOverlayContextMenu);
    }

    window.removeEventListener('keydown', this.onWindowKeyDown, true);
    window.removeEventListener('keyup', this.onWindowKeyUp, true);

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingMove = null;
  }

  // Calculate normalized coordinate (0.0000 to 1.0000) accounting for letterboxing
  getNormalizedCoordinates(event, overlayEl) {
    const video = document.getElementById('presentationVideo');
    if (!video || !overlayEl) return null;

    const overlayRect = overlayEl.getBoundingClientRect();
    const clickX = event.clientX - overlayRect.left;
    const clickY = event.clientY - overlayRect.top;

    const videoW = video.videoWidth || overlayRect.width;
    const videoH = video.videoHeight || overlayRect.height;

    if (videoW === 0 || videoH === 0) return null;

    const containerW = overlayRect.width;
    const containerH = overlayRect.height;

    const videoAspect = videoW / videoH;
    const containerAspect = containerW / containerH;

    let renderW = containerW;
    let renderH = containerH;
    let offsetX = 0;
    let offsetY = 0;

    if (containerAspect > videoAspect) {
      // Black bars on left and right
      renderH = containerH;
      renderW = renderH * videoAspect;
      offsetX = (containerW - renderW) / 2;
    } else {
      // Black bars on top and bottom
      renderW = containerW;
      renderH = renderW / videoAspect;
      offsetY = (containerH - renderH) / 2;
    }

    if (clickX < offsetX || clickX > offsetX + renderW || clickY < offsetY || clickY > offsetY + renderH) {
      return null; // Clicked on letterbox padding
    }

    const normX = Math.max(0, Math.min(1, (clickX - offsetX) / renderW));
    const normY = Math.max(0, Math.min(1, (clickY - offsetY) / renderH));

    return {
      x: Number(normX.toFixed(4)),
      y: Number(normY.toFixed(4))
    };
  }

  handleOverlayMouseMove(e) {
    const coords = this.getNormalizedCoordinates(e, e.currentTarget);
    if (!coords) {
      // In letterbox padding or outside active video frame
      e.currentTarget.style.cursor = 'default';
      return;
    }

    // Inside active remote screen area: hide local cursor so only the single remote host cursor is seen
    e.currentTarget.style.cursor = 'none';

    this.pendingMove = coords;

    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => {
        if (this.pendingMove && window.setuWebRTC) {
          window.setuWebRTC.sendData('control', JSON.stringify({
            type: 'rc-input',
            action: 'mousemove',
            x: this.pendingMove.x,
            y: this.pendingMove.y
          }));
        }
        this.pendingMove = null;
        this.rafId = null;
      });
    }
  }

  handleOverlayMouseLeave(e) {
    if (e && e.currentTarget) {
      e.currentTarget.style.cursor = 'default';
    }
  }

  handleOverlayMouseDown(e) {
    if (e.target && e.target.closest && e.target.closest('.rc-indicator-banner')) {
      return;
    }
    e.preventDefault();
    const coords = this.getNormalizedCoordinates(e, e.currentTarget);
    if (!coords) return;

    const buttonMap = { 0: 'left', 1: 'middle', 2: 'right' };
    const btn = buttonMap[e.button] || 'left';

    if (window.setuWebRTC) {
      window.setuWebRTC.sendData('control', JSON.stringify({
        type: 'rc-input',
        action: 'mousedown',
        button: btn,
        x: coords.x,
        y: coords.y
      }));
    }
  }

  handleOverlayMouseUp(e) {
    if (e.target && e.target.closest && e.target.closest('.rc-indicator-banner')) {
      return;
    }
    e.preventDefault();
    const coords = this.getNormalizedCoordinates(e, e.currentTarget);
    if (!coords) return;

    const buttonMap = { 0: 'left', 1: 'middle', 2: 'right' };
    const btn = buttonMap[e.button] || 'left';

    if (window.setuWebRTC) {
      window.setuWebRTC.sendData('control', JSON.stringify({
        type: 'rc-input',
        action: 'mouseup',
        button: btn,
        x: coords.x,
        y: coords.y
      }));
    }
  }

  handleOverlayWheel(e) {
    e.preventDefault();
    if (window.setuWebRTC) {
      window.setuWebRTC.sendData('control', JSON.stringify({
        type: 'rc-input',
        action: 'wheel',
        dx: Math.round(e.deltaX),
        dy: Math.round(e.deltaY)
      }));
    }
  }

  handleOverlayKeyDown(e) {
    this.handleWindowKeyDown(e);
  }

  handleOverlayKeyUp(e) {
    this.handleWindowKeyUp(e);
  }

  handleWindowKeyDown(e) {
    if (!this.isViewerActive) return;

    // Do not intercept if user is typing in local input/textarea/editable elements
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }

    if (e.key === 'Escape') {
      this.stopViewerControl();
      if (window.setuWebRTC) {
        window.setuWebRTC.sendData('control', JSON.stringify({ type: 'rc-revoke' }));
      }
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (window.setuWebRTC) {
      window.setuWebRTC.sendData('control', JSON.stringify({
        type: 'rc-input',
        action: 'keydown',
        key: e.key,
        code: e.code,
        modifiers: {
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey,
          meta: e.metaKey
        }
      }));
    }
  }

  handleWindowKeyUp(e) {
    if (!this.isViewerActive) return;

    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (window.setuWebRTC) {
      window.setuWebRTC.sendData('control', JSON.stringify({
        type: 'rc-input',
        action: 'keyup',
        key: e.key,
        code: e.code
      }));
    }
  }

  onPresentationStateChanged(isLocalSharing, isRemoteSharing) {
    this.isLocalSharing = isLocalSharing;
    this.isRemoteSharing = isRemoteSharing;

    const hostBar = document.getElementById('hostRemoteControlBar');
    const reqBtn = document.getElementById('requestRemoteControlBtn');

    if (isLocalSharing) {
      if (hostBar) hostBar.style.display = 'flex';
      if (reqBtn) reqBtn.style.display = 'none';
      if (this.allowRemoteControl) {
        this.startHostCompanionBridge();
      }
    } else if (isRemoteSharing) {
      if (hostBar) hostBar.style.display = 'none';
      if (reqBtn) reqBtn.style.display = 'inline-flex';
    } else {
      if (hostBar) hostBar.style.display = 'none';
      if (reqBtn) reqBtn.style.display = 'none';
      this.stopViewerControl();
      this.stopHostCompanionBridge();
    }
  }

  reset() {
    this.allowRemoteControl = false;
    this.isLocalSharing = false;
    this.isRemoteSharing = false;
    this.isViewerActive = false;

    this.stopHostCompanionBridge();
    this.stopViewerControl();

    const allowCheckbox = document.getElementById('allowRemoteControlCheckbox');
    if (allowCheckbox) allowCheckbox.checked = false;

    const hostBar = document.getElementById('hostRemoteControlBar');
    if (hostBar) hostBar.style.display = 'none';

    const reqBtn = document.getElementById('requestRemoteControlBtn');
    if (reqBtn) reqBtn.style.display = 'none';

    if (window.setuStorage && window.setuStorage.saveRemoteControlSettings) {
      window.setuStorage.saveRemoteControlSettings({
        companionPort: this.companionPort,
        companionPasskey: this.companionPasskey,
        allowRemoteControl: false
      }).catch(() => {});
    }
  }
}

// Global instance
window.setuRemoteControl = new RemoteControlModule();
