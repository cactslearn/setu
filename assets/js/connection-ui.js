/**
 * Setu P2P - Guided Connection Wizard & UI Controller
 * Manages 4-step Host/Join flows, copy-paste, QR codes, device selection (mic/cam/speaker),
 * live audio visualizer meter, and phonetic SAS verification.
 * Zero emojis in UI chrome.
 */

class ConnectionWizardUI {
  constructor() {
    this.modal = null;
    this.currentStep = 1;
    this.mode = 'host'; // 'host' or 'join'
    this.generatedPayload = '';
    this.localSdp = null;
    this.remoteSdp = null;

    this.audioContext = null;
    this.analyser = null;
    this.micMeterInterval = null;

    this.onConnectionEstablished = null;
  }

  init() {
    this.modal = document.getElementById('wizardModal');
    this.bindEvents();
  }

  async syncPrejoinStateFromProfile() {
    if (window.setuStorage) {
      try {
        const profile = await window.setuStorage.getUserProfile();
        if (profile) {
          const defaultMutedAudio = (profile.defaultMutedAudio !== undefined) ? !!profile.defaultMutedAudio : !!profile.defaultMuteAudio;
          const defaultMutedVideo = (profile.defaultMutedVideo !== undefined) ? !!profile.defaultMutedVideo : !!profile.defaultMuteVideo;
          if (window.setuWebRTC) {
            window.setuWebRTC.isAudioMuted = defaultMutedAudio;
            window.setuWebRTC.isVideoMuted = defaultMutedVideo;
          }
        }
      } catch (e) {
        console.warn('[ConnectionWizard] Error reading user profile mute settings:', e);
      }
    }
  }

  async openWizard(mode = 'host') {
    this.mode = mode;
    this.currentStep = 2;
    this.modal.classList.add('open');
    await this.syncPrejoinStateFromProfile();
    this.updateWizardView();

    if (this.mode === 'host') {
      this.startHostFlow();
    } else {
      this.startJoinFlow();
    }
  }

  closeWizard() {
    this.modal.classList.remove('open');
    this.stopMicMeter();
    if (window.setuQR) window.setuQR.stopScanner();
    if (window.setuMeeting) {
      window.setuMeeting.syncButtonStates();
    }
  }

  bindEvents() {
    const closeBtn = document.getElementById('wizardCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeWizard());

    const copyBtn = document.getElementById('copyPayloadBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        if (!this.generatedPayload) return;
        navigator.clipboard.writeText(this.generatedPayload);
        copyBtn.textContent = 'Copied';
        setTimeout(() => (copyBtn.textContent = 'Copy Code'), 2500);
        if (window.showToast) window.showToast('Connection code copied to clipboard');
      });
    }

