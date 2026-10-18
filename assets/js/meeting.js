/**
 * Setu P2P - Meeting Room Controller
 * Coordinates audio/video media controls, Spacebar push-to-talk & toggle,
 * Main Screen presentation mode with separate participant strip,
 * hardware camera release, device switching mid-call, and connected people list.
 */

class MeetingController {
  constructor() {
    this.timerInterval = null;
    this.meetingStartTime = null;
    this.durationLimitSec = 3600;
    this._meetingArchived = false;

    this.isPresentationActive = false;
    this.isLocalPresenting = false;

    this.remoteMediaState = {
      audio: true,
      video: true
    };

    this.spacePressTime = 0;
    this.wasMutedBeforeSpace = false;

    this.remotePeerName = 'Remote Peer';
    this.remotePeerAvatar = null;
    this.localDisplayName = 'You';
  }

  init() {
    this.bindControls();
    this.bindSpacebarPushToTalk();
    this.setupNotesAutosave();
    this.bindScreenShareHooks();
    this.bindRemoteStreamHooks();
  }

  bindRemoteStreamHooks() {
    if (!window.setuWebRTC) return;

    window.setuWebRTC.onRemoteStream = (stream) => {
      console.log('[MeetingUI] onRemoteStream received!', stream);
      this.syncParticipantTiles();
    };

    window.setuWebRTC.onRemoteScreenStream = (screenStream) => {
      console.log('[MeetingUI] onRemoteScreenStream received:', screenStream);
      if (this.isPresentationActive && !this.isLocalPresenting) {
        const presVideo = document.getElementById('presentationVideo');
        if (presVideo && screenStream) {
          presVideo.srcObject = screenStream;
          presVideo.muted = true;
          presVideo.play().catch(async () => {
            try { await presVideo.play(); } catch (_) {}
          });
        }
      }
    };
  }

  enterMeeting() {
    document.getElementById('welcomeSection')?.classList.remove('active');
    document.getElementById('meetingSection')?.classList.add('active');

    // Fresh session slate: every new meeting records new files and messages only for this meeting
    this.resetMeetingSession();
    this.meetingStartTime = Date.now();
    this._meetingArchived = false;

    // Ensure presentation mode starts clean (no ghost presentation on join)
    this.isPresentationActive = false;
    this.isLocalPresenting = false;
    this.clearPresentationStage();

    this.bindRemoteStreamHooks();

    const remoteVideo = document.getElementById('remoteVideo');
    const localVideo = document.getElementById('localVideo');

    if (window.setuWebRTC) {
      if (window.setuWebRTC.localStream && localVideo) {
        if (localVideo.srcObject !== window.setuWebRTC.localStream) {
          localVideo.srcObject = window.setuWebRTC.localStream;
        }
        localVideo.play().catch(e => console.warn('localVideo play error:', e));
      }
      // Sync button visual states and media tiles based on user settings
      this.syncButtonStates();
      this.syncParticipantTiles();
    }

    this.loadLocalDisplayName();
    this.updatePeopleList();

    // Check if peer is already connected (e.g. re-entry)
    const isConn = window.setuWebRTC && window.setuWebRTC.pc && window.setuWebRTC.pc.connectionState === 'connected';
    if (isConn) {
      this.onPeerConnected();
    } else {
      this.isPeerConnected = false;
      this.setMeetingWaitingState();
    }

    // Bind state listener so timer starts ONLY when both peers connect!
    if (window.setuWebRTC) {
      const prevHandler = window.setuWebRTC.onStateChange;
      window.setuWebRTC.onStateChange = (state) => {
        if (prevHandler) prevHandler(state);
        if (state === 'connected') {
          this.onPeerConnected();
        } else if (state === 'failed') {
          this.setMeetingFailedState('NAT/Firewall');
        } else if (state === 'disconnected') {
          this.setMeetingWaitingState();
        }
      };
    }
  }

  setMeetingWaitingState() {
    this.isPeerConnected = false;
    const statusDot = document.getElementById('connStatusDot');
    const statusText = document.getElementById('connStatusText');
    const timerDisplay = document.getElementById('meetingTimerDisplay');

    if (statusDot) statusDot.className = 'status-dot status-away';
    if (statusText) statusText.textContent = 'Waiting for peer...';
    if (timerDisplay) timerDisplay.textContent = '00:00';
    this.stopMeetingTimer();
  }

  setMeetingFailedState(reason = 'NAT/Firewall') {
    this.isPeerConnected = false;
    const statusDot = document.getElementById('connStatusDot');
    const statusText = document.getElementById('connStatusText');
    if (statusDot) statusDot.className = 'status-dot status-busy';
    if (statusText) statusText.textContent = `Connection failed (${reason})`;
    this.stopMeetingTimer();
  }

  onPeerConnected() {
    this.isPeerConnected = true;

    const statusDot = document.getElementById('connStatusDot');
    const statusText = document.getElementById('connStatusText');
    if (statusDot) statusDot.className = 'status-dot status-available';
    if (statusText) statusText.textContent = 'Connected';

    // Meeting timer officially starts ticking up from 00:00 only now!
    this.startMeetingTimer();

    // Ensure remote and local tiles are synchronized and actively playing
    this.syncParticipantTiles();

    // Hide in-meeting invite card and join reply pill
    const inviteCard = document.getElementById('inMeetingInviteCard');
    const replyPill = document.getElementById('directJoinReplyPill');
    const invitePill = document.getElementById('inMeetingInvitePill');

    if (inviteCard) inviteCard.style.display = 'none';
    if (replyPill) replyPill.style.display = 'none';
    if (invitePill) invitePill.style.display = 'none';

    if (window.setuDiagnostics) window.setuDiagnostics.start();
    if (window.showToast) window.showToast('Participant connected! Call timer started.');
  }

