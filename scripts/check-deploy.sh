#!/usr/bin/env bash
#
# check-deploy.sh — verify a Calby deployment end to end.
#
#   ./scripts/check-deploy.sh [domain] [port]
#
# Prints everything that commonly breaks sign-in behind nginx, so a failure
# points at one line instead of a guessing game.
set -uo pipefail

DOMAIN="${1:-cal.airmdr.net}"
PORT="${2:-3002}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ok()   { echo "  ✅ $1"; }
bad()  { echo "  ❌ $1"; }
warn() { echo "  ⚠️  $1"; }

echo "=== 1. backend process ==="
if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  ok "backend answering on 127.0.0.1:$PORT"
else
  bad "no /api/health on 127.0.0.1:$PORT — check 'pm2 logs calby'"
fi

echo "=== 2. .env ==="
if [ -f "$APP_DIR/.env" ]; then
  grep -E '^(GOOGLE_CALLBACK_URL|CLIENT_URL|VITE_API_URL|PORT|NODE_ENV)=' "$APP_DIR/.env" \
    | sed 's/^/  /'
  grep -q "^GOOGLE_CALLBACK_URL=https://$DOMAIN/auth/google/callback$" "$APP_DIR/.env" \
    && ok "callback URL matches $DOMAIN" \
    || bad "GOOGLE_CALLBACK_URL should be https://$DOMAIN/auth/google/callback"
  grep -q "^CLIENT_URL=https://$DOMAIN$" "$APP_DIR/.env" \
    && ok "CLIENT_URL matches $DOMAIN (no trailing slash)" \
    || bad "CLIENT_URL should be exactly https://$DOMAIN"
  grep -q '^VITE_API_URL=$' "$APP_DIR/.env" \
    && ok "VITE_API_URL blank (same-origin)" \
    || bad "VITE_API_URL must be blank in production"
else
  bad "no .env at $APP_DIR/.env"
fi

echo "=== 3. frontend build ==="
if [ -d "$APP_DIR/dist" ]; then
  if grep -qro 'localhost:[0-9]*' "$APP_DIR/dist/assets/" 2>/dev/null; then
    bad "build has a localhost API URL baked in — run 'npm run build' after fixing .env"
  else
    ok "no localhost URL in the bundle"
  fi
  [ "$APP_DIR/dist/index.html" -nt "$APP_DIR/.env" ] \
    && ok "build is newer than .env" \
    || warn "build is older than .env — rebuild so VITE_* changes take effect"
else
  bad "no dist/ — run 'npm run build'"
fi

echo "=== 4. nginx proxy headers ==="
if command -v nginx >/dev/null 2>&1; then
  CONF_DUMP="$(sudo nginx -T 2>/dev/null)"
  echo "$CONF_DUMP" | grep -q 'X-Forwarded-Proto' \
    && ok "X-Forwarded-Proto is set somewhere" \
    || bad "no X-Forwarded-Proto anywhere — sessions will be dropped"
  if echo "$CONF_DUMP" | grep -qE 'location = /auth/'; then
    bad "old 'location = /auth/...' blocks present; run scripts/setup-nginx.sh"
  else
    ok "no stale exact-match /auth blocks"
  fi
else
  warn "nginx not found on PATH"
fi

echo "=== 5. what Google is sent ==="
LOC="$(curl -s -o /dev/null -D - "https://$DOMAIN/auth/google" | grep -i '^location:')"
if [ -n "$LOC" ]; then
  RU="$(echo "$LOC" | grep -o 'redirect_uri=[^&]*' | cut -d= -f2- | sed 's|%3A|:|g; s|%2F|/|g')"
  echo "$LOC" | grep -o 'client_id=[^&]*' | sed 's/^/  /'
  echo "  redirect_uri=$RU"
  if [ "$RU" = "https://$DOMAIN/auth/google/callback" ]; then
    ok "redirect_uri matches $DOMAIN — it must also be listed on that client in the Google console"
  else
    bad "redirect_uri mismatch: fix GOOGLE_CALLBACK_URL in .env, then pm2 restart calby --update-env"
  fi
else
  bad "https://$DOMAIN/auth/google returned no redirect — is nginx proxying /auth?"
fi

echo "=== 6. https ==="
curl -sI "https://$DOMAIN" | head -1 | sed 's/^/  /'

echo ""
echo "Sign-in still failing with all of the above green? Open DevTools → Network"
echo "(Preserve log), sign in, and check the /auth/user response body plus whether"
echo "the /auth/google/callback response carries a Set-Cookie: connect.sid header."
