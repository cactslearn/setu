/**
 * Setu P2P - Connection Diagnostics & WebRTC Quality Monitor
 * Continuously polls getStats() for RTT, packet loss, bitrate, resolution, and candidate typology.
 * Directly extracts Local Network IP, Remote Peer IP, and enforces automated network adaptation.
 */

class DiagnosticsMonitor {
  constructor() {
    this.timerId = null;
    this.pollIntervalMs = 1500;
    this.prevStats = null;
    this.struggleCounter = 0;
    this.recoveryCounter = 0;
    this.isStruggling = false;

    this.latestMetrics = {
      rttMs: null,
      packetLossPercent: 0,
      videoBitrateKbps: 0,
      audioBitrateKbps: 0,
      resolution: 'N/A',
      fps: 0,
      connectionType: 'Direct (P2P)',
      localCandidateType: 'host',
      remoteCandidateType: 'host',
      localIp: 'Detecting...',
      localPort: '',
      remoteIp: 'Detecting...',
      remotePort: '',
      protocol: 'UDP',
      state: 'idle'
    };

    this.onMetricsUpdate = null;
  }

  start() {
    if (this.timerId) return;
    this.timerId = setInterval(() => this.collectStats(), this.pollIntervalMs);
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  async collectStats() {
    if (!window.setuWebRTC || !window.setuWebRTC.pc) return;
    const pc = window.setuWebRTC.pc;

    if (pc.connectionState !== 'connected') {
      this.latestMetrics.state = pc.connectionState;
      if (this.onMetricsUpdate) this.onMetricsUpdate(this.latestMetrics);
      return;
    }

    try {
      const stats = await pc.getStats();
      let activeCandidatePair = null;
      let inboundVideo = null;
      let inboundAudio = null;
      let localCandObj = null;
      let remoteCandObj = null;

      stats.forEach(report => {
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated === true || report.selected === true || (report.bytesSent && report.bytesSent > 0))) {
          if (!activeCandidatePair || report.state === 'succeeded' || report.nominated) {
            activeCandidatePair = report;
          }
        } else if (report.type === 'inbound-rtp' && report.kind === 'video') {
          inboundVideo = report;
        } else if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          inboundAudio = report;
        } else if (report.type === 'local-candidate' && !localCandObj) {
          localCandObj = report;
        } else if (report.type === 'remote-candidate' && !remoteCandObj) {
          remoteCandObj = report;
        }
      });

      // 1. RTT & Candidate Information
      if (activeCandidatePair) {
        if (activeCandidatePair.currentRoundTripTime !== undefined) {
          this.latestMetrics.rttMs = Math.round(activeCandidatePair.currentRoundTripTime * 1000);
        }

        const localCand = (stats.get && activeCandidatePair.localCandidateId) ? stats.get(activeCandidatePair.localCandidateId) : localCandObj;
        const remoteCand = (stats.get && activeCandidatePair.remoteCandidateId) ? stats.get(activeCandidatePair.remoteCandidateId) : remoteCandObj;

        if (localCand) {
          this.latestMetrics.localCandidateType = localCand.candidateType || 'host';
          let lip = localCand.address || localCand.ip;
          if (!lip || lip.includes('.local')) {
            lip = window.setuWebRTC.localCandidateIps?.[0]?.ip || lip || '192.168.1.x (LAN)';
          }
          this.latestMetrics.localIp = lip;
          this.latestMetrics.localPort = localCand.port || window.setuWebRTC.localCandidateIps?.[0]?.port || '';
          this.latestMetrics.protocol = (localCand.protocol || 'udp').toUpperCase();
        }

        if (remoteCand) {
          this.latestMetrics.remoteCandidateType = remoteCand.candidateType || 'host';
          let rip = remoteCand.address || remoteCand.ip;
          if (!rip || rip.includes('.local')) {
            rip = window.setuWebRTC.remoteCandidateIps?.[0]?.ip || rip || 'Peer Direct';
          }
          this.latestMetrics.remoteIp = rip;
          this.latestMetrics.remotePort = remoteCand.port || window.setuWebRTC.remoteCandidateIps?.[0]?.port || '';
        }

        if (this.latestMetrics.localCandidateType === 'relay' || this.latestMetrics.remoteCandidateType === 'relay') {
          this.latestMetrics.connectionType = 'Relayed (TURN)';
        } else if (this.latestMetrics.localCandidateType === 'host' && this.latestMetrics.remoteCandidateType === 'host') {
          this.latestMetrics.connectionType = 'Direct LAN (P2P)';
        } else {
          this.latestMetrics.connectionType = 'Direct STUN (P2P)';
        }
      } else {
        // Fallback to SDP extracted candidate IPs if stats candidate-pair report is delayed
        if (window.setuWebRTC.localCandidateIps?.length > 0) {
          const l = window.setuWebRTC.localCandidateIps[0];
          this.latestMetrics.localIp = l.ip;
          this.latestMetrics.localPort = l.port;
          this.latestMetrics.protocol = l.protocol;
          this.latestMetrics.localCandidateType = l.type;
        }
        if (window.setuWebRTC.remoteCandidateIps?.length > 0) {
          const r = window.setuWebRTC.remoteCandidateIps[0];
          this.latestMetrics.remoteIp = r.ip;
          this.latestMetrics.remotePort = r.port;
          this.latestMetrics.remoteCandidateType = r.type;
        }
      }

