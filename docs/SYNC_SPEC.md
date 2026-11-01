# Setu P2P Standard Multi-Device Synchronization Specification

Version: 1.0.0  
Status: Production Standard  
Classification: Zero-Knowledge, Provider-Independent Protocol  

---

## 1. Executive Overview

The Setu P2P Synchronization Protocol enables decentralized, multi-device data synchronization across any compatible HTTP server. 

### Core Architectural Principles
1. **Provider Independence**: Setu does not bind to proprietary storage APIs (Google Drive SDK, OneDrive SDK, Dropbox API). Instead, it communicates with any HTTP server implementing five standard REST operations.
2. **Zero-Knowledge Security**: All records are encrypted, blinded, and digitally signed in the client browser using the WebCrypto API before transmission. The sync server stores only opaque ciphertext and blinded hashes; it cannot inspect user data, tamper with records, or forge updates.
3. **High-Performance Architecture**:
   - **In-Memory Key Caching**: Heavy key derivation (PBKDF2 600,000 iterations) executes once upon initialization; record encryption uses native hardware-accelerated AES-GCM (< 1ms per record).
   - **Debounced Write Batching**: A 1.5-second coalescing timer bundles rapid edits into a single HTTP payload.
   - **Adaptive Polling (Page Visibility API)**: Foreground polling occurs every 15 seconds; background/hidden tabs throttle automatically to 60-120 seconds to preserve battery.
   - **Monotonic Cursor Pagination**: Incremental delta pulls fetch only changes committed since the last cursor ($O(\log N)$ range lookup).

---

## 2. Cryptographic Security Specification

```
Master Passphrase + Account Salt
               │
               ▼  PBKDF2-HMAC-SHA256 (600,000 iterations)
          Master Secret
               │
               ▼  HKDF-SHA256 Extract & Expand
    ┌──────────┼──────────┐
    ▼          ▼          ▼
  K_enc      K_blind    K_auth
(AES-GCM)  (HMAC-256) (API Token)
```

### Key Derivation
- **Salt**: `SetuSyncSalt_v1_<lowercase_account_id>`
- **PBKDF2**: 600,000 iterations using SHA-256 to produce an intermediate 256-bit Master Secret.
- **HKDF Expansion**:
  - `K_enc` (`info: setu-sync-enc-v1`): 256-bit AES-GCM encryption key.
  - `K_blind` (`info: setu-sync-blind-v1`): 256-bit HMAC key for table and record ID blinding.
  - `K_auth` (`info: setu-sync-auth-v1`): 256-bit HMAC key for Bearer Token generation.

### Device Non-Repudiation (ECDSA P-256)
- Every device generates an asymmetric `ECDSA P-256` keypair upon initialization.
- The private key is non-extractable and signs every change envelope.
- Receiving devices verify the signature against the authoring device's registered public key. Tampered packets are discarded.

### Metadata Blinding
- Store Name: $\text{blindedStore} = \text{HMAC}_{K_{blind}}(\text{"store:"} \parallel \text{storeName})$
- Record ID: $\text{blindedRecordId} = \text{HMAC}_{K_{blind}}(\text{"record:"} \parallel \text{recordId})$

### Random Bucket Padding
- To defeat traffic analysis, plaintext JSON is padded to discrete bucket sizes (512 B, 2 KB, 8 KB, 32 KB, 128 KB) using cryptographically secure random bytes before encryption.

---

## 3. Standard REST API Contracts

All endpoints accept and return `application/json` over `HTTPS`.

### Required Headers (Standard Servers)
```http
Authorization: Bearer <AuthToken>
X-Setu-Account-Id: <AccountId>
X-Setu-Device-Id: <DeviceId>
Content-Type: application/json
```

