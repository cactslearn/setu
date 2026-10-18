/**
 * Setu P2P - Consensual Local Recording Module
 * Dual-consent recording with MediaRecorder and Web Audio API mixing.
 * Strictly zero cloud upload; recorded files are downloaded locally or discarded.
 */

class MeetingRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.consentGranted = false;
    this.startTime = null;
    this.timerInterval = null;

    this.compositeCanvas = null;
    this.compositeCtx = null;
    this.compositeRafId = null;
    this.compositeTimerId = null;

    this.onRecordingStateChange = null;
    this.onConsentRequested = null;
  }

  /**
   * Step 1: Request mutual consent before starting recording.
   * If solo in the meeting room, starts directly without blocking.
   */
  requestConsent() {
    const isPeerConnected = window.setuWebRTC && window.setuWebRTC.pc && window.setuWebRTC.pc.connectionState === 'connected';

    // Solo mode: No peer in the room, so start recording directly without waiting for nonexistent remote consent
    if (!isPeerConnected) {
      if (window.showToast) window.showToast('Starting recording in solo mode...');
      this.consentGranted = true;
      this.startLocalRecording();
      return;
    }

    if (!window.setuWebRTC || !window.setuWebRTC.channels?.control || window.setuWebRTC.channels.control.readyState !== 'open') {
      if (window.showToast) window.showToast('Cannot start recording: Connection channel is not ready.');
      return;
    }

    if (window.showToast) window.showToast('Requesting recording consent from participant...');

    const requestPacket = JSON.stringify({
      type: 'recording-consent-request',
      requesterName: window.setuMeeting?.localDisplayName || 'Participant'
    });
    window.setuWebRTC.sendData('control', requestPacket);
  }

  /**
   * Handle incoming recording consent request from peer via non-blocking in-app banner.
   */
  handleConsentRequest(requesterName) {
    const banner = document.getElementById('recordingConsentBanner');
    const details = document.getElementById('recordingConsentDetails');
    const acceptBtn = document.getElementById('acceptRecordingBtn');
    const declineBtn = document.getElementById('declineRecordingBtn');

    if (banner && acceptBtn && declineBtn) {
      const name = requesterName || window.setuMeeting?.remotePeerName || 'Remote participant';
      if (details) {
        details.textContent = `${name} wants to record this meeting's audio and video. Do you grant consent?`;
      }
      banner.classList.add('open');

      acceptBtn.onclick = () => {
        banner.classList.remove('open');
        this.respondToConsent(true);
        if (window.showToast) window.showToast('You granted recording consent');
      };

      declineBtn.onclick = () => {
        banner.classList.remove('open');
        this.respondToConsent(false);
        if (window.showToast) window.showToast('You declined recording consent');
      };
    } else {
      const consent = confirm('Remote peer wishes to record this meeting. Do you grant consent?');
      this.respondToConsent(consent);
    }
  }

  respondToConsent(granted) {
    if (!window.setuWebRTC || !window.setuWebRTC.channels?.control || window.setuWebRTC.channels.control.readyState !== 'open') return;
    const responsePacket = JSON.stringify({
      type: 'recording-consent-response',
      granted: !!granted
    });
    window.setuWebRTC.sendData('control', responsePacket);
  }

  /**
   * Handle peer's response to recording consent.
   */
  handleConsentResponse(granted) {
    if (granted) {
      this.consentGranted = true;
      if (window.showToast) window.showToast('Consent granted! Starting local recording.');
      this.startLocalRecording();
    } else {
      this.consentGranted = false;
      if (window.showToast) {
        window.showToast('Recording canceled: The other participant declined recording consent.');
      }
    }
  }

  /**
   * Mixes audio and composites video from local & remote streams into a single stream.
   * Intelligently composites Screen Share, Remote Camera, or Local Video.
   */
  createCompositeStream() {
    const localStream = window.setuWebRTC ? window.setuWebRTC.localStream : null;
    const remoteStream = window.setuWebRTC ? window.setuWebRTC.remoteStream : null;

    // 1. Audio Mixing via Web Audio API
    let audioTracks = [];
    const hasLocalAudio = !!(localStream && localStream.getAudioTracks().length > 0);
    const hasRemoteAudio = !!(remoteStream && remoteStream.getAudioTracks().length > 0);

    if (hasLocalAudio || hasRemoteAudio) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioContextClass();
        if (audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
        const dest = audioCtx.createMediaStreamDestination();

        // Feed clock-synchronized silence to prevent MediaRecorder starvation during speech pauses
        try {
          const osc = audioCtx.createOscillator();
          const silentGain = audioCtx.createGain();
          silentGain.gain.value = 0;
          osc.connect(silentGain);
          silentGain.connect(dest);
          osc.start();
        } catch (e) {}

        if (hasLocalAudio) {
          try {
            const localSource = audioCtx.createMediaStreamSource(localStream);
            localSource.connect(dest);
          } catch (e) {
            console.warn('AudioSource localStream error:', e);
          }
        }
        if (hasRemoteAudio) {
          try {
            const remoteSource = audioCtx.createMediaStreamSource(remoteStream);
            remoteSource.connect(dest);
          } catch (e) {
            console.warn('AudioSource remoteStream error:', e);
          }
        }

        audioTracks = dest.stream.getAudioTracks();
      } catch (err) {
        console.warn('Failed to initialize audio mixer:', err);
      }
    }

    // 2. Video Compositing via 720p Canvas
    this.compositeCanvas = document.createElement('canvas');
    this.compositeCanvas.width = 1280;
    this.compositeCanvas.height = 720;
    this.compositeCtx = this.compositeCanvas.getContext('2d');

    const remoteVideoEl = document.getElementById('remoteVideo');
    const localVideoEl = document.getElementById('localVideo');
    const presVideoEl = document.getElementById('presentationVideo');

    const drawFrame = () => {
      if (!this.isRecording) return;

      this.compositeCtx.fillStyle = '#0a0d14';
      this.compositeCtx.fillRect(0, 0, 1280, 720);

      const isPresenting = window.setuMeeting && window.setuMeeting.isPresentationActive;

      // Draw Main Stage (Presentation Screen > Remote Video > Local Video for Solo)
      if (isPresenting && presVideoEl && presVideoEl.videoWidth) {
        this.compositeCtx.drawImage(presVideoEl, 0, 0, 1280, 720);
      } else if (remoteVideoEl && remoteVideoEl.videoWidth && remoteVideoEl.style.display !== 'none') {
        this.compositeCtx.drawImage(remoteVideoEl, 0, 0, 1280, 720);
      } else if (localVideoEl && localVideoEl.videoWidth) {
        this.compositeCtx.drawImage(localVideoEl, 0, 0, 1280, 720);
      } else {
        this.compositeCtx.fillStyle = '#1e293b';
        this.compositeCtx.fillRect(0, 0, 1280, 720);
        this.compositeCtx.fillStyle = '#94a3b8';
        this.compositeCtx.font = '24px sans-serif';
        this.compositeCtx.textAlign = 'center';
        this.compositeCtx.fillText('Setu Meeting Recording', 640, 360);
      }

      // Draw local video Picture-in-Picture bottom right if remote video or presentation is active
      const hasMainContent = (isPresenting && presVideoEl && presVideoEl.videoWidth) || (remoteVideoEl && remoteVideoEl.videoWidth && remoteVideoEl.style.display !== 'none');
      if (hasMainContent && localVideoEl && localVideoEl.videoWidth) {
        const pipW = 280;
        const pipH = 158;
        const pipX = 1280 - pipW - 20;
        const pipY = 720 - pipH - 20;

        this.compositeCtx.strokeStyle = 'rgba(255,255,255,0.3)';
        this.compositeCtx.lineWidth = 4;
        this.compositeCtx.strokeRect(pipX, pipY, pipW, pipH);
        this.compositeCtx.drawImage(localVideoEl, pipX, pipY, pipW, pipH);
      }

      if (!document.hidden) {
        this.compositeRafId = requestAnimationFrame(drawFrame);
      }
    };

    drawFrame();

    // Secondary heartbeat interval ensures continuous video frames even when the tab is in the background or minimized
    this.compositeTimerId = setInterval(() => {
      if (!this.isRecording) {
        clearInterval(this.compositeTimerId);
        return;
      }
      if (document.hidden) {
        drawFrame();
      }
    }, 100);

    const canvasVideoStream = this.compositeCanvas.captureStream(30);
    const mixedStream = new MediaStream([
      ...canvasVideoStream.getVideoTracks(),
      ...audioTracks
    ]);

    return mixedStream;
  }

  /**
   * Starts MediaRecorder.
   */
  startLocalRecording() {
    try {
      this.isRecording = true;
      const stream = this.createCompositeStream();
      this.recordedChunks = [];

      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8,opus';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = '';
      }

      const options = mimeType ? { mimeType } : undefined;
      this.mediaRecorder = new MediaRecorder(stream, options);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.handleRecordingStopped();
      };

      // 500ms timeslices ensure even quick or brief recordings capture valid chunks
      this.mediaRecorder.start(500);
      this.startTime = Date.now();

      // Notify peer that recording has actively started
      if (window.setuWebRTC && window.setuWebRTC.channels?.control?.readyState === 'open') {
        const notifyPacket = JSON.stringify({
          type: 'recording-status',
          active: true
        });
        window.setuWebRTC.sendData('control', notifyPacket);
      }

      if (this.onRecordingStateChange) {
        this.onRecordingStateChange(true);
      }
      if (window.showToast) window.showToast('Recording started.');
    } catch (err) {
      console.error('Failed to start recording:', err);
      if (window.showToast) window.showToast('Recording failed to start: ' + err.message);
    }
  }

  /**
   * Stops recording.
   */
  stopRecording() {
    if (!this.isRecording || !this.mediaRecorder) return;
    this.isRecording = false;

    if (this.compositeRafId) {
      cancelAnimationFrame(this.compositeRafId);
      this.compositeRafId = null;
    }
    if (this.compositeTimerId) {
      clearInterval(this.compositeTimerId);
      this.compositeTimerId = null;
    }

    try {
      // Flush buffered chunks before stopping to prevent 0-byte recordings
      if (this.mediaRecorder.state === 'recording') {
        try {
          this.mediaRecorder.requestData();
        } catch (e) {}
      }
      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    } catch (e) {
      console.warn('Error stopping mediaRecorder:', e);
    }

    // Notify peer
    if (window.setuWebRTC && window.setuWebRTC.channels?.control?.readyState === 'open') {
      try {
        const notifyPacket = JSON.stringify({
          type: 'recording-status',
          active: false
        });
        window.setuWebRTC.sendData('control', notifyPacket);
      } catch (e) {}
    }

    if (this.onRecordingStateChange) {
      this.onRecordingStateChange(false);
    }
  }

  /**
   * Handles saving recorded output cleanly with automatic download.
   */
  handleRecordingStopped() {
    const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
    const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);

    if (blob.size === 0) {
      if (window.showToast) window.showToast('Recording ended (no video data captured).');
      this.recordedChunks = [];
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `setu-meeting-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    if (window.showToast) {
      window.showToast(`Meeting recording saved (${sizeMb} MB) and downloaded.`);
    }

    this.recordedChunks = [];
  }
}

// Global instance
window.setuRecorder = new MeetingRecorder();