    const copyLinkBtn = document.getElementById('copyInviteLinkBtn');
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', () => {
        if (!this.generatedPayload) return;
        const link = window.location.origin + window.location.pathname + '#join=' + encodeURIComponent(this.generatedPayload);
        navigator.clipboard.writeText(link);
        copyLinkBtn.textContent = 'Link Copied';
        setTimeout(() => (copyLinkBtn.textContent = 'Copy Invite Link'), 2500);
        if (window.showToast) window.showToast('1-Click meeting link copied to clipboard');
      });
    }

    const pasteInput = document.getElementById('remotePayloadInput');
    if (pasteInput) {
      pasteInput.addEventListener('input', () => this.handlePayloadPasted(pasteInput.value));
    }

    const toggleQrBtn = document.getElementById('toggleQrBtn');
    if (toggleQrBtn) {
      toggleQrBtn.addEventListener('click', () => this.toggleQRDisplay());
    }

    const verifyConfirmBtn = document.getElementById('verifyConfirmBtn');
    if (verifyConfirmBtn) {
      verifyConfirmBtn.addEventListener('click', async () => {
        const peerName = document.getElementById('peerLabelInput')?.value || 'Peer';
        if (this.remoteSdp && window.setuIdentity) {
          const fp = window.setuIdentity.extractFingerprint(this.remoteSdp);
          await window.setuIdentity.rememberVerifiedPeer(peerName, fp);
          verifyConfirmBtn.textContent = 'Verified & Saved';
          verifyConfirmBtn.disabled = true;
          if (window.showToast) window.showToast(`Verified contact "${peerName}" saved`);
        }
      });
    }

    const startCallBtn = document.getElementById('startCallBtn');
    if (startCallBtn) {
      startCallBtn.addEventListener('click', () => {
        this.stopMicMeter();
        this.closeWizard();
        if (window.setuMeeting) {
          window.setuMeeting.enterMeeting();
          window.setuMeeting.syncButtonStates();
        }
        if (this.onConnectionEstablished) {
          this.onConnectionEstablished({
            mode: this.mode,
            localSdp: this.localSdp,
            remoteSdp: this.remoteSdp
          });
        }
      });
    }

    const soundTestBtn = document.getElementById('soundTestBtn');
    if (soundTestBtn) {
      soundTestBtn.addEventListener('click', () => this.playTestChime());
    }

    // Device Pickers in Preview
    const audioSelect = document.getElementById('audioSourceSelect');
    if (audioSelect) {
      audioSelect.addEventListener('change', async () => {
        await window.setuWebRTC.getLocalMedia(audioSelect.value, document.getElementById('videoSourceSelect')?.value);
        this.updatePreviewVideo();
        this.startMicMeter();
      });
    }

    const videoSelect = document.getElementById('videoSourceSelect');
    if (videoSelect) {
      videoSelect.addEventListener('change', async () => {
        await window.setuWebRTC.getLocalMedia(document.getElementById('audioSourceSelect')?.value, videoSelect.value);
        this.updatePreviewVideo();
      });
    }

    const outputSelect = document.getElementById('audioOutputSelect');
    if (outputSelect) {
      outputSelect.addEventListener('change', async () => {
        const previewVideo = document.getElementById('previewVideo');
        await window.setuWebRTC.switchAudioOutput(previewVideo, outputSelect.value);
      });
    }

    // Prejoin Mute Toggles
    const prejoinMic = document.getElementById('prejoinMicBtn');
    if (prejoinMic) {
      prejoinMic.addEventListener('click', () => {
        const isMuted = !window.setuWebRTC.isAudioMuted;
        window.setuWebRTC.setAudioMute(isMuted);
        this.updatePrejoinMicDisplay(isMuted);
      });
    }

    const prejoinCam = document.getElementById('prejoinCamBtn');
    if (prejoinCam) {
      prejoinCam.addEventListener('click', async () => {
        const isOff = !window.setuWebRTC.isVideoMuted;
        await window.setuWebRTC.setVideoMute(isOff);
        await this.updatePrejoinCamDisplay(isOff);
        if (!isOff) {
          await this.updatePreviewVideo();
        }
      });
    }
  }

  updateWizardView() {
    const titleEl = document.getElementById('wizardTitle');
    const promptEl = document.getElementById('wizardPrompt');
    const stepDots = document.querySelectorAll('.wizard-step-dot');

    stepDots.forEach((dot, idx) => {
      dot.classList.remove('active', 'completed');
      if (idx + 1 === this.currentStep) dot.classList.add('active');
      else if (idx + 1 < this.currentStep) dot.classList.add('completed');
    });

    if (this.currentStep === 2) {
      if (this.mode === 'host') {
        titleEl.textContent = 'Host Meeting';
        promptEl.textContent = 'Copy this connection code and send it to your participant.';
        document.getElementById('hostPayloadSection').style.display = 'block';
        document.getElementById('joinPayloadSection').style.display = 'none';
        document.getElementById('verificationSection').style.display = 'none';
        document.getElementById('previewSection').style.display = 'none';
      } else {
        titleEl.textContent = 'Join Meeting';
        promptEl.textContent = 'Paste the connection code you received from the host.';
        document.getElementById('hostPayloadSection').style.display = 'none';
        document.getElementById('joinPayloadSection').style.display = 'block';
        document.getElementById('verificationSection').style.display = 'none';
        document.getElementById('previewSection').style.display = 'none';
      }
    } else if (this.currentStep === 3) {
      titleEl.textContent = 'Security Verification';
      promptEl.textContent = 'Compare these verification tokens with your peer via phone or secondary channel to ensure authentic peer-to-peer encryption.';
      document.getElementById('hostPayloadSection').style.display = 'none';
      document.getElementById('joinPayloadSection').style.display = 'none';
      document.getElementById('verificationSection').style.display = 'block';
      document.getElementById('previewSection').style.display = 'none';
    } else if (this.currentStep === 4) {
      titleEl.textContent = 'Ready to Join';
      promptEl.textContent = 'Select your devices and check audio/video before entering the room.';
      document.getElementById('hostPayloadSection').style.display = 'none';
      document.getElementById('joinPayloadSection').style.display = 'none';
      document.getElementById('verificationSection').style.display = 'none';
      document.getElementById('previewSection').style.display = 'block';
      this.populateDeviceList();
      this.startPreviewMedia();
    }
  }

  async populateDeviceList() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioSelect = document.getElementById('audioSourceSelect');
      const videoSelect = document.getElementById('videoSourceSelect');
      const outputSelect = document.getElementById('audioOutputSelect');

      if (audioSelect) audioSelect.innerHTML = '';
      if (videoSelect) videoSelect.innerHTML = '';
      if (outputSelect) outputSelect.innerHTML = '';

      let audioIdx = 1, videoIdx = 1, outputIdx = 1;

      devices.forEach(d => {
        const option = document.createElement('option');
        option.value = d.deviceId;

        if (d.kind === 'audioinput' && audioSelect) {
          option.text = d.label || `Microphone ${audioIdx++}`;
          if (d.deviceId === window.setuWebRTC.selectedAudioDeviceId) option.selected = true;
          audioSelect.appendChild(option);
        } else if (d.kind === 'videoinput' && videoSelect) {
          option.text = d.label || `Camera ${videoIdx++}`;
          if (d.deviceId === window.setuWebRTC.selectedVideoDeviceId) option.selected = true;
          videoSelect.appendChild(option);
        } else if (d.kind === 'audiooutput' && outputSelect) {
          option.text = d.label || `Speaker ${outputIdx++}`;
          if (d.deviceId === window.setuWebRTC.selectedAudioOutputId) option.selected = true;
          outputSelect.appendChild(option);
        }
      });
    } catch (e) {
      console.warn('Could not enumerate devices:', e);
    }
  }

  async startHostFlow() {
    const gatheringEl = document.getElementById('iceGatheringIndicator');
    const codeArea = document.getElementById('localPayloadText');
    const copyBtn = document.getElementById('copyPayloadBtn');

    gatheringEl.style.display = 'flex';
    codeArea.value = 'Gathering network routes and preparing secure session...';
    copyBtn.disabled = true;

    try {
      await window.setuWebRTC.getLocalMedia();
      const offerDesc = await window.setuWebRTC.createOffer();
      this.localSdp = offerDesc.sdp;

      let hostName = 'Meeting Host';
      if (window.setuStorage) {
        try {
          const profile = await window.setuStorage.getUserProfile();
          if (profile && profile.displayName && profile.displayName.trim()) {
            hostName = profile.displayName.trim();
          }
        } catch (e) {}
      }

      this.generatedPayload = window.setuSignaling.packSessionDescription(offerDesc, hostName);
      codeArea.value = this.generatedPayload;
      gatheringEl.style.display = 'none';
      copyBtn.disabled = false;

      const qrCanvas = document.getElementById('qrCodeCanvas');
      if (qrCanvas && window.setuQR) {
        window.setuQR.renderQR(qrCanvas, this.generatedPayload);
      }
    } catch (err) {
      console.error('Host offer generation error:', err);
      codeArea.value = 'WebRTC Initialization Error: ' + err.message;
    }
  }

  startJoinFlow() {
    const pasteArea = document.getElementById('remotePayloadInput');
    pasteArea.value = '';
    pasteArea.placeholder = 'Paste the host code (SETU-v1:...) here';
    document.getElementById('joinAnswerSection').style.display = 'none';
  }

  async handlePayloadPasted(rawText) {
    if (!rawText || !rawText.trim()) return;

    const validation = window.setuSignaling.unpackSessionDescription(rawText);
    const feedbackEl = document.getElementById('payloadFeedback');

    if (!validation.valid) {
      feedbackEl.textContent = validation.error;
      feedbackEl.style.color = 'var(--accent-rose)';
      return;
    }

    feedbackEl.textContent = 'Code verified (' + validation.type.toUpperCase() + ')';
    feedbackEl.style.color = 'var(--accent-emerald)';

    if (validation.label) {
      this.remotePeerName = validation.label;
      if (window.setuMeeting) {
        window.setuMeeting.setRemotePeerName(validation.label);
      }
      const peerLabelInput = document.getElementById('peerLabelInput');
      if (peerLabelInput) {
        peerLabelInput.value = validation.label;
      }
    }

    if (this.mode === 'join' && validation.type === 'offer') {
      this.remoteSdp = validation.sdp;
      document.getElementById('joinAnswerSection').style.display = 'block';
      const answerArea = document.getElementById('joinAnswerText');
      answerArea.value = 'Generating reply code...';

      try {
        await window.setuWebRTC.getLocalMedia();
        const answerDesc = await window.setuWebRTC.createAnswer(validation.sdp);
        this.localSdp = answerDesc.sdp;

        let participantName = 'Participant';
        if (window.setuStorage) {
          try {
            const profile = await window.setuStorage.getUserProfile();
            if (profile && profile.displayName && profile.displayName.trim()) {
              participantName = profile.displayName.trim();
            }
          } catch (e) {}
        }

        this.generatedPayload = window.setuSignaling.packSessionDescription(answerDesc, participantName);
        answerArea.value = this.generatedPayload;

        const copyAnswerBtn = document.getElementById('copyAnswerBtn');
        copyAnswerBtn.onclick = () => {
          navigator.clipboard.writeText(this.generatedPayload);
          copyAnswerBtn.textContent = 'Copied';
          setTimeout(() => (copyAnswerBtn.textContent = 'Copy Reply Code'), 2500);
          if (window.showToast) window.showToast('Reply code copied. Send it to the host.');
          this.proceedToVerification();
        };
      } catch (e) {
        answerArea.value = 'Error generating reply: ' + e.message;
      }
    } else if (this.mode === 'host' && validation.type === 'answer') {
      this.remoteSdp = validation.sdp;
      try {
        await window.setuWebRTC.applyAnswer(validation.sdp);
        feedbackEl.textContent = 'Reply code connected successfully';
        setTimeout(() => this.proceedToVerification(), 800);
      } catch (e) {
        feedbackEl.textContent = 'Error applying reply: ' + e.message;
        feedbackEl.style.color = 'var(--accent-rose)';
      }
    }
  }

  async proceedToVerification() {
    this.currentStep = 3;
    this.updateWizardView();

    if (window.setuIdentity && this.localSdp && this.remoteSdp) {
      const tokens = await window.setuIdentity.generateVerificationTokens(this.localSdp, this.remoteSdp);
      document.getElementById('sasCodeDisplay').textContent = tokens.numericCode;
      document.getElementById('sasWordsDisplay').textContent = tokens.phoneticWords;
      document.getElementById('remoteFingerprintDisplay').textContent = tokens.remoteFingerprint || 'SHA256: Authenticated';

      const savedCheck = await window.setuIdentity.checkSavedIdentity('Remote Peer', tokens.remoteFingerprint);
      if (savedCheck.status === 'mismatch') {
        alert(savedCheck.warning);
      }
    }

    const nextBtn = document.getElementById('proceedToPreviewBtn');
    if (nextBtn) {
      nextBtn.onclick = () => {
        this.currentStep = 4;
        this.updateWizardView();
      };
    }
  }

  async directLinkJoin(rawOfferPayload) {
    // 1. Explicitly synchronize global profile settings first so camera and mic respect settings!
    await this.syncPrejoinStateFromProfile();

    this.mode = 'join';
    const validation = window.setuSignaling.unpackSessionDescription(rawOfferPayload);
    if (!validation.valid || validation.type !== 'offer') {
      if (window.showToast) window.showToast('Invalid meeting invitation link');
      return;
    }

    this.remoteSdp = validation.sdp;
    if (validation.label && window.setuMeeting) {
      window.setuMeeting.setRemotePeerName(validation.label);
    }

    // 2. Acquire media respecting mute settings (does NOT open webcam if defaultMutedVideo is true)
    try {
      await window.setuWebRTC.getLocalMedia();
    } catch (e) {
      console.warn('[DirectJoin] Media capture warning:', e);
    }

    // 3. Create WebRTC answer
    try {
      const answerDesc = await window.setuWebRTC.createAnswer(validation.sdp);
      this.localSdp = answerDesc.sdp;

      let participantName = 'Participant';
      if (window.setuStorage) {
        try {
          const profile = await window.setuStorage.getUserProfile();
          if (profile && profile.displayName && profile.displayName.trim()) {
            participantName = profile.displayName.trim();
          }
        } catch (e) {}
      }

      this.generatedPayload = window.setuSignaling.packSessionDescription(answerDesc, participantName);

      // Copy reply code to clipboard automatically
      try {
        await navigator.clipboard.writeText(this.generatedPayload);
        if (window.showToast) window.showToast('Joined meeting! Reply code copied to clipboard — send to Host to connect');
      } catch (err) {
        if (window.showToast) window.showToast('Joined meeting! Click "Copy Reply for Host" to share code');
      }

      // Enter meeting room directly
      if (this.modal) this.modal.classList.remove('open');
      if (window.setuMeeting) {
        window.setuMeeting.enterMeeting();
        window.setuMeeting.syncButtonStates();
      }

      // Show top pill in meeting room with 1-click copy for the host
      const replyPill = document.getElementById('directJoinReplyPill');
      const replyPillText = document.getElementById('directJoinReplyPillText');
      if (replyPill) {
        replyPill.style.display = 'inline-flex';
        replyPill.onclick = () => {
          if (this.generatedPayload) {
            navigator.clipboard.writeText(this.generatedPayload);
            if (replyPillText) {
              replyPillText.textContent = 'Copied!';
              setTimeout(() => { replyPillText.textContent = 'Copy Reply for Host'; }, 2500);
            }
            if (window.showToast) window.showToast('Reply code copied to clipboard');
          }
        };
      }

      // Hide pill once connected
      const origStateChange = window.setuWebRTC.onStateChange;
      window.setuWebRTC.onStateChange = (state) => {
        if (origStateChange) origStateChange(state);
        if (state === 'connected' && replyPill) {
          replyPill.style.display = 'none';
        }
      };
    } catch (err) {
      console.error('[DirectJoin] Error creating answer:', err);
      if (window.showToast) window.showToast('Could not complete direct join: ' + err.message);
    }
  }

  /**
   * Smart Auto-Role Room Entry ("First-Arrival Hosting"):
   * Allows both Host and Participant to enter with the exact same reusable room code or link.
   * Probes the ephemeral broker for an existing offer:
   * - If offer found -> Joins as Answerer (participant).
   * - If no offer found within probe window -> Automatically hosts as Offerer.
   */
  async smartRoomEntry(roomCode) {
    if (!window.setuRoomSignaling) {
      if (window.showToast) window.showToast('Signaling engine unavailable');
      return;
    }

    const cleanCode = window.setuRoomSignaling.normalizeRoomCode(roomCode);
    if (!cleanCode || cleanCode.length < 6) {
      if (window.showToast) window.showToast('Please enter a valid room code (e.g. kpm-trvw-xzn or 482-194)');
      return;
    }

    const formattedCode = window.setuRoomSignaling.formatRoomCode(cleanCode);

    // 1. Sync global mute preferences
    await this.syncPrejoinStateFromProfile();

    // 2. Enter meeting room directly in waiting state
    if (this.modal) this.modal.classList.remove('open');
    if (window.setuMeeting) {
      window.setuMeeting.enterMeeting();
      window.setuMeeting.syncButtonStates();
      window.setuMeeting.setMeetingWaitingState();
    }

    const statusText = document.getElementById('connStatusText');
    if (statusText) statusText.textContent = `Entering room ${formattedCode}...`;

    // 3. Acquire local media respecting mute preferences
    try {
      await window.setuWebRTC.getLocalMedia();
      const localVideo = document.getElementById('localVideo');
      if (localVideo && window.setuWebRTC.localStream) {
        localVideo.srcObject = window.setuWebRTC.localStream;
        localVideo.play().catch(e => console.warn('localVideo play error:', e));
      }
      if (window.setuMeeting) {
        window.setuMeeting.syncButtonStates();
        window.setuMeeting.updateLocalVideoDisplay(!window.setuWebRTC.isVideoMuted);
      }
    } catch (e) {
      console.warn('[SmartRoomEntry] Media capture note:', e);
    }

    let localDisplayName = 'Participant';
    if (window.setuStorage) {
      try {
        const profile = await window.setuStorage.getUserProfile();
        if (profile && profile.displayName && profile.displayName.trim()) {
          localDisplayName = profile.displayName.trim();
        }
      } catch (_) {}
    }

    // 4. Probe for existing host offer with randomized jitter to prevent simultaneous collision
    const jitter = Math.floor(Math.random() * 250);
    const probeTimeout = 550 + jitter;
    if (statusText) statusText.textContent = `Connecting to room ${formattedCode}...`;

    try {
      const probeResult = await window.setuRoomSignaling.probeRoomOffer(cleanCode, probeTimeout);

      if (probeResult && probeResult.found && probeResult.offerObj) {
        // --- CASE A: Room offer exists! Assuming Joiner (Answerer) role ---
        console.log('[SmartRoomEntry] Active offer found on room! Assuming Joiner role.');
        this.mode = 'join';
        window.setuSharedPage.isHost = false;
        const offerObj = probeResult.offerObj;
        this.remoteSdp = offerObj.sdp;

        if (offerObj.label && window.setuMeeting) {
          window.setuMeeting.setRemotePeerName(offerObj.label);
        }

        if (statusText) statusText.textContent = 'Room offer found! Creating answer...';
        const answerDesc = await window.setuWebRTC.createAnswer(offerObj.sdp);
        this.localSdp = answerDesc.sdp;

        await window.setuRoomSignaling.sendAnswer(
          cleanCode,
          { type: answerDesc.type, sdp: answerDesc.sdp, label: localDisplayName }
        );

        if (window.showToast) {
          window.showToast('Room found! Establishing direct P2P call...');
        }
      } else {
        // --- CASE B: No offer found! First arrival -> Automatically Host (Offerer) ---
        console.log('[SmartRoomEntry] No offer found within probe window. Assuming Host role.');
        this.mode = 'host';
        window.setuSharedPage.isHost = true;

        if (statusText) statusText.textContent = `Hosting room ${formattedCode}. Waiting for participant...`;

        const offerDesc = await window.setuWebRTC.createOffer();
        this.localSdp = offerDesc.sdp;

        const shortLink = `${window.location.origin}${window.location.pathname}#room=${cleanCode}`;
        this.generatedPayload = window.setuSignaling.packSessionDescription(offerDesc, localDisplayName);

        // Open in-room Google Meet style "Your meeting is ready" card
        if (window.setuMeeting) {
          window.setuMeeting.setupInMeetingInvite(this.generatedPayload, shortLink, formattedCode);
        }

        if (window.showToast) {
          window.showToast(`You are the first arrival! Hosting room ${formattedCode}`);
        }

        // Host room on broker & listen for participant answer
        await window.setuRoomSignaling.hostRoom(
          cleanCode,
          { type: offerDesc.type, sdp: offerDesc.sdp, label: localDisplayName },
          async (answerObj) => {
            try {
              console.log('[SmartRoomEntry/Host] Participant answer received! Applying...');
              if (answerObj.label && window.setuMeeting) {
                window.setuMeeting.setRemotePeerName(answerObj.label);
              }
              await window.setuWebRTC.applyAnswer(answerObj.sdp);
              if (window.setuMeeting) {
                window.setuMeeting.onPeerConnected();
              }
              window.setuRoomSignaling.cleanupRoom(cleanCode);
            } catch (err) {
              console.error('[SmartRoomEntry/Host] Failed to apply answer:', err);
              if (window.showToast) window.showToast('Could not complete connection: ' + err.message);
            }
          },
          (statusMsg) => {
            const st = document.getElementById('connStatusText');
            if (st && (!window.setuWebRTC.peerConnection || window.setuWebRTC.peerConnection.connectionState !== 'connected')) {
              st.textContent = statusMsg;
            }
          },
          // On dual-offer collision: other peer also hosted with higher priority -> yield and become answerer
          async (competingOffer) => {
            try {
              console.warn('[SmartRoomEntry/Host] Dual-offer collision detected. Yielding to competing offer...');
              this.mode = 'join';
              window.setuSharedPage.isHost = false;
              this.remoteSdp = competingOffer.sdp;
              if (competingOffer.label && window.setuMeeting) {
                window.setuMeeting.setRemotePeerName(competingOffer.label);
              }
              const ansDesc = await window.setuWebRTC.createAnswer(competingOffer.sdp);
              this.localSdp = ansDesc.sdp;
              await window.setuRoomSignaling.sendAnswer(
                cleanCode,
                { type: ansDesc.type, sdp: ansDesc.sdp, label: localDisplayName }
              );
            } catch (err) {
              console.error('[SmartRoomEntry/Collision] Error yielding to competing offer:', err);
            }
          }
        );
      }
    } catch (err) {
      console.error('[SmartRoomEntry] Signaling error:', err);
      if (window.showToast) window.showToast('Room connection error: ' + err.message);
    }
  }

  // Alias for backward compatibility
  async directRoomCodeJoin(roomCode) {
    return await this.smartRoomEntry(roomCode);
  }

  async startDirectHostMeeting(customRoomCode = null) {
    // 1. Sync global settings so mic and camera respect user preferences
    await this.syncPrejoinStateFromProfile();

    this.mode = 'host';
    window.setuSharedPage.isHost = true;

    // 2. Enter meeting room directly (like Google Meet / Zoom)
    if (this.modal) this.modal.classList.remove('open');
    if (window.setuMeeting) {
      window.setuMeeting.enterMeeting();
      window.setuMeeting.syncButtonStates();
      window.setuMeeting.setMeetingWaitingState();
    }

    // 3. Acquire media respecting mute choices
    try {
      await window.setuWebRTC.getLocalMedia();
      const localVideo = document.getElementById('localVideo');
      if (localVideo && window.setuWebRTC.localStream) {
        localVideo.srcObject = window.setuWebRTC.localStream;
        localVideo.play().catch(e => console.warn('localVideo play error:', e));
      }
      if (window.setuMeeting) {
        window.setuMeeting.syncButtonStates();
        window.setuMeeting.updateLocalVideoDisplay(!window.setuWebRTC.isVideoMuted);
      }
    } catch (e) {
      console.warn('[DirectHost] Media capture note:', e);
    }

    // 4. Generate Offer & Room Code
    try {
      const offerDesc = await window.setuWebRTC.createOffer();
      this.localSdp = offerDesc.sdp;

      let hostName = 'Meeting Host';
      if (window.setuStorage) {
        try {
          const profile = await window.setuStorage.getUserProfile();
          if (profile && profile.displayName && profile.displayName.trim()) {
            hostName = profile.displayName.trim();
          }
        } catch (e) {}
      }

      // Determine room code: custom reusable or freshly generated
      let roomCode = customRoomCode;
      if (!roomCode && window.setuRoomSignaling) {
        roomCode = window.setuRoomSignaling.generateRoomCode();
      }
      const cleanCode = window.setuRoomSignaling ? window.setuRoomSignaling.normalizeRoomCode(roomCode) : roomCode;
      const formattedCode = window.setuRoomSignaling ? window.setuRoomSignaling.formatRoomCode(cleanCode) : cleanCode;

      const shortLink = `${window.location.origin}${window.location.pathname}#room=${cleanCode}`;
      this.generatedPayload = window.setuSignaling.packSessionDescription(offerDesc, hostName);

      // 5. Open in-room Google Meet style "Your meeting is ready" card
      if (window.setuMeeting) {
        window.setuMeeting.setupInMeetingInvite(this.generatedPayload, shortLink, formattedCode);
      }

      // 6. Connect to ephemeral broker & listen for participant answer automatically
      if (window.setuRoomSignaling && cleanCode) {
        // Clear any previous stale offer on this reusable code before publishing new offer
        window.setuRoomSignaling.cleanupRoom(cleanCode);

        window.setuRoomSignaling.hostRoom(
          cleanCode,
          { type: offerDesc.type, sdp: offerDesc.sdp, label: hostName },
          async (answerObj) => {
            try {
              console.log('[DirectHost] Participant joined room! Applying answer...');
              if (answerObj.label && window.setuMeeting) {
                window.setuMeeting.setRemotePeerName(answerObj.label);
              }
              await window.setuWebRTC.applyAnswer(answerObj.sdp);
              if (window.setuMeeting) {
                window.setuMeeting.onPeerConnected();
              }
              window.setuRoomSignaling.cleanupRoom(cleanCode);
            } catch (err) {
              console.error('[DirectHost] Error auto-applying participant answer:', err);
              if (window.showToast) window.showToast('Could not complete connection: ' + err.message);
            }
          },
          (statusMsg) => {
            const statusText = document.getElementById('connStatusText');
            if (statusText && (!window.setuWebRTC.peerConnection || window.setuWebRTC.peerConnection.connectionState !== 'connected')) {
              statusText.textContent = statusMsg;
            }
          }
        );
      }

      if (window.showToast) {
        window.showToast(`Meeting ready! Share code: ${formattedCode}`);
      }
    } catch (err) {
      console.error('[DirectHost] Error generating offer:', err);
      if (window.showToast) window.showToast('Initialization error: ' + err.message);
    }
  }

  updatePrejoinMicDisplay(isMuted) {
    const prejoinMic = document.getElementById('prejoinMicBtn');
    if (!prejoinMic) return;

    prejoinMic.classList.toggle('off', isMuted);
    prejoinMic.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
    prejoinMic.setAttribute('title', isMuted ? 'Unmute microphone' : 'Mute microphone');

    if (isMuted) {
      prejoinMic.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
      `;
      const meterBar = document.getElementById('micVolumeFill');
      if (meterBar) meterBar.style.width = '0%';
      this.stopMicMeter();
    } else {
      prejoinMic.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
      `;
      this.startMicMeter();
    }
  }

  async updatePrejoinCamDisplay(isOff) {
    const prejoinCam = document.getElementById('prejoinCamBtn');
    if (prejoinCam) {
      prejoinCam.classList.toggle('off', isOff);
      prejoinCam.setAttribute('aria-pressed', isOff ? 'true' : 'false');
      prejoinCam.setAttribute('title', isOff ? 'Turn on camera' : 'Turn off camera');

      if (isOff) {
        prejoinCam.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="1" y1="1" x2="23" y2="23"></line>
            <path d="M21 21l-3.34-3.34M23 7l-7 5 7 5V7z"></path>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
        `;
      } else {
        prejoinCam.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
        `;
      }
    }

    const previewVideo = document.getElementById('previewVideo');
    const offPlaceholder = document.getElementById('previewCamOffPlaceholder');
    if (previewVideo && offPlaceholder) {
      previewVideo.style.display = isOff ? 'none' : 'block';
      offPlaceholder.style.display = isOff ? 'flex' : 'none';

      if (isOff) {
        try {
          const profile = window.setuStorage ? await window.setuStorage.getUserProfile() : null;
          if (profile && profile.avatarDataUrl) {
            offPlaceholder.innerHTML = `
              <img src="${profile.avatarDataUrl}" alt="${profile.displayName || 'You'}" style="width: 72px; height: 72px; border-radius: 50%; object-fit: cover; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
              <span style="font-weight: 600; margin-top: 0.35rem;">Camera is off</span>
            `;
          } else if (profile && profile.displayName) {
            const initial = profile.displayName.charAt(0).toUpperCase();
            offPlaceholder.innerHTML = `
              <div style="width: 72px; height: 72px; border-radius: 50%; background: var(--accent-blue); color: #fff; font-size: 1.8rem; font-weight: 700; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">${initial}</div>
              <span style="font-weight: 600; margin-top: 0.35rem;">Camera is off</span>
            `;
          } else {
            offPlaceholder.innerHTML = `
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M21 21l-3.34-3.34M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
              <span style="font-weight: 600; margin-top: 0.35rem;">Camera is off</span>
            `;
          }
        } catch (e) {}
      }
    }
  }

  async startPreviewMedia() {
    await this.syncPrejoinStateFromProfile();

    const isMuted = window.setuWebRTC ? window.setuWebRTC.isAudioMuted : false;
    const isOff = window.setuWebRTC ? window.setuWebRTC.isVideoMuted : false;

    this.updatePrejoinMicDisplay(isMuted);
    await this.updatePrejoinCamDisplay(isOff);

    if (window.setuWebRTC && window.setuWebRTC.localStream) {
      window.setuWebRTC.localStream.getAudioTracks().forEach(t => (t.enabled = !isMuted));
    }

    if (!isOff) {
      await this.updatePreviewVideo();
    }
    if (!isMuted) {
      this.startMicMeter();
    }
  }

  async updatePreviewVideo() {
    const previewVideo = document.getElementById('previewVideo');
    if (previewVideo && window.setuWebRTC && window.setuWebRTC.localStream) {
      previewVideo.srcObject = window.setuWebRTC.localStream;
      try {
        await previewVideo.play();
      } catch (e) {}
    }
  }

  startMicMeter() {
    this.stopMicMeter();
    if (!window.setuWebRTC.localStream) return;

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioSource = this.audioContext.createMediaStreamSource(window.setuWebRTC.localStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      audioSource.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      const meterBar = document.getElementById('micVolumeFill');

      this.micMeterInterval = setInterval(() => {
        if (!this.analyser || !meterBar) return;
        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const pct = Math.min(100, Math.round((avg / 128) * 100));
        meterBar.style.width = `${pct}%`;
      }, 80);
    } catch (e) {
      console.warn('AudioContext mic visualizer note:', e);
    }
  }

  stopMicMeter() {
    if (this.micMeterInterval) {
      clearInterval(this.micMeterInterval);
      this.micMeterInterval = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  playTestChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.15);
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } catch (e) {}
  }
}

// Global instance
window.setuWizard = new ConnectionWizardUI();