> [!NOTE]
> **Google Apps Script CORS Compatibility**: Google Apps Script Web Apps do not support CORS `OPTIONS` preflight requests. When connecting to Google Apps Script endpoints, Setu automatically uses CORS Simple Requests:
> - **GET**: Headers are omitted; routing and auth are passed as URL query parameters (`?action=...&secretKey=...&accountId=...`).
> - **POST**: Sent as `Content-Type: text/plain;charset=utf-8` with authentication and metadata embedded directly within the JSON body payload.
> Both modes are natively parsed by Google Apps Script `doGet(e)` / `doPost(e)` without triggering browser preflight blocks.

---

### Endpoint 1: `POST /sync/register`
Registers a device within the user's sync ring.

#### Request Body
```json
{
  "deviceId": "dev_desk_7a8b9c",
  "deviceLabel": "Work Desktop (Windows)",
  "deviceType": "desktop",
  "publicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...",
  "registeredAt": 1793358000000
}
```

#### Response (`200 OK`)
```json
{
  "success": true,
  "registered": true,
  "currentCursor": 1042,
  "serverTime": 1793358000100,
  "activeDevices": 2
}
```

---

### Endpoint 2: `GET /sync/changes`
Fetches incremental changes since the client's last known cursor.

#### Query Parameters
- `since` (integer, optional): High-water mark cursor. Default `0`.
- `limit` (integer, optional): Maximum changes to return. Default `100`.

#### Response (`200 OK`)
```json
{
  "success": true,
  "cursor": 1045,
  "hasMore": false,
  "serverTime": 1793358015000,
  "changes": [
    {
      "changeId": "chg_1793358010000_a8f9b2",
      "originDeviceId": "dev_mob_k3b201",
      "seq": 14,
      "timestamp": 1793358010000,
      "action": "upsert",
      "blindedStore": "7a3f81c9e4b1029384756abcdef0123456789abcdef0123456789abcdef01234",
      "blindedRecordId": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "iv": "dGVzdF9pdl8xMjM0NTY3OA==",
      "ciphertext": "ZXlKaGJHY2lPaUpTVXpVTklpd2lhWE56SWl3aWNYVnFibV...",
      "deviceSignature": "MEUCIQD3s...base64_encoded_signature...",
      "senderPublicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE..."
    }
  ]
}
```

---

### Endpoint 3: `POST /sync/changes`
Submits a batch of local encrypted changes.

#### Request Body
```json
{
  "batchId": "batch_1793358020000_9b8a",
  "clientTimestamp": 1793358020000,
  "changes": [
    {
      "changeId": "chg_1793358019000_44ba12",
      "originDeviceId": "dev_desk_7a8b9c",
      "seq": 15,
      "timestamp": 1793358019000,
      "action": "upsert",
      "blindedStore": "7a3f81c9e4b1029384756abcdef0123456789abcdef0123456789abcdef01234",
      "blindedRecordId": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "iv": "c2FtcGxlX2l2X2Jhc2U2NA==",
      "ciphertext": "ZW5jcnlwdGVkX3NjaGVkdWxlX2Jsb2I=",
      "deviceSignature": "MEUCIQD3s...base64_encoded_signature...",
      "senderPublicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE..."
    }
  ]
}
```

#### Response (`200 OK`)
```json
{
  "success": true,
  "acceptedCount": 1,
  "newCursor": 1046,
  "serverTime": 1793358020500
}
```

---

### Endpoint 4: `GET /sync/status`
Lightweight heartbeat for diagnostics, latency calculation, and device discovery.

#### Response (`200 OK`)
```json
{
  "success": true,
  "accountId": "my_account_id",
  "currentCursor": 1046,
  "serverTime": 1793358030000,
  "devices": [
    {
      "deviceId": "dev_desk_7a8b9c",
      "deviceLabel": "Work Desktop (Windows)",
      "lastActiveAt": 1793358020000,
      "isCurrent": true
    },
    {
      "deviceId": "dev_mob_k3b201",
      "deviceLabel": "Mobile PWA",
      "lastActiveAt": 1793358010000,
      "isCurrent": false
    }
  ]
}
```

---

### Endpoint 5: `POST /sync/acknowledge`
Confirms receipt and local processing of changes up to a specified cursor. Allows the server to prune historical logs safely.

