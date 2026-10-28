/**
 * Setu P2P - WebRTC Connection Core
 * Manages RTCPeerConnection, Non-trickle ICE Gathering, DataChannels, Media Streams,
 * Hardware Camera Release upon Turn-Off, Device Switching, Quality Presets, and Screen Sharing.
 * Strictly zero backend or signaling server.
 */

const CAMERA_QUALITY_PRESETS = {
  '240p': { width: 426, height: 240, frameRate: 15, maxBitrate: 150000 },
  '360p': { width: 640, height: 360, frameRate: 20, maxBitrate: 300000 },
  '480p': { width: 854, height: 480, frameRate: 25, maxBitrate: 500000 },
  '720p': { width: 1280, height: 720, frameRate: 30, maxBitrate: 1200000 },
  '1080p': { width: 1920, height: 1080, frameRate: 30, maxBitrate: 2500000 }
};

const SCREEN_SHARE_PRESETS = {
  'sharpness': { contentHint: 'detail', maxFramerate: 30, width: 1920, height: 1080 },
  'balanced': { contentHint: 'text', maxFramerate: 30, width: 1920, height: 1080 },
  'motion': { contentHint: 'motion', maxFramerate: 60, width: 1280, height: 720 },
  'remote-control': { contentHint: 'motion', maxFramerate: 60, width: 1920, height: 1080 }
};

class WebRTCManager {
  constructor() {
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.screenStream = null;
    this.cameraTrackBeforeShare = null;

    this.selectedAudioDeviceId = null;
    this.selectedVideoDeviceId = null;
    this.selectedAudioOutputId = null;

    this.isAudioMuted = false;
    this.isVideoMuted = false;

    this.currentCameraPreset = '720p';
    this.currentScreenMode = 'sharpness';
    this.localCandidateIps = [];
    this.remoteCandidateIps = [];

    this.channels = {
      chat: null,
      control: null,
      mouse: null,
      file: null
    };

    this.defaultIceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];
    this.iceServers = [...this.defaultIceServers];

    // Event hooks
    this.onStateChange = null;
    this.onRemoteStream = null;
    this.onChannelMessage = null;
    this.onIceGatheringProgress = null;
    this.onScreenShareStarted = null;
    this.onScreenShareStopped = null;
    this.onControlChannelOpen = null;
    this.onNatTraversalFailed = null;

    this.isInitiator = false;
    this.videoSender = null;
    this.screenSender = null;
    this.audioSender = null;

    this.audioTransceiver = null;
    this.camTransceiver = null;
    this.screenTransceiver = null;
    this.dummyScreenTrack = null;
    this.dummyCamTrack = null;
    this.dummyAudioTrack = null;
    this.dummyAudioCtx = null;

