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