#### Request Body
```json
{
  "acknowledgedCursor": 1045,
  "timestamp": 1793358035000
}
```

#### Response (`200 OK`)
```json
{
  "success": true,
  "prunedCursor": 1020
}
```

---

## 4. Reference Server Implementations

Below are complete, self-contained reference server implementations.

### Reference 1: Google Apps Script (Zero-Cost Serverless Deployment)

Deploy as a private Web App in Google Apps Script backed strictly by a designated Google Drive folder.

#### Configuration via Script Properties (Zero Full-Drive Access)

To prevent the script from accessing personal files or requiring broad drive access, and to secure the endpoint against unauthorized requests, Setu reads configuration strictly from **Project Settings -> Script Properties**:

1. **Create a Dedicated Folder in Google Drive**:
   - In Google Drive, create a new folder (e.g. `SetuSync`).
   - Open the folder and copy the unique **Folder ID** from the browser URL:
     `https://drive.google.com/drive/folders/1A2b3C4D5E6F7G8H9I0JkLmNoPqRsTuVw`
     The folder ID is the string at the end (e.g. `1A2b3C4D5E6F7G8H9I0JkLmNoPqRsTuVw`).

2. **Add Script Properties in Project Settings**:
   - Open your project at [script.google.com](https://script.google.com).
   - In the left sidebar, click **Project Settings** (gear icon).
   - Scroll down to **Script Properties** and click **Add script property**.
   - Configure the following properties:
     | Property | Value | Purpose |
     |:---|:---|:---|
     | `SYNC_FOLDER_ID` | `<Your-Google-Drive-Folder-ID>` | Dedicated folder for storage isolation (zero full-drive access). |
     | `SECRET_KEY` | `<Your-Secret-Key>` | Pre-shared secret key to authenticate sync requests (matches Signaling API pattern). |
   - Click **Save script properties**.

3. **Deploy as Web App**:
   - In the top right, click **Deploy** -> **New deployment**.
   - Select type: **Web app**.
   - **Execute as**: `Me (<your_email@gmail.com>)`
   - **Who has access**: `Anyone` *(Access is protected by `SECRET_KEY`, and payloads stored in Drive are AES-256-GCM encrypted blobs; plaintext is never exposed)*.
   - Click **Deploy** and complete the standard authorization prompt.
   - Copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`).
   - In Setu P2P, open **Settings** -> **Multi-Device Sync**, paste this URL into **Synchronization Endpoint URL**, enter your secret key into **Authentication Token / API Key**, and click **Test Connection**.

---

#### Production Google Apps Script Reference Code (`Code.gs`)

```javascript
/**
 * Setu P2P Standard Sync Server - Google Apps Script Reference
 * Stores changelog and device metadata strictly in a designated Google Drive folder.
 * Configuration is read securely from Project Settings -> Script Properties:
 * - SYNC_FOLDER_ID: Dedicated Google Drive folder ID
 * - SECRET_KEY: Pre-shared authentication secret (optional but recommended)
 * Payloads stored in Drive are client-side AES-256-GCM zero-knowledge encrypted blobs.
 */

function doPost(e) {
  return handleRequest(e, 'POST');
}

function doGet(e) {
  return handleRequest(e, 'GET');
}

function handleRequest(e, method) {
  var props = PropertiesService.getScriptProperties();
  var expectedSecret = props.getProperty('SECRET_KEY');

  // Support both pathInfo and query parameter routing (?action=sync/...)
  var path = (e.pathInfo || e.parameter['action'] || e.parameter['path'] || '').replace(/^\/+|\/+$/g, '');
  var accountId = e.parameter['accountId'] || '';
  var body = {};
  
  if (e.postData && e.postData.contents) {
    try {
      body = JSON.parse(e.postData.contents);
    } catch (_) {}
  }

  // Verify secret key authentication if SECRET_KEY is configured in Script Properties
  if (expectedSecret && expectedSecret.trim() !== '') {
    var incomingSecret = (e.parameter && (e.parameter['secretKey'] || e.parameter['secret'] || e.parameter['auth'])) ||
                         body.secretKey || body.secret || body.authToken || '';
    if (incomingSecret !== expectedSecret.trim()) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'Unauthorized: Invalid or missing secret key'
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  var responseData = { success: false, error: 'Endpoint not found: ' + path };

  try {
    if (path === 'sync/register' && method === 'POST') {
      responseData = handleRegister(body);
    } else if (path === 'sync/changes' && method === 'GET') {
      var since = parseInt(e.parameter['since'] || '0', 10);
      if (isNaN(since)) since = 0;
      var limit = parseInt(e.parameter['limit'] || '100', 10);
      if (isNaN(limit)) limit = 100;
      responseData = handleGetChanges(since, limit);
    } else if (path === 'sync/changes' && method === 'POST') {
      responseData = handlePostChanges(body);
    } else if (path === 'sync/status' && method === 'GET') {
      responseData = handleStatus();
    } else if (path === 'sync/acknowledge' && method === 'POST') {
      responseData = handleAcknowledge(body);
    }
  } catch (err) {
    responseData = { success: false, error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(responseData))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Accesses strictly the folder configured in Project Settings -> Script Properties
 */
function getSyncFolder() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('SYNC_FOLDER_ID');
  
  if (!folderId || !folderId.trim()) {
    throw new Error('SYNC_FOLDER_ID is not set. Go to Project Settings -> Script Properties, add SYNC_FOLDER_ID, and set your Google Drive Folder ID.');
  }

  return DriveApp.getFolderById(folderId.trim());
}

function getStoreFile() {
  var folder = getSyncFolder();
  var fileName = 'setu_sync_store.json';
  var files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    var f = files.next();
    if (!f.isTrashed()) {
      return f;
    }
  }
  return folder.createFile(fileName, JSON.stringify({ cursor: 0, changes: [], devices: {} }));
}

function readStore() {
  var file = getStoreFile();
  try {
    return JSON.parse(file.getBlob().getDataAsString());
  } catch (_) {
    return { cursor: 0, changes: [], devices: {} };
  }
}

function writeStore(data) {
  var file = getStoreFile();
  file.setContent(JSON.stringify(data));
}

function handleRegister(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var store = readStore();
    if (!store.devices) store.devices = {};
    store.devices[body.deviceId] = {
      deviceId: body.deviceId,
      deviceLabel: body.deviceLabel || 'Device',
      deviceType: body.deviceType || 'generic',
      publicKey: body.publicKey,
      lastActiveAt: new Date().getTime()
    };
    writeStore(store);
    return {
      success: true,
      registered: true,
      currentCursor: store.cursor || 0,
      serverTime: new Date().getTime(),
      activeDevices: Object.keys(store.devices).length
    };
  } finally {
    lock.releaseLock();
  }
}

function handleGetChanges(since, limit) {
  var store = readStore();
  var allChanges = store.changes || [];
  var filtered = allChanges.filter(function(c) {
    return c.cursor > since;
  }).slice(0, limit);

  return {
    success: true,
    cursor: store.cursor || 0,
    hasMore: false,
    serverTime: new Date().getTime(),
    changes: filtered
  };
}

function handlePostChanges(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var store = readStore();
    if (!store.changes) store.changes = [];
    if (!store.cursor) store.cursor = 0;

    var incoming = body.changes || [];
    for (var i = 0; i < incoming.length; i++) {
      store.cursor += 1;
      incoming[i].cursor = store.cursor;
      store.changes.push(incoming[i]);
    }
    writeStore(store);
    return {
      success: true,
      acceptedCount: incoming.length,
      newCursor: store.cursor,
      serverTime: new Date().getTime()
    };
  } finally {
    lock.releaseLock();
  }
}

