/**
 * Setu Device Test Subsystem
 * Comprehensive hardware diagnostic and verification suite for:
 * 1. Camera & Video Preview (resolution, framerate, flip front/back)
 * 2. Microphone Input (real-time level meter, 4-second record & loopback test)
 * 3. Audio Output / Speaker (melodic chime playback, earpiece/speaker routing)
 */

class DeviceTestManager {
  constructor() {
    this.cameraStream = null;
    this.micStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.micMeterInterval = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.loopbackAudio = null;
    this.isRecordingLoopback = false;
    this.isPlayingSpeakerTest = false;
    this.speakerAudioContext = null;
    this.speakerOscillator = null;

    this.selectedCameraId = null;
    this.selectedMicId = null;
    this.selectedSpeakerId = null;
    this.currentFacingMode = 'user';

    this.boundElements = false;
  }

  /**
   * Initializes all device test dropdowns, event listeners, and preview components.
   */
  async initTestUI() {
    this.bindDomElements();
    await this.populateTestDevices();
    await this.startCameraTest();
    await this.startMicTest();
  }

  /**
   * Binds UI event listeners once.
   */
  bindDomElements() {
    if (this.boundElements) return;
    this.boundElements = true;

    const camSelect = document.getElementById('testCameraSelect');
    const micSelect = document.getElementById('testMicSelect');
    const speakerSelect = document.getElementById('testSpeakerSelect');
    const toggleCamBtn = document.getElementById('testToggleCameraBtn');
    const flipCamBtn = document.getElementById('testFlipCameraBtn');
    const recordMicBtn = document.getElementById('testMicRecordBtn');
    const playSpeakerBtn = document.getElementById('testSpeakerPlayBtn');
    const sysSpeakerPickerBtn = document.getElementById('testSpeakerSysPickerBtn');

    if (camSelect) {
      camSelect.addEventListener('change', async () => {
        this.selectedCameraId = camSelect.value;
        await this.startCameraTest(this.selectedCameraId);
      });
    }

    if (micSelect) {
      micSelect.addEventListener('change', async () => {
        this.selectedMicId = micSelect.value;
        await this.startMicTest(this.selectedMicId);
      });
    }

    if (speakerSelect) {
      speakerSelect.addEventListener('change', () => {
        this.selectedSpeakerId = speakerSelect.value;
      });
    }

    if (toggleCamBtn) {
      toggleCamBtn.addEventListener('click', async () => {
        if (this.cameraStream) {
          this.stopCameraTest();
          toggleCamBtn.textContent = 'Start Camera';
          const badge = document.getElementById('testVideoSpecsBadge');
          if (badge) badge.textContent = 'Camera paused';
        } else {
          await this.startCameraTest(this.selectedCameraId);
          toggleCamBtn.textContent = 'Pause Camera';
        }
      });
    }

    if (flipCamBtn) {
      flipCamBtn.addEventListener('click', async () => {
        await this.flipCamera();
      });
    }

    if (recordMicBtn) {
      recordMicBtn.addEventListener('click', async () => {
        if (this.isRecordingLoopback) {
          this.stopMicLoopbackTest();
        } else {
          await this.startMicLoopbackTest();
        }
      });
    }

    if (playSpeakerBtn) {
      playSpeakerBtn.addEventListener('click', () => {
        if (this.isPlayingSpeakerTest) {
          this.stopSpeakerTest();
        } else {
          this.playSpeakerTest();
        }
      });
    }

    if (sysSpeakerPickerBtn) {
      sysSpeakerPickerBtn.addEventListener('click', async () => {
        if (typeof navigator.mediaDevices?.selectAudioOutput === 'function') {
          try {
            const dev = await navigator.mediaDevices.selectAudioOutput();
            if (dev && dev.deviceId) {
              this.selectedSpeakerId = dev.deviceId;
              await this.populateTestDevices();
              if (speakerSelect) speakerSelect.value = dev.deviceId;
              if (window.showToast) window.showToast('Audio output: ' + (dev.label || 'Selected device'));
            }
          } catch (err) {
            console.warn('[DeviceTest] selectAudioOutput note:', err);
          }
        }
      });
    }
  }