      // 2. Video Metrics (Bitrate, Resolution, Loss)
      if (inboundVideo) {
        if (inboundVideo.frameWidth && inboundVideo.frameHeight) {
          this.latestMetrics.resolution = `${inboundVideo.frameWidth}x${inboundVideo.frameHeight}`;
        }
        if (inboundVideo.framesPerSecond) {
          this.latestMetrics.fps = Math.round(inboundVideo.framesPerSecond);
        }

        if (this.prevStats && this.prevStats.inboundVideo) {
          const prev = this.prevStats.inboundVideo;
          const bytesDiff = (inboundVideo.bytesReceived || 0) - (prev.bytesReceived || 0);
          const timeDiff = (inboundVideo.timestamp - prev.timestamp) / 1000;
          if (timeDiff > 0) {
            this.latestMetrics.videoBitrateKbps = Math.round((bytesDiff * 8) / timeDiff / 1000);
          }

          const packetsDiff = (inboundVideo.packetsReceived || 0) - (prev.packetsReceived || 0);
          const lostDiff = (inboundVideo.packetsLost || 0) - (prev.packetsLost || 0);
          const totalExpected = packetsDiff + lostDiff;
          if (totalExpected > 0) {
            this.latestMetrics.packetLossPercent = Math.min(100, Math.round((lostDiff / totalExpected) * 100));
          }
        }
      }

      this.prevStats = {
        inboundVideo: inboundVideo ? { ...inboundVideo } : null,
        inboundAudio: inboundAudio ? { ...inboundAudio } : null
      };

      this.latestMetrics.state = pc.connectionState;

      // 3. Network Adaptation Check
      this.handleNetworkAdaptation(this.latestMetrics);

      if (this.onMetricsUpdate) {
        this.onMetricsUpdate(this.latestMetrics);
      }
    } catch (err) {
      console.warn('Diagnostics getStats error:', err);
    }
  }

  /**
   * Evaluates network conditions and dynamically adapts video quality or triggers audio fallback.
   */
  async handleNetworkAdaptation(metrics) {
    let autoReduce = true;
    let audioOnlyFallback = false;

    if (window.setuStorage) {
      try {
        const profile = await window.setuStorage.getUserProfile();
        if (profile) {
          autoReduce = profile.autoReduceQuality !== false;
          audioOnlyFallback = !!profile.audioOnlyFallback;
        }
      } catch (e) {}
    }

    const loss = metrics.packetLossPercent || 0;
    const rtt = metrics.rttMs || 0;

    const poorNetwork = loss > 5 || rtt > 350;
    const severeNetwork = loss > 15 || rtt > 600;

    if (poorNetwork) {
      this.struggleCounter++;
      this.recoveryCounter = 0;
    } else {
      this.recoveryCounter++;
      this.struggleCounter = 0;
    }

    // Automatically reduce quality when struggling
    if (autoReduce && this.struggleCounter >= 2 && !this.isStruggling) {
      this.isStruggling = true;
      if (window.setuWebRTC) {
        window.setuWebRTC.adaptQualityDegradation(true);
      }
      if (window.showToast) {
        window.showToast('Network unstable: automatically lowered video quality to preserve audio continuity');
      }
    } else if (autoReduce && this.recoveryCounter >= 3 && this.isStruggling) {
      this.isStruggling = false;
      if (window.setuWebRTC) {
        window.setuWebRTC.adaptQualityDegradation(false);
      }
      if (window.showToast) {
        window.showToast('Network stabilized: restored full video quality');
      }
    }

    // Audio-only fallback if connection is severely degraded
    if (audioOnlyFallback && severeNetwork && window.setuWebRTC && !window.setuWebRTC.isVideoMuted) {
      await window.setuWebRTC.setVideoMute(true);
      if (window.showToast) {
        window.showToast('Severe network drop: switched to Audio-Only fallback');
      }
    }
  }
}

// Global instance
window.setuDiagnostics = new DiagnosticsMonitor();