  setupInMeetingInvite(payload, link, roomCode = '') {
    this.generatedInvitePayload = payload;
    this.generatedInviteLink = link;
    this.activeRoomCode = roomCode;

    const inviteCard = document.getElementById('inMeetingInviteCard');
    const linkInput = document.getElementById('inMeetingInviteLinkInput');
    const copyLinkBtn = document.getElementById('inMeetingCopyLinkBtn');
    const copyCodeBtn = document.getElementById('inMeetingCopyCodeBtn');
    const copyRoomCodeBtn = document.getElementById('inMeetingCopyRoomCodeBtn');
    const roomCodeText = document.getElementById('inMeetingRoomCodeText');
    const toggleQrBtn = document.getElementById('inMeetingToggleQrBtn');
    const closeCardBtn = document.getElementById('closeInviteCardBtn');
    const invitePill = document.getElementById('inMeetingInvitePill');
    const replyInput = document.getElementById('inMeetingReplyInput');
    const applyReplyBtn = document.getElementById('inMeetingApplyReplyBtn');

    if (roomCodeText && roomCode) {
      roomCodeText.textContent = roomCode;
    }

    if (linkInput) linkInput.value = link;

    if (inviteCard && !this.isPeerConnected) {
      inviteCard.style.display = 'flex';
    }

    if (closeCardBtn) {
      closeCardBtn.onclick = () => {
        if (inviteCard) inviteCard.style.display = 'none';
        if (invitePill && !this.isPeerConnected) invitePill.style.display = 'inline-flex';
      };
    }

    if (invitePill) {
      invitePill.onclick = () => {
        if (inviteCard) inviteCard.style.display = 'flex';
        if (invitePill) invitePill.style.display = 'none';
      };
    }

    if (copyRoomCodeBtn && roomCode) {
      copyRoomCodeBtn.onclick = () => {
        navigator.clipboard.writeText(roomCode);
        const span = copyRoomCodeBtn.querySelector('span');
        if (span) {
          span.textContent = 'Copied!';
          setTimeout(() => { span.textContent = 'Copy Code'; }, 2500);
        }
        if (window.showToast) window.showToast('Meeting room code ' + roomCode + ' copied to clipboard');
      };
    }

    if (copyLinkBtn) {
      copyLinkBtn.onclick = () => {
        navigator.clipboard.writeText(link);
        const textSpan = copyLinkBtn.querySelector('span');
        if (textSpan) {
          textSpan.textContent = 'Copied!';
          setTimeout(() => { textSpan.textContent = 'Copy Link'; }, 2500);
        }
        if (window.showToast) window.showToast('Meeting link copied to clipboard');
      };
    }

    if (copyCodeBtn) {
      copyCodeBtn.onclick = () => {
        navigator.clipboard.writeText(payload);
        copyCodeBtn.textContent = 'Copied!';
        setTimeout(() => { copyCodeBtn.textContent = 'Copy Code'; }, 2500);
        if (window.showToast) window.showToast('Connection code copied to clipboard');
      };
    }

    if (toggleQrBtn) {
      toggleQrBtn.onclick = () => {
        const qrBox = document.getElementById('inMeetingQrBox');
        const qrCanvas = document.getElementById('inMeetingQrCanvas');
        if (qrBox) {
          const isOpening = qrBox.style.display === 'none';
          qrBox.style.display = isOpening ? 'flex' : 'none';
          toggleQrBtn.textContent = isOpening ? 'Hide QR' : 'Show QR';
          if (isOpening) {
            if (qrCanvas && window.setuQR) {
              window.setuQR.renderQR(qrCanvas, link);
            }
            setTimeout(() => {
              if (inviteCard) inviteCard.scrollTo({ top: inviteCard.scrollHeight, behavior: 'smooth' });
            }, 60);
          }
        }
      };
    }

    const offlineDetails = document.getElementById('inMeetingOfflineDetails');
    if (offlineDetails && !offlineDetails._scrollBound) {
      offlineDetails._scrollBound = true;
      offlineDetails.addEventListener('toggle', () => {
        if (offlineDetails.open && inviteCard) {
          setTimeout(() => {
            inviteCard.scrollTo({ top: inviteCard.scrollHeight, behavior: 'smooth' });
          }, 60);
        }
      });
    }

    // Connect participant reply (Serverless P2P exchange)
    const handleConnectReply = async () => {
      const code = replyInput ? replyInput.value.trim() : '';
      if (!code) {
        if (window.showToast) window.showToast('Please paste the participant reply code');
        return;
      }
      const validation = window.setuSignaling.unpackSessionDescription(code);
      if (!validation.valid || validation.type !== 'answer') {
        if (window.showToast) window.showToast('Invalid reply code format');
        return;
      }
      try {
        if (applyReplyBtn) applyReplyBtn.textContent = 'Connecting...';
        await window.setuWebRTC.applyAnswer(validation.sdp);
        if (applyReplyBtn) applyReplyBtn.textContent = 'Connected!';
        if (window.showToast) window.showToast('Reply applied! Establishing peer session...');
      } catch (err) {
        if (applyReplyBtn) applyReplyBtn.textContent = 'Connect';
        if (window.showToast) window.showToast('Connection error: ' + err.message);
      }
    };

    if (applyReplyBtn) {
      applyReplyBtn.onclick = handleConnectReply;
    }
    if (replyInput) {
      replyInput.onkeydown = (e) => {
        if (e.key === 'Enter') handleConnectReply();
      };
    }
  }

