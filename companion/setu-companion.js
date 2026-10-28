/**
 * Setu Companion - Standalone Node.js Input Daemon
 * Implements the Setu Remote Control companion protocol with native OS input simulation.
 * Run directly with: node companion/setu-companion.js [--port 49152] [--key <PASSKEY>]
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

// Parse CLI arguments
const args = process.argv.slice(2);
let portOverride = null;
let keyOverride = null;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
    portOverride = parseInt(args[i + 1], 10);
    i++;
  } else if ((args[i] === '--key' || args[i] === '-k') && args[i + 1]) {
    keyOverride = args[i + 1].trim();
    i++;
  }
}

// Load or create config.json
const configPath = path.join(__dirname, 'config.json');
let config = { port: 49152, passkey: 'setu_remote_access_key' };

if (fs.existsSync(configPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...config, ...raw };
  } catch (_) {}
} else {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('[Config] Created default config at:', configPath);
  } catch (_) {}
}

if (!config.passkey || !config.passkey.trim()) {
  config.passkey = 'setu_remote_access_key';
}

if (portOverride) config.port = portOverride;
if (keyOverride) config.passkey = keyOverride;

console.log('----------------------------------------------------');
console.log('Setu Companion - Input Daemon (Node.js)');
console.log('----------------------------------------------------');
console.log('[Config] Port:', config.port);
console.log('[Config] Security Passkey:', config.passkey);

// Screen dimensions (dynamically discovered from driver)
let screenWidth = 1920;
let screenHeight = 1080;
let driverProcess = null;
let hasXdotool = false;

// Virtual Key Code Map for Windows
const VK_MAP = {
  Enter: 13,
  Backspace: 8,
  Tab: 9,
  Escape: 27,
  ' ': 32,
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Insert: 45,
  Delete: 46,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Meta: 91,
  // Number row shifted symbols (VK_0 through VK_9: 48-57)
  ')': 48,
  '!': 49,
  '@': 50,
  '#': 51,
  '$': 52,
  '%': 53,
  '^': 54,
  '&': 55,
  '*': 56,
  '(': 57,
  // OEM Punctuation & Symbols
  ';': 186,
  ':': 186,
  '=': 187,
  '+': 187,
  ',': 188,
  '<': 188,
  '-': 189,
  '_': 189,
  '.': 190,
  '>': 190,
  '/': 191,
  '?': 191,
  '`': 192,
  '~': 192,
  '[': 219,
  '{': 219,
  '\\': 220,
  '|': 220,
  ']': 221,
  '}': 221,
  '\'': 222,
  '"': 222,
  // Physical key codes (e.g. from e.code)
  BracketLeft: 219,
  BracketRight: 221,
  Backslash: 220,
  Backquote: 192,
  Comma: 188,
  Period: 190,
  Slash: 191,
  Semicolon: 186,
  Equal: 187,
  Minus: 189,
  Quote: 222
};

function getVirtualKey(key, code) {
  if (key && VK_MAP[key]) return VK_MAP[key];
  if (code && VK_MAP[code]) return VK_MAP[code];

  // Map physical key codes (e.g., Digit4 -> 52, KeyA -> 65)
  if (code) {
    if (code.startsWith('Digit')) {
      const num = parseInt(code.replace('Digit', ''), 10);
      if (!isNaN(num) && num >= 0 && num <= 9) return 48 + num;
    }
    if (code.startsWith('Key') && code.length === 4) {
      return code.toUpperCase().charCodeAt(3);
    }
  }

  if (key && key.length === 1) {
    const charCode = key.charCodeAt(0);
    // 0-9
    if (charCode >= 48 && charCode <= 57) return charCode;
    // A-Z / a-z
    const upper = key.toUpperCase();
    const upCode = upper.charCodeAt(0);
    if (upCode >= 65 && upCode <= 90) return upCode;
  }
  return null;
}

// Key Map for Linux (xdotool keysyms)
const X11_MAP = {
  Enter: 'Return',
  Backspace: 'BackSpace',
  Tab: 'Tab',
  Escape: 'Escape',
  ' ': 'space',
  Space: 'space',
  PageUp: 'Page_Up',
  PageDown: 'Page_Down',
  End: 'End',
  Home: 'Home',
  ArrowLeft: 'Left',
  ArrowUp: 'Up',
  ArrowRight: 'Right',
  ArrowDown: 'Down',
  Delete: 'Delete',
  Shift: 'Shift_L',
  Control: 'Control_L',
  Alt: 'Alt_L',
  Meta: 'Super_L',
  // Number row shifted symbols
  ')': 'parenright',
  '!': 'exclam',
  '@': 'at',
  '#': 'numbersign',
  '$': 'dollar',
  '%': 'percent',
  '^': 'asciicircum',
  '&': 'ampersand',
  '*': 'asterisk',
  '(': 'parenleft',
  '.': 'period',
  ',': 'comma',
  ';': 'semicolon',
  ':': 'colon',
  '-': 'minus',
  '_': 'underscore',
  '=': 'equal',
  '+': 'plus',
  '/': 'slash',
  '?': 'question',
  // OEM & punctuation keysyms for X11 / xdotool
  '<': 'less',
  '>': 'greater',
  '`': 'grave',
  '~': 'asciitilde',
  '{': 'braceleft',
  '}': 'braceright',
  '|': 'bar',
  '\\': 'backslash',
  '[': 'bracketleft',
  ']': 'bracketright',
  '\'': 'apostrophe',
  '"': 'quotedbl',
  // Physical codes
  BracketLeft: 'bracketleft',
  BracketRight: 'bracketright',
  Backslash: 'backslash',
  Backquote: 'grave',
  Comma: 'comma',
  Period: 'period',
  Slash: 'slash',
  Semicolon: 'semicolon',
  Equal: 'equal',
  Minus: 'minus',
  Quote: 'apostrophe'
};

function getX11Key(key, code) {
  if (key && X11_MAP[key]) return X11_MAP[key];
  if (code && X11_MAP[code]) return X11_MAP[code];
  if (code && code.startsWith('Digit')) {
    return code.replace('Digit', '');
  }
  if (key && key.length === 1) return key;
  return null;
}

// 1. Windows Native Input Driver
if (process.platform === 'win32') {
  const driverScript = path.join(__dirname, 'win-driver.ps1');
  if (fs.existsSync(driverScript)) {
    try {
      driverProcess = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        driverScript
      ], {
        stdio: ['pipe', 'pipe', 'inherit']
      });

      driverProcess.stdout.on('data', (data) => {
        const text = data.toString('utf8');
        const match = text.match(/READY\s+(\d+)\s+(\d+)/);
        if (match) {
          screenWidth = parseInt(match[1], 10);
          screenHeight = parseInt(match[2], 10);
          console.log(`[Driver] Windows native input active. Resolution: ${screenWidth} x ${screenHeight}`);
        }
      });

      driverProcess.on('exit', (code) => {
        console.log(`[Driver] Native driver exited with code ${code}`);
        driverProcess = null;
      });
    } catch (err) {
      console.warn('[Driver] Failed to start native driver:', err.message);
    }
  }
}

// 2. Linux Native Input Driver (xdotool)
if (process.platform === 'linux') {
  try {
    const { execSync } = require('child_process');
    try {
      execSync('which xdotool', { stdio: 'ignore' });
      hasXdotool = true;
      const geom = execSync('xdotool getdisplaygeometry', { encoding: 'utf8' }).trim();
      const parts = geom.split(/\s+/);
      if (parts.length >= 2) {
        screenWidth = parseInt(parts[0], 10) || 1920;
        screenHeight = parseInt(parts[1], 10) || 1080;
        console.log(`[Driver] Linux xdotool active. Resolution: ${screenWidth} x ${screenHeight}`);
      }
    } catch (_) {
      console.log('[Driver] Linux: xdotool not detected. For native input, install via: sudo apt install xdotool');
    }
  } catch (_) {}
}

function sendDriverCommand(cmd) {
  if (driverProcess && driverProcess.stdin && driverProcess.stdin.writable) {
    try {
      driverProcess.stdin.write(cmd + '\n');
    } catch (_) {}
  }
}

// Clean up driver process on termination
function cleanup() {
  if (driverProcess) {
    sendDriverCommand('Q');
    try { driverProcess.kill(); } catch (_) {}
  }
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
  if (driverProcess) {
    try { driverProcess.kill(); } catch (_) {}
  }
});

// HTTP & WebSocket Server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  if (url.pathname === '/health' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'setu-companion',
      version: '1.0.0',
      port: config.port,
      platform: process.platform,
      resolution: `${screenWidth}x${screenHeight}`
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// RFC 6455 WebSocket Upgrade with Full Fragmentation & Chunk Buffering
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const keyHeader = req.headers['sec-websocket-key'];

  if (!keyHeader) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(keyHeader + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    'Access-Control-Allow-Origin: *',
    'Access-Control-Allow-Private-Network: true',
    '\r\n'
  ];

  socket.write(headers.join('\r\n'));

  let authenticated = false;
  const providedKey = url.searchParams.get('key');
  if (providedKey && providedKey === config.passkey) {
    authenticated = true;
    console.log('[Auth] Client authenticated via connection parameter');
    sendWsMessage(socket, { type: 'rc-auth-success' });
  }

  let bufferQueue = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    bufferQueue = Buffer.concat([bufferQueue, chunk]);

    while (bufferQueue.length >= 2) {
      const firstByte = bufferQueue[0];
      const secondByte = bufferQueue[1];
      const opcode = firstByte & 0x0F;

      if (opcode === 0x8) {
        socket.end();
        return;
      }

      const isMasked = (secondByte & 0x80) === 0x80;
      let payloadLength = secondByte & 0x7F;
      let offset = 2;

      if (payloadLength === 126) {
        if (bufferQueue.length < 4) return;
        payloadLength = bufferQueue.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (bufferQueue.length < 10) return;
        payloadLength = Number(bufferQueue.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLength = isMasked ? 4 : 0;
      const totalFrameSize = offset + maskLength + payloadLength;

      if (bufferQueue.length < totalFrameSize) {
        return;
      }

      let maskKey = null;
      if (isMasked) {
        maskKey = bufferQueue.slice(offset, offset + 4);
        offset += 4;
      }

      const payload = bufferQueue.slice(offset, offset + payloadLength);
      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      bufferQueue = bufferQueue.slice(totalFrameSize);

      const msgText = payload.toString('utf8');
      try {
        const packet = JSON.parse(msgText);
        handlePacket(packet, socket, () => { authenticated = true; }, () => authenticated);
      } catch (err) {
        console.warn('[Error] Invalid packet:', err.message);
      }
    }
  });

  socket.on('close', () => {
    console.log('[Connection] Client disconnected');
  });

  socket.on('error', (err) => {
    console.warn('[Connection] Socket error:', err.message);
  });
});

function handlePacket(packet, socket, setAuth, getAuth) {
  if (packet.type === 'rc-auth') {
    if (packet.passkey === config.passkey) {
      setAuth();
      console.log('[Auth] Security passkey verified successfully');
      sendWsMessage(socket, { type: 'rc-auth-success' });
    } else {
      console.warn(`[Auth] Passkey mismatch. Configured in companion: "${config.passkey}", Received from browser: "${packet.passkey || ''}". Closing connection.`);
      sendWsMessage(socket, { type: 'rc-auth-failed', reason: 'Passkey mismatch' });
      socket.end();
    }
    return;
  }

  if (packet.type === 'rc-ping') {
    sendWsMessage(socket, { type: 'rc-pong' });
    return;
  }

  if (packet.type === 'rc-input') {
    if (!getAuth()) {
      console.warn('[Security] Dropped input command from unauthenticated connection');
      return;
    }
    executeInputCommand(packet);
  }
}

function executeInputCommand(packet) {
  const { action, x, y, button, dx, dy, key, code } = packet;

  // Linux xdotool dispatch
  if (process.platform === 'linux' && hasXdotool) {
    switch (action) {
      case 'mousemove': {
        if (typeof x === 'number' && typeof y === 'number') {
          const px = Math.round(x * screenWidth);
          const py = Math.round(y * screenHeight);
          exec(`xdotool mousemove ${px} ${py}`, () => {});
        }
        break;
      }
      case 'mousedown': {
        if (typeof x === 'number' && typeof y === 'number') {
          const px = Math.round(x * screenWidth);
          const py = Math.round(y * screenHeight);
          exec(`xdotool mousemove ${px} ${py}`, () => {});
        }
        const btn = button === 'right' ? 3 : (button === 'middle' ? 2 : 1);
        exec(`xdotool mousedown ${btn}`, () => {});
        console.log(`[Input] Mouse down (${button || 'left'})`);
        break;
      }
      case 'mouseup': {
        if (typeof x === 'number' && typeof y === 'number') {
          const px = Math.round(x * screenWidth);
          const py = Math.round(y * screenHeight);
          exec(`xdotool mousemove ${px} ${py}`, () => {});
        }
        const btn = button === 'right' ? 3 : (button === 'middle' ? 2 : 1);
        exec(`xdotool mouseup ${btn}`, () => {});
        console.log(`[Input] Mouse up (${button || 'left'})`);
        break;
      }
      case 'wheel': {
        const btn = dy > 0 ? 5 : 4;
        exec(`xdotool click ${btn}`, () => {});
        console.log(`[Input] Mouse wheel (${dy > 0 ? 'down' : 'up'})`);
        break;
      }
      case 'keydown': {
        const xk = getX11Key(key, code);
        if (xk) {
          exec(`xdotool keydown ${xk}`, () => {});
          console.log(`[Input] Key down: ${key} (${xk})`);
        }
        break;
      }
      case 'keyup': {
        const xk = getX11Key(key, code);
        if (xk) {
          exec(`xdotool keyup ${xk}`, () => {});
          console.log(`[Input] Key up: ${key} (${xk})`);
        }
        break;
      }
    }
    return;
  }

  // Windows win-driver dispatch
  switch (action) {
    case 'mousemove': {
      if (typeof x === 'number' && typeof y === 'number') {
        const px = Math.round(x * screenWidth);
        const py = Math.round(y * screenHeight);
        sendDriverCommand(`M ${px} ${py}`);
      }
      break;
    }

    case 'mousedown': {
      if (typeof x === 'number' && typeof y === 'number') {
        const px = Math.round(x * screenWidth);
        const py = Math.round(y * screenHeight);
        sendDriverCommand(`M ${px} ${py}`);
      }
      let flags = 2; // Left down
      if (button === 'right') flags = 8;
      else if (button === 'middle') flags = 32;
      sendDriverCommand(`D ${flags}`);
      console.log(`[Input] Mouse down (${button || 'left'})`);
      break;
    }

    case 'mouseup': {
      if (typeof x === 'number' && typeof y === 'number') {
        const px = Math.round(x * screenWidth);
        const py = Math.round(y * screenHeight);
        sendDriverCommand(`M ${px} ${py}`);
      }
      let flags = 4; // Left up
      if (button === 'right') flags = 16;
      else if (button === 'middle') flags = 64;
      sendDriverCommand(`U ${flags}`);
      console.log(`[Input] Mouse up (${button || 'left'})`);
      break;
    }

    case 'wheel': {
      const scrollAmount = dy ? (dy > 0 ? -120 : 120) : 0;
      if (scrollAmount !== 0) {
        sendDriverCommand(`W ${scrollAmount}`);
        console.log(`[Input] Mouse wheel (${scrollAmount})`);
      }
      break;
    }

    case 'keydown': {
      const vk = getVirtualKey(key, code);
      if (vk) {
        sendDriverCommand(`K ${vk} 0`);
        console.log(`[Input] Key down: ${key} (VK: ${vk})`);
      } else {
        console.log(`[Input] Key down unmapped: ${key}`);
      }
      break;
    }

    case 'keyup': {
      const vk = getVirtualKey(key, code);
      if (vk) {
        sendDriverCommand(`K ${vk} 2`);
        console.log(`[Input] Key up: ${key} (VK: ${vk})`);
      }
      break;
    }
  }
}

function sendWsMessage(socket, obj) {
  try {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    const length = payload.length;
    let header;

    if (length < 126) {
      header = Buffer.from([0x81, length]);
    } else if (length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    socket.write(Buffer.concat([header, payload]));
  } catch (_) {}
}

server.listen(config.port, '127.0.0.1', () => {
  console.log(`[Server] Listening on ws://127.0.0.1:${config.port}`);
  console.log('[Ready] Waiting for Setu web application...');
});
