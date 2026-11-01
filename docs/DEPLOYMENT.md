# Setu P2P — Deployment Guide

Deploying Setu P2P requires only a static file web server with HTTPS enabled. Because there is zero server-side code (no Node.js, PHP, Python, or database backend required), it can be deployed for free on GitHub Pages, Cloudflare Pages, Vercel, or Netlify.

---

## 1. Deploying to GitHub Pages

1. **Fork or Push to GitHub:**
   Push this repository to your GitHub account (e.g. `https://github.com/<your-username>/setu`).

2. **Enable GitHub Pages:**
   - In your repository, go to **Settings** > **Pages**.
   - Under **Build and deployment**:
     - Source: **Deploy from a branch**
     - Branch: `main` (or `master`)
     - Folder: `/ (root)`
   - Click **Save**.

3. **Enforce HTTPS:**
   - Check the **"Enforce HTTPS"** checkbox.
   - *Crucial:* Modern browsers block camera, microphone, and screen share permissions on unencrypted HTTP connections (except for `localhost`).

4. **Access your site:**
   After 1–2 minutes, your platform will be live at:
   `https://<your-username>.github.io/setu/`

---

## 2. Deploying with Cloudflare Pages / Netlify / Vercel

Because the project contains no build steps:
- **Build command:** *(leave empty)*
- **Output directory:** `.` or `/` (root)
- Simply select the repository and click Deploy.

---

## 3. Self-Hosting with Nginx / Apache / Caddy

Ensure your web server serves static files and enforces TLS:

### Caddy Example (`Caddyfile`):
```text
meet.yourdomain.com {
    root * /var/www/setu
    file_server
    tls internal # Or automatic Let's Encrypt
}
```

### Nginx Example:
```nginx
server {
    listen 443 ssl http2;
    server_name meet.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/meet.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/meet.yourdomain.com/privkey.pem;

    root /var/www/setu;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

---

## 4. Optional Serverless Gateways (Google Apps Script)

Setu P2P can optionally connect to serverless Google Apps Script Web Apps for:
1. **Custom API Signaling Gateway** (automated room codes and offer/answer exchange)
2. **Multi-Device Synchronization Gateway** (cross-device sync for contacts, schedules, and history)

### 4.1 Deployment & Security Principles

To ensure zero broad drive access, prevent credential leakage, and eliminate maintenance overhead:
1. **Never Hardcode Secrets or Folder IDs in Source Code**: Always store sensitive values in **Project Settings -> Script Properties**.
2. **Never Edit `appsscript.json` Manifests**: Outdated guidelines required editing OAuth scopes in manifest files. Google Apps Script automatically infers minimal required permissions based on standard service usage (`PropertiesService`, `CacheService`, `DriveApp.getFolderById`).
3. **Execute as Me, Accessible to Anyone**: Deploying with access set to "Anyone" allows browser clients to reach the endpoint without Google login prompts. Requests are authenticated at the application layer via `SECRET_KEY`, and all payloads are client-side end-to-end encrypted before transmission.

---

### 4.2 Custom API Signaling Gateway Reference (`Code.gs`)

This script provides an ephemeral signaling gateway with zero database costs. Offers and answers are kept in high-speed RAM (`CacheService`) and expire automatically after 6 hours:

```javascript
/**
 * Setu P2P - Custom API Signaling Gateway (Google Apps Script)
 * Stores ephemeral offer/answer payloads in memory cache with zero disk footprint.
 * Authentication secret is read securely from Project Settings -> Script Properties.
 */

function doGet(e) {
  return handleSignalingRequest(e, 'GET');
}

function doPost(e) {
  return handleSignalingRequest(e, 'POST');
}