  setRemotePeerName(name) {
    if (!name || !name.trim()) return;
    this.remotePeerName = name.trim();
    const badge = document.getElementById('remotePeerNameBadge');
    if (badge) {
      badge.textContent = this.isPresentationActive && !this.isLocalPresenting
        ? `${this.remotePeerName} (Presenting)`
        : this.remotePeerName;
    }
    this.updatePeopleList();
  }

  setRemotePeerAvatar(avatarUrl) {
    this.remotePeerAvatar = avatarUrl;
    const avatarPlaceholder = document.getElementById('remoteAvatarPlaceholder');
    if (avatarPlaceholder && avatarUrl) {
      avatarPlaceholder.innerHTML = `<img src="${avatarUrl}" alt="${this.remotePeerName}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; box-shadow: 0 4px 12px rgba(0,0,0,0.4);"><div style="font-weight: 600; font-size: 0.95rem; color: var(--text-secondary); margin-top: 0.5rem;">Camera is off</div>`;
    }
    this.updatePeopleList();
  }

  async loadLocalDisplayName() {
    if (window.setuStorage) {
      try {
        const p = await window.setuStorage.getUserProfile();
        if (p && p.displayName) {
          this.localDisplayName = p.displayName.trim();
          this.updatePeopleList();
        }
      } catch (e) {}
    }
  }

  syncButtonStates() {
    if (!window.setuWebRTC) return;
    this.updateMicButton(window.setuWebRTC.isAudioMuted);
    this.updateCamButton(window.setuWebRTC.isVideoMuted);
    this.updateLocalVideoDisplay(!window.setuWebRTC.isVideoMuted);
    this.updatePeopleList();
  }

  updateMicButton(isMuted) {
    const micWrapper = document.getElementById('micToggleBtn');
    if (!micWrapper) return;

    micWrapper.classList.toggle('off', isMuted);
    const mainBtn = micWrapper.querySelector('.split-main-btn');

    if (mainBtn) {
      if (isMuted) {
        mainBtn.title = 'Unmute microphone (Spacebar to speak)';
        mainBtn.setAttribute('aria-label', 'Unmute microphone');
        // Slashed microphone SVG icon
        mainBtn.innerHTML = `
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="1" y1="1" x2="23" y2="23"></line>
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        `;
      } else {
        mainBtn.title = 'Mute microphone (M or Spacebar)';
        mainBtn.setAttribute('aria-label', 'Mute microphone');
        // Normal microphone SVG icon
        mainBtn.innerHTML = `
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        `;
      }
    }
  }

  updateCamButton(isOff) {
    const camWrapper = document.getElementById('camToggleBtn');
    if (!camWrapper) return;

    camWrapper.classList.toggle('off', isOff);
    const mainBtn = camWrapper.querySelector('.split-main-btn');

    if (mainBtn) {
      if (isOff) {
        mainBtn.title = 'Start camera (V)';
        mainBtn.setAttribute('aria-label', 'Start camera');
        // Slashed video camera SVG icon
        mainBtn.innerHTML = `
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="1" y1="1" x2="23" y2="23"></line>
            <path d="M21 21l-3.34-3.34M23 7l-7 5 7 5V7z"></path>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
        `;
      } else {
        mainBtn.title = 'Stop camera (V)';
        mainBtn.setAttribute('aria-label', 'Stop camera');
        // Normal video camera SVG icon
        mainBtn.innerHTML = `
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
        `;
      }
    }

    this.updateLocalVideoDisplay(!isOff);
  }

  async leaveMeeting(isRemoteTriggered = false) {
    if (!isRemoteTriggered) {
      // Broadcast meeting-ended packet across control channel so peer call ends simultaneously
      if (window.setuWebRTC) {
        try {
          window.setuWebRTC.sendData('control', JSON.stringify({
            type: 'meeting-ended',
            reason: 'user-left',
            timestamp: Date.now()
          }));
        } catch (e) {
          console.warn('[Meeting] Could not broadcast meeting-ended packet:', e);
        }
      }
    }

    // 1. Safe archive to IndexedDB (captures only this meeting's files, messages, and notes)
    try {
      await this.saveCurrentMeetingToArchive();
    } catch (e) {
      console.warn('[Meeting] Could not archive meeting session:', e);
    }

    // Reset meeting session data so no files, messages, or notes bleed into future meetings
    this.resetMeetingSession();

    // 2. Stop meeting timer and diagnostics
    try {
      this.stopMeetingTimer();
    } catch (e) {}

    try {
      if (window.setuDiagnostics) window.setuDiagnostics.stop();
    } catch (e) {}

    // 3. Stop recording if active
    try {
      if (window.setuRecorder && window.setuRecorder.isRecording) {
        window.setuRecorder.stopRecording();
      }
    } catch (e) {}

    // 4. Close WebRTC peer connection and streams
    try {
      if (window.setuWebRTC) {
        window.setuWebRTC.close();
      }
    } catch (e) {}

    // 5. Clear presentation stage
    try {
      this.clearPresentationStage();
    } catch (e) {}

    // 6. Detach media from all meeting video elements
    const vids = ['localVideo', 'remoteVideo', 'presentationVideo', 'localScreenSharePreview'];
    vids.forEach(id => {
      const v = document.getElementById(id);
      if (v) {
        try {
          v.pause();
          v.srcObject = null;
        } catch (e) {}
      }
    });

    // 7. Close all open side drawers
    const drawers = ['peopleDrawer', 'chatDrawer', 'fileDrawer', 'whiteboardDrawer', 'diagnosticsDrawer', 'notesDrawer'];
    drawers.forEach(id => {
      const d = document.getElementById(id);
      if (d) d.classList.remove('open');
    });

    // Reset in-meeting invite card and connection flags
    this.isPeerConnected = false;
    const inviteCard = document.getElementById('inMeetingInviteCard');
    const replyPill = document.getElementById('directJoinReplyPill');
    const invitePill = document.getElementById('inMeetingInvitePill');
    if (inviteCard) inviteCard.style.display = 'none';
    if (replyPill) replyPill.style.display = 'none';
    if (invitePill) invitePill.style.display = 'none';

    // Ephemeral room cleanup: remove retained offer from broker so code is clean for reuse
    if (window.setuRoomSignaling) {
      try {
        if (this.activeRoomCode) {
          window.setuRoomSignaling.cleanupRoom(this.activeRoomCode);
        }
        window.setuRoomSignaling.disconnect();
      } catch (e) {
        console.warn('[Meeting] Room signaling cleanup warning:', e);
      }
    }

    // 8. Always guarantee UI switch back to welcome panel
    try {
      document.getElementById('meetingSection')?.classList.remove('active');
      document.getElementById('welcomeSection')?.classList.add('active');
    } catch (e) {
      console.error('[Meeting] Critical UI switch error:', e);
    }

    // 9. Re-render saved contacts chips on welcome screen if available
    if (window.renderSavedContactsChips) {
      try { window.renderSavedContactsChips(); } catch (e) {}
    }

    if (isRemoteTriggered) {
      if (window.showToast) window.showToast('The call was ended by the other participant');
    } else {
      if (window.showToast) window.showToast('Meeting ended');
    }
  }

