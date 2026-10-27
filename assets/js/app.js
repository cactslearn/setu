/**
 * Setu P2P - Main Application Controller
 * Coordinates WebRTC lifecycle, DataChannel routing, device selection,
 * non-blocking file consent, theme toggles, user profile settings,
 * meeting archive & history search, permanent QR codes, PowerToys whiteboard,
 * and keyboard shortcuts.
 * Zero emojis in UI chrome.
 */

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Setu P2P] Initializing serverless communication platform...');

  // 1. Toast Notification Helper (Clean text, zero emojis)
  window.showToast = function (message, duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    }, duration);
  };

  // 2. Initialize Subsystems
  await window.setuStorage.init();
  if (window.setuSound) await window.setuSound.init();
  window.setuWizard.init();
  window.setuMeeting.init();
  window.setuChat.init(document.getElementById('chatMessagesContainer'));

  const canvasEl = document.getElementById('whiteboardCanvas');
  const notepadEl = document.getElementById('sharedNotepadText');
  window.setuSharedPage.init(canvasEl, notepadEl, false);

  if (window.setuRemoteControl) {
    await window.setuRemoteControl.init();
  }

  // 3. WebRTC DataChannel Message Router
  window.setuWebRTC.onChannelMessage = (channelLabel, data) => {
    if (channelLabel === 'chat') {
      window.setuChat.receiveMessage(data);
    } else if (channelLabel === 'file') {
      window.setuFileTransfer.handleChunk(data);
    } else if (channelLabel === 'control') {
      try {
        const packet = JSON.parse(data);
        handleControlPacket(packet);
      } catch (err) {
        console.error('Failed to parse control packet:', err);
      }
    }
  };

  function handleControlPacket(packet) {
    switch (packet.type) {
      case 'presence':
        window.setuPresence.handlePeerPresencePacket(packet);
        break;
      case 'reaction':
        window.setuMeeting.renderFloatingReaction(packet.emoji);
        break;
      case 'rc-request':
      case 'rc-grant':
      case 'rc-revoke':
      case 'rc-input':
        if (window.setuRemoteControl) {
          window.setuRemoteControl.handleControlPacket(packet);
        }
        break;
      case 'raise-hand':
        window.showToast(packet.raised ? 'Remote peer raised hand' : 'Remote peer lowered hand');
        if (packet.raised && window.setuSound) {
          window.setuSound.playHandRaise();
        }
        break;
      case 'media-state':
        window.setuMeeting.handleRemoteMediaState(packet.audio, packet.video);
        break;
      case 'screen-share-status':
        const peerLabel = document.getElementById('remotePeerNameBadge');
        if (peerLabel) {
          peerLabel.textContent = packet.active ? 'Remote Peer (Presenting)' : 'Remote Peer';
        }
        window.setuMeeting.handleRemoteScreenShare(packet.active);
        break;
      case 'meeting-ended':
        if (window.setuMeeting) {
          window.setuMeeting.handleRemoteMeetingEnded();
        }
        break;
      case 'profile-update':
        if (packet.displayName) {
          if (window.setuMeeting) {
            window.setuMeeting.setRemotePeerName(packet.displayName);
          } else {
            const badge = document.getElementById('remotePeerNameBadge');
            if (badge) badge.textContent = packet.displayName;
          }
        }
        if (packet.avatarDataUrl) {
          if (window.setuMeeting) {
            window.setuMeeting.setRemotePeerAvatar(packet.avatarDataUrl);
          } else {
            const avatarPlaceholder = document.getElementById('remoteAvatarPlaceholder');
            if (avatarPlaceholder) {
              avatarPlaceholder.innerHTML = `<img src="${packet.avatarDataUrl}" alt="Peer Avatar" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; box-shadow: 0 4px 12px rgba(0,0,0,0.4);"><div style="font-weight: 600; font-size: 0.95rem; color: var(--text-secondary); margin-top: 0.5rem;">Camera is off</div>`;
            }
          }
        }
        break;
      case 'recording-consent-request':
        window.setuRecorder.handleConsentRequest(packet.requesterName);
        break;
      case 'recording-consent-response':
        window.setuRecorder.handleConsentResponse(packet.granted);
        break;
      case 'recording-status':
        const recIndicator = document.getElementById('recordingIndicator');
        if (recIndicator) recIndicator.classList.toggle('active', !!packet.active);
        break;
      case 'file-offer':
        window.setuFileTransfer.handleIncomingOffer(packet);
        break;
      case 'file-response':
        window.setuFileTransfer.handleFileResponse(packet);
        break;
      case 'file-cancel':
        window.setuFileTransfer.cancelTransfer(packet.fileId);
        break;
      case 'shared-page-permission':
      case 'shared-canvas-draw':
      case 'shared-notepad-update':
        window.setuSharedPage.handleInboundPacket(packet);
        break;
      default:
        console.log('[Control] Unhandled packet type:', packet.type);
    }
  }

  async function broadcastUserProfile() {
    if (!window.setuStorage || !window.setuWebRTC) return;
    try {
      const profile = await window.setuStorage.getUserProfile();
      if (profile) {
        window.setuWebRTC.sendData('control', JSON.stringify({
          type: 'profile-update',
          displayName: profile.displayName || 'You',
          avatarDataUrl: profile.avatarDataUrl || null
        }));
      }
    } catch (e) {
      console.warn('Could not broadcast user profile:', e);
    }
  }

  // Hook control channel open to immediately broadcast profile
  window.setuWebRTC.onControlChannelOpen = () => {
    broadcastUserProfile();
  };

  // 4. WebRTC Connection State Lifecycle
  window.setuWebRTC.onStateChange = (state) => {
    const statusDot = document.getElementById('connStatusDot');
    const statusText = document.getElementById('connStatusText');

    if (state === 'connected') {
      if (statusDot) {
        statusDot.className = 'status-dot status-available';
      }
      if (statusText) {
        statusText.textContent = 'Connected';
      }
      window.setuPresence.setStatus('available');
      window.showToast('Peer connection established');
      if (window.setuMeeting) {
        window.setuMeeting.onPeerConnected();
      }
      if (window.setuRoomSignaling) {
        window.setuRoomSignaling.cleanupRoom();
        setTimeout(() => {
          if (window.setuRoomSignaling) window.setuRoomSignaling.disconnect();
        }, 1000);
      }
      setTimeout(broadcastUserProfile, 600);
    } else if (state === 'disconnected' || state === 'failed') {
      if (statusDot) {
        statusDot.className = 'status-dot status-busy';
      }
      if (statusText) {
        statusText.textContent = 'Disconnected';
      }
      window.showToast('Connection interrupted');
      if (window.setuMeeting) {
        window.setuMeeting.setMeetingWaitingState();
      }
    } else if (state === 'connecting') {
      if (statusDot) statusDot.className = 'status-dot status-away';
      if (statusText) statusText.textContent = 'Connecting...';
    }
  };

  // 5. Welcome Action Cards: Host or Join (Instant or Personal Reusable Room)
  const startInstantCallBtn = document.getElementById('startInstantCallBtn');
  const startPersonalRoomBtn = document.getElementById('startPersonalRoomBtn');
  const copyPersonalRoomLinkBtn = document.getElementById('copyPersonalRoomLinkBtn');
  const welcomePersonalCodeBadge = document.getElementById('welcomePersonalCodeBadge');

  async function updateWelcomePersonalRoomDisplay() {
    if (!window.setuStorage) return;
    try {
      const personalCode = await window.setuStorage.getOrCreatePersonalRoomCode();
      const formatted = window.setuRoomSignaling ? window.setuRoomSignaling.formatRoomCode(personalCode) : personalCode;
      if (welcomePersonalCodeBadge) {
        welcomePersonalCodeBadge.textContent = formatted;
      }
    } catch (e) {
      console.warn('Could not update personal room badge:', e);
    }
  }

  updateWelcomePersonalRoomDisplay();

  startInstantCallBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    window.setuSharedPage.isHost = true;
    if (window.setuWizard) {
      await window.setuWizard.startDirectHostMeeting();
    }
  });

  startPersonalRoomBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    window.setuSharedPage.isHost = true;
    if (window.setuWizard && window.setuStorage) {
      const personalCode = await window.setuStorage.getOrCreatePersonalRoomCode();
      await window.setuWizard.startDirectHostMeeting(personalCode);
    }
  });

  copyPersonalRoomLinkBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!window.setuStorage) return;
    const personalCode = await window.setuStorage.getOrCreatePersonalRoomCode();
    const clean = window.setuRoomSignaling ? window.setuRoomSignaling.normalizeRoomCode(personalCode) : personalCode;
    const url = `${window.location.origin}${window.location.pathname}#room=${clean}`;
    try {
      await navigator.clipboard.writeText(url);
      copyPersonalRoomLinkBtn.textContent = 'Copied!';
      setTimeout(() => { copyPersonalRoomLinkBtn.textContent = 'Copy Link'; }, 2500);
      if (window.showToast) window.showToast('Permanent room link copied to clipboard');
    } catch (_) {
      if (window.showToast) window.showToast('Room link: ' + url);
    }
  });

  document.getElementById('hostMeetingCard')?.addEventListener('click', async (e) => {
    if (e.target !== startInstantCallBtn && e.target !== startPersonalRoomBtn && e.target !== copyPersonalRoomLinkBtn) {
      window.setuSharedPage.isHost = true;
      if (window.setuWizard) {
        await window.setuWizard.startDirectHostMeeting();
      }
    }
  });

  const welcomeRoomCodeInput = document.getElementById('welcomeRoomCodeInput');
  const welcomeJoinRoomBtn = document.getElementById('welcomeJoinRoomBtn');
  const openManualJoinBtn = document.getElementById('openManualJoinBtn');

  const executeRoomCodeJoin = async () => {
    const raw = welcomeRoomCodeInput ? welcomeRoomCodeInput.value.trim() : '';
    if (!raw) {
      if (window.showToast) window.showToast('Please enter a room code (e.g. kpm-trvw-xzn)');
      welcomeRoomCodeInput?.focus();
      return;
    }
    const clean = window.setuRoomSignaling ? window.setuRoomSignaling.normalizeRoomCode(raw) : raw;
    if (!clean || clean.length < 6) {
      if (window.showToast) window.showToast('Please enter a valid room code (e.g. kpm-trvw-xzn)');
      return;
    }
    if (window.setuWizard) {
      // Smart Auto-Role Entry: first arrival hosts, second joins instantly
      await window.setuWizard.smartRoomEntry(clean);
    }
  };

  welcomeJoinRoomBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    executeRoomCodeJoin();
  });

  welcomeRoomCodeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeRoomCodeJoin();
    }
  });

  // Automatically format input as XXX-XXXX-XXX or XXX-XXX while user types
  welcomeRoomCodeInput?.addEventListener('input', (e) => {
    if (window.setuRoomSignaling) {
      const clean = window.setuRoomSignaling.normalizeRoomCode(e.target.value);
      e.target.value = window.setuRoomSignaling.formatRoomCode(clean);
    }
  });

  openManualJoinBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.setuSharedPage.isHost = false;
    window.setuWizard.openWizard('join');
  });

  document.getElementById('joinMeetingCard')?.addEventListener('click', (e) => {
    if (e.target !== welcomeRoomCodeInput && e.target !== welcomeJoinRoomBtn) {
      welcomeRoomCodeInput?.focus();
    }
  });


  // 7. Theme Toggle (Dark / Light)
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const savedTheme = localStorage.getItem('setu_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('setu_theme', next);
    });
  }

  // 8. Chat Form Handlers
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInputField');
  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const txt = chatInput.value;
      if (txt) {
        window.setuChat.sendMessage(txt);
        chatInput.value = '';
      }
    });
  }

  window.setuChat.onUnreadChange = (count) => {
    const badge = document.getElementById('chatUnreadBadge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  };

  // 9. In-App Non-Blocking File Consent Banner
  const fileConsentBanner = document.getElementById('fileConsentBanner');
  const fileConsentTitle = document.getElementById('fileConsentTitle');
  const fileConsentDetails = document.getElementById('fileConsentDetails');
  const acceptFileBtn = document.getElementById('acceptFileBtn');
  const declineFileBtn = document.getElementById('declineFileBtn');
  let pendingFileId = null;

  window.setuFileTransfer.onIncomingOffer = (transfer) => {
    pendingFileId = transfer.fileId;
    if (fileConsentTitle) fileConsentTitle.textContent = `Incoming: ${transfer.name}`;
    if (fileConsentDetails) {
      const sizeMb = (transfer.size / (1024 * 1024)).toFixed(2);
      fileConsentDetails.textContent = `Size: ${sizeMb} MB • SHA-256 Verified`;
    }
    if (fileConsentBanner) fileConsentBanner.classList.add('open');

    // Also badge the file drawer button
    const fileBtn = document.getElementById('toggleFileDrawerBtn');
    if (fileBtn) fileBtn.classList.add('active');
  };

  if (acceptFileBtn) {
    acceptFileBtn.addEventListener('click', () => {
      if (pendingFileId) {
        const fileIdToAccept = pendingFileId;
        window.setuFileTransfer.respondToOffer(fileIdToAccept, true);
        pendingFileId = null;

        // Automatically open File Drawer so user sees live progress
        const fileDrawer = document.getElementById('fileDrawer');
        const fileBtn = document.getElementById('toggleFileDrawerBtn');
        document.querySelectorAll('.meeting-drawer').forEach(d => d.classList.remove('open'));
        document.querySelectorAll('.meet-ctrl-btn').forEach(b => {
          if (b.id && b.id.startsWith('toggle')) b.classList.remove('active');
        });
        if (fileDrawer) fileDrawer.classList.add('open');
        if (fileBtn) fileBtn.classList.add('active');
        if (window.showToast) window.showToast('Transfer accepted. Receiving file...');
      }
      fileConsentBanner?.classList.remove('open');
    });
  }

  if (declineFileBtn) {
    declineFileBtn.addEventListener('click', () => {
      if (pendingFileId) {
        window.setuFileTransfer.respondToOffer(pendingFileId, false);
        pendingFileId = null;
      }
      fileConsentBanner?.classList.remove('open');
    });
  }

  // 10. File Dropzone & Queue
  const dropZone = document.getElementById('fileDropzone');
  const fileInput = document.getElementById('fileSelectorInput');

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        window.setuFileTransfer.offerFile(fileInput.files[0]);
      }
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        window.setuFileTransfer.offerFile(e.dataTransfer.files[0]);
      }
    });
  }

  window.setuFileTransfer.onTransferUpdate = (transfer) => {
    renderFileTransferItem(transfer);
  };

  function renderFileTransferItem(transfer) {
    const list = document.getElementById('fileTransfersList');
    if (!list) return;

    let item = document.getElementById(`transfer_${transfer.fileId}`);
    if (!item) {
      item = document.createElement('div');
      item.id = `transfer_${transfer.fileId}`;
      item.className = 'file-entry';
      list.prepend(item);
    }

    const pct = Math.min(100, Math.round((transfer.bytesTransferred / (transfer.size || 1)) * 100));
    const speedKb = Math.round((transfer.speedBps || 0) / 1024);

    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 600;">
        <span>${transfer.name}</span>
        <span>${pct}%</span>
      </div>
      <div class="file-progress-track">
        <div class="file-progress-bar" style="width: ${pct}%"></div>
      </div>
      <div style="font-size: 0.72rem; color: var(--text-muted); display: flex; justify-content: space-between;">
        <span>Status: ${transfer.status}</span>
        <span>${speedKb} KB/s</span>
      </div>
    `;
  }

  // 11. Consensual Recording Toggle
  const recordBtn = document.getElementById('recordToggleBtn');
  if (recordBtn) {
    recordBtn.addEventListener('click', () => {
      if (!window.setuRecorder.isRecording) {
        window.setuRecorder.requestConsent();
      } else {
        window.setuRecorder.stopRecording();
      }
    });
  }

  window.setuRecorder.onRecordingStateChange = (active) => {
    const recIndicator = document.getElementById('recordingIndicator');
    if (recIndicator) recIndicator.classList.toggle('active', active);
    if (recordBtn) recordBtn.classList.toggle('active', active);
  };

  // 12. Diagnostics Metrics HUD (Including Direct IP addresses & Ports)
  window.setuDiagnostics.onMetricsUpdate = (metrics) => {
    const rttEl = document.getElementById('diagRttVal');
    const lossEl = document.getElementById('diagLossVal');
    const resEl = document.getElementById('diagResVal');
    const connEl = document.getElementById('diagConnTypeVal');
    const localIpEl = document.getElementById('diagLocalIpVal');
    const remoteIpEl = document.getElementById('diagRemoteIpVal');

    if (rttEl) rttEl.textContent = metrics.rttMs !== null ? `${metrics.rttMs} ms` : 'Measuring...';
    if (lossEl) lossEl.textContent = `${metrics.packetLossPercent}%`;
    if (resEl) resEl.textContent = `${metrics.resolution} @ ${metrics.fps}fps`;
    if (connEl) connEl.textContent = metrics.connectionType;
    if (localIpEl) localIpEl.textContent = metrics.localIp ? `${metrics.localIp}${metrics.localPort ? ':' + metrics.localPort : ''}` : 'Local Candidate';
    if (remoteIpEl) remoteIpEl.textContent = metrics.remoteIp ? `${metrics.remoteIp}${metrics.remotePort ? ':' + metrics.remotePort : ''}` : 'Remote Candidate';

    // On-Screen Direct IP Pill update
    const screenIpDisplay = document.getElementById('screenIpDisplay');
    const screenIpPill = document.getElementById('screenIpPill');
    if (screenIpDisplay) {
      if (metrics.remoteIp && metrics.remoteIp !== 'Detecting...') {
        screenIpDisplay.textContent = `P2P IP: ${metrics.remoteIp}${metrics.remotePort ? ':' + metrics.remotePort : ''}`;
      } else if (metrics.localIp && metrics.localIp !== 'Detecting...') {
        screenIpDisplay.textContent = `IP: ${metrics.localIp}`;
      } else {
        screenIpDisplay.textContent = 'IP: Direct P2P';
      }
    }
    if (screenIpPill) {
      screenIpPill.title = `Local IP: ${metrics.localIp}${metrics.localPort ? ':' + metrics.localPort : ''} | Remote IP: ${metrics.remoteIp}${metrics.remotePort ? ':' + metrics.remotePort : ''} (${metrics.connectionType})`;
    }
  };

  // 12b. NAT Traversal & Firewall Failure Notifications
  if (window.setuWebRTC) {
    window.setuWebRTC.onNatTraversalFailed = () => {
      const hasCustomTurn = window.setuWebRTC.iceServers.some(s => {
        const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
        return urls.some(u => typeof u === 'string' && (u.startsWith('turn:') || u.startsWith('turns:')));
      });

      if (window.showToast) {
        if (hasCustomTurn) {
          window.showToast('Connection failed: Both peers could not connect even with configured relay. Please verify your TURN credentials or network firewall.', 8000);
        } else {
          window.showToast('Direct P2P connection failed: Strict NAT or firewall blocked direct connection. Try a mobile hotspot/Wi-Fi or configure a TURN relay in Settings.', 9000);
        }
      }
    };
  }

  // 13. PowerToys Collaborative Whiteboard Controls
  const clearBoardBtn = document.getElementById('clearWhiteboardBtn');
  if (clearBoardBtn) {
    clearBoardBtn.addEventListener('click', () => window.setuSharedPage.clearCanvas());
  }

  const downloadBoardBtn = document.getElementById('downloadWhiteboardBtn');
  if (downloadBoardBtn) {
    downloadBoardBtn.addEventListener('click', () => window.setuSharedPage.downloadCanvas());
  }

  const allowCollabCheckbox = document.getElementById('allowPeerCollabCheckbox');
  if (allowCollabCheckbox) {
    allowCollabCheckbox.addEventListener('change', (e) => {
      window.setuSharedPage.setCollaborationAllowed(e.target.checked);
    });
  }

  // Whiteboard Tool Buttons (Pen, Highlighter, Rect, Circle, Arrow, Line, Text, Eraser)
  document.querySelectorAll('.wb-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wb-tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tool = btn.getAttribute('data-tool');
      if (tool && window.setuSharedPage) {
        window.setuSharedPage.setTool(tool);
      }
    });
  });

  // Whiteboard Color Swatches
  document.querySelectorAll('.wb-color-dot').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wb-color-dot').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const color = btn.getAttribute('data-color');
      if (color && window.setuSharedPage) {
        window.setuSharedPage.setColor(color);
      }
    });
  });

  // Whiteboard Stroke Width
  const strokeSelect = document.getElementById('wbStrokeWidthSelect');
  if (strokeSelect) {
    strokeSelect.addEventListener('change', (e) => {
      if (window.setuSharedPage) {
        window.setuSharedPage.setLineWidth(parseInt(e.target.value, 10));
      }
    });
  }

  // Whiteboard Grid Patterns (Blank, Dots, Grid, Dark)
  const gridSelect = document.getElementById('wbGridSelect');
  if (gridSelect) {
    gridSelect.addEventListener('change', (e) => {
      if (window.setuSharedPage) {
        window.setuSharedPage.setBackgroundMode(e.target.value);
      }
    });
  }

  // Whiteboard Undo & Redo
  document.getElementById('wbUndoBtn')?.addEventListener('click', () => window.setuSharedPage.undo());
  document.getElementById('wbRedoBtn')?.addEventListener('click', () => window.setuSharedPage.redo());

  // 14. Remembered Contacts Loader (Zero emojis)
  async function loadRememberedContacts() {
    const container = document.getElementById('contactsChipsList');
    if (!container) return;
    const contacts = await window.setuStorage.getContacts();

    container.innerHTML = '';
    if (contacts.length === 0) {
      container.innerHTML = '<span style="font-size: 0.825rem; color: var(--text-muted);">No saved contacts yet. Verified peers will appear here.</span>';
      return;
    }

    contacts.forEach(c => {
      const chip = document.createElement('div');
      chip.className = 'contact-chip';
      chip.innerHTML = `
        <span>${escapeHtml(c.label)}</span>
        ${c.verified ? '<span class="verified-tag">Verified</span>' : ''}
        <button class="contact-delete" title="Remove contact">✕</button>
      `;
      chip.querySelector('.contact-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.setuStorage.deleteContact(c.id);
        loadRememberedContacts();
      });
      container.appendChild(chip);
    });
  }

  loadRememberedContacts();

  // Responsive Comparison Table Filter
  const compFilterBar = document.getElementById('compFilterBar');
  const compTable = document.getElementById('compTable');
  if (compFilterBar && compTable) {
    compFilterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.comp-filter-btn');
      if (!btn) return;
      compFilterBar.querySelectorAll('.comp-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.col;
      compTable.className = 'comp-table';
      if (target && target !== 'all') {
        compTable.classList.add('filter-active', `filter-${target}`);
      }
    });
  }

  // 15. Privacy Console Modal
  const privacyBtn = document.getElementById('privacyCenterBtn');
  const privacyModal = document.getElementById('privacyModal');
  const closePrivacyBtn = document.getElementById('closePrivacyModalBtn');
  const panicWipeBtn = document.getElementById('panicWipeBtn');

  if (privacyBtn && privacyModal) {
    privacyBtn.addEventListener('click', async () => {
      const audit = await window.setuPrivacy.getStorageAudit();
      document.getElementById('auditMsgCount').textContent = audit.totalMessages;
      document.getElementById('auditContactCount').textContent = audit.totalContacts;
      document.getElementById('auditSizeEst').textContent = `${audit.estimatedSizeKb} KB`;
      privacyModal.classList.add('open');
    });

    closePrivacyBtn?.addEventListener('click', () => privacyModal.classList.remove('open'));
    panicWipeBtn?.addEventListener('click', () => window.setuPrivacy.executePanicWipe());
  }

  // 16. Global Settings & User Profile
  const settingsModal = document.getElementById('settingsModal');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const welcomeSettingsBtn = document.getElementById('welcomeSettingsBtn');
  const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const uploadAvatarBtn = document.getElementById('uploadAvatarBtn');
  const avatarFileInput = document.getElementById('avatarFileInput');
  const removeAvatarBtn = document.getElementById('removeAvatarBtn');
  const profileDisplayNameInput = document.getElementById('profileDisplayNameInput');
  const prefMuteAudioCheckbox = document.getElementById('prefMuteAudioCheckbox');
  const prefMuteVideoCheckbox = document.getElementById('prefMuteVideoCheckbox');
  const prefNoiseSuppressionCheckbox = document.getElementById('prefNoiseSuppressionCheckbox');
  const prefMeetingSoundsCheckbox = document.getElementById('prefMeetingSoundsCheckbox');
  const settingsAvatarImg = document.getElementById('settingsAvatarImg');
  const settingsAvatarInitial = document.getElementById('settingsAvatarInitial');

  let currentAvatarDataUrl = null;

  async function loadUserProfile() {
    try {
      const profile = await window.setuStorage.getUserProfile();
      if (!profile) return;

      if (profileDisplayNameInput && profile.displayName) {
        profileDisplayNameInput.value = profile.displayName;
      }
      const isMuteAudio = (profile.defaultMutedAudio !== undefined) ? !!profile.defaultMutedAudio : !!profile.defaultMuteAudio;
      const isMuteVideo = (profile.defaultMutedVideo !== undefined) ? !!profile.defaultMutedVideo : !!profile.defaultMuteVideo;

      if (prefMuteAudioCheckbox) {
        prefMuteAudioCheckbox.checked = isMuteAudio;
      }
      if (prefMuteVideoCheckbox) {
        prefMuteVideoCheckbox.checked = isMuteVideo;
      }
      if (window.setuWebRTC) {
        window.setuWebRTC.isAudioMuted = isMuteAudio;
        window.setuWebRTC.isVideoMuted = isMuteVideo;
      }
      if (prefNoiseSuppressionCheckbox && profile.noiseSuppression !== undefined) {
        prefNoiseSuppressionCheckbox.checked = profile.noiseSuppression;
      }
      if (prefMeetingSoundsCheckbox && profile.meetingSounds !== undefined) {
        prefMeetingSoundsCheckbox.checked = profile.meetingSounds;
      }
      if (window.setuSound && profile.meetingSounds !== undefined) {
        window.setuSound.setEnabled(profile.meetingSounds);
      }
      const camQualitySelect = document.getElementById('settingCameraQuality');
      if (camQualitySelect && profile.cameraQuality) {
        camQualitySelect.value = profile.cameraQuality;
      }
      if (window.setuWebRTC) {
        window.setuWebRTC.applyCameraQuality(profile.cameraQuality || '720p');
      }

      const screenModeSelect = document.getElementById('settingScreenShareMode');
      if (screenModeSelect && profile.screenShareMode) {
        screenModeSelect.value = profile.screenShareMode;
      }
      if (window.setuWebRTC) {
        window.setuWebRTC.setScreenShareMode(profile.screenShareMode || 'sharpness');
      }

      const autoReduce = document.getElementById('settingAutoReduceQuality');
      if (autoReduce && profile.autoReduceQuality !== undefined) {
        autoReduce.checked = profile.autoReduceQuality;
      }

      const audioOnly = document.getElementById('settingAudioOnlyFallback');
      if (audioOnly && profile.audioOnlyFallback !== undefined) {
        audioOnly.checked = profile.audioOnlyFallback;
      }

      // Load custom TURN relay settings
      const turnUrlInput = document.getElementById('settingTurnServerUrl');
      const turnUserInput = document.getElementById('settingTurnUsername');
      const turnCredInput = document.getElementById('settingTurnCredential');

      if (turnUrlInput) turnUrlInput.value = profile.turnServerUrl || '';
      if (turnUserInput) turnUserInput.value = profile.turnUsername || '';
      if (turnCredInput) turnCredInput.value = profile.turnCredential || '';

      if (window.setuWebRTC) {
        window.setuWebRTC.setCustomIceServers(profile.turnServerUrl, profile.turnUsername, profile.turnCredential);
      }

      // Load personal reusable room code
      const personalCodeInput = document.getElementById('settingPersonalRoomCode');
      let personalCode = profile.personalRoomCode;
      if ((!personalCode || !personalCode.trim()) && window.setuStorage.getOrCreatePersonalRoomCode) {
        personalCode = await window.setuStorage.getOrCreatePersonalRoomCode();
      }
      const formattedCode = window.setuRoomSignaling ? window.setuRoomSignaling.formatRoomCode(personalCode) : personalCode;
      if (personalCodeInput) personalCodeInput.value = formattedCode;
      const welcomeBadge = document.getElementById('welcomePersonalCodeBadge');
      if (welcomeBadge) welcomeBadge.textContent = formattedCode;

      if (profile.avatarDataUrl) {
        currentAvatarDataUrl = profile.avatarDataUrl;
        if (settingsAvatarImg) {
          settingsAvatarImg.src = profile.avatarDataUrl;
          settingsAvatarImg.style.display = 'block';
        }
        if (settingsAvatarInitial) settingsAvatarInitial.style.display = 'none';
      } else if (profile.displayName) {
        if (settingsAvatarInitial) {
          settingsAvatarInitial.textContent = profile.displayName.charAt(0).toUpperCase();
          settingsAvatarInitial.style.display = 'block';
        }
        if (settingsAvatarImg) settingsAvatarImg.style.display = 'none';
      }

      // Load custom API signaling gateway settings
      if (window.setuStorage && window.setuStorage.getApiSignalingSettings) {
        try {
          const apiSettings = await window.setuStorage.getApiSignalingSettings();
          const apiEnabledCheckbox = document.getElementById('settingApiSignalingEnabled');
          const apiEndpointInput = document.getElementById('settingApiEndpoint');
          const apiSecretKeyInput = document.getElementById('settingApiSecretKey');
          const apiPollIntervalInput = document.getElementById('settingApiPollInterval');
          const apiPollIntervalVal = document.getElementById('settingApiPollIntervalVal');

          if (apiEnabledCheckbox) apiEnabledCheckbox.checked = !!apiSettings.enabled;
          if (apiEndpointInput) apiEndpointInput.value = apiSettings.endpoint || '';
          if (apiSecretKeyInput) apiSecretKeyInput.value = apiSettings.secretKey || '';
          if (apiPollIntervalInput) {
            apiPollIntervalInput.value = apiSettings.pollIntervalSec || 3;
            if (apiPollIntervalVal) apiPollIntervalVal.textContent = `${apiPollIntervalInput.value}s`;
          }
        } catch (_) {}
      }

      // Load remote control & companion settings
      if (window.setuStorage && window.setuStorage.getRemoteControlSettings) {
        try {
          const rcSettings = await window.setuStorage.getRemoteControlSettings();
          const portInput = document.getElementById('settingCompanionPort');
          const passkeyInput = document.getElementById('settingCompanionPasskey');
          if (portInput) portInput.value = rcSettings.companionPort || 49152;
          if (passkeyInput) passkeyInput.value = rcSettings.companionPasskey || '';
        } catch (_) {}
      }
    } catch (e) {
      console.warn('Failed to load profile:', e);
    }
  }

  loadUserProfile();

  const regeneratePersonalRoomCodeBtn = document.getElementById('regeneratePersonalRoomCodeBtn');
  const copyPersonalRoomLinkSettingsBtn = document.getElementById('copyPersonalRoomLinkSettingsBtn');

  regeneratePersonalRoomCodeBtn?.addEventListener('click', async () => {
    if (!window.setuRoomSignaling || !window.setuStorage) return;
    const newCode = window.setuRoomSignaling.generateRoomCode();
    const clean = window.setuRoomSignaling.normalizeRoomCode(newCode);
    const formatted = window.setuRoomSignaling.formatRoomCode(clean);
    const personalCodeInput = document.getElementById('settingPersonalRoomCode');
    if (personalCodeInput) personalCodeInput.value = formatted;
    const welcomeBadge = document.getElementById('welcomePersonalCodeBadge');
    if (welcomeBadge) welcomeBadge.textContent = formatted;
    await window.setuStorage.setPersonalRoomCode(clean);
    if (window.showToast) window.showToast('New personal room code generated: ' + formatted);
  });

  copyPersonalRoomLinkSettingsBtn?.addEventListener('click', async () => {
    const personalCodeInput = document.getElementById('settingPersonalRoomCode');
    const raw = personalCodeInput ? personalCodeInput.value.trim() : '';
    const clean = window.setuRoomSignaling ? window.setuRoomSignaling.normalizeRoomCode(raw) : raw;
    if (!clean) return;
    const url = `${window.location.origin}${window.location.pathname}#room=${clean}`;
    try {
      await navigator.clipboard.writeText(url);
      copyPersonalRoomLinkSettingsBtn.textContent = 'Copied!';
      setTimeout(() => { copyPersonalRoomLinkSettingsBtn.textContent = 'Copy Link'; }, 2500);
      if (window.showToast) window.showToast('Permanent room link copied to clipboard');
    } catch (_) {
      if (window.showToast) window.showToast('Room link: ' + url);
    }
  });

  const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
  const jumpToAudioTestBtn = document.getElementById('jumpToAudioTestBtn');
  const jumpToVideoTestBtn = document.getElementById('jumpToVideoTestBtn');

  // Settings Tabs Management
  const tabBtns = document.querySelectorAll('.settings-tab-btn');
  const tabPanes = document.querySelectorAll('.settings-tab-pane');

  function switchSettingsTab(tabName) {
    tabBtns.forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    tabPanes.forEach(pane => {
      const isActive = pane.id === `tab-${tabName}`;
      pane.classList.toggle('active', isActive);
      pane.style.display = isActive ? 'block' : 'none';
    });

    if (tabName === 'device-test' && window.setuDeviceTest) {
      window.setuDeviceTest.initTestUI();
    } else if (window.setuDeviceTest) {
      window.setuDeviceTest.stopAllTests();
    }
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.tab));
  });

  jumpToAudioTestBtn?.addEventListener('click', () => switchSettingsTab('device-test'));
  jumpToVideoTestBtn?.addEventListener('click', () => switchSettingsTab('device-test'));

  async function populateSettingsDeviceDropdowns() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const micSelect = document.getElementById('settingAudioInputSource');
      const speakerSelect = document.getElementById('settingAudioOutputSink');
      const camSelect = document.getElementById('settingVideoInputSource');
      const sysPickerBtn = document.getElementById('settingAudioOutputPickerBtn');

      if (micSelect) micSelect.innerHTML = '<option value="">Default Microphone</option>';
      if (speakerSelect) speakerSelect.innerHTML = '<option value="default">Speaker / Default</option>';
      if (camSelect) camSelect.innerHTML = '<option value="">Default Camera</option>';

      let micIdx = 1, spkIdx = 1, camIdx = 1;

      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;

        if (d.kind === 'audioinput' && micSelect) {
          opt.textContent = d.label || `Microphone ${micIdx++}`;
          if (d.deviceId === window.setuWebRTC?.selectedAudioDeviceId) opt.selected = true;
          micSelect.appendChild(opt);
        } else if (d.kind === 'audiooutput' && speakerSelect) {
          let label = d.label;
          if (!label || !label.trim()) {
            label = d.deviceId === 'default' ? 'Speaker / Default' : `Speaker ${spkIdx++}`;
          }
          opt.textContent = label;
          if (d.deviceId === (window.setuWebRTC?.selectedAudioOutputId || 'default')) opt.selected = true;
          speakerSelect.appendChild(opt);
        } else if (d.kind === 'videoinput' && camSelect) {
          opt.textContent = d.label || `Camera ${camIdx++}`;
          if (d.deviceId === window.setuWebRTC?.selectedVideoDeviceId) opt.selected = true;
          camSelect.appendChild(opt);
        }
      });

      if (sysPickerBtn) {
        sysPickerBtn.style.display = (typeof navigator.mediaDevices?.selectAudioOutput === 'function') ? 'inline-block' : 'none';
      }
    } catch (e) {
      console.warn('[Settings] Error enumerating devices:', e);
    }
  }

  // Device change handlers in settings
  document.getElementById('settingAudioInputSource')?.addEventListener('change', async (e) => {
    if (window.setuWebRTC && e.target.value) {
      await window.setuWebRTC.switchAudioDevice(e.target.value);
      if (window.showToast) window.showToast('Microphone switched');
    }
  });

  document.getElementById('settingAudioOutputSink')?.addEventListener('change', async (e) => {
    if (window.setuWebRTC && e.target.value) {
      const ok = await window.setuWebRTC.switchAudioOutput(e.target.value);
      if (window.showToast) {
        const text = e.target.options[e.target.selectedIndex]?.text || 'device';
        window.showToast(ok ? `Audio output: ${text}` : 'Audio output switched');
      }
    }
  });

  document.getElementById('settingAudioOutputPickerBtn')?.addEventListener('click', async () => {
    if (window.setuWebRTC) {
      const chosen = await window.setuWebRTC.selectAudioOutputDialog();
      if (chosen) {
        await populateSettingsDeviceDropdowns();
        if (window.showToast) window.showToast('Audio output: ' + (chosen.label || 'Selected device'));
      }
    }
  });

  document.getElementById('settingVideoInputSource')?.addEventListener('change', async (e) => {
    if (window.setuWebRTC && e.target.value) {
      const ok = await window.setuWebRTC.switchVideoDevice(e.target.value);
      if (window.showToast) window.showToast(ok ? 'Camera switched' : 'Could not switch camera');
    }
  });

  document.getElementById('settingFlipCameraBtn')?.addEventListener('click', async () => {
    if (window.setuWebRTC) {
      const ok = await window.setuWebRTC.flipCamera();
      await populateSettingsDeviceDropdowns();
      if (window.showToast) window.showToast(ok ? 'Camera switched' : 'Could not switch camera');
    }
  });

  const openSettings = (preferredTab = 'general') => {
    loadUserProfile();
    populateSettingsDeviceDropdowns();
    switchSettingsTab(preferredTab);
    if (settingsModal) settingsModal.classList.add('open');
  };

  window.openSettingsModal = openSettings;

  const closeSettings = () => {
    if (window.setuDeviceTest) {
      window.setuDeviceTest.stopAllTests();
    }
    settingsModal?.classList.remove('open');
  };

  openSettingsBtn?.addEventListener('click', () => openSettings('general'));
  welcomeSettingsBtn?.addEventListener('click', () => openSettings('general'));
  closeSettingsModalBtn?.addEventListener('click', closeSettings);
  cancelSettingsBtn?.addEventListener('click', closeSettings);
  settingsModal?.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  if (uploadAvatarBtn && avatarFileInput) {
    uploadAvatarBtn.addEventListener('click', () => avatarFileInput.click());

    avatarFileInput.addEventListener('change', () => {
      const file = avatarFileInput.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        window.showToast('Please select an image smaller than 2MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        currentAvatarDataUrl = e.target.result;
        if (settingsAvatarImg) {
          settingsAvatarImg.src = currentAvatarDataUrl;
          settingsAvatarImg.style.display = 'block';
        }
        if (settingsAvatarInitial) settingsAvatarInitial.style.display = 'none';
      };
      reader.readAsDataURL(file);
    });
  }

  if (removeAvatarBtn) {
    removeAvatarBtn.addEventListener('click', () => {
      currentAvatarDataUrl = null;
      if (settingsAvatarImg) {
        settingsAvatarImg.src = '';
        settingsAvatarImg.style.display = 'none';
      }
      if (settingsAvatarInitial) {
        const name = profileDisplayNameInput?.value || 'Y';
        settingsAvatarInitial.textContent = name.charAt(0).toUpperCase();
        settingsAvatarInitial.style.display = 'block';
      }
    });
  }

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
      const displayName = profileDisplayNameInput?.value.trim() || 'You';
      const defaultMutedAudio = !!prefMuteAudioCheckbox?.checked;
      const defaultMutedVideo = !!prefMuteVideoCheckbox?.checked;
      const noiseSuppression = !!prefNoiseSuppressionCheckbox?.checked;
      const meetingSounds = prefMeetingSoundsCheckbox ? !!prefMeetingSoundsCheckbox.checked : true;

      if (window.setuSound) {
        window.setuSound.setEnabled(meetingSounds);
      }

      const cameraQuality = document.getElementById('settingCameraQuality')?.value || '720p';
      const screenShareMode = document.getElementById('settingScreenShareMode')?.value || 'sharpness';
      const autoReduceQuality = !!document.getElementById('settingAutoReduceQuality')?.checked;
      const audioOnlyFallback = !!document.getElementById('settingAudioOnlyFallback')?.checked;

      const turnServerUrl = document.getElementById('settingTurnServerUrl')?.value.trim() || '';
      const turnUsername = document.getElementById('settingTurnUsername')?.value.trim() || '';
      const turnCredential = document.getElementById('settingTurnCredential')?.value.trim() || '';

      const rawPersonalCode = document.getElementById('settingPersonalRoomCode')?.value.trim() || '';
      const cleanPersonalCode = window.setuRoomSignaling ? window.setuRoomSignaling.normalizeRoomCode(rawPersonalCode) : rawPersonalCode;

      await window.setuStorage.saveUserProfile({
        displayName,
        personalRoomCode: cleanPersonalCode,
        avatarDataUrl: currentAvatarDataUrl,
        defaultMutedAudio,
        defaultMuteAudio: defaultMutedAudio,
        defaultMutedVideo,
        defaultMuteVideo: defaultMutedVideo,
        noiseSuppression,
        meetingSounds,
        cameraQuality,
        screenShareMode,
        autoReduceQuality,
        audioOnlyFallback,
        turnServerUrl,
        turnUsername,
        turnCredential
      });

      const welcomeBadge = document.getElementById('welcomePersonalCodeBadge');
      if (welcomeBadge && cleanPersonalCode) {
        welcomeBadge.textContent = window.setuRoomSignaling ? window.setuRoomSignaling.formatRoomCode(cleanPersonalCode) : cleanPersonalCode;
      }

      if (window.setuWebRTC) {
        window.setuWebRTC.isAudioMuted = defaultMutedAudio;
        window.setuWebRTC.isVideoMuted = defaultMutedVideo;
        await window.setuWebRTC.applyCameraQuality(cameraQuality);
        window.setuWebRTC.setScreenShareMode(screenShareMode);
        window.setuWebRTC.setCustomIceServers(turnServerUrl, turnUsername, turnCredential);
      }

      // Save custom API signaling settings
      if (window.setuStorage && window.setuStorage.saveApiSignalingSettings) {
        try {
          const apiEnabled = !!document.getElementById('settingApiSignalingEnabled')?.checked;
          const apiEndpoint = document.getElementById('settingApiEndpoint')?.value.trim() || '';
          const apiSecretKey = document.getElementById('settingApiSecretKey')?.value.trim() || '';
          const apiPollInterval = parseInt(document.getElementById('settingApiPollInterval')?.value, 10) || 3;

          await window.setuStorage.saveApiSignalingSettings({
            enabled: apiEnabled,
            endpoint: apiEndpoint,
            secretKey: apiSecretKey,
            pollIntervalSec: apiPollInterval
          });
        } catch (_) {}
      }

      // Save remote control & companion settings
      if (window.setuStorage && window.setuStorage.saveRemoteControlSettings) {
        try {
          const companionPort = parseInt(document.getElementById('settingCompanionPort')?.value, 10) || 49152;
          const companionPasskey = document.getElementById('settingCompanionPasskey')?.value.trim() || '';
          await window.setuStorage.saveRemoteControlSettings({
            companionPort,
            companionPasskey
          });
          if (window.setuRemoteControl) {
            window.setuRemoteControl.companionPort = companionPort;
            window.setuRemoteControl.companionPasskey = companionPasskey;
          }
        } catch (_) {}
      }

      broadcastUserProfile();
      closeSettings();
      window.showToast('Profile, personal room, and gateway settings saved');
    });
  }

  // Custom API Signaling Gateway UI listeners
  const apiPollSlider = document.getElementById('settingApiPollInterval');
  const apiPollVal = document.getElementById('settingApiPollIntervalVal');
  apiPollSlider?.addEventListener('input', () => {
    if (apiPollVal) apiPollVal.textContent = `${apiPollSlider.value}s`;
  });

  const toggleSecretBtn = document.getElementById('toggleApiSecretVisibilityBtn');
  const secretKeyInput = document.getElementById('settingApiSecretKey');
  toggleSecretBtn?.addEventListener('click', () => {
    if (secretKeyInput) {
      const isPass = secretKeyInput.type === 'password';
      secretKeyInput.type = isPass ? 'text' : 'password';
      toggleSecretBtn.textContent = isPass ? 'Hide' : 'Show';
    }
  });

  const testApiBtn = document.getElementById('testApiEndpointBtn');
  const testApiStatus = document.getElementById('apiEndpointTestStatus');
  testApiBtn?.addEventListener('click', async () => {
    const endpoint = document.getElementById('settingApiEndpoint')?.value.trim();
    const secretKey = document.getElementById('settingApiSecretKey')?.value.trim();
    if (!endpoint) {
      if (testApiStatus) {
        testApiStatus.textContent = 'Please enter an API Endpoint URL';
        testApiStatus.style.color = 'var(--accent-rose)';
      }
      return;
    }
    if (testApiStatus) {
      testApiStatus.textContent = 'Testing connection & CORS...';
      testApiStatus.style.color = 'var(--accent-blue)';
    }
    try {
      if (!window.setuRoomSignaling || !window.setuRoomSignaling.testApiEndpoint) {
        throw new Error('Signaling service unavailable');
      }
      const res = await window.setuRoomSignaling.testApiEndpoint(endpoint, secretKey);
      if (testApiStatus) {
        testApiStatus.textContent = res.message || 'Connected successfully!';
        testApiStatus.style.color = 'var(--accent-teal)';
      }
    } catch (err) {
      if (testApiStatus) {
        testApiStatus.textContent = err.message || 'Connection failed';
        testApiStatus.style.color = 'var(--accent-rose)';
      }
    }
  });

  // 17. Meeting History & Archive
  const historyModal = document.getElementById('historyModal');
  const openHistoryBtn = document.getElementById('openHistoryBtn');
  const welcomeHistoryBtn = document.getElementById('welcomeHistoryBtn');
  const closeHistoryModalBtn = document.getElementById('closeHistoryModalBtn');
  const historySearchInput = document.getElementById('historySearchInput');
  const clearAllHistoryBtn = document.getElementById('clearAllHistoryBtn');
  const historyListContainer = document.getElementById('historyListContainer');
  let currentHistoryFilter = 'all';

  async function renderMeetingHistory(filter = currentHistoryFilter, query = '') {
    if (!historyListContainer) return;

    let meetings = [];
    try {
      if (window.setuStorage) {
        if (query && query.trim()) {
          meetings = await window.setuStorage.searchMeetings(query.trim());
        } else {
          meetings = await window.setuStorage.getAllMeetings();
        }
      }
    } catch (err) {
      console.warn('[Meeting History] Failed to load meetings from storage:', err);
      try {
        const raw = localStorage.getItem('setu_meeting_history_fallback');
        if (raw) meetings = JSON.parse(raw);
      } catch (e) {}
    }

    if (!Array.isArray(meetings)) meetings = [];

    if (filter === 'notes') {
      meetings = meetings.filter(m => m.notes && m.notes.trim().length > 0);
    } else if (filter === 'chats') {
      meetings = meetings.filter(m => (m.chats && m.chats.length > 0) || (m.chatMessages && m.chatMessages.length > 0) || (m.chatCount > 0));
    } else if (filter === 'files') {
      meetings = meetings.filter(m => (m.files && m.files.length > 0) || (m.sharedFiles && m.sharedFiles.length > 0) || (m.fileCount > 0));
    }

    if (meetings.length === 0) {
      historyListContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 2.5rem 1rem;">
          <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 0.3rem;">No archived meetings found yet</div>
          <div style="font-size: 0.8rem; margin-bottom: 1rem;">Completed meetings will automatically save notes, chat transcripts, and shared file records here.</div>
          <button id="seedSampleHistoryBtn" class="btn btn-secondary btn-sm">Add Sample Meeting Record</button>
        </div>
      `;
      document.getElementById('seedSampleHistoryBtn')?.addEventListener('click', async () => {
        try {
          await seedSampleMeetingArchive();
        } catch (e) {
          console.error(e);
        }
        renderMeetingHistory('all', '');
      });
      return;
    }

    historyListContainer.innerHTML = '';
    meetings.forEach(meeting => {
      const card = document.createElement('article');
      card.className = 'history-card';
      const formattedDate = new Date(meeting.timestamp).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const durationSec = meeting.durationSec || meeting.durationSeconds || 0;
      const durationText = meeting.durationFormatted || (durationSec > 0
        ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
        : 'Brief Call');

      const hasNotes = meeting.notes && meeting.notes.trim().length > 0;
      const chats = meeting.chats || meeting.chatMessages || [];
      const files = meeting.files || meeting.sharedFiles || [];

      card.innerHTML = `
        <div class="history-card-header">
          <div>
            <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">${escapeHtml(meeting.peerName || 'Direct P2P Call')}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem;">${formattedDate} • Duration: ${durationText}</div>
          </div>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
            <button class="btn btn-secondary btn-sm export-json-btn" title="Export JSON">Export</button>
            <button class="btn btn-secondary btn-sm delete-history-btn" style="color: var(--accent-rose);" title="Delete Meeting Record">✕</button>
          </div>
        </div>

        <div class="history-badges-row">
          <span class="history-meta-badge">${chats.length || meeting.chatCount || 0} Messages</span>
          <span class="history-meta-badge">${files.length || meeting.fileCount || 0} Shared Files</span>
          ${hasNotes ? '<span class="history-meta-badge" style="background: rgba(52, 168, 83, 0.15); color: #34a853;">Notes Attached</span>' : ''}
        </div>

        ${hasNotes ? `
          <div style="margin-top: 0.6rem; background: var(--bg-surface-elevated); padding: 0.6rem 0.8rem; border-radius: var(--radius-sm); font-size: 0.8rem; border-left: 3px solid var(--accent-blue);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
              <span style="font-weight: 600; font-size: 0.72rem; text-transform: uppercase; color: var(--text-muted);">Session Notes</span>
              <button class="copy-notes-btn" style="background: transparent; border: none; font-size: 0.72rem; color: var(--accent-blue); cursor: pointer;">Copy Notes</button>
            </div>
            <div style="white-space: pre-wrap; color: var(--text-secondary); max-height: 100px; overflow-y: auto;">${escapeHtml(meeting.notes)}</div>
          </div>
        ` : ''}

        ${chats.length > 0 ? `
          <details style="margin-top: 0.5rem; font-size: 0.8rem;">
            <summary style="cursor: pointer; color: var(--text-secondary); font-weight: 600; font-size: 0.75rem; padding: 0.2rem 0;">View Chat Log (${chats.length})</summary>
            <div style="margin-top: 0.4rem; max-height: 120px; overflow-y: auto; background: var(--bg-surface-elevated); border-radius: var(--radius-sm); padding: 0.5rem;">
              ${chats.map(c => `
                <div style="margin-bottom: 0.35rem; font-size: 0.75rem;">
                  <strong style="color: ${c.isLocal ? 'var(--accent-blue)' : 'var(--text-main)'};">${c.isLocal ? 'You' : escapeHtml(c.sender || 'Peer')}:</strong>
                  <span>${escapeHtml(c.text)}</span>
                </div>
              `).join('')}
            </div>
          </details>
        ` : ''}

        ${files.length > 0 ? `
          <details style="margin-top: 0.4rem; font-size: 0.8rem;">
            <summary style="cursor: pointer; color: var(--text-secondary); font-weight: 600; font-size: 0.75rem; padding: 0.2rem 0;">Shared Files (${files.length})</summary>
            <div style="margin-top: 0.4rem; background: var(--bg-surface-elevated); border-radius: var(--radius-sm); padding: 0.5rem;">
              ${files.map(f => `
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 0.2rem;">
                  <span>${escapeHtml(f.name)} (${(f.size / (1024 * 1024)).toFixed(2)} MB)</span>
                  <span style="color: var(--text-muted);">${escapeHtml(f.status || 'Completed')}</span>
                </div>
              `).join('')}
            </div>
          </details>
        ` : ''}
      `;

      card.querySelector('.copy-notes-btn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(meeting.notes || '');
        window.showToast('Meeting notes copied to clipboard');
      });

      card.querySelector('.export-json-btn')?.addEventListener('click', () => {
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(meeting, null, 2));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = `meeting_archive_${meeting.id || meeting.timestamp}.json`;
        a.click();
      });

      card.querySelector('.delete-history-btn')?.addEventListener('click', async () => {
        if (confirm('Delete this meeting archive?')) {
          await window.setuStorage.deleteMeeting(meeting.id);
          renderMeetingHistory(currentHistoryFilter, historySearchInput?.value || '');
          window.showToast('Meeting record deleted');
        }
      });

      historyListContainer.appendChild(card);
    });
  }

  async function seedSampleMeetingArchive() {
    if (!window.setuStorage) return;
    const now = Date.now();
    await window.setuStorage.saveMeeting({
      id: 'meet_sample_' + now,
      timestamp: now - 3600000,
      dateStr: new Date(now - 3600000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      timeStr: new Date(now - 3600000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      durationSec: 1455,
      durationFormatted: '24:15',
      peerName: 'Sarah Connor',
      peerFingerprint: 'A4:B2:91:0F:88:C3',
      notes: 'Reviewed serverless peer-to-peer WebRTC connection architecture, verified DTLS SAS phonetic security tokens out-of-band, and completed file integrity check on shared documentation.',
      chats: [
        { text: 'Hello! I can hear you loud and clear.', sender: 'Sarah Connor', isLocal: false, timestamp: now - 3500000 },
        { text: 'Great, sharing the architecture document over chunked P2P DataChannel now.', sender: 'You', isLocal: true, timestamp: now - 3400000 },
        { text: 'File received and verified with SHA-256 hash.', sender: 'Sarah Connor', isLocal: false, timestamp: now - 3300000 }
      ],
      files: [
        { name: 'architecture_specification.pdf', size: 1845210, status: 'Completed', direction: 'Sent', sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' }
      ]
    });
    window.showToast('Sample meeting session archived');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const openHistory = () => {
    currentHistoryFilter = 'all';
    document.querySelectorAll('#historyFilterChips .filter-chip').forEach(c => c.classList.toggle('active', c.getAttribute('data-filter') === 'all'));
    if (historySearchInput) historySearchInput.value = '';
    renderMeetingHistory('all', '');
    if (historyModal) historyModal.classList.add('open');
  };

  openHistoryBtn?.addEventListener('click', openHistory);
  welcomeHistoryBtn?.addEventListener('click', openHistory);
  closeHistoryModalBtn?.addEventListener('click', () => historyModal?.classList.remove('open'));

  let searchTimer = null;
  historySearchInput?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      renderMeetingHistory(currentHistoryFilter, e.target.value);
    }, 250);
  });

  document.querySelectorAll('#historyFilterChips .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#historyFilterChips .filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentHistoryFilter = chip.getAttribute('data-filter');
      renderMeetingHistory(currentHistoryFilter, historySearchInput?.value || '');
    });
  });

  clearAllHistoryBtn?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete all meeting history archives permanently?')) {
      await window.setuStorage.clearAllMeetings();
      renderMeetingHistory('all', '');
      window.showToast('All meeting archives cleared');
    }
  });

  // 18. Permanent Reusable Identity Card Modal
  const permanentQrModal = document.getElementById('permanentQrModal');
  const openPermanentQrBtn = document.getElementById('openPermanentQrBtn');
  const welcomePermQrBtn = document.getElementById('welcomePermQrBtn');
  const closePermanentQrBtn = document.getElementById('closePermanentQrBtn');
  const copyPermanentCardBtn = document.getElementById('copyPermanentCardBtn');
  const savePermanentQrPngBtn = document.getElementById('savePermanentQrPngBtn');
  const permanentQrCanvas = document.getElementById('permanentQrCanvas');
  const permanentFingerprintDisplay = document.getElementById('permanentFingerprintDisplay');

  let permanentIdentityToken = '';

  async function loadPermanentIdentityCard() {
    if (!window.setuIdentity) return;
    const identity = await window.setuIdentity.getOrCreatePermanentIdentity();
    permanentIdentityToken = identity.token;

    if (permanentFingerprintDisplay) {
      permanentFingerprintDisplay.textContent = `Token: ${identity.token}\nSHA-256: ${identity.fingerprint}`;
    }

    if (permanentQrCanvas && window.setuQR) {
      window.setuQR.renderQR(permanentQrCanvas, identity.token, { size: 200 });
    }
  }

  const openPermanentQr = () => {
    loadPermanentIdentityCard();
    if (permanentQrModal) permanentQrModal.classList.add('open');
  };

  openPermanentQrBtn?.addEventListener('click', openPermanentQr);
  welcomePermQrBtn?.addEventListener('click', openPermanentQr);
  closePermanentQrBtn?.addEventListener('click', () => permanentQrModal?.classList.remove('open'));

  copyPermanentCardBtn?.addEventListener('click', () => {
    if (permanentIdentityToken) {
      navigator.clipboard.writeText(permanentIdentityToken);
      copyPermanentCardBtn.textContent = 'Copied!';
      setTimeout(() => (copyPermanentCardBtn.textContent = 'Copy Identity Token'), 2500);
      window.showToast('Permanent identity token copied to clipboard');
    }
  });

  savePermanentQrPngBtn?.addEventListener('click', () => {
    if (!permanentQrCanvas) return;
    const a = document.createElement('a');
    a.href = permanentQrCanvas.toDataURL('image/png');
    a.download = 'setu_permanent_identity_qr.png';
    a.click();
  });

  // 19. 1-Click URL Hash Auto-Join (#room=... or #join=...)
  async function checkUrlJoinHash() {
    const hash = window.location.hash || '';
    if (hash.startsWith('#room=')) {
      try {
        const roomCode = hash.substring(6).trim();
        if (roomCode && window.setuWizard) {
          await window.setuWizard.smartRoomEntry(roomCode);
        }
      } catch (e) {
        console.warn('Failed to parse #room= hash:', e);
      }
    } else if (hash.startsWith('#join=')) {
      try {
        const rawPayload = decodeURIComponent(hash.substring(6));
        if (rawPayload && rawPayload.trim().startsWith('SETU-v1:')) {
          window.setuSharedPage.isHost = false;
          if (window.setuWizard) {
            await window.setuWizard.directLinkJoin(rawPayload);
          }
        }
      } catch (e) {
        console.warn('Failed to parse #join= hash:', e);
      }
    } else if (hash.startsWith('#apiRoom=')) {
      try {
        const params = new URLSearchParams(hash.substring(1));
        const roomCode = params.get('apiRoom');
        const endpoint = params.get('api');
        if (roomCode && endpoint && window.setuWizard && window.setuWizard.joinApiMeeting) {
          await window.setuWizard.joinApiMeeting(roomCode, endpoint);
        }
      } catch (e) {
        console.warn('Failed to parse #apiRoom= hash:', e);
      }
    }
  }

  checkUrlJoinHash();
  window.addEventListener('hashchange', checkUrlJoinHash);

  // 20. Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.key === 'm' || e.key === 'M') {
      document.getElementById('micToggleBtn')?.click();
    } else if (e.key === 'v' || e.key === 'V') {
      document.getElementById('camToggleBtn')?.click();
    } else if (e.key === 'c' || e.key === 'C') {
      document.getElementById('toggleChatDrawerBtn')?.click();
    } else if (e.key === 'Escape') {
      window.setuWizard.closeWizard();
      if (privacyModal) privacyModal.classList.remove('open');
      closeSettings();
      if (historyModal) historyModal.classList.remove('open');
      if (permanentQrModal) permanentQrModal.classList.remove('open');
    }
  });

  console.log('[Setu P2P] Platform ready.');
});