function handleSignalingRequest(e, method) {
  var props = PropertiesService.getScriptProperties();
  var expectedSecret = props.getProperty('SECRET_KEY');
  var cache = CacheService.getScriptCache();

  var body = {};
  if (e.postData && e.postData.contents) {
    try {
      body = JSON.parse(e.postData.contents);
    } catch (_) {}
  }

  var id = (e.parameter && e.parameter.id) || body.id || '';
  var cleanId = id.toString().toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!cleanId) {
    return respondJson({ status: 'ok', service: 'setu-signaling', version: '1.0.0' });
  }

  // 1. GET Request: Participant fetching offer or Host polling for answer
  if (method === 'GET') {
    var raw = cache.get('room_' + cleanId);
    if (!raw) {
      return respondJson({ error: 'Room not found or expired', status: 'empty' });
    }
    try {
      var roomData = JSON.parse(raw);
      return respondJson(roomData);
    } catch (err) {
      return respondJson({ error: 'Malformed room payload' });
    }
  }

  // 2. POST Request: Register Offer, Submit Answer, or Delete
  if (method === 'POST') {
    var reqType = body.type || 'offer';

    // Verify secret key for host actions (offer registration and deletion)
    if (expectedSecret && expectedSecret.trim() !== '') {
      if (reqType === 'offer' || reqType === 'delete') {
        var incomingSecret = (e.parameter && (e.parameter.secretKey || e.parameter.secret)) || body.secretKey || '';
        if (incomingSecret !== expectedSecret.trim()) {
          return respondJson({ error: 'Unauthorized: Invalid host secret key', success: false });
        }
      }
    }

    if (reqType === 'offer') {
      var record = {
        id: cleanId,
        status: 'open',
        offer: body.offer,
        hostName: body.hostName || 'Host',
        createdTs: body.createdTs || new Date().getTime()
      };
      // 6-hour ephemeral cache TTL (21600 seconds)
      cache.put('room_' + cleanId, JSON.stringify(record), 21600);
      return respondJson({ success: true, id: cleanId });
    }

    if (reqType === 'answer') {
      var existingRaw = cache.get('room_' + cleanId);
      if (!existingRaw) {
        return respondJson({ error: 'Room not found or expired', success: false });
      }
      var existing = JSON.parse(existingRaw);
      existing.status = 'answered';
      existing.answer = body.answer;
      existing.clientName = body.clientName || 'Participant';
      existing.answeredTs = new Date().getTime();
      cache.put('room_' + cleanId, JSON.stringify(existing), 21600);
      return respondJson({ success: true });
    }

    if (reqType === 'delete') {
      cache.remove('room_' + cleanId);
      return respondJson({ success: true, deleted: true });
    }
  }

  return respondJson({ error: 'Unsupported request' });
}

function respondJson(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

#### Setup Instructions:
1. Open [script.google.com](https://script.google.com) and create a new project.
2. Paste the `Code.gs` above.
3. Click **Project Settings** (gear icon) -> **Script Properties** -> **Add script property**:
   - `SECRET_KEY`: `<Your-Host-Secret-Key>`
   - Click **Save script properties**.
4. Click **Deploy** -> **New deployment** -> **Web app**:
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
   - Click **Deploy** and copy the **Web app URL**.
5. In Setu P2P, open **Settings** -> **Network & Relays** -> **Custom API Signaling Gateway**:
   - Check **Enable Custom API Signaling Gateway**.
   - Paste the Web App URL into **API Endpoint URL**.
   - Enter your `SECRET_KEY` into **Host Secret Key**.
   - Click **Test API Connection**.

---

### 4.3 Multi-Device Synchronization Gateway

To deploy the Multi-Device Synchronization backend on Google Apps Script:
1. Create a dedicated Google Drive folder (e.g. `SetuSync`) and copy its **Folder ID**.
2. Create a new Google Apps Script project and paste the reference code from [docs/SYNC_SPEC.md](SYNC_SPEC.md).
3. In **Project Settings -> Script Properties**, add:
   - `SYNC_FOLDER_ID`: `<Your-Google-Drive-Folder-ID>`
   - `SECRET_KEY`: `<Your-Sync-Secret-Key>`
4. Deploy as **Web app** (`Execute as: Me`, `Who has access: Anyone`).
5. In Setu P2P, open **Settings** -> **Multi-Device Sync**, paste the URL and secret key, and click **Test Connection**.