  handleRemoteMeetingEnded() {
    this.leaveMeeting(true);
  }

  async saveCurrentMeetingToArchive() {
    if (!window.setuStorage) return null;
    if (!this.meetingStartTime || this._meetingArchived) {
      return null;
    }
    this._meetingArchived = true;

    const durationSec = Math.max(1, Math.floor((Date.now() - this.meetingStartTime) / 1000));
    const mins = String(Math.floor(durationSec / 60)).padStart(2, '0');
    const secs = String(durationSec % 60).padStart(2, '0');

    const notesEl = document.getElementById('meetingNotesText');
    const notes = notesEl ? notesEl.value.trim() : '';

    let chats = [];
    if (window.setuChat) {
      if (Array.isArray(window.setuChat.sessionMessages)) {
        chats = [...window.setuChat.sessionMessages];
      } else if (Array.isArray(window.setuChat.messages)) {
        chats = [...window.setuChat.messages];
      }
    }

    const files = (window.setuFileTransfer && window.setuFileTransfer.transfers && typeof window.setuFileTransfer.transfers.values === 'function')
      ? Array.from(window.setuFileTransfer.transfers.values()).map(t => ({
          name: t.name || 'unnamed',
          size: t.size || 0,
          status: t.status || 'Completed',
          direction: t.direction || 'Transferred',
          sha256: t.sha256 || ''
        }))
      : [];

    let peerName = this.remotePeerName;
    if (!peerName) {
      const badge = document.getElementById('remotePeerNameBadge');
      if (badge && badge.textContent && badge.textContent.trim()) {
        peerName = badge.textContent.trim();
      }
    }
    if (!peerName || peerName === 'Remote Peer') peerName = 'Direct P2P Call';

    const record = {
      id: 'meet_' + this.meetingStartTime,
      timestamp: this.meetingStartTime,
      durationSec,
      durationFormatted: `${mins}:${secs}`,
      peerName,
      notes,
      chats,
      files
    };

    try {
      await window.setuStorage.saveMeeting(record);
      console.log('[Meeting] Session archived successfully:', record.id, {
        messagesRecorded: chats.length,
        filesRecorded: files.length
      });
      return record;
    } catch (e) {
      console.warn('Could not archive meeting session:', e);
      return null;
    }
  }

  resetMeetingSession() {
    this.meetingStartTime = null;
    this.remotePeerName = null;
    this.isPeerConnected = false;
    this.isPresentationActive = false;
    this.isLocalPresenting = false;
    this._meetingArchived = false;

    // Reset meeting notes
    const notesEl = document.getElementById('meetingNotesText');
    if (notesEl) notesEl.value = '';

    // Reset shared whiteboard & notepad
    const notepadEl = document.getElementById('sharedNotepadText');
    if (notepadEl) notepadEl.value = '';
    if (window.setuSharedPage && typeof window.setuSharedPage.clearCanvas === 'function') {
      window.setuSharedPage.clearCanvas(false);
    }

    // Reset in-meeting chat session (clears chat container and session message array)
    if (window.setuChat && typeof window.setuChat.resetMeetingSession === 'function') {
      window.setuChat.resetMeetingSession();
    }

    // Reset in-meeting file transfers (clears transfer Map and UI list)
    if (window.setuFileTransfer && typeof window.setuFileTransfer.resetMeetingSession === 'function') {
      window.setuFileTransfer.resetMeetingSession();
    }

    // Reset status indicators
    const statusDot = document.getElementById('connStatusDot');
    const statusText = document.getElementById('connStatusText');
    const timerDisplay = document.getElementById('meetingTimerDisplay');
    if (statusDot) statusDot.className = 'status-dot status-away';
    if (statusText) statusText.textContent = 'Waiting for peer...';
    if (timerDisplay) timerDisplay.textContent = '00:00';
  }