    this.remoteCameraTrack = null;
    this.remoteCameraStream = null;
    this.remoteScreenTrack = null;
    this.remoteScreenStream = null;
    this.remoteAudioTrack = null;
    this.onRemoteScreenStream = null;
  }

  /**
   * Configures custom TURN / STUN relay servers into active ICE configuration.
   * Merges user-provided TURN server(s) with public STUN servers for fallback.
   */
  setCustomIceServers(turnUrl, username, credential) {
    this.iceServers = [...this.defaultIceServers];
    if (turnUrl && turnUrl.trim()) {
      const urls = turnUrl.split(/[\n,]+/).map(u => u.trim()).filter(Boolean);
      for (const url of urls) {
        const entry = { urls: url };
        if (username && username.trim()) entry.username = username.trim();
        if (credential && credential.trim()) entry.credential = credential.trim();
        this.iceServers.push(entry);
      }
      console.log('[WebRTC] Custom ICE / TURN servers configured:', this.iceServers);
    }
  }

  /**
   * Initializes local camera and microphone stream with selected devices and initial mute states.
   */
  async getLocalMedia(audioDeviceId = null, videoDeviceId = null) {
    if (audioDeviceId) this.selectedAudioDeviceId = audioDeviceId;
    if (videoDeviceId) this.selectedVideoDeviceId = videoDeviceId;

    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(this.selectedAudioDeviceId ? { deviceId: { exact: this.selectedAudioDeviceId } } : {})
    };

    const preset = CAMERA_QUALITY_PRESETS[this.currentCameraPreset] || CAMERA_QUALITY_PRESETS['720p'];

    const videoConstraints = this.selectedVideoDeviceId
      ? { deviceId: { exact: this.selectedVideoDeviceId }, width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate } }
      : { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate } };

    try {
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
      }

      // If user muted camera in prejoin, only request audio initially to keep camera hardware released
      if (this.isVideoMuted) {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } else {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: videoConstraints
        });

        const activeVid = this.localStream.getVideoTracks()[0];
        if (activeVid && activeVid.getSettings) {
          const s = activeVid.getSettings();
          if (s.deviceId) this.selectedVideoDeviceId = s.deviceId;
          if (s.facingMode) this.currentFacingMode = s.facingMode;
        }
      }

      // Apply initial mic mute state
      this.localStream.getAudioTracks().forEach(t => (t.enabled = !this.isAudioMuted));

      // If active audio sender was holding a dummy placeholder, replace with real hardware microphone
      if (this.audioSender && this.localStream.getAudioTracks().length > 0) {
        const realTrack = this.localStream.getAudioTracks()[0];
        try {
          await this.audioSender.replaceTrack(realTrack);
          if (this.dummyAudioTrack) {
            try { this.dummyAudioTrack.stop(); } catch (_) {}
            this.dummyAudioTrack = null;
          }
        } catch (e) {
          console.warn('[WebRTC] replaceTrack with active mic note:', e);
        }
      }

      return this.localStream;
    } catch (err) {
      console.warn('[WebRTC] getUserMedia with constraints failed:', err);

      // Fallback Attempt 1: Try basic constraints without specific device IDs
      try {
        if (!this.isVideoMuted) {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        } else {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        this.localStream.getAudioTracks().forEach(t => (t.enabled = !this.isAudioMuted));
        return this.localStream;
      } catch (fallbackErr) {
        console.warn('[WebRTC] Audio+Video capture failed (webcam likely locked by another tab):', fallbackErr);

        // Fallback Attempt 2: Audio-only fallback for same-machine testing or busy camera
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.localStream.getAudioTracks().forEach(t => (t.enabled = !this.isAudioMuted));
          this.isVideoMuted = true;
          if (window.showToast) {
            window.showToast('Camera is in use by another tab. Joined in audio-only mode.');
          }
          if (window.setuMeeting) {
            window.setuMeeting.updateCamButton(true);
            window.setuMeeting.updateLocalVideoDisplay(false);
          }
          return this.localStream;
        } catch (audioErr) {
          console.warn('[WebRTC] Microphone also unavailable:', audioErr);

          // Fallback Attempt 3: No media permissions/devices -> Return safe empty MediaStream
          this.localStream = new MediaStream();
          this.isAudioMuted = true;
          this.isVideoMuted = true;
          if (window.setuMeeting) {
            window.setuMeeting.updateMicButton(true);
            window.setuMeeting.updateCamButton(true);
            window.setuMeeting.updateLocalVideoDisplay(false);
          }
          return this.localStream;
        }
      }
    }
  }

  /**
   * Switches audio input device on-the-fly and replaces track on active sender.
   */
  async switchAudioDevice(deviceId) {
    this.selectedAudioDeviceId = deviceId;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }
      });
      const newTrack = newStream.getAudioTracks()[0];
      newTrack.enabled = !this.isAudioMuted;

      if (this.localStream) {
        const oldTrack = this.localStream.getAudioTracks()[0];
        if (oldTrack) {
          this.localStream.removeTrack(oldTrack);
          oldTrack.stop();
        }
        this.localStream.addTrack(newTrack);
      }

      if (this.pc) {
        const sender = this.audioSender || this.pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) {
          await sender.replaceTrack(newTrack);
        }
      }
      if (this.dummyAudioTrack) {
        try { this.dummyAudioTrack.stop(); } catch (_) {}
        this.dummyAudioTrack = null;
      }
      return true;
    } catch (e) {
      console.error('Failed to switch audio input device:', e);
      return false;
    }
  }

  /**
   * Switches video input device on-the-fly and replaces track on active sender.
   * Releases existing camera hardware track FIRST to avoid mobile HAL NotReadableError sensor locks.
   */
  async switchVideoDevice(deviceId, facingMode = null) {
    if (deviceId) {
      this.selectedVideoDeviceId = deviceId;
    }
    if (facingMode) {
      this.currentFacingMode = facingMode;
    }

    if (this.isVideoMuted) return true;

    // 1. Identify active video track
    const oldTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null;

    // 2. Identify active WebRTC video sender
    const sender = (this.pc && !this.screenStream)
      ? (this.videoSender || this.pc.getSenders().find(s => s.track && s.track.kind === 'video') || this.pc.getSenders().find(s => s.track === null))
      : null;

    // 3. Stop old camera track FIRST to release mobile hardware sensor.
    // Mobile OS camera HALs (Android Camera2, iOS AVFoundation) enforce strict single-camera hardware locks.
    if (oldTrack) {
      try {
        if (this.localStream) {
          this.localStream.removeTrack(oldTrack);
        }
        oldTrack.stop();
      } catch (e) {
        console.warn('[WebRTC] Error stopping old video track:', e);
      }
    }

    // While switching, maintain SSRC pipeline on WebRTC sender using dummy placeholder so peer decoder does not freeze
    if (sender) {
      const dummy = this.dummyCamTrack || this.createDummyVideoTrack();
      this.dummyCamTrack = dummy;
      try {
        await sender.replaceTrack(dummy);
      } catch (_) {}
    }

    // Brief delay (80ms) allows mobile OS camera driver to fully teardown previous sensor pipeline
    await new Promise(resolve => setTimeout(resolve, 80));

    // 4. Build constraint strategies with fallbacks
    const preset = CAMERA_QUALITY_PRESETS[this.currentCameraPreset] || CAMERA_QUALITY_PRESETS['720p'];
    const attempts = [];

    if (deviceId) {
      attempts.push({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.frameRate }
        }
      });
      attempts.push({
        video: {
          deviceId: deviceId,
          width: { ideal: preset.width },
          height: { ideal: preset.height }
        }
      });
    }

    if (facingMode || this.currentFacingMode) {
      const fm = facingMode || this.currentFacingMode;
      attempts.push({
        video: {
          facingMode: { exact: fm },
          width: { ideal: preset.width },
          height: { ideal: preset.height }
        }
      });
      attempts.push({
        video: {
          facingMode: { ideal: fm },
          width: { ideal: preset.width },
          height: { ideal: preset.height }
        }
      });
    }

    attempts.push({
      video: {
        width: { ideal: preset.width },
        height: { ideal: preset.height }
      }
    });

    attempts.push({ video: true });

    let newStream = null;
    let lastErr = null;

    for (const constraints of attempts) {
      try {
        newStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (newStream && newStream.getVideoTracks().length > 0) {
          break;
        }
      } catch (err) {
        lastErr = err;
        console.warn('[WebRTC] Camera constraint attempt failed, trying fallback:', constraints.video, err);
      }
    }

    if (!newStream || newStream.getVideoTracks().length === 0) {
      console.error('[WebRTC] All attempts to switch camera failed:', lastErr);
      return false;
    }

    const newTrack = newStream.getVideoTracks()[0];
    const settings = newTrack.getSettings ? newTrack.getSettings() : {};
    if (settings.deviceId) this.selectedVideoDeviceId = settings.deviceId;
    if (settings.facingMode) this.currentFacingMode = settings.facingMode;

    if (!this.localStream) {
      this.localStream = new MediaStream([newTrack]);
    } else {
      this.localStream.addTrack(newTrack);
    }

    if (sender) {
      try {
        await sender.replaceTrack(newTrack);
      } catch (e) {
        console.warn('[WebRTC] sender.replaceTrack note:', e);
      }
    } else {
      this.cameraTrackBeforeShare = newTrack;
    }

    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      localVideo.srcObject = this.localStream;
      localVideo.play().catch(e => console.warn('localVideo play error:', e));
    }

    if (window.setuMeeting) {
      window.setuMeeting.updateLocalVideoDisplay(true);
    }

    return true;
  }

  /**
   * Flips between available cameras (front user-facing vs back environment-facing on mobile, or next webcam).
   */
  async flipCamera() {
    try {
      // 1. Identify current track and facing mode
      const curTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null;
      const curSettings = curTrack?.getSettings ? curTrack.getSettings() : {};
      const curDeviceId = curSettings.deviceId || this.selectedVideoDeviceId;
      const curFacing = curSettings.facingMode || this.currentFacingMode || 'user';

      // Next facing mode
      const nextFacing = (curFacing === 'environment') ? 'user' : 'environment';

      // 2. Enumerate available video inputs
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');

      let targetDeviceId = null;

      if (videoDevices.length > 1) {
        // Try matching next facing mode by device label (e.g. front / back / rear)
        const targetByLabel = videoDevices.find(d => {
          const l = (d.label || '').toLowerCase();
          if (nextFacing === 'environment') {
            return l.includes('back') || l.includes('rear') || l.includes('environment');
          } else {
            return l.includes('front') || l.includes('user') || l.includes('face');
          }
        });

        if (targetByLabel && targetByLabel.deviceId !== curDeviceId) {
          targetDeviceId = targetByLabel.deviceId;
        } else {
          // Fallback to round-robin index cycling
          const curIdx = videoDevices.findIndex(d => d.deviceId === curDeviceId);
          const nextIdx = (curIdx >= 0) ? (curIdx + 1) % videoDevices.length : 1;
          targetDeviceId = videoDevices[nextIdx]?.deviceId || null;
        }
      }

      // Delegate to switchVideoDevice with hardware release and fallback chain
      return await this.switchVideoDevice(targetDeviceId, nextFacing);
    } catch (err) {
      console.warn('[WebRTC] flipCamera error:', err);
      return false;
    }
  }

  /**
   * Switches speaker/audio output sink if supported by browser.
   * Routes remote inbound audio to the chosen sink (earpiece, speakerphone, bluetooth).
   */
  async switchAudioOutput(targetOrSinkId, sinkId = null) {
    let target = document.getElementById('remoteAudio');
    let id = targetOrSinkId;

    if (targetOrSinkId && typeof targetOrSinkId === 'object' && 'setSinkId' in targetOrSinkId) {
      target = targetOrSinkId;
      id = sinkId;
    }

    if (id) {
      this.selectedAudioOutputId = id;
    }

    if (target && typeof target.setSinkId === 'function' && id) {
      try {
        await target.setSinkId(id);
        return true;
      } catch (err) {
        console.warn('[WebRTC] setSinkId failed:', err);
      }
    }
    return false;
  }

  /**
   * Triggers native system audio output dialog if supported (Android / Chrome 110+).
   */
  async selectAudioOutputDialog() {
    if (typeof navigator.mediaDevices?.selectAudioOutput === 'function') {
      try {
        const chosen = await navigator.mediaDevices.selectAudioOutput();
        if (chosen && chosen.deviceId) {
          await this.switchAudioOutput(chosen.deviceId);
          return chosen;
        }
      } catch (err) {
        if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
          console.warn('[WebRTC] selectAudioOutput note:', err);
        }
      }
    }
    return null;
  }

  /**
   * Sets microphone mute state across local capture and WebRTC senders.
   */
  setAudioMute(muted) {
    this.isAudioMuted = !!muted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => {
        if (!this.dummyAudioTrack || t !== this.dummyAudioTrack) {
          t.enabled = !this.isAudioMuted;
        }
      });
    }
    if (this.pc) {
      this.pc.getSenders().forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
          // Never unmute a dummy audio track placeholder; only real microphones transmit
          if (this.dummyAudioTrack && sender.track === this.dummyAudioTrack) {
            sender.track.enabled = false;
          } else {
            sender.track.enabled = !this.isAudioMuted;
          }
        }
      });
    }

    this.broadcastMediaState();
  }

  /**
   * Sets video mute state with full hardware release:
   * When video is turned off, the track is explicitly STOPPED so the camera hardware
   * and physical webcam indicator light turn completely off.
   */
  async setVideoMute(muted) {
    this.isVideoMuted = !!muted;

    if (this.isVideoMuted) {
      // 1. Release hardware camera: stop existing video tracks so webcam LED light turns off
      if (this.localStream) {
        this.localStream.getVideoTracks().forEach(track => {
          track.stop();
          this.localStream.removeTrack(track);
        });
      }

      // 2. Set camera sender to disabled dummy track so SSRC pipeline remains warm
      if (this.videoSender) {
        const dummy = this.dummyCamTrack || this.createDummyVideoTrack();
        this.dummyCamTrack = dummy;
        try {
          await this.videoSender.replaceTrack(dummy);
        } catch (e) {
          try { await this.videoSender.replaceTrack(null); } catch (_) {}
        }
      }

      if (window.setuMeeting) {
        window.setuMeeting.updateLocalVideoDisplay(false);
      }
    } else {
      // Camera turned ON: re-acquire media from hardware device
      try {
        let newStream = null;
        const preset = CAMERA_QUALITY_PRESETS[this.currentCameraPreset] || CAMERA_QUALITY_PRESETS['720p'];
        const attempts = [];

        if (this.selectedVideoDeviceId) {
          attempts.push({
            video: {
              deviceId: { exact: this.selectedVideoDeviceId },
              width: { ideal: preset.width },
              height: { ideal: preset.height }
            }
          });
          attempts.push({
            video: {
              deviceId: this.selectedVideoDeviceId,
              width: { ideal: preset.width },
              height: { ideal: preset.height }
            }
          });
        }

        if (this.currentFacingMode) {
          attempts.push({
            video: {
              facingMode: { ideal: this.currentFacingMode },
              width: { ideal: preset.width },
              height: { ideal: preset.height }
            }
          });
        }

        attempts.push({
          video: {
            width: { ideal: preset.width },
            height: { ideal: preset.height }
          }
        });
        attempts.push({ video: true });

        for (const constraints of attempts) {
          try {
            newStream = await navigator.mediaDevices.getUserMedia(constraints);
            if (newStream && newStream.getVideoTracks().length > 0) {
              break;
            }
          } catch (_) {}
        }

        if (!newStream || newStream.getVideoTracks().length === 0) {
          throw new Error('Unable to re-acquire camera stream');
        }

        const newTrack = newStream.getVideoTracks()[0];
        const s = newTrack.getSettings ? newTrack.getSettings() : {};
        if (s.deviceId) this.selectedVideoDeviceId = s.deviceId;
        if (s.facingMode) this.currentFacingMode = s.facingMode;

        if (this.localStream) {
          this.localStream.addTrack(newTrack);
        }

        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
          localVideo.srcObject = this.localStream;
          localVideo.play().catch(e => console.warn('localVideo play error:', e));
        }

        if (this.videoSender) {
          await this.videoSender.replaceTrack(newTrack);
        }

        if (window.setuMeeting) {
          window.setuMeeting.updateLocalVideoDisplay(true);
        }
      } catch (err) {
        console.error('Error re-activating camera hardware:', err);
        this.isVideoMuted = true;
        if (window.showToast) {
          window.showToast('Could not access camera. It may be in use by another tab or app.');
        }
        if (window.setuMeeting) {
          window.setuMeeting.updateCamButton(true);
          window.setuMeeting.updateLocalVideoDisplay(false);
        }
      }
    }

    this.broadcastMediaState();
  }

  broadcastMediaState() {
    this.sendData('control', JSON.stringify({
      type: 'media-state',
      audio: !this.isAudioMuted,
      video: !this.isVideoMuted
    }));
  }

  /**
   * Applies camera quality preset (240p, 360p, 480p, 720p, 1080p).
   */
  async applyCameraQuality(presetKey = '720p') {
    this.currentCameraPreset = presetKey;
    const preset = CAMERA_QUALITY_PRESETS[presetKey] || CAMERA_QUALITY_PRESETS['720p'];

    if (this.localStream) {
      const track = this.localStream.getVideoTracks()[0];
      if (track && track.readyState === 'live') {
        try {
          await track.applyConstraints({
            width: { ideal: preset.width, max: preset.width },
            height: { ideal: preset.height, max: preset.height },
            frameRate: { ideal: preset.frameRate, max: preset.frameRate }
          });
        } catch (e) {
          console.warn('Could not apply track constraints:', e);
        }
      }
    }

    if (this.videoSender && typeof this.videoSender.getParameters === 'function') {
      try {
        const params = this.videoSender.getParameters();
        if (params && params.encodings && params.encodings.length > 0) {
          params.encodings[0].maxBitrate = preset.maxBitrate;
          await this.videoSender.setParameters(params);
        }
      } catch (e) {
        console.warn('Could not set sender bitrate parameters:', e);
      }
    }
  }

  /**
   * Sets screen-sharing mode (sharpness, balanced, motion).
   */
  setScreenShareMode(modeKey = 'sharpness') {
    this.currentScreenMode = modeKey;
    const preset = SCREEN_SHARE_PRESETS[modeKey] || SCREEN_SHARE_PRESETS['sharpness'];
    if (this.screenStream) {
      const track = this.screenStream.getVideoTracks()[0];
      if (track) {
        if ('contentHint' in track) track.contentHint = preset.contentHint;
        try {
          track.applyConstraints({
            frameRate: { max: preset.maxFramerate }
          });
        } catch (e) {}
      }
    }
  }

  /**
   * Automatically elevates screen share framerate to 60/30 FPS during an active remote control session.
   */
  setRemoteControlActive(isActive) {
    if (this.screenStream) {
      const track = this.screenStream.getVideoTracks()[0];
      if (track) {
        try {
          if (isActive) {
            track.contentHint = 'motion';
            track.applyConstraints({
              frameRate: { ideal: 60, max: 60 }
            }).catch(() => {
              track.applyConstraints({ frameRate: { ideal: 30, max: 30 } }).catch(() => {});
            });
          } else {
            const preset = SCREEN_SHARE_PRESETS[this.currentScreenMode] || SCREEN_SHARE_PRESETS['sharpness'];
            track.contentHint = preset.contentHint;
            track.applyConstraints({
              frameRate: { max: preset.maxFramerate }
            }).catch(() => {});
          }
        } catch (_) {}
      }
    }
  }

  /**
   * Dynamic degradation when network is struggling.
   */
  async adaptQualityDegradation(isDegraded) {
    if (!this.videoSender || typeof this.videoSender.getParameters !== 'function') return;
    try {
      const params = this.videoSender.getParameters();
      if (params && params.encodings && params.encodings.length > 0) {
        params.encodings[0].scaleResolutionDownBy = isDegraded ? 2 : 1;
        if (isDegraded) {
          params.encodings[0].maxBitrate = 150000;
        } else {
          const preset = CAMERA_QUALITY_PRESETS[this.currentCameraPreset || '720p'];
          params.encodings[0].maxBitrate = preset.maxBitrate;
        }
        await this.videoSender.setParameters(params);
      }
    } catch (e) {
      console.warn('adaptQualityDegradation error:', e);
    }
  }

  /**
   * Extracts candidate IP addresses from SDP text.
   */
  extractIpsFromSdp(sdp) {
    if (!sdp) return [];
    const ips = [];
    const regex = /a=candidate:[^\s]+\s+\d+\s+([a-zA-Z]+)\s+\d+\s+([0-9a-fA-F.:]+)\s+(\d+)\s+typ\s+([a-zA-Z]+)/g;
    let m;
    while ((m = regex.exec(sdp)) !== null) {
      ips.push({ protocol: m[1].toUpperCase(), ip: m[2], port: m[3], type: m[4] });
    }
    const cMatch = sdp.match(/c=IN\s+IP[46]\s+([0-9a-fA-F.:]+)/);
    if (cMatch && cMatch[1] && cMatch[1] !== '0.0.0.0' && !ips.some(i => i.ip === cMatch[1])) {
      ips.push({ protocol: 'UDP', ip: cMatch[1], port: '', type: 'host' });
    }
    return ips;
  }

  createDummyVideoTrack() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 16, 16);
      }
      const stream = canvas.captureStream ? canvas.captureStream(1) : null;
      if (stream && stream.getVideoTracks().length > 0) {
        const track = stream.getVideoTracks()[0];
        track.enabled = false;
        return track;
      }
    } catch (e) {
      console.warn('[WebRTC] Dummy video track creation note:', e);
    }
    return null;
  }

  createDummyAudioTrack() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        // Generate pure digital silence buffer (all samples 0.0, strictly no sinusoidal frequency)
        const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        // Route through zero-gain node to guarantee absolute zero sound output
        const silentGain = ctx.createGain();
        silentGain.gain.setValueAtTime(0, ctx.currentTime);
        silentGain.gain.value = 0;

        const dst = ctx.createMediaStreamDestination();
        source.connect(silentGain);
        silentGain.connect(dst);
        source.start();

        const track = dst.stream.getAudioTracks()[0];
        if (track) {
          track.enabled = false;
        }
        this.dummyAudioCtx = ctx;
        return track;
      }
    } catch (e) {
      console.warn('[WebRTC] Dummy audio track creation note:', e);
    }
    return null;
  }

  /**
   * Initializes RTCPeerConnection and binds listeners without pre-allocating transceivers.
   */
  initPeerConnectionBase() {
    if (this.pc) {
      this.close();
    }

    const config = {
      iceServers: this.iceServers,
      iceCandidatePoolSize: 2
    };

    this.pc = new RTCPeerConnection(config);
    this.remoteStream = new MediaStream();

    // Remote track listener
    this.pc.ontrack = (event) => {
      const track = event.track;
      const trans = event.transceiver;
      console.log('[WebRTC] ontrack received:', track.kind, 'mid:', trans?.mid, 'trackId:', track.id);

      const isScreen = (trans && trans.mid === '2') || (this.screenTransceiver && trans === this.screenTransceiver);
      const isCam = (trans && trans.mid === '1') || (this.camTransceiver && trans === this.camTransceiver) || (track.kind === 'video' && !isScreen);
      const isAudio = (trans && trans.mid === '0') || (track.kind === 'audio');

      if (isScreen) {
        this.remoteScreenTrack = track;
        this.remoteScreenStream = new MediaStream([track]);
        if (this.onRemoteScreenStream) this.onRemoteScreenStream(this.remoteScreenStream);
      } else if (isCam) {
        this.remoteCameraTrack = track;
        this.remoteCameraStream = new MediaStream([track]);
        this.remoteStream = this.remoteCameraStream;
        if (this.remoteAudioTrack && !this.remoteStream.getTracks().includes(this.remoteAudioTrack)) {
          this.remoteStream.addTrack(this.remoteAudioTrack);
        }
        if (this.onRemoteStream) this.onRemoteStream(this.remoteCameraStream);
      } else if (isAudio) {
        this.remoteAudioTrack = track;
        if (this.remoteStream && !this.remoteStream.getTracks().includes(track)) {
          this.remoteStream.addTrack(track);
        }
        const audioEl = document.getElementById('remoteAudio');
        if (audioEl) {
          audioEl.srcObject = new MediaStream([track]);
          if (this.selectedAudioOutputId && typeof audioEl.setSinkId === 'function') {
            audioEl.setSinkId(this.selectedAudioOutputId).catch(() => {});
          }
          audioEl.play().catch(async () => {
            const unlock = () => {
              audioEl.play().catch(() => {});
              window.removeEventListener('click', unlock);
            };
            window.addEventListener('click', unlock);
          });
        }
      }

      track.addEventListener('unmute', () => {
        console.log('[WebRTC] track unmute event:', track.kind, trans?.mid);
        if (isScreen) {
          if (this.onRemoteScreenStream) {
            this.onRemoteScreenStream(this.remoteScreenStream || new MediaStream([track]));
          }
        } else if (isCam) {
          if (this.onRemoteStream) {
            this.onRemoteStream(this.remoteCameraStream || new MediaStream([track]));
          }
        }
      });
    };

    // Connection state changes
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      console.log('[WebRTC] Connection state:', state);
      if (state === 'failed') {
        if (this.onNatTraversalFailed) this.onNatTraversalFailed();
      }
      if (this.onStateChange) this.onStateChange(state);
    };

    this.pc.oniceconnectionstatechange = () => {
      const iceState = this.pc.iceConnectionState;
      console.log('[WebRTC] ICE connection state:', iceState);
      if (iceState === 'failed') {
        if (this.onNatTraversalFailed) this.onNatTraversalFailed();
      }
    };

    // Inbound DataChannel listener (for Answer side)
    this.pc.ondatachannel = (event) => {
      const channel = event.channel;
      this.bindDataChannel(channel.label, channel);
    };

    return this.pc;
  }

  /**
   * Creates RTCPeerConnection and adds initial Offer transceivers.
   */
  createPeerConnection() {
    this.initPeerConnectionBase();

    // STEP 1: Strict Audio Ordering (Always Transceiver index 0 -> mid:0)
    const hasLocalAudio = !!(this.localStream && this.localStream.getAudioTracks().length > 0);
    const localAudioTrack = hasLocalAudio
      ? this.localStream.getAudioTracks()[0]
      : this.createDummyAudioTrack();
    this.dummyAudioTrack = hasLocalAudio ? null : localAudioTrack;

    if (localAudioTrack) {
      localAudioTrack.enabled = !this.isAudioMuted && hasLocalAudio;
      this.audioTransceiver = this.pc.addTransceiver(localAudioTrack, {
        direction: 'sendrecv',
        streams: [this.localStream || new MediaStream([localAudioTrack])]
      });
      this.audioSender = this.audioTransceiver.sender;
    } else {
      this.audioTransceiver = this.pc.addTransceiver('audio', { direction: 'sendrecv' });
      this.audioSender = this.audioTransceiver.sender;
    }

    // STEP 2: Strict Camera Video Ordering (Always Transceiver index 1 -> mid:1)
    const localCamTrack = (this.localStream && this.localStream.getVideoTracks().length > 0 && !this.isVideoMuted)
      ? this.localStream.getVideoTracks()[0]
      : this.createDummyVideoTrack();
    this.dummyCamTrack = localCamTrack;

    if (localCamTrack) {
      localCamTrack.enabled = !this.isVideoMuted && (this.localStream && this.localStream.getVideoTracks().length > 0);
      this.camTransceiver = this.pc.addTransceiver(localCamTrack, {
        direction: 'sendrecv',
        streams: [this.localStream || new MediaStream([localCamTrack])]
      });
      this.videoSender = this.camTransceiver.sender;
    } else {
      this.camTransceiver = this.pc.addTransceiver('video', { direction: 'sendrecv' });
      this.videoSender = this.camTransceiver.sender;
    }

    // STEP 3: Strict Screen Sharing Video Ordering (Always Transceiver index 2 -> mid:2)
    const dummyScreen = this.createDummyVideoTrack();
    this.dummyScreenTrack = dummyScreen;
    if (dummyScreen) {
      dummyScreen.enabled = false;
      this.screenTransceiver = this.pc.addTransceiver(dummyScreen, {
        direction: 'sendrecv',
        streams: [new MediaStream([dummyScreen])]
      });
      this.screenSender = this.screenTransceiver.sender;
    } else {
      this.screenTransceiver = this.pc.addTransceiver('video', { direction: 'sendrecv' });
      this.screenSender = this.screenTransceiver.sender;
    }

    return this.pc;
  }

  /**
   * Binds event handlers to a DataChannel.
   */
  bindDataChannel(label, channel) {
    if (label === 'chat' || label === 'control' || label === 'mouse' || label === 'file') {
      this.channels[label] = channel;
    }

    if (label === 'file') {
      channel.binaryType = 'arraybuffer';
    }

    channel.onopen = () => {
      console.log(`[DataChannel] ${label} opened`);
      if (label === 'control') {
        // Immediately sync media state upon open
        this.broadcastMediaState();
        if (this.onControlChannelOpen) {
          this.onControlChannelOpen();
        }
      }
    };

    channel.onclose = () => {
      console.log(`[DataChannel] ${label} closed`);
    };

    channel.onmessage = (event) => {
      if (this.onChannelMessage) {
        this.onChannelMessage(label, event.data);
      }
    };
  }

  /**
   * Creates outbound DataChannels (used by the Host / Offer initiator).
   */
  createDataChannels() {
    this.channels.chat = this.pc.createDataChannel('chat', { ordered: true });
    this.bindDataChannel('chat', this.channels.chat);

    this.channels.control = this.pc.createDataChannel('control', { ordered: true });
    this.bindDataChannel('control', this.channels.control);

    // Dedicated high-frequency unordered channel for zero-latency mouse movements
    this.channels.mouse = this.pc.createDataChannel('mouse', { ordered: false, maxRetransmits: 0 });
    this.bindDataChannel('mouse', this.channels.mouse);

    this.channels.file = this.pc.createDataChannel('file', { ordered: true });
    this.channels.file.binaryType = 'arraybuffer';
    this.bindDataChannel('file', this.channels.file);
  }

  /**
   * Non-Trickle ICE Gathering Promise.
   */
  waitForIceGathering() {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      let timeoutId = null;

      const checkState = () => {
        if (this.onIceGatheringProgress) {
          this.onIceGatheringProgress(this.pc.iceGatheringState);
        }
        if (this.pc.iceGatheringState === 'complete') {
          cleanup();
          resolve();
        }
      };

      const onIceCandidate = (event) => {
        if (event.candidate === null) {
          cleanup();
          resolve();
        } else {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            console.log('[WebRTC] ICE candidate quiet timeout reached; finalizing payload.');
            cleanup();
            resolve();
          }, 3500);
        }
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.pc.removeEventListener('icecandidate', onIceCandidate);
        this.pc.removeEventListener('icegatheringstatechange', checkState);
      };

      this.pc.addEventListener('icecandidate', onIceCandidate);
      this.pc.addEventListener('icegatheringstatechange', checkState);

      timeoutId = setTimeout(() => {
        console.warn('[WebRTC] Max ICE gathering timeout hit.');
        cleanup();
        resolve();
      }, 8000);
    });
  }

  /**
   * Generates Host Offer with Non-Trickle ICE.
   */
  async createOffer() {
    this.isInitiator = true;
    this.createPeerConnection();
    this.createDataChannels();

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    if (this.onIceGatheringProgress) {
      this.onIceGatheringProgress('gathering');
    }

    await this.waitForIceGathering();
    if (this.pc.localDescription) {
      this.localCandidateIps = this.extractIpsFromSdp(this.pc.localDescription.sdp);
    }
    return this.pc.localDescription;
  }

  /**
   * Generates Join Answer given a remote Offer with Non-Trickle ICE.
   */
  async createAnswer(remoteOfferSdp) {
    this.isInitiator = false;
    this.initPeerConnectionBase();

    await this.pc.setRemoteDescription(new RTCSessionDescription({
      type: 'offer',
      sdp: remoteOfferSdp
    }));
    this.remoteCandidateIps = this.extractIpsFromSdp(remoteOfferSdp);

    // Synchronize and configure the transceivers created by the remote offer
    const transceivers = this.pc.getTransceivers();
    const audioTrans = transceivers.find(t => t.mid === '0') || transceivers[0];
    const camTrans = transceivers.find(t => t.mid === '1') || transceivers[1];
    const screenTrans = transceivers.find(t => t.mid === '2') || transceivers[2];

    // Configure Audio Transceiver (MID 0)
    if (audioTrans) {
      audioTrans.direction = 'sendrecv';
      const hasLocalAudio = !!(this.localStream && this.localStream.getAudioTracks().length > 0);
      const localAudioTrack = hasLocalAudio
        ? this.localStream.getAudioTracks()[0]
        : this.createDummyAudioTrack();
      this.dummyAudioTrack = hasLocalAudio ? null : localAudioTrack;
      if (localAudioTrack) {
        localAudioTrack.enabled = !this.isAudioMuted && hasLocalAudio;
        try { await audioTrans.sender.replaceTrack(localAudioTrack); } catch (e) { console.warn('audio replaceTrack:', e); }
      }
      this.audioTransceiver = audioTrans;
      this.audioSender = audioTrans.sender;
    }

    // Configure Camera Transceiver (MID 1)
    if (camTrans) {
      camTrans.direction = 'sendrecv';
      const localCamTrack = (this.localStream && this.localStream.getVideoTracks().length > 0 && !this.isVideoMuted)
        ? this.localStream.getVideoTracks()[0]
        : this.createDummyVideoTrack();
      this.dummyCamTrack = localCamTrack;
      if (localCamTrack) {
        localCamTrack.enabled = !this.isVideoMuted && (this.localStream && this.localStream.getVideoTracks().length > 0);
        try { await camTrans.sender.replaceTrack(localCamTrack); } catch (e) { console.warn('cam replaceTrack:', e); }
      }
      this.camTransceiver = camTrans;
      this.videoSender = camTrans.sender;
    }

    // Configure Screen Transceiver (MID 2)
    if (screenTrans) {
      screenTrans.direction = 'sendrecv';
      const dummyScreen = this.createDummyVideoTrack();
      this.dummyScreenTrack = dummyScreen;
      if (dummyScreen) {
        dummyScreen.enabled = false;
        try { await screenTrans.sender.replaceTrack(dummyScreen); } catch (e) { console.warn('screen replaceTrack:', e); }
      }
      this.screenTransceiver = screenTrans;
      this.screenSender = screenTrans.sender;
    }

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    if (this.onIceGatheringProgress) {
      this.onIceGatheringProgress('gathering');
    }

    await this.waitForIceGathering();
    if (this.pc.localDescription) {
      this.localCandidateIps = this.extractIpsFromSdp(this.pc.localDescription.sdp);
    }
    return this.pc.localDescription;
  }

  /**
   * Finalizes the Host connection by applying the remote Answer.
   */
  async applyAnswer(remoteAnswerSdp) {
    if (!this.pc) throw new Error('PeerConnection is not initialized.');
    await this.pc.setRemoteDescription(new RTCSessionDescription({
      type: 'answer',
      sdp: remoteAnswerSdp
    }));
    this.remoteCandidateIps = this.extractIpsFromSdp(remoteAnswerSdp);
    this.syncTransceiverSenders();
  }

  /**
   * Re-aligns internal sender references to the actual transceivers on the RTCPeerConnection.
   */
  syncTransceiverSenders() {
    if (!this.pc) return;
    const transceivers = this.pc.getTransceivers();
    const audioTrans = transceivers.find(t => t.mid === '0') || transceivers.find(t => t.receiver?.track?.kind === 'audio');
    const camTrans = transceivers.find(t => t.mid === '1') || transceivers.filter(t => t.receiver?.track?.kind === 'video')[0];
    const screenTrans = transceivers.find(t => t.mid === '2') || transceivers.filter(t => t.receiver?.track?.kind === 'video')[1];

    if (audioTrans) {
      this.audioTransceiver = audioTrans;
      this.audioSender = audioTrans.sender;
    }
    if (camTrans) {
      this.camTransceiver = camTrans;
      this.videoSender = camTrans.sender;
    }
    if (screenTrans) {
      this.screenTransceiver = screenTrans;
      this.screenSender = screenTrans.sender;
    }
  }

  /**
   * Sends data over a specific DataChannel.
   */
  sendData(channelName, data) {
    const channel = this.channels[channelName];
    if (channel && channel.readyState === 'open') {
      channel.send(data);
      return true;
    }
    return false;
  }

  /**
   * Screen sharing toggle with sharer preview and peer notification.
   */
  async startScreenShare() {
    try {
      const modeKey = this.currentScreenMode || 'sharpness';
      const preset = SCREEN_SHARE_PRESETS[modeKey] || SCREEN_SHARE_PRESETS['sharpness'];

      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          frameRate: { ideal: preset.maxFramerate, max: preset.maxFramerate }
        },
        audio: true
      });

      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (screenTrack && 'contentHint' in screenTrack) {
        screenTrack.contentHint = preset.contentHint;
      }
      screenTrack.enabled = true;

      // Replace track on the dedicated screen sender
      this.syncTransceiverSenders();
      if (this.screenSender) {
        await this.screenSender.replaceTrack(screenTrack);
      }

      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      this.sendData('control', JSON.stringify({
        type: 'screen-share-status',
        active: true
      }));

      if (this.onScreenShareStarted) {
        this.onScreenShareStarted(this.screenStream);
      }

      return this.screenStream;
    } catch (err) {
      console.error('Error starting screen share:', err);
      throw err;
    }
  }

  async stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }

    this.syncTransceiverSenders();
    if (this.screenSender) {
      const dummy = this.dummyScreenTrack || this.createDummyVideoTrack();
      this.dummyScreenTrack = dummy;
      try {
        await this.screenSender.replaceTrack(dummy);
      } catch (e) {
        try { await this.screenSender.replaceTrack(null); } catch (_) {}
      }
    }

    this.sendData('control', JSON.stringify({
      type: 'screen-share-status',
      active: false
    }));

    if (this.onScreenShareStopped) {
      this.onScreenShareStopped();
    }
  }

  /**
   * Retrieves the true presentation stream from remote peer.
   * Directly extracts the dedicated screen transceiver track if available.
   */
  getRemoteScreenStream() {
    if (this.remoteScreenTrack && this.remoteScreenTrack.readyState === 'live') {
      if (!this.remoteScreenStream || !this.remoteScreenStream.getTracks().includes(this.remoteScreenTrack)) {
        this.remoteScreenStream = new MediaStream([this.remoteScreenTrack]);
      }
      return this.remoteScreenStream;
    }

    if (this.pc) {
      const trans = this.pc.getTransceivers().find(t => t.mid === '2') ||
                    this.pc.getTransceivers().filter(t => t.receiver?.track?.kind === 'video')[1];
      if (trans && trans.receiver?.track) {
        this.remoteScreenTrack = trans.receiver.track;
        this.remoteScreenStream = new MediaStream([this.remoteScreenTrack]);
        return this.remoteScreenStream;
      }
    }

    return this.remoteScreenStream;
  }

  /**
   * Retrieves the remote camera stream.
   */
  getRemoteCameraStream() {
    if (this.remoteCameraTrack && this.remoteCameraTrack.readyState === 'live') {
      if (!this.remoteCameraStream || !this.remoteCameraStream.getTracks().includes(this.remoteCameraTrack)) {
        this.remoteCameraStream = new MediaStream([this.remoteCameraTrack]);
      }
      return this.remoteCameraStream;
    }

    if (this.pc) {
      const trans = this.pc.getTransceivers().find(t => t.mid === '1') ||
                    this.pc.getTransceivers().filter(t => t.receiver?.track?.kind === 'video')[0];
      if (trans && trans.receiver?.track) {
        this.remoteCameraTrack = trans.receiver.track;
        this.remoteCameraStream = new MediaStream([this.remoteCameraTrack]);
        return this.remoteCameraStream;
      }
    }

    return this.remoteStream;
  }

  /**
   * Cleanly closes streams and connection.
   */
  close() {
    try {
      if (this.dummyScreenTrack) {
        try { this.dummyScreenTrack.stop(); } catch (e) {}
        this.dummyScreenTrack = null;
      }
      if (this.dummyCamTrack) {
        try { this.dummyCamTrack.stop(); } catch (e) {}
        this.dummyCamTrack = null;
      }
      if (this.dummyAudioTrack) {
        try { this.dummyAudioTrack.stop(); } catch (e) {}
        this.dummyAudioTrack = null;
      }
      if (this.dummyAudioCtx) {
        try { this.dummyAudioCtx.close(); } catch (e) {}
        this.dummyAudioCtx = null;
      }
      if (this.screenStream) {
        this.screenStream.getTracks().forEach(t => {
          try { t.stop(); } catch (e) {}
        });
        this.screenStream = null;
      }
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => {
          try { t.stop(); } catch (e) {}
        });
        this.localStream = null;
      }
      if (this.remoteStream) {
        this.remoteStream.getTracks().forEach(t => {
          try { t.stop(); } catch (e) {}
        });
        this.remoteStream = null;
      }
      if (this.remoteScreenStream) {
        this.remoteScreenStream.getTracks().forEach(t => {
          try { t.stop(); } catch (e) {}
        });
        this.remoteScreenStream = null;
      }
      if (this.channels) {
        Object.values(this.channels).forEach(ch => {
          try { if (ch && ch.readyState !== 'closed') ch.close(); } catch (e) {}
        });
      }
      this.channels = {};
      if (this.pc) {
        try { this.pc.close(); } catch (e) {}
        this.pc = null;
      }
      this.videoSender = null;
      this.screenTrackSender = null;
      this.cameraTrackBeforeShare = null;
      this.localCandidateIps = [];
      this.remoteCandidateIps = [];
      this.isInitiator = false;
    } catch (err) {
      console.warn('[WebRTC] Error during clean close:', err);
    }
  }
}

// Global instance
window.setuWebRTC = new WebRTCManager();
