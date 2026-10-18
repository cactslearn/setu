/**
 * Setu P2P - Presence & Availability Engine
 * Tracks local presence status, idle detection, and peer presence over WebRTC DataChannel.
 * Pure peer-to-peer, zero centralized presence servers.
 */

class PresenceEngine {
  constructor() {
    this.currentStatus = 'available'; // 'available', 'away', 'busy', 'invisible'
    this.statusMessage = '';
    this.peerStatus = 'offline';
    this.peerStatusMessage = '';
    this.lastPeerHeartbeat = null;

    this.idleTimeoutMs = 5 * 60 * 1000; // 5 minutes inactivity
    this.idleTimer = null;
    this.isAutoAway = false;

    // Callbacks
    this.onLocalStatusChange = null;
    this.onPeerStatusChange = null;

    this.initIdleDetection();
  }

  initIdleDetection() {
    const resetTimer = () => {
      if (this.isAutoAway) {
        this.isAutoAway = false;
        this.setStatus('available', false);
      }
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        if (this.currentStatus === 'available') {
          this.isAutoAway = true;
          this.setStatus('away', true);
        }
      }, this.idleTimeoutMs);
    };

    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
      window.addEventListener(evt, resetTimer, { passive: true });
    });
    resetTimer();
  }

  setStatus(status, isAutomated = false) {
    if (!['available', 'away', 'busy', 'invisible'].includes(status)) return;
    this.currentStatus = status;

    if (!isAutomated) {
      this.isAutoAway = false;
    }

    if (this.onLocalStatusChange) {
      this.onLocalStatusChange(this.currentStatus, this.statusMessage);
    }

    // Broadcast to connected peer over WebRTC control channel
    this.broadcastStatus();
  }

  setStatusMessage(msg) {
    this.statusMessage = msg;
    this.broadcastStatus();
  }

  broadcastStatus() {
    if (!window.setuWebRTC) return;
    // If set to invisible, send offline / away representation
    const outgoingStatus = this.currentStatus === 'invisible' ? 'offline' : this.currentStatus;

    const payload = JSON.stringify({
      type: 'presence',
      status: outgoingStatus,
      message: this.statusMessage,
      ts: Date.now()
    });

    window.setuWebRTC.sendData('control', payload);
  }

  handlePeerPresencePacket(packet) {
    if (!packet || packet.type !== 'presence') return;
    this.peerStatus = packet.status;
    this.peerStatusMessage = packet.message || '';
    this.lastPeerHeartbeat = packet.ts || Date.now();

    if (this.onPeerStatusChange) {
      this.onPeerStatusChange(this.peerStatus, this.peerStatusMessage);
    }
  }

  getExplanation() {
    return 'Setu P2P is serverless. Real-time availability is only transmitted between actively connected peers. Disconnected contacts show their last-known state.';
  }
}

// Global instance
window.setuPresence = new PresenceEngine();
