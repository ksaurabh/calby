# Deploying to AWS Lightsail

This guide deploys the app to a single Amazon Linux 2023 Lightsail instance behind nginx,
with the Express API running under PM2 and the React build served as static files. Replace
`calby.airmdr.net` with your actual domain throughout.

## Architecture

```
                  ┌──────────────── Lightsail instance ────────────────┐
  Browser ──443──▶ nginx ──▶ /            → dist/ (static React build)  │
                  │         ├ /api/*       → http://127.0.0.1:3002       │
                  │         └ /auth/*      → http://127.0.0.1:3002       │
                  │                          (Express API via PM2)       │
                  └─────────────────────────────────────────────────────┘
```

## 1. Create the instance

- Lightsail → Create instance → Linux/Unix → **Amazon Linux 2023**.
- Networking → attach a **static IP**, and open ports **80** and **443** in the firewall.
- Point your DNS `A` record (`calby.airmdr.net`) at the static IP.

## 2. Install dependencies on the instance

```bash
# Node.js 22 (Vite needs 20.19+ / 22.12+)
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs nginx git

# PM2
sudo npm install -g pm2
```

## 3. Clone and configure the app

```bash
cd ~
git clone <your-repo-url> calby
cd calby
npm install

cp .env.example .env
nano .env   # fill in the production values below
```

Production `.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=https://calby.airmdr.net/auth/google/callback
SESSION_SECRET=<long-random-string>
CLIENT_URL=https://calby.airmdr.net
PORT=3002
NODE_ENV=production
# Leave VITE_API_URL blank so the frontend uses same-origin relative URLs.
VITE_API_URL=
```

Add the production redirect URI in the Google Cloud Console OAuth client:

- `https://calby.airmdr.net/auth/google/callback`

Build and start:

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # run the command it prints, to start PM2 on boot
```

## 4. nginx config

The quickest path is the script in the repo, which generates the whole site
config with the correct proxy headers, backs up any existing copy, applies the
SELinux settings from step 5, and reloads (restoring the backup if the config
fails to validate):

```bash
sudo ./scripts/setup-nginx.sh cal.airmdr.net 3002
```

It emits an HTTPS block automatically if a Let's Encrypt certificate for the
domain already exists, and an HTTP-only block otherwise — so run it before
certbot on a fresh instance, and again after, if you like.

To verify a deployment at any time:

```bash
./scripts/check-deploy.sh cal.airmdr.net 3002
```

The rest of this section describes the same config by hand.

Disable the default server block if present (in `/etc/nginx/nginx.conf`, comment out the
`server { ... }` block around lines 37–51 that listens on port 80).

Create `/etc/nginx/conf.d/calby.conf`:

```nginx
server {
    listen 80;
    server_name calby.airmdr.net;

    root /home/ec2-user/calby/dist;
    index index.html;

    # API and auth → Express backend
    location /api/ {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend-handled auth routes. These need the same proxy_set_header lines as
    # /api/ — X-Forwarded-Proto especially. Without it Express sees the proxied
    # request as plain HTTP and refuses to set the `secure` session cookie, so
    # sign-in appears to work and then dumps you back on the login page.
    # The regex excludes /auth/callback, which is a frontend route.
    location ~ ^/auth/(google|google/callback|logout|user|failure)$ {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Everything else — the SPA. Includes /auth/callback and /book/<slug>,
    # which are frontend routes, not backend ones.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Reload nginx:

```bash
sudo nginx -t && sudo systemctl restart nginx
sudo systemctl enable nginx
```

## 5. SELinux / permissions (Amazon Linux)

```bash
# Allow nginx to proxy to the backend and read the build directory
sudo setsebool -P httpd_can_network_connect 1
sudo setsebool -P httpd_read_user_content 1
sudo chcon -R -t httpd_sys_content_t ~/calby/dist
# Let nginx traverse into the home directory
chmod o+x /home/ec2-user
```

## 6. HTTPS with Let's Encrypt

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d calby.airmdr.net
```

Certbot rewrites the nginx config to listen on 443 and auto-renews via a systemd timer.

## 7. Access control

Only Google accounts on an allowed domain can sign in. `airmdr.com` is always allowed.
Add more from the Administration page as a super admin, or on the instance:

```bash
nano ~/calby/server/allowed-domains.json   # {"domains": ["partner.com"]}
```

Super admins come from `server/super-admins.json` (plus the bootstrap list in
`server/index.js`):

```bash
cp super-admins.example.json server/super-admins.json
nano server/super-admins.json
pm2 restart calby
```

## 8. Updating after a code change

```bash
cd ~/calby
./restart.sh      # git pull + npm install + build + pm2 restart
```

nginx does **not** need a restart unless you change its config.

## Useful commands

```bash
pm2 status      # process state
pm2 logs calby  # tail backend logs
pm2 restart all # restart after manual changes
```

## Backups

All data lives in `server/*.json`. Copy that directory to back up:

```bash
cp -r ~/calby/server ~/calby-backup-$(date +%F)
```