  bindControls() {
    // 0. Auto-archive meeting session on tab close or page navigation
    window.addEventListener('beforeunload', () => {
      if (this.meetingStartTime) {
        this.saveCurrentMeetingToArchive();
      }
    });
    window.addEventListener('pagehide', () => {
      if (this.meetingStartTime) {
        this.saveCurrentMeetingToArchive();
      }
    });

    // 1. Mic Toggle
    const micBtn = document.getElementById('micToggleBtn');
    if (micBtn) {
      micBtn.addEventListener('click', (e) => {
        if (e.target.closest('.device-menu-btn')) return;

        const nextMute = !window.setuWebRTC.isAudioMuted;
        window.setuWebRTC.setAudioMute(nextMute);
        this.updateMicButton(nextMute);
        this.updatePeopleList();
        if (window.showToast) window.showToast(nextMute ? 'Microphone muted' : 'Microphone unmuted');
      });
    }

    // 2. Camera Toggle
    const camBtn = document.getElementById('camToggleBtn');
    if (camBtn) {
      camBtn.addEventListener('click', async (e) => {
        if (e.target.closest('.device-menu-btn')) return;

        const nextOff = !window.setuWebRTC.isVideoMuted;
        await window.setuWebRTC.setVideoMute(nextOff);
        this.updateCamButton(nextOff);
        this.updatePeopleList();

        const localVideo = document.getElementById('localVideo');
        if (localVideo && window.setuWebRTC.localStream) {
          localVideo.srcObject = window.setuWebRTC.localStream;
        }

        if (window.showToast) window.showToast(nextOff ? 'Camera turned off' : 'Camera turned on');
      });
    }

    // 3. Screen Share Toggle
    const screenBtn = document.getElementById('screenShareBtn');
    if (screenBtn) {
      screenBtn.addEventListener('click', async () => {
        if (!window.setuWebRTC.screenStream) {
          try {
            await window.setuWebRTC.startScreenShare();
          } catch (e) {
            console.error('Screen share error:', e);
          }
        } else {
          await window.setuWebRTC.stopScreenShare();
        }
      });
    }

    // Stop presentation banner button
    const stopPresentBtn = document.getElementById('stopPresentationBannerBtn');
    if (stopPresentBtn) {
      stopPresentBtn.addEventListener('click', () => {
        window.setuWebRTC.stopScreenShare();
      });
    }

    // 4. Raise Hand Toggle
    const handBtn = document.getElementById('raiseHandBtn');
    if (handBtn) {
      handBtn.addEventListener('click', () => {
        this.isHandRaised = !this.isHandRaised;
        handBtn.classList.toggle('active', this.isHandRaised);

        const packet = JSON.stringify({
          type: 'raise-hand',
          raised: this.isHandRaised
        });
        window.setuWebRTC.sendData('control', packet);
        if (window.showToast) {
          window.showToast(this.isHandRaised ? 'You raised your hand' : 'Hand lowered');
        }
      });
    }

    // 5. Reactions Action Menu
    const reactionsBtn = document.getElementById('reactionsMenuBtn');
    const reactionsBar = document.getElementById('reactionsPopupBar');
    if (reactionsBtn && reactionsBar) {
      reactionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        reactionsBar.classList.toggle('open');
      });
      window.addEventListener('click', () => reactionsBar.classList.remove('open'));
    }

    const reactionButtons = document.querySelectorAll('.reaction-item');
    reactionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-emoji');
        this.sendReaction(emoji);
        if (reactionsBar) reactionsBar.classList.remove('open');
      });
    });

    // 6. Device Switching Popup Menus
    this.setupDeviceMenus();

    // 7. Leave Call
    const leaveBtn = document.getElementById('leaveCallBtn');
    if (leaveBtn) leaveBtn.addEventListener('click', () => this.leaveMeeting());

    // 8. Drawer Toggles
    this.setupDrawerToggles();
  }

  /**
   * Spacebar Push-to-Talk & Quick Toggle
   */
  bindSpacebarPushToTalk() {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
      e.preventDefault();
      if (e.repeat) return;

      this.spacePressTime = Date.now();
      this.wasMutedBeforeSpace = window.setuWebRTC ? window.setuWebRTC.isAudioMuted : false;

      // If currently muted, temporarily unmute on hold
      if (this.wasMutedBeforeSpace && window.setuWebRTC) {
        window.setuWebRTC.setAudioMute(false);
        this.updateMicButton(false);
        this.updatePeopleList();
        if (window.showToast) window.showToast('Microphone unmuted (Holding Spacebar)...');
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space') return;
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
      e.preventDefault();

      if (!window.setuWebRTC) return;
      const duration = Date.now() - this.spacePressTime;

      if (duration > 300) {
        // Spacebar was held as push-to-talk: restore muted state
        if (this.wasMutedBeforeSpace) {
          window.setuWebRTC.setAudioMute(true);
          this.updateMicButton(true);
          this.updatePeopleList();
          if (window.showToast) window.showToast('Microphone muted');
        }
      } else {
        // Spacebar was quickly tapped: toggle mute state
        const willMute = !this.wasMutedBeforeSpace;
        window.setuWebRTC.setAudioMute(willMute);
        this.updateMicButton(willMute);
        this.updatePeopleList();
        if (window.showToast) window.showToast(willMute ? 'Microphone muted' : 'Microphone unmuted');
      }
    });
  }

  syncParticipantTiles() {
    const remoteVideo = document.getElementById('remoteVideo');
    const remoteAvatar = document.getElementById('remoteAvatarPlaceholder');
    const localVideo = document.getElementById('localVideo');
    const localAvatar = document.getElementById('localCamOffPlaceholder');

    // 1. Sync Remote Participant Tile
    const remoteCam = window.setuWebRTC?.getRemoteCameraStream ? window.setuWebRTC.getRemoteCameraStream() : window.setuWebRTC?.remoteStream;
    if (remoteVideo && remoteCam) {
      if (remoteVideo.srcObject !== remoteCam) {
        remoteVideo.srcObject = remoteCam;
      }
      remoteVideo.play().catch(() => {});
    }

    const hasRemoteLiveCam = this.remoteMediaState.video && remoteCam && remoteCam.getVideoTracks().some(t => t.readyState === 'live' && t.enabled);
    if (remoteVideo) remoteVideo.style.display = hasRemoteLiveCam ? 'block' : 'none';
    if (remoteAvatar) remoteAvatar.style.display = hasRemoteLiveCam ? 'none' : 'flex';

    // 2. Sync Local Participant Tile
    const hasLocalLiveCam = window.setuWebRTC && !window.setuWebRTC.isVideoMuted && window.setuWebRTC.localStream && window.setuWebRTC.localStream.getVideoTracks().some(t => t.readyState === 'live' && t.enabled);
    if (localVideo) {
      if (window.setuWebRTC?.localStream && localVideo.srcObject !== window.setuWebRTC.localStream) {
        localVideo.srcObject = window.setuWebRTC.localStream;
      }
      localVideo.play().catch(() => {});
      localVideo.style.display = hasLocalLiveCam ? 'block' : 'none';
    }
    if (localAvatar) localAvatar.style.display = hasLocalLiveCam ? 'none' : 'flex';
  }

  updateLocalVideoDisplay(isVideoOn) {
    this.syncParticipantTiles();
  }

  handleRemoteMediaState(audioEnabled, videoEnabled) {
    this.remoteMediaState.audio = audioEnabled;
    this.remoteMediaState.video = videoEnabled;

    this.syncParticipantTiles();

    const remoteMuteBadge = document.getElementById('remoteMutedBadge');
    if (remoteMuteBadge) {
      remoteMuteBadge.style.display = audioEnabled ? 'none' : 'inline-flex';
    }

    this.updatePeopleList();
  }

  /**
   * Screen Sharing: Puts the presentation on the Main Stage and arrays participants in a separate strip.
   */
  bindScreenShareHooks() {
    window.setuWebRTC.onScreenShareStarted = (screenStream) => {
      this.isPresentationActive = true;
      this.isLocalPresenting = true;
      this.renderPresentationStage(screenStream, 'You are presenting to everyone');

      const banner = document.getElementById('presentationBanner');
      if (banner) banner.classList.add('active');

      const screenBtn = document.getElementById('screenShareBtn');
      if (screenBtn) screenBtn.classList.add('active');

      this.updatePeopleList();
    };

    window.setuWebRTC.onScreenShareStopped = () => {
      this.isPresentationActive = false;
      this.isLocalPresenting = false;
      this.clearPresentationStage();

      const banner = document.getElementById('presentationBanner');
      if (banner) banner.classList.remove('active');

      const screenBtn = document.getElementById('screenShareBtn');
      if (screenBtn) screenBtn.classList.remove('active');
      this.updatePeopleList();
    };

    window.setuWebRTC.onRemoteScreenStream = (screenStream) => {
      console.log('[MeetingUI] onRemoteScreenStream received:', screenStream);
      if (this.isPresentationActive && !this.isLocalPresenting) {
        const presVideo = document.getElementById('presentationVideo');
        if (presVideo && screenStream) {
          if (presVideo.srcObject !== screenStream) {
            presVideo.srcObject = screenStream;
          }
          presVideo.muted = true;
          presVideo.play().catch(async () => {
            try { await presVideo.play(); } catch (_) {}
          });
        }
      }
    };

    // Presentation Expansion & Viewport Controls (Expand, Fullscreen, Fit, Double-Click)
    const expandBtn = document.getElementById('expandPresentationBtn');
    const fullscreenBtn = document.getElementById('fullscreenPresentationBtn');
    const fitBtn = document.getElementById('fitPresentationBtn');
    const presVideo = document.getElementById('presentationVideo');
    const presBox = document.getElementById('mainPresentationBox');
    const stage = document.getElementById('videoStage');
    const expandText = document.getElementById('expandPresentationText');
    const expandIcon = document.getElementById('expandPresentationIcon');
    const fullscreenText = document.getElementById('fullscreenPresentationText');

    if (expandBtn && stage) {
      expandBtn.onclick = (e) => {
        e.stopPropagation();
        const isExpanded = stage.classList.toggle('presentation-expanded');
        if (expandText) {
          expandText.textContent = isExpanded ? 'Restore' : 'Expand';
        }
        if (expandIcon) {
          expandIcon.innerHTML = isExpanded
            ? `<polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line>`
            : `<polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line>`;
        }
        if (window.showToast) {
          window.showToast(isExpanded ? 'Shared screen expanded to full width' : 'Restored participants side view');
        }
      };
    }

    if (fullscreenBtn && presBox) {
      fullscreenBtn.onclick = (e) => {
        e.stopPropagation();
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          presBox.requestFullscreen().catch((err) => {
            console.warn('Fullscreen request failed:', err);
            if (expandBtn) expandBtn.click();
          });
        }
      };

      document.addEventListener('fullscreenchange', () => {
        const isFs = !!document.fullscreenElement;
        if (fullscreenText) {
          fullscreenText.textContent = isFs ? 'Exit' : 'Fullscreen';
        }
      });
    }

    if (fitBtn && presVideo) {
      fitBtn.onclick = (e) => {
        e.stopPropagation();
        const fitText = document.getElementById('fitPresentationText');
        const isCover = presVideo.style.objectFit === 'cover';
        presVideo.style.objectFit = isCover ? 'contain' : 'cover';
        if (fitText) {
          fitText.textContent = isCover ? 'Fit' : 'Fill';
        }
        if (window.showToast) {
          window.showToast(isCover ? 'Aspect ratio: Fit to screen' : 'Aspect ratio: Fill canvas');
        }
      };
    }

    if (presVideo) {
      presVideo.ondblclick = (e) => {
        e.stopPropagation();
        if (fullscreenBtn) fullscreenBtn.click();
      };
    }
  }

  /**
   * Called when remote peer indicates they started or stopped sharing screen.
   */
  handleRemoteScreenShare(active) {
    if (active) {
      this.isPresentationActive = true;
      this.isLocalPresenting = false;
      const stream = window.setuWebRTC?.getRemoteScreenStream 
        ? window.setuWebRTC.getRemoteScreenStream() 
        : (window.setuWebRTC?.remoteScreenStream || window.setuWebRTC?.remoteStream);
      this.renderPresentationStage(stream, 'Remote Peer is presenting');
      if (window.showToast) window.showToast('Remote peer started screen presentation');
    } else {
      this.isPresentationActive = false;
      this.clearPresentationStage();
      if (window.showToast) window.showToast('Screen presentation ended');
    }
    this.updatePeopleList();
  }

  renderPresentationStage(stream, titleText) {
    const stage = document.getElementById('videoStage');
    const presBox = document.getElementById('mainPresentationBox');
    const presVideo = document.getElementById('presentationVideo');
    const presTitle = document.getElementById('presentationTitleText');

    if (stage) stage.classList.add('in-presentation-mode');
    if (presBox) presBox.style.display = 'flex';
    if (presTitle) presTitle.textContent = titleText;

    if (presVideo && stream) {
      if (presVideo.srcObject !== stream) {
        presVideo.srcObject = stream;
      }
      presVideo.muted = true;
      presVideo.play().catch(async (e) => {
        console.warn('presVideo play error, retrying muted:', e);
        try { await presVideo.play(); } catch (_) {}
      });

      const tracks = stream.getVideoTracks();
      if (tracks.length > 0) {
        tracks[0].addEventListener('unmute', () => {
          if (presVideo.srcObject !== stream) {
            presVideo.srcObject = stream;
          }
          presVideo.play().catch(() => {});
        });
      }
    }

    this.syncParticipantTiles();
  }

  clearPresentationStage() {
    const stage = document.getElementById('videoStage');
    const presBox = document.getElementById('mainPresentationBox');
    const presVideo = document.getElementById('presentationVideo');
    const expandText = document.getElementById('expandPresentationText');

    if (stage) {
      stage.classList.remove('in-presentation-mode');
      stage.classList.remove('presentation-expanded');
    }
    if (expandText) {
      expandText.textContent = 'Expand';
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    if (presBox) presBox.style.display = 'none';
    if (presVideo) {
      presVideo.srcObject = null;
    }

    this.syncParticipantTiles();
  }

  async setupDeviceMenus() {
    const micMenuBtn = document.getElementById('micMenuBtn');
    const micMenu = document.getElementById('micDeviceMenu');
    const camMenuBtn = document.getElementById('camMenuBtn');
    const camMenu = document.getElementById('camDeviceMenu');

    if (micMenuBtn && micMenu) {
      micMenuBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        camMenu?.classList.remove('open');
        const isOpen = micMenu.classList.contains('open');
        if (!isOpen) {
          await this.populateMeetingAudioDevices(micMenu);
          micMenu.classList.add('open');
        } else {
          micMenu.classList.remove('open');
        }
      });
    }

    if (camMenuBtn && camMenu) {
      camMenuBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        micMenu?.classList.remove('open');
        const isOpen = camMenu.classList.contains('open');
        if (!isOpen) {
          await this.populateMeetingVideoDevices(camMenu);
          camMenu.classList.add('open');
        } else {
          camMenu.classList.remove('open');
        }
      });
    }

    window.addEventListener('click', () => {
      micMenu?.classList.remove('open');
      camMenu?.classList.remove('open');
    });
  }

  async populateMeetingAudioDevices(container) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      container.innerHTML = '<div class="menu-heading">Select Microphone</div>';

      devices.filter(d => d.kind === 'audioinput').forEach(d => {
        const item = document.createElement('button');
        item.className = 'menu-item' + (d.deviceId === window.setuWebRTC.selectedAudioDeviceId ? ' selected' : '');
        item.textContent = d.label || 'Microphone';
        item.addEventListener('click', async () => {
          await window.setuWebRTC.switchAudioDevice(d.deviceId);
          container.classList.remove('open');
          if (window.showToast) window.showToast('Microphone switched');
        });
        container.appendChild(item);
      });
    } catch (e) {}
  }

  async populateMeetingVideoDevices(container) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      container.innerHTML = '<div class="menu-heading">Select Camera</div>';

      devices.filter(d => d.kind === 'videoinput').forEach(d => {
        const item = document.createElement('button');
        item.className = 'menu-item' + (d.deviceId === window.setuWebRTC.selectedVideoDeviceId ? ' selected' : '');
        item.textContent = d.label || 'Camera';
        item.addEventListener('click', async () => {
          await window.setuWebRTC.switchVideoDevice(d.deviceId);
          const localVideo = document.getElementById('localVideo');
          if (localVideo) localVideo.srcObject = window.setuWebRTC.localStream;
          container.classList.remove('open');
          if (window.showToast) window.showToast('Camera switched');
        });
        container.appendChild(item);
      });
    } catch (e) {}
  }

  sendReaction(emoji) {
    this.renderFloatingReaction(emoji);
    if (window.setuWebRTC) {
      const packet = JSON.stringify({
        type: 'reaction',
        emoji
      });
      window.setuWebRTC.sendData('control', packet);
    }
  }

  renderFloatingReaction(emoji) {
    const stage = document.getElementById('videoStage');
    if (!stage) return;

    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = emoji;
    el.style.left = `${30 + Math.random() * 40}%`;
    el.style.bottom = '90px';
    stage.appendChild(el);

    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2200);
  }

  setupDrawerToggles() {
    const mapping = [
      { btnId: 'togglePeopleDrawerBtn', drawerId: 'peopleDrawer' },
      { btnId: 'toggleChatDrawerBtn', drawerId: 'chatDrawer' },
      { btnId: 'toggleFileDrawerBtn', drawerId: 'fileDrawer' },
      { btnId: 'toggleWhiteboardBtn', drawerId: 'whiteboardDrawer' },
      { btnId: 'toggleDiagnosticsBtn', drawerId: 'diagnosticsDrawer' },
      { btnId: 'toggleNotesDrawerBtn', drawerId: 'notesDrawer' }
    ];

    mapping.forEach(({ btnId, drawerId }) => {
      const btn = document.getElementById(btnId);
      const drawer = document.getElementById(drawerId);
      if (!btn || !drawer) return;

      btn.addEventListener('click', () => {
        const isOpen = drawer.classList.contains('open');

        document.querySelectorAll('.meeting-drawer').forEach(d => d.classList.remove('open'));
        document.querySelectorAll('.meet-ctrl-btn').forEach(b => {
          if (b.id && b.id.startsWith('toggle')) b.classList.remove('active');
        });

        if (!isOpen) {
          drawer.classList.add('open');
          btn.classList.add('active');
          if (drawerId === 'chatDrawer' && window.setuChat) {
            window.setuChat.markAsRead();
          }
          if (drawerId === 'peopleDrawer') {
            this.updatePeopleList();
          }
          if (drawerId === 'whiteboardDrawer' && window.setuSharedPage) {
            window.setuSharedPage.resizeCanvas();
          }
        }
      });

      const closeIcon = drawer.querySelector('.drawer-close');
      if (closeIcon) {
        closeIcon.addEventListener('click', () => {
          drawer.classList.remove('open');
          btn.classList.remove('active');
        });
      }
    });

    // Mobile More Menu
    const moreBtn = document.getElementById('toggleMoreOptionsBtn');
    const moreMenu = document.getElementById('moreOptionsMenu');
    if (moreBtn && moreMenu) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moreMenu.classList.toggle('open');
      });
      window.addEventListener('click', () => moreMenu.classList.remove('open'));
    }
  }

  updatePeopleList() {
    const listEl = document.getElementById('connectedPeopleList');
    const countBadge = document.getElementById('peopleCountBadge');
    const drawerCount = document.getElementById('peopleDrawerCount');
    if (!listEl) return;

    const isLocalMuted = window.setuWebRTC?.isAudioMuted;
    const isLocalCamOff = window.setuWebRTC?.isVideoMuted;
    const isLocalPres = this.isLocalPresenting;

    const isRemoteMuted = !this.remoteMediaState.audio;
    const isRemoteCamOff = !this.remoteMediaState.video;
    const isRemotePres = this.isPresentationActive && !this.isLocalPresenting;

    if (countBadge) countBadge.textContent = '2';
    if (drawerCount) drawerCount.textContent = '2';
    const moreDrawerCount = document.getElementById('morePeopleCountBadge');
    if (moreDrawerCount) moreDrawerCount.textContent = '2';

    const localInitial = (this.localDisplayName || 'Y').charAt(0).toUpperCase();
    const remoteInitial = (this.remotePeerName || 'P').charAt(0).toUpperCase();

    listEl.innerHTML = `
      <div class="people-item">
        <div class="people-avatar">${localInitial}</div>
        <div class="people-info">
          <div class="people-name">${this.localDisplayName} (You)</div>
          <div class="people-status">
            ${isLocalPres ? '<span class="status-badge-pres">Presenting</span>' : ''}
            <span>${isLocalMuted ? 'Muted' : 'Mic Active'}</span> •
            <span>${isLocalCamOff ? 'Camera Off' : 'Camera On'}</span>
          </div>
        </div>
      </div>
      <div class="people-item">
        <div class="people-avatar">
          ${this.remotePeerAvatar ? `<img src="${this.remotePeerAvatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : remoteInitial}
        </div>
        <div class="people-info">
          <div class="people-name">${this.remotePeerName}</div>
          <div class="people-status">
            ${isRemotePres ? '<span class="status-badge-pres">Presenting</span>' : ''}
            <span>${isRemoteMuted ? 'Muted' : 'Mic Active'}</span> •
            <span>${isRemoteCamOff ? 'Camera Off' : 'Camera On'}</span>
          </div>
        </div>
      </div>
    `;
  }

  startMeetingTimer() {
    this.meetingStartTime = Date.now();
    const timerDisplay = document.getElementById('meetingTimerDisplay');

    this.timerInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - this.meetingStartTime) / 1000);
      const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const secs = String(elapsedSec % 60).padStart(2, '0');
      if (timerDisplay) timerDisplay.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  stopMeetingTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  bindDraggablePIP() {
    const pip = document.getElementById('localVideoContainer');
    if (!pip) return;

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    pip.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = pip.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      pip.style.right = 'auto';
      pip.style.bottom = 'auto';
      pip.style.left = `${initialLeft}px`;
      pip.style.top = `${initialTop}px`;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      pip.style.left = `${initialLeft + dx}px`;
      pip.style.top = `${initialTop + dy}px`;
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  async setupNotesAutosave() {
    const notesArea = document.getElementById('meetingNotesText');
    if (!notesArea || !window.setuStorage) return;

    const savedNotes = await window.setuStorage.getSetting('local_meeting_notes', '');
    notesArea.value = savedNotes;

    notesArea.addEventListener('input', () => {
      window.setuStorage.setSetting('local_meeting_notes', notesArea.value);
    });
  }
}

// Global instance
window.setuMeeting = new MeetingController();
