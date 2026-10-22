/**
 * Setu P2P - Built-in Audio Notification Service
 * Uses browser-native Web Audio API (AudioContext) for zero-latency, zero-asset sound effects.
 * Synthesizes lightweight, pleasant chimes for participant join, disconnect, and chat messages.
 * Strictly zero external MP3/WAV files required.
 */

class SoundManager {
  constructor() {
    this.audioCtx = null;
    this.enabled = true;
    this.unlocked = false;

    // Auto-unlock on first user gesture
    this.bindUnlockGesture();
  }

  async init() {
    if (window.setuStorage && window.setuStorage.getUserProfile) {
      try {
        const profile = await window.setuStorage.getUserProfile();
        if (profile && typeof profile.meetingSounds === 'boolean') {
          this.enabled = profile.meetingSounds;
        }
      } catch (_) {}
    }
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
  }

  bindUnlockGesture() {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const unlock = () => {
      this.getAudioContext();
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().then(() => {
          this.unlocked = true;
        }).catch(() => {});
      } else {
        this.unlocked = true;
      }
      window.removeEventListener('click', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
    };

    window.addEventListener('click', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('touchstart', unlock, true);
  }

  getAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Participant Join Chime
   * Harmonic, pleasant upward dual-tone (C5 -> E5) with soft acoustic decay.
   */
  playJoin() {
    if (!this.enabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      // Step 1: Note C5 (523.25 Hz)
      osc.frequency.setValueAtTime(523.25, now);
      // Step 2: Note E5 (659.25 Hz)
      osc.frequency.setValueAtTime(659.25, now + 0.09);

      // Smooth attack & gentle exponential release
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
      gain.gain.setValueAtTime(0.12, now + 0.09);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.38);
    } catch (_) {}
  }

  /**
   * Participant Disconnect / Leave Chime
   * Gentle, soft downward dual-tone (E5 -> A4) indicating disconnection.
   */
  playLeave() {
    if (!this.enabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      // Step 1: Note E5 (659.25 Hz)
      osc.frequency.setValueAtTime(659.25, now);
      // Step 2: Note A4 (440.00 Hz)
      osc.frequency.setValueAtTime(440.00, now + 0.09);

      // Smooth envelope
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.10, now + 0.02);
      gain.gain.setValueAtTime(0.10, now + 0.09);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.38);
    } catch (_) {}
  }

  /**
   * Chat Message Notification Ping
   * Crisp, subtle high ping (A5 -> D6) for incoming messages.
   */
  playMessage() {
    if (!this.enabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880.00, now);
      osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.07);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.20);
    } catch (_) {}
  }

  /**
   * Hand Raise Notification Chime
   */
  playHandRaise() {
    if (!this.enabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(783.99, now); // G5
      osc.frequency.setValueAtTime(987.77, now + 0.08); // B5

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.30);
    } catch (_) {}
  }
}

// Global instance
window.setuSound = new SoundManager();
