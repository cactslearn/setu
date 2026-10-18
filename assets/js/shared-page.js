/**
 * Setu P2P - Purpose-Built Shared Page & PowerToys Collaborative Whiteboard
 * Rich drawing tools: Pen, Highlighter, Rectangle, Circle, Arrow, Line, Text, Eraser,
 * customizable color palettes, stroke widths, background patterns (Dot Grid, Graph, Dark),
 * Multi-step Undo/Redo stack, and real-time P2P synchronization over WebRTC DataChannel.
 * Zero external libraries or cloud dependencies.
 */

class SharedPageModule {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.notepad = null;

    this.isDrawing = false;
    this.currentTool = 'pen'; // 'pen', 'highlighter', 'rect', 'circle', 'arrow', 'line', 'text', 'eraser'
    this.currentColor = '#1a73e8';
    this.currentLineWidth = 3;
    this.backgroundMode = 'blank'; // 'blank', 'dots', 'grid', 'dark'

    this.startX = 0;
    this.startY = 0;
    this.snapshot = null;

    // History stack for Undo / Redo
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 25;

    // Permissions: Host must grant permission before remote participant can draw
    this.collaborationAllowed = false;
    this.isHost = false;

    this.onPermissionChanged = null;
  }

  init(canvasEl, notepadEl, isHost = false) {
    this.canvas = canvasEl;
    this.notepad = notepadEl;
    this.isHost = isHost;

    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      this.resizeCanvas();
      this.bindCanvasEvents();
      this.bindShortcuts();
    }

    if (this.notepad) {
      this.bindNotepadEvents();
    }
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    const w = Math.max(300, Math.floor(rect.width));
    const h = Math.max(250, Math.floor(rect.height));

    // Save existing drawing content if resizing
    let tempImage = null;
    if (this.canvas.width > 0 && this.canvas.height > 0) {
      tempImage = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    this.canvas.width = w;
    this.canvas.height = h;

    this.renderBackground();

    if (tempImage) {
      this.ctx.putImageData(tempImage, 0, 0);
    }
    this.pushHistory();
  }

  renderBackground() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;

    if (this.backgroundMode === 'dark') {
      this.ctx.fillStyle = '#1e1f20';
      this.ctx.fillRect(0, 0, w, h);
      return;
    }

    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, w, h);

    if (this.backgroundMode === 'dots') {
      this.ctx.fillStyle = '#cbd5e1';
      const gap = 20;
      for (let x = gap; x < w; x += gap) {
        for (let y = gap; y < h; y += gap) {
          this.ctx.beginPath();
          this.ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    } else if (this.backgroundMode === 'grid') {
      this.ctx.strokeStyle = '#f1f5f9';
      this.ctx.lineWidth = 1;
      const gap = 24;
      for (let x = gap; x < w; x += gap) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, h);
        this.ctx.stroke();
      }
      for (let y = gap; y < h; y += gap) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(w, y);
        this.ctx.stroke();
      }
    }
  }

  setBackgroundMode(mode) {
    this.backgroundMode = mode;
    this.clearCanvas(false);
  }

  setTool(tool) {
    this.currentTool = tool;
  }

  setColor(color) {
    this.currentColor = color;
  }

  setLineWidth(width) {
    this.currentLineWidth = parseInt(width, 10) || 3;
  }

  pushHistory() {
    if (!this.ctx || !this.canvas) return;
    try {
      const snap = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      this.undoStack.push(snap);
      if (this.undoStack.length > this.maxHistory) {
        this.undoStack.shift();
      }
      this.redoStack = []; // Clear redo after new action
    } catch (e) {}
  }

  undo() {
    if (this.undoStack.length <= 1) return;
    const current = this.undoStack.pop();
    this.redoStack.push(current);
    const prev = this.undoStack[this.undoStack.length - 1];
    if (prev && this.ctx) {
      this.ctx.putImageData(prev, 0, 0);
      this.broadcastDrawAction('sync-canvas', 0, 0, { dataUrl: this.canvas.toDataURL() });
    }
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop();
    this.undoStack.push(next);
    if (next && this.ctx) {
      this.ctx.putImageData(next, 0, 0);
      this.broadcastDrawAction('sync-canvas', 0, 0, { dataUrl: this.canvas.toDataURL() });
    }
  }

  bindShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      }
    });
  }

  setCollaborationAllowed(allowed) {
    this.collaborationAllowed = !!allowed;
    if (this.onPermissionChanged) {
      this.onPermissionChanged(this.collaborationAllowed);
    }

    if (window.setuWebRTC) {
      const packet = JSON.stringify({
        type: 'shared-page-permission',
        allowed: this.collaborationAllowed
      });
      window.setuWebRTC.sendData('control', packet);
    }
  }

  bindCanvasEvents() {
    const start = (e) => {
      this.isDrawing = true;
      const pt = this.getPointerPos(e);
      this.startX = pt.x;
      this.startY = pt.y;

      if (this.currentTool === 'text') {
        const text = prompt('Enter label text:');
        if (text && text.trim()) {
          this.drawText(text, pt.x, pt.y, this.currentColor, this.currentLineWidth * 5);
          this.pushHistory();
          this.broadcastDrawAction('text', pt.x, pt.y, { text, size: this.currentLineWidth * 5 });
        }
        this.isDrawing = false;
        return;
      }

      this.snapshot = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

      if (this.currentTool === 'pen' || this.currentTool === 'highlighter' || this.currentTool === 'eraser') {
        this.ctx.beginPath();
        this.ctx.moveTo(pt.x, pt.y);
        this.broadcastDrawAction('start', pt.x, pt.y);
      }
    };

    const draw = (e) => {
      if (!this.isDrawing) return;
      const pt = this.getPointerPos(e);

      if (this.currentTool === 'pen') {
        this.ctx.lineTo(pt.x, pt.y);
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = this.currentLineWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.stroke();
        this.broadcastDrawAction('draw', pt.x, pt.y);
      } else if (this.currentTool === 'highlighter') {
        this.ctx.lineTo(pt.x, pt.y);
        this.ctx.strokeStyle = this.getHighlighterColor(this.currentColor);
        this.ctx.lineWidth = this.currentLineWidth * 4;
        this.ctx.lineCap = 'round';
        this.ctx.stroke();
        this.broadcastDrawAction('draw', pt.x, pt.y);
      } else if (this.currentTool === 'eraser') {
        this.ctx.lineTo(pt.x, pt.y);
        this.ctx.strokeStyle = this.backgroundMode === 'dark' ? '#1e1f20' : '#ffffff';
        this.ctx.lineWidth = this.currentLineWidth * 6;
        this.ctx.lineCap = 'round';
        this.ctx.stroke();
        this.broadcastDrawAction('draw', pt.x, pt.y, { isEraser: true });
      } else if (['rect', 'circle', 'arrow', 'line'].includes(this.currentTool)) {
        // Live preview of shape
        if (this.snapshot) {
          this.ctx.putImageData(this.snapshot, 0, 0);
        }
        this.drawShape(this.currentTool, this.startX, this.startY, pt.x, pt.y, this.currentColor, this.currentLineWidth);
      }
    };

    const stop = (e) => {
      if (!this.isDrawing) return;
      this.isDrawing = false;

      if (['rect', 'circle', 'arrow', 'line'].includes(this.currentTool)) {
        const pt = this.getPointerPos(e);
        this.drawShape(this.currentTool, this.startX, this.startY, pt.x, pt.y, this.currentColor, this.currentLineWidth);
        this.broadcastDrawAction('shape', pt.x, pt.y, {
          shape: this.currentTool,
          x1: this.startX,
          y1: this.startY,
          x2: pt.x,
          y2: pt.y
        });
      } else {
        this.broadcastDrawAction('stop');
      }

      this.pushHistory();
    };

    this.canvas.addEventListener('mousedown', start);
    this.canvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', stop);

    // Touch support
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      start(e.touches[0]);
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      draw(e.touches[0]);
    }, { passive: false });
    this.canvas.addEventListener('touchend', (e) => {
      stop(e.changedTouches ? e.changedTouches[0] : e);
    });
  }

  getHighlighterColor(hex) {
    if (hex.startsWith('#') && hex.length === 7) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, 0.35)`;
    }
    return 'rgba(255, 235, 59, 0.4)';
  }

  drawShape(shape, x1, y1, x2, y2, color, width) {
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (shape === 'rect') {
      this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (shape === 'circle') {
      const radiusX = Math.abs(x2 - x1) / 2;
      const radiusY = Math.abs(y2 - y1) / 2;
      const centerX = Math.min(x1, x2) + radiusX;
      const centerY = Math.min(y1, y2) + radiusY;
      this.ctx.beginPath();
      this.ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      this.ctx.stroke();
    } else if (shape === 'line') {
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
    } else if (shape === 'arrow') {
      this.drawArrow(x1, y1, x2, y2);
    }

    this.ctx.restore();
  }

  drawArrow(x1, y1, x2, y2) {
    const headLength = 14;
    const angle = Math.atan2(y2 - y1, x2 - x1);

    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.moveTo(x2, y2);
    this.ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
    this.ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
    this.ctx.closePath();
    this.ctx.fillStyle = this.ctx.strokeStyle;
    this.ctx.fill();
  }

  drawText(text, x, y, color, size) {
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.font = `600 ${Math.max(14, size)}px Inter, system-ui, sans-serif`;
    this.ctx.fillText(text, x, y);
    this.ctx.restore();
  }

  getPointerPos(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = evt.clientX || (evt.touches ? evt.touches[0].clientX : 0);
    const clientY = evt.clientY || (evt.touches ? evt.touches[0].clientY : 0);
    return {
      x: (clientX - rect.left) * (this.canvas.width / rect.width),
      y: (clientY - rect.top) * (this.canvas.height / rect.height)
    };
  }

  bindNotepadEvents() {
    this.notepad.addEventListener('input', () => {
      if (window.setuWebRTC) {
        const packet = JSON.stringify({
          type: 'shared-notepad-update',
          text: this.notepad.value
        });
        window.setuWebRTC.sendData('control', packet);
      }
    });
  }

  broadcastDrawAction(action, x, y, extra = {}) {
    if (!window.setuWebRTC) return;
    const packet = JSON.stringify({
      type: 'shared-canvas-draw',
      action,
      x: x ? Math.round(x) : 0,
      y: y ? Math.round(y) : 0,
      color: this.currentColor,
      width: this.currentLineWidth,
      tool: this.currentTool,
      ...extra
    });
    window.setuWebRTC.sendData('control', packet);
  }

  handleInboundPacket(packet) {
    if (packet.type === 'shared-page-permission') {
      this.collaborationAllowed = !!packet.allowed;
      if (this.onPermissionChanged) this.onPermissionChanged(this.collaborationAllowed);
      if (window.showToast) {
        window.showToast(this.collaborationAllowed ? 'Host enabled shared whiteboard collaboration' : 'Whiteboard collaboration disabled by host');
      }
      return;
    }

    if (!this.collaborationAllowed && this.isHost) {
      return;
    }

    if (packet.type === 'shared-canvas-draw' && this.ctx) {
      const { action, x, y, color, width, tool, isEraser, shape, x1, y1, x2, y2, text, size, dataUrl } = packet;

      if (action === 'start') {
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
      } else if (action === 'draw') {
        this.ctx.lineTo(x, y);
        if (isEraser) {
          this.ctx.strokeStyle = this.backgroundMode === 'dark' ? '#1e1f20' : '#ffffff';
          this.ctx.lineWidth = (width || 3) * 6;
        } else if (tool === 'highlighter') {
          this.ctx.strokeStyle = this.getHighlighterColor(color || '#f9ab00');
          this.ctx.lineWidth = (width || 3) * 4;
        } else {
          this.ctx.strokeStyle = color || '#1a73e8';
          this.ctx.lineWidth = width || 3;
        }
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.stroke();
      } else if (action === 'shape') {
        this.drawShape(shape, x1, y1, x2, y2, color, width);
        this.pushHistory();
      } else if (action === 'text') {
        this.drawText(text, x, y, color, size);
        this.pushHistory();
      } else if (action === 'clear') {
        this.renderBackground();
        this.pushHistory();
      } else if (action === 'sync-canvas' && dataUrl) {
        const img = new Image();
        img.onload = () => {
          this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.ctx.drawImage(img, 0, 0);
          this.pushHistory();
        };
        img.src = dataUrl;
      }
    } else if (packet.type === 'shared-notepad-update' && this.notepad) {
      this.notepad.value = packet.text || '';
    }
  }

  clearCanvas(broadcast = true) {
    if (!this.ctx) return;
    this.renderBackground();
    this.pushHistory();

    if (broadcast && window.setuWebRTC) {
      const packet = JSON.stringify({
        type: 'shared-canvas-draw',
        action: 'clear'
      });
      window.setuWebRTC.sendData('control', packet);
    }
  }

  downloadCanvas() {
    if (!this.canvas) return;
    const a = document.createElement('a');
    a.href = this.canvas.toDataURL('image/png');
    a.download = `setu-whiteboard-${Date.now()}.png`;
    a.click();
    if (window.showToast) window.showToast('Whiteboard PNG downloaded');
  }
}

// Global instance
window.setuSharedPage = new SharedPageModule();
