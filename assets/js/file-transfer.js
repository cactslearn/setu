/**
 * Setu P2P - Chunked File Transfer Engine
 * P2P file transfers over WebRTC DataChannel with chunking, backpressure flow control,
 * consent handshake, and cryptographic SHA-256 integrity verification.
 * Zero emojis in UI or logic.
 */

class FileTransferEngine {
  constructor() {
    this.CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
    this.HEADER_SIZE = 36; // Exact 36-byte ASCII header for fileId
    this.MAX_BUFFER_THRESHOLD = 512 * 1024; // 512 KB backpressure limit
    this.transfers = new Map(); // fileId -> state
    this.onTransferUpdate = null;
    this.onIncomingOffer = null;
  }

  resetMeetingSession() {
    this.transfers.clear();
    const list = document.getElementById('fileTransfersList');
    if (list) {
      list.innerHTML = '';
    }
    const fileInput = document.getElementById('fileSelectorInput');
    if (fileInput) {
      fileInput.value = '';
    }
  }

  /**
   * Computes SHA-256 hash of a File or Blob using WebCrypto streaming.
   */
  async computeHash(file) {
    const arrayBuffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Initiates sending a file to the connected peer.
   */
  async offerFile(file) {
    if (!window.setuWebRTC || !window.setuWebRTC.channels.control) {
      alert('Cannot send file: No peer is currently connected.');
      return null;
    }

    // 24-character ID that cleanly fits within the 36-byte header
    const fileId = 'file_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
    const hash = await this.computeHash(file);

    const transferState = {
      fileId,
      file,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      sha256: hash,
      direction: 'send',
      status: 'waiting_consent', // 'waiting_consent', 'sending', 'completed', 'rejected', 'canceled', 'failed'
      bytesTransferred: 0,
      startTime: null,
      speedBps: 0
    };

    this.transfers.set(fileId, transferState);
    if (this.onTransferUpdate) this.onTransferUpdate(transferState);

    // Send offer message across control channel
    const offerPacket = JSON.stringify({
      type: 'file-offer',
      fileId,
      name: file.name,
      size: file.size,
      mime: file.type,
      sha256: hash
    });

    window.setuWebRTC.sendData('control', offerPacket);
    return transferState;
  }

  /**
   * Remote peer's response to file offer.
   */
  handleFileResponse(responsePacket) {
    const { fileId, accepted } = responsePacket;
    const transfer = this.transfers.get(fileId);
    if (!transfer) return;

    if (accepted) {
      transfer.status = 'sending';
      transfer.startTime = Date.now();
      if (this.onTransferUpdate) this.onTransferUpdate(transfer);
      this.streamFile(transfer);
    } else {
      transfer.status = 'rejected';
      if (this.onTransferUpdate) this.onTransferUpdate(transfer);
      if (window.showToast) window.showToast(`Peer declined transfer: "${transfer.name}"`);
    }
  }

  /**
   * Streams file chunks with backpressure management.
   */
  /**
   * Streams file chunks with backpressure management.
   */
  async streamFile(transfer) {
    let channel = window.setuWebRTC?.channels?.file;
    if (!channel || channel.readyState !== 'open') {
      // Retry channel check up to 5 times (total 1 sec) in case of initial setup latency
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(r => setTimeout(r, 200));
        channel = window.setuWebRTC?.channels?.file;
        if (channel && channel.readyState === 'open') break;
      }
    }

    if (!channel || channel.readyState !== 'open') {
      transfer.status = 'failed';
      if (this.onTransferUpdate) this.onTransferUpdate(transfer);
      if (window.showToast) window.showToast('File transfer channel not open');
      return;
    }

    const file = transfer.file;
    let offset = 0;
    const totalBytes = file.size;

    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = this.CHUNK_SIZE * 2;

    const sendNextChunk = async () => {
      if (transfer.status !== 'sending') return; // Cancelled or paused

      while (offset < totalBytes) {
        if (channel.bufferedAmount > this.MAX_BUFFER_THRESHOLD) {
          let resumed = false;
          const resumeHandler = () => {
            if (resumed) return;
            resumed = true;
            channel.onbufferedamountlow = null;
            sendNextChunk();
          };
          channel.onbufferedamountlow = resumeHandler;
          // Safety fallback timeout in case onbufferedamountlow is delayed
          setTimeout(resumeHandler, 60);
          return;
        }

        const slice = file.slice(offset, offset + this.CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();

        // Exact 36-byte ASCII header for fileId
        const header = new TextEncoder().encode(transfer.fileId.padEnd(this.HEADER_SIZE, ' ').slice(0, this.HEADER_SIZE));
        const packet = new Uint8Array(this.HEADER_SIZE + buffer.byteLength);
        packet.set(header, 0);
        packet.set(new Uint8Array(buffer), this.HEADER_SIZE);

        channel.send(packet.buffer);

        offset += buffer.byteLength;
        transfer.bytesTransferred = offset;

        const elapsedSec = (Date.now() - transfer.startTime) / 1000;
        if (elapsedSec > 0) {
          transfer.speedBps = transfer.bytesTransferred / elapsedSec;
        }

        if (this.onTransferUpdate) this.onTransferUpdate(transfer);
      }

      transfer.status = 'completed';
      if (this.onTransferUpdate) this.onTransferUpdate(transfer);
      if (window.showToast) window.showToast(`File "${transfer.name}" sent successfully`);
    };

    sendNextChunk();
  }

  /**
   * Handles inbound file offer from peer.
   */
  handleIncomingOffer(offerPacket) {
    const transferState = {
      fileId: offerPacket.fileId,
      name: offerPacket.name,
      size: offerPacket.size,
      mime: offerPacket.mime,
      sha256: offerPacket.sha256,
      direction: 'receive',
      status: 'pending_decision',
      bytesTransferred: 0,
      receivedChunks: [],
      startTime: null,
      speedBps: 0
    };

    this.transfers.set(offerPacket.fileId, transferState);
    if (this.onTransferUpdate) this.onTransferUpdate(transferState);

    if (this.onIncomingOffer) {
      this.onIncomingOffer(transferState);
    }
  }

  /**
   * Local user accepts or rejects incoming file.
   */
  respondToOffer(fileId, accept) {
    const transfer = this.transfers.get(fileId);
    if (!transfer) return;

    if (accept) {
      transfer.status = 'receiving';
      transfer.startTime = Date.now();
    } else {
      transfer.status = 'rejected';
    }

    if (this.onTransferUpdate) this.onTransferUpdate(transfer);

    const packet = JSON.stringify({
      type: 'file-response',
      fileId,
      accepted: accept
    });
    window.setuWebRTC.sendData('control', packet);
  }

  /**
   * Inbound binary chunk handler from DataChannel with support for Blob & ArrayBuffer.
   */
  async handleChunk(rawData) {
    let arrayBuffer = rawData;
    if (rawData instanceof Blob) {
      arrayBuffer = await rawData.arrayBuffer();
    } else if (rawData && rawData.buffer instanceof ArrayBuffer && !(rawData instanceof ArrayBuffer)) {
      arrayBuffer = rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength);
    }

    if (!arrayBuffer) return;
    const data = new Uint8Array(arrayBuffer);
    if (data.length < this.HEADER_SIZE) return;

    const fileId = new TextDecoder().decode(data.subarray(0, this.HEADER_SIZE)).trim();
    const chunkBytes = data.subarray(this.HEADER_SIZE);

    let transfer = this.transfers.get(fileId);
    // Resilient fallback: If not found by exact string, find active receive transfer
    if (!transfer) {
      for (const t of this.transfers.values()) {
        if (t.direction === 'receive' && (t.status === 'receiving' || t.status === 'pending_decision')) {
          transfer = t;
          break;
        }
      }
    }

    if (!transfer) return;
    if (transfer.status === 'pending_decision') {
      transfer.status = 'receiving';
      transfer.startTime = transfer.startTime || Date.now();
    }
    if (transfer.status !== 'receiving') return;

    transfer.receivedChunks.push(chunkBytes);
    transfer.bytesTransferred += chunkBytes.length;

    const elapsedSec = (Date.now() - transfer.startTime) / 1000;
    if (elapsedSec > 0) {
      transfer.speedBps = transfer.bytesTransferred / elapsedSec;
    }

    if (this.onTransferUpdate) this.onTransferUpdate(transfer);

    if (transfer.bytesTransferred >= transfer.size) {
      transfer.status = 'verifying';
      if (this.onTransferUpdate) this.onTransferUpdate(transfer);

      const combinedBlob = new Blob(transfer.receivedChunks, { type: transfer.mime });
      const computedHash = await this.computeHash(combinedBlob);

      if (computedHash.toLowerCase() === transfer.sha256.toLowerCase()) {
        transfer.status = 'verified';
        transfer.blob = combinedBlob;
        if (this.onTransferUpdate) this.onTransferUpdate(transfer);
        if (window.showToast) window.showToast(`File "${transfer.name}" received & verified`);
        this.triggerDownload(transfer);
      } else {
        transfer.status = 'corrupted';
        if (this.onTransferUpdate) this.onTransferUpdate(transfer);
        alert(`Integrity Check Failed: Checksum mismatch for "${transfer.name}". The file may be corrupt.`);
      }
    }
  }

  triggerDownload(transfer) {
    if (!transfer.blob) return;
    const url = URL.createObjectURL(transfer.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = transfer.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  cancelTransfer(fileId) {
    const transfer = this.transfers.get(fileId);
    if (!transfer) return;
    transfer.status = 'canceled';
    if (this.onTransferUpdate) this.onTransferUpdate(transfer);

    const cancelPacket = JSON.stringify({
      type: 'file-cancel',
      fileId
    });
    window.setuWebRTC.sendData('control', cancelPacket);
  }
}

// Global instance
window.setuFileTransfer = new FileTransferEngine();