  /**
   * Enumerates system devices and populates test select dropdowns.
   */
  async populateTestDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const camSelect = document.getElementById('testCameraSelect');
      const micSelect = document.getElementById('testMicSelect');
      const speakerSelect = document.getElementById('testSpeakerSelect');

      if (camSelect) camSelect.innerHTML = '';
      if (micSelect) micSelect.innerHTML = '';
      if (speakerSelect) speakerSelect.innerHTML = '';

      let camIdx = 1, micIdx = 1, spkIdx = 1;

      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;

        if (d.kind === 'videoinput' && camSelect) {
          opt.textContent = d.label || `Camera ${camIdx++}`;
          if (d.deviceId === this.selectedCameraId) opt.selected = true;
          camSelect.appendChild(opt);
        } else if (d.kind === 'audioinput' && micSelect) {
          opt.textContent = d.label || `Microphone ${micIdx++}`;
          if (d.deviceId === this.selectedMicId) opt.selected = true;
          micSelect.appendChild(opt);
        } else if (d.kind === 'audiooutput' && speakerSelect) {
          let label = d.label;
          if (!label || !label.trim()) {
            label = d.deviceId === 'default' ? 'Speaker / Default' : `Speaker ${spkIdx++}`;
          }
          opt.textContent = label;
          if (d.deviceId === this.selectedSpeakerId) opt.selected = true;
          speakerSelect.appendChild(opt);
        }
      });

      // Show or hide system picker button
      const sysBtn = document.getElementById('testSpeakerSysPickerBtn');
      if (sysBtn) {
        sysBtn.style.display = (typeof navigator.mediaDevices?.selectAudioOutput === 'function') ? 'inline-block' : 'none';
      }

      // If active selections are null, initialize with first option value
      if (!this.selectedCameraId && camSelect && camSelect.value) this.selectedCameraId = camSelect.value;
      if (!this.selectedMicId && micSelect && micSelect.value) this.selectedMicId = micSelect.value;
      if (!this.selectedSpeakerId && speakerSelect && speakerSelect.value) this.selectedSpeakerId = speakerSelect.value;
    } catch (e) {
      console.warn('[DeviceTest] Error enumerating devices:', e);
    }
  }

  /**
   * Starts live video test stream and renders to preview element.
   */
  async startCameraTest(deviceId = null) {
    this.stopCameraTest();

    const videoEl = document.getElementById('testVideoPreview');
    const badge = document.getElementById('testVideoSpecsBadge');
    if (!videoEl) return;

    try {
      const constraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: this.currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      };

      this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      videoEl.srcObject = this.cameraStream;
      await videoEl.play().catch(() => {});

      const track = this.cameraStream.getVideoTracks()[0];
      if (track) {
        const updateSpecs = () => {
          const settings = track.getSettings ? track.getSettings() : {};
          const w = videoEl.videoWidth || settings.width || 0;
          const h = videoEl.videoHeight || settings.height || 0;
          const fps = Math.round(settings.frameRate || 30);
          const facing = settings.facingMode ? ` (${settings.facingMode})` : '';
          if (badge) {
            badge.textContent = `${w}x${h} @ ${fps}fps${facing}`;
          }
        };

        videoEl.onloadedmetadata = updateSpecs;
        setTimeout(updateSpecs, 500);
      }

      const toggleBtn = document.getElementById('testToggleCameraBtn');
      if (toggleBtn) toggleBtn.textContent = 'Pause Camera';
    } catch (err) {
      console.warn('[DeviceTest] Camera test error:', err);
      if (badge) badge.textContent = 'Camera unavailable or permission denied';
    }
  }

  /**
   * Stops live camera test stream.
   */
  stopCameraTest() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(t => t.stop());
      this.cameraStream = null;
    }
    const videoEl = document.getElementById('testVideoPreview');
    if (videoEl) videoEl.srcObject = null;
  }

  /**
   * Flips between front (user) and back (environment) camera during testing.
   */
  async flipCamera() {
    const camSelect = document.getElementById('testCameraSelect');
    if (camSelect && camSelect.options.length > 1) {
      const nextIdx = (camSelect.selectedIndex + 1) % camSelect.options.length;
      camSelect.selectedIndex = nextIdx;
      this.selectedCameraId = camSelect.value;
      await this.startCameraTest(this.selectedCameraId);
      return;
    }

    // Toggle facing mode directly
    this.currentFacingMode = (this.currentFacingMode === 'environment') ? 'user' : 'environment';
    await this.startCameraTest();
  }

  /**
   * Starts microphone level visualizer.
   */
  async startMicTest(deviceId = null) {
    this.stopMicTest();

    const meterBar = document.getElementById('testMicVolumeFill');
    const volumeText = document.getElementById('testMicVolumeText');

    try {
      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false
      };

      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(this.micStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

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
        if (volumeText) volumeText.textContent = `${pct}%`;
      }, 70);
    } catch (err) {
      console.warn('[DeviceTest] Mic test error:', err);
      if (volumeText) volumeText.textContent = 'Mic unavailable';
    }
  }

  /**
   * Stops microphone level visualizer.
   */
  stopMicTest() {
    if (this.micMeterInterval) {
      clearInterval(this.micMeterInterval);
      this.micMeterInterval = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    const meterBar = document.getElementById('testMicVolumeFill');
    if (meterBar) meterBar.style.width = '0%';
    const volumeText = document.getElementById('testMicVolumeText');
    if (volumeText) volumeText.textContent = '0%';
  }

  /**
   * 4-second voice loopback test: records speech, then plays it back through the chosen speaker.
   */
  async startMicLoopbackTest() {
    const recordBtn = document.getElementById('testMicRecordBtn');
    const statusEl = document.getElementById('testMicRecordStatus');
    if (this.isRecordingLoopback) return;

    try {
      const constraints = {
        audio: this.selectedMicId ? { deviceId: { exact: this.selectedMicId } } : true,
        video: false
      };
      const recordStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.recordedChunks = [];

      const options = MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : {};
      this.mediaRecorder = new MediaRecorder(recordStream, options);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        recordStream.getTracks().forEach(t => t.stop());
        const blob = new Blob(this.recordedChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
        const audioUrl = URL.createObjectURL(blob);

        if (statusEl) statusEl.textContent = 'Playing back your recording...';
        if (recordBtn) {
          recordBtn.textContent = 'Stop Playback';
          recordBtn.classList.remove('btn-danger');
          recordBtn.classList.add('btn-secondary');
        }

        this.loopbackAudio = new Audio(audioUrl);

        // Apply audio output sink if supported
        const speakerSelect = document.getElementById('testSpeakerSelect');
        const sinkId = speakerSelect ? speakerSelect.value : this.selectedSpeakerId;
        if (sinkId && typeof this.loopbackAudio.setSinkId === 'function') {
          try {
            await this.loopbackAudio.setSinkId(sinkId);
          } catch (e) {
            console.warn('[DeviceTest] Loopback setSinkId note:', e);
          }
        }

        this.loopbackAudio.onended = () => {
          this.isRecordingLoopback = false;
          if (statusEl) statusEl.textContent = 'Playback completed. Did your voice sound clear?';
          if (recordBtn) recordBtn.textContent = 'Record Voice Test (4s)';
          URL.revokeObjectURL(audioUrl);
          this.loopbackAudio = null;
        };

        try {
          await this.loopbackAudio.play();
        } catch (playErr) {
          console.warn('[DeviceTest] Loopback playback error:', playErr);
          this.isRecordingLoopback = false;
          if (statusEl) statusEl.textContent = 'Playback failed. Check speaker volume.';
          if (recordBtn) recordBtn.textContent = 'Record Voice Test (4s)';
        }
      };

      this.mediaRecorder.start();
      this.isRecordingLoopback = true;

      let remainingSec = 4;
      if (recordBtn) {
        recordBtn.textContent = `Recording (${remainingSec}s)...`;
        recordBtn.classList.add('btn-danger');
      }
      if (statusEl) statusEl.textContent = 'Listening... Speak now to test your microphone.';

      const countdownInterval = setInterval(() => {
        remainingSec -= 1;
        if (remainingSec > 0) {
          if (recordBtn) recordBtn.textContent = `Recording (${remainingSec}s)...`;
        } else {
          clearInterval(countdownInterval);
          if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
          }
        }
      }, 1000);

    } catch (err) {
      console.warn('[DeviceTest] Record test error:', err);
      this.isRecordingLoopback = false;
      if (statusEl) statusEl.textContent = 'Could not record test: ' + err.message;
      if (recordBtn) {
        recordBtn.textContent = 'Record Voice Test (4s)';
        recordBtn.classList.remove('btn-danger');
      }
    }
  }

  /**
   * Cancels active microphone loopback test.
   */
  stopMicLoopbackTest() {
    this.isRecordingLoopback = false;
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try { this.mediaRecorder.stop(); } catch (_) {}
    }
    if (this.loopbackAudio) {
      try {
        this.loopbackAudio.pause();
        this.loopbackAudio.currentTime = 0;
      } catch (_) {}
      this.loopbackAudio = null;
    }
    const recordBtn = document.getElementById('testMicRecordBtn');
    const statusEl = document.getElementById('testMicRecordStatus');
    if (recordBtn) {
      recordBtn.textContent = 'Record Voice Test (4s)';
      recordBtn.classList.remove('btn-danger');
    }
    if (statusEl) statusEl.textContent = 'Test cancelled';
  }

  /**
   * Plays a pleasant melodic tone chime through the selected speaker/earpiece output sink.
   */
  async playSpeakerTest() {
    this.stopSpeakerTest();

    const playBtn = document.getElementById('testSpeakerPlayBtn');
    const statusEl = document.getElementById('testSpeakerStatus');
    const speakerSelect = document.getElementById('testSpeakerSelect');
    const sinkId = speakerSelect ? speakerSelect.value : this.selectedSpeakerId;

    try {
      this.speakerAudioContext = new (window.AudioContext || window.webkitAudioContext)();

      // If AudioContext supports setSinkId, apply target device sink
      if (sinkId && typeof this.speakerAudioContext.setSinkId === 'function') {
        try {
          await this.speakerAudioContext.setSinkId(sinkId);
        } catch (e) {
          console.warn('[DeviceTest] AudioContext setSinkId note:', e);
        }
      }

      this.isPlayingSpeakerTest = true;
      if (playBtn) playBtn.textContent = 'Stop Sound';
      if (statusEl) statusEl.textContent = 'Playing test chime...';

      const ctx = this.speakerAudioContext;
      const notes = [
        { freq: 523.25, start: 0.0, dur: 0.22 },  // C5
        { freq: 659.25, start: 0.18, dur: 0.22 }, // E5
        { freq: 783.99, start: 0.36, dur: 0.25 }, // G5
        { freq: 1046.50, start: 0.54, dur: 0.45 } // C6
      ];

      notes.forEach(n => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.freq, ctx.currentTime + n.start);

        gain.gain.setValueAtTime(0.0001, ctx.currentTime + n.start);
        gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + n.start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + n.start + n.dur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + n.start);
        osc.stop(ctx.currentTime + n.start + n.dur);
      });

      setTimeout(() => {
        this.stopSpeakerTest();
        if (statusEl) statusEl.textContent = 'Sound finished. Did you hear the chime?';
      }, 1100);

    } catch (err) {
      console.warn('[DeviceTest] Speaker test error:', err);
      this.isPlayingSpeakerTest = false;
      if (playBtn) playBtn.textContent = 'Play Test Sound';
      if (statusEl) statusEl.textContent = 'Playback error: ' + err.message;
    }
  }

  /**
   * Stops speaker test sound.
   */
  stopSpeakerTest() {
    this.isPlayingSpeakerTest = false;
    if (this.speakerAudioContext) {
      this.speakerAudioContext.close().catch(() => {});
      this.speakerAudioContext = null;
    }
    const playBtn = document.getElementById('testSpeakerPlayBtn');
    if (playBtn) playBtn.textContent = 'Play Test Sound';
  }

  /**
   * Complete teardown of all active test streams and contexts to release hardware lock.
   */
  stopAllTests() {
    this.stopCameraTest();
    this.stopMicTest();
    this.stopMicLoopbackTest();
    this.stopSpeakerTest();
  }
}

// Global singleton instance
window.setuDeviceTest = new DeviceTestManager();
