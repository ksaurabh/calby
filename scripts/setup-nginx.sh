#!/usr/bin/env bash
#
# setup-nginx.sh — write and load the nginx site config for Calby.
#
#   sudo ./scripts/setup-nginx.sh [domain] [port]
#
# Defaults: domain cal.airmdr.net, backend port 3002.
#
# Generates /etc/nginx/conf.d/calby.conf from scratch (backing up any existing
# copy), so the proxy headers are always right. The /auth/* routes need
# X-Forwarded-Proto in particular: without it Express sees the proxied request
# as plain HTTP and refuses to set the `secure` session cookie, which silently
# drops you back on the login page after signing in with Google.
#
# If a Let's Encrypt certificate already exists for the domain, an HTTPS server
# block is emitted too and port 80 redirects to it. Otherwise only the port 80
# block is written — run certbot afterwards.
set -euo pipefail

DOMAIN="${1:-cal.airmdr.net}"
PORT="${2:-3002}"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$APP_DIR/dist"
CONF=/etc/nginx/conf.d/calby.conf
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Run with sudo: sudo $0 $DOMAIN $PORT" >&2
  exit 1
fi
if [ ! -d "$ROOT_DIR" ]; then
  echo "❌ No build found at $ROOT_DIR — run 'npm run build' first." >&2
  exit 1
fi

echo "Domain    : $DOMAIN"
echo "Backend   : http://127.0.0.1:$PORT"
echo "Web root  : $ROOT_DIR"

# --- proxy settings shared by every proxied location --------------------------
cat > /etc/nginx/calby-proxy.conf <<EOF
proxy_pass http://127.0.0.1:$PORT;
proxy_set_header Host \$host;
proxy_set_header X-Real-IP \$remote_addr;
proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto \$scheme;
EOF

# The body of a server block, reused for both http and https.
site_body() {
  cat <<EOF
    root $ROOT_DIR;
    index index.html;

    # API → Express backend
    location /api/ {
        include /etc/nginx/calby-proxy.conf;
    }

    # Backend-handled auth routes. The regex deliberately excludes
    # /auth/callback, which is a frontend route and must fall through to the
    # SPA handler below.
    location ~ ^/auth/(google|google/callback|logout|user|failure)\$ {
        include /etc/nginx/calby-proxy.conf;
    }

    # Everything else → SPA
    location / {
        try_files \$uri \$uri/ /index.html;
    }
EOF
}

# --- back up whatever is there now --------------------------------------------
if [ -f "$CONF" ]; then
  BACKUP="$CONF.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$CONF" "$BACKUP"
  echo "Backed up existing config → $BACKUP"
fi

# --- write the site config ----------------------------------------------------
if [ -d "$CERT_DIR" ]; then
  echo "Certificate found → writing HTTP redirect + HTTPS server block."
  {
    echo "server {"
    echo "    listen 80;"
    echo "    server_name $DOMAIN;"
    echo "    return 301 https://\$host\$request_uri;"
    echo "}"
    echo ""
    echo "server {"
    echo "    listen 443 ssl;"
    echo "    server_name $DOMAIN;"
    echo ""
    echo "    ssl_certificate     $CERT_DIR/fullchain.pem;"
    echo "    ssl_certificate_key $CERT_DIR/privkey.pem;"
    # These are written by certbot; include them only if they exist, since an
    # nginx -t failure here would take the whole site down.
    [ -f /etc/letsencrypt/options-ssl-nginx.conf ] && \
      echo "    include /etc/letsencrypt/options-ssl-nginx.conf;" || true
    [ -f /etc/letsencrypt/ssl-dhparams.pem ] && \
      echo "    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;" || true
    echo ""
    site_body
    echo "}"
  } > "$CONF"
else
  echo "No certificate at $CERT_DIR → writing HTTP-only block."
  echo "   After this, run: sudo certbot --nginx -d $DOMAIN"
  {
    echo "server {"
    echo "    listen 80;"
    echo "    server_name $DOMAIN;"
    echo ""
    site_body
    echo "}"
  } > "$CONF"
fi

# --- SELinux + permissions (Amazon Linux) -------------------------------------
if command -v setsebool >/dev/null 2>&1; then
  setsebool -P httpd_can_network_connect 1 || true
  setsebool -P httpd_read_user_content 1 || true
fi
if command -v chcon >/dev/null 2>&1; then
  chcon -R -t httpd_sys_content_t "$ROOT_DIR" || true
fi
chmod o+x "$(dirname "$APP_DIR")" 2>/dev/null || true
chmod o+x "$APP_DIR" 2>/dev/null || true

# --- test and reload ----------------------------------------------------------
if ! nginx -t; then
  echo "❌ Generated config failed nginx -t." >&2
  if [ -n "${BACKUP:-}" ]; then
    cp "$BACKUP" "$CONF"
    echo "   Restored the previous config from $BACKUP; nothing was reloaded." >&2
  fi
  exit 1
fi
systemctl reload nginx

echo ""
echo "✅ nginx reloaded. Proxied locations:"
nginx -T 2>/dev/null | grep -E "location (/api/|~ \^/auth)" || true
echo ""
echo "Sanity checks:"
echo "  curl -sI https://$DOMAIN | head -1"
echo "  curl -s https://$DOMAIN/api/health"
