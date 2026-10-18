/**
 * Setu P2P - Chat Module
 * Handles real-time DataChannel messaging, markdown rendering, persistence via IndexedDB,
 * search, export, and optional local encryption.
 */

class ChatModule {
  constructor() {
    this.messagesContainer = null;
    this.unreadCount = 0;
    this.currentPeerId = 'current_peer';
    this.remotePeerName = 'Remote Peer';
    this.localUserName = 'You';
    this.sessionMessages = [];

    // Hook listeners
    this.onUnreadChange = null;
  }

  get messages() {
    return this.sessionMessages || [];
  }

  init(containerElement) {
    this.messagesContainer = containerElement;
    this.resetMeetingSession();
  }

  resetMeetingSession() {
    this.sessionMessages = [];
    this.unreadCount = 0;
    if (this.messagesContainer) {
      this.messagesContainer.innerHTML = '';
    }
    const unreadBadge = document.getElementById('chatUnreadBadge');
    if (unreadBadge) {
      unreadBadge.style.display = 'none';
      unreadBadge.textContent = '0';
    }
    const chatInput = document.getElementById('chatMessageInput');
    if (chatInput) {
      chatInput.value = '';
    }
    if (this.onUnreadChange) this.onUnreadChange(0);
  }

  setPeer(peerId, peerName) {
    this.currentPeerId = peerId || 'current_peer';
    this.remotePeerName = peerName || 'Remote Peer';
  }

  async loadHistory() {
    if (!window.setuStorage) return;
    try {
      const messages = await window.setuStorage.getMessages(this.currentPeerId);
      if (this.messagesContainer) {
        this.messagesContainer.innerHTML = '';
        messages.forEach(msg => this.renderMessage(msg, false));
        this.scrollToBottom();
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  }

  /**
   * Sends a message to the connected peer over DataChannel.
   */
  async sendMessage(text) {
    if (!text || !text.trim()) return;

    const msgObj = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      sender: 'local',
      senderName: this.localUserName,
      peerId: this.currentPeerId,
      content: text.trim(),
      timestamp: Date.now()
    };

    // Send across WebRTC DataChannel
    if (window.setuWebRTC) {
      const packet = JSON.stringify({
        id: msgObj.id,
        senderName: this.localUserName,
        content: msgObj.content,
        timestamp: msgObj.timestamp
      });
      window.setuWebRTC.sendData('chat', packet);
    }

    // Save to IndexedDB
    if (window.setuStorage) {
      await window.setuStorage.saveMessage(msgObj);
    }

    // Track session messages for meeting archive
    this.sessionMessages.push({
      text: msgObj.content,
      sender: this.localUserName || 'You',
      isLocal: true,
      timestamp: msgObj.timestamp
    });

    // Render locally
    this.renderMessage(msgObj, true);
    this.scrollToBottom();
  }

  /**
   * Inbound message handler from WebRTC DataChannel.
   */
  async receiveMessage(packetStr) {
    try {
      const parsed = JSON.parse(packetStr);
      const msgObj = {
        id: parsed.id || 'msg_' + Date.now(),
        sender: 'remote',
        senderName: parsed.senderName || this.remotePeerName,
        peerId: this.currentPeerId,
        content: parsed.content,
        timestamp: parsed.timestamp || Date.now()
      };

      if (window.setuStorage) {
        await window.setuStorage.saveMessage(msgObj);
      }

      // Track session messages for meeting archive
      this.sessionMessages.push({
        text: msgObj.content,
        sender: msgObj.senderName || this.remotePeerName || 'Remote Peer',
        isLocal: false,
        timestamp: msgObj.timestamp
      });

      this.renderMessage(msgObj, true);
      this.scrollToBottom();

      // Update unread count if drawer is closed
      const drawer = document.getElementById('chatDrawer');
      if (drawer && !drawer.classList.contains('open')) {
        this.unreadCount++;
        if (this.onUnreadChange) this.onUnreadChange(this.unreadCount);
      }

      // Play soft chime
      this.playChime();
    } catch (err) {
      console.error('Failed to parse inbound chat message:', err);
    }
  }

  markAsRead() {
    this.unreadCount = 0;
    if (this.onUnreadChange) this.onUnreadChange(0);
  }

  formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Lightweight safe markdown parser (bold, italic, code block, links).
   */
  parseMarkdown(text) {
    const escapeHtml = (str) =>
      str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);

    let safe = escapeHtml(text);

    // Code blocks `code`
    safe = safe.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.25);padding:2px 4px;border-radius:4px;font-family:monospace;">$1</code>');
    // Bold **text**
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic *text*
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // URL auto-link
    safe = safe.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:underline;">$1</a>');

    return safe;
  }

  renderMessage(msg, animate = false) {
    if (!this.messagesContainer) return;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${msg.sender === 'local' ? 'sent' : 'received'}`;
    bubble.setAttribute('data-id', msg.id);

    const contentHtml = this.parseMarkdown(msg.content);
    bubble.innerHTML = `
      <div class="chat-bubble-text">${contentHtml}</div>
      <span class="chat-bubble-time">${this.formatTime(msg.timestamp)}</span>
    `;

    // Right-click or long-press copy
    bubble.title = 'Click to copy text';
    bubble.addEventListener('click', () => {
      navigator.clipboard.writeText(msg.content);
      if (window.showToast) window.showToast('Message copied to clipboard');
    });

    this.messagesContainer.appendChild(bubble);
  }

  scrollToBottom() {
    if (this.messagesContainer) {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
  }

  async searchHistory(query) {
    if (!window.setuStorage) return;
    const results = await window.setuStorage.searchMessages(query, this.currentPeerId);
    if (this.messagesContainer) {
      this.messagesContainer.innerHTML = '';
      results.forEach(msg => this.renderMessage(msg, false));
    }
  }

  async clearConversation() {
    if (!window.setuStorage) return;
    await window.setuStorage.clearMessages(this.currentPeerId);
    if (this.messagesContainer) {
      this.messagesContainer.innerHTML = '';
    }
  }

  async exportConversation() {
    if (!window.setuStorage) return;
    const messages = await window.setuStorage.getMessages(this.currentPeerId);
    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  playChime() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) {
      // AudioContext policy
    }
  }
}

// Global instance
window.setuChat = new ChatModule();