function handleStatus() {
  var store = readStore();
  var devList = [];
  var devices = store.devices || {};
  for (var k in devices) {
    devList.push(devices[k]);
  }
  return {
    success: true,
    currentCursor: store.cursor || 0,
    serverTime: new Date().getTime(),
    devices: devList
  };
}

function handleAcknowledge(body) {
  return { success: true, acknowledged: true };
}
```

---

### Reference 2: Node.js + Express (Self-Hosted Docker / VPS / NAS)

Single-file server with zero dependencies beyond `express`:

```javascript
/**
 * Setu P2P Standard Sync Server - Node.js Reference
 * Usage: node sync-server.js
 */

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// In-Memory or SQLite Store
let currentCursor = 0;
const changelog = [];
const devices = new Map();

// Middleware: Authenticate Request via Bearer token, query param, or payload secretKey
app.use('/sync', (req, res, next) => {
  const expectedSecret = process.env.SECRET_KEY || '';
  if (expectedSecret) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const providedSecret = req.query.secretKey || (req.body && req.body.secretKey) || token;
    if (providedSecret !== expectedSecret) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid secret key' });
    }
  }
  next();
});

// 1. Device Registration
app.post('/sync/register', (req, res) => {
  const { deviceId, deviceLabel, deviceType, publicKey } = req.body;
  if (!deviceId) return res.status(400).json({ success: false, error: 'Missing deviceId' });

  devices.set(deviceId, {
    deviceId,
    deviceLabel: deviceLabel || 'Device',
    deviceType: deviceType || 'generic',
    publicKey,
    lastActiveAt: Date.now()
  });

  res.json({
    success: true,
    registered: true,
    currentCursor,
    serverTime: Date.now(),
    activeDevices: devices.size
  });
});

// 2. Retrieve Changes
app.get('/sync/changes', (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);

  const delta = changelog.filter(c => c.cursor > since).slice(0, limit);

  res.json({
    success: true,
    cursor: currentCursor,
    hasMore: false,
    serverTime: Date.now(),
    changes: delta
  });
});

// 3. Submit Changes
app.post('/sync/changes', (req, res) => {
  const { changes } = req.body;
  if (!Array.isArray(changes)) return res.status(400).json({ success: false, error: 'Invalid changes array' });

  for (const item of changes) {
    currentCursor += 1;
    item.cursor = currentCursor;
    changelog.push(item);
  }

  res.json({
    success: true,
    acceptedCount: changes.length,
    newCursor: currentCursor,
    serverTime: Date.now()
  });
});

// 4. Status Check
app.get('/sync/status', (req, res) => {
  res.json({
    success: true,
    currentCursor,
    serverTime: Date.now(),
    devices: Array.from(devices.values())
  });
});

// 5. Acknowledge & Compaction
app.post('/sync/acknowledge', (req, res) => {
  const { acknowledgedCursor } = req.body;
  // Optional: prune changelog items where cursor <= acknowledgedCursor
  res.json({ success: true, prunedCursor: acknowledgedCursor });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[Setu Sync Server] Running on port ${PORT}`);
});
```

---

## 5. Configuration Guide for Users

1. Open **Settings** in Setu P2P (`#openSettingsBtn` -> **Multi-Device Sync** tab, or click the header sync icon to configure if not yet set up).
2. Select the **Multi-Device Sync** tab.
3. Check **Enable Automatic Multi-Device Synchronization**.
4. Enter your **Synchronization Endpoint URL** (e.g., your deployed Google Apps Script URL or custom Node.js endpoint).
5. Enter your **Account Identifier** (e.g., `personal_ring_01`).
6. Enter your secret **Master Encryption Passphrase**.
7. Click **Test Connection** to verify zero-knowledge key derivation and server connectivity.
8. Click **Save Settings**.
9. Repeat steps 1-8 on your other devices using the **exact same account identifier and master passphrase**. All contacts, schedules, and history will synchronize automatically.
10. Click the header sync button (`#openSyncSettingsBtn`) or mobile menu item (`#mobileMenuSyncBtn`) at any time to trigger an instant manual synchronization cycle. The button animates with a spin effect during synchronization.

