#!/bin/bash
# Reads ./secrets.env, writes backend/.env + infra/livekit.prod.yaml,
# then pulls images and starts the stack. Idempotent — safe to re-run.
set -euo pipefail

cd "$(dirname "$0")"

SECRETS_FILE="${SECRETS_FILE:-./secrets.env}"
if [ ! -f "$SECRETS_FILE" ]; then
  echo "secrets file not found: $SECRETS_FILE" >&2
  echo "scp it from your laptop, then re-run." >&2
  exit 1
fi

set -a
. "$SECRETS_FILE"
set +a

# ============================================================
# Backend .env
# ============================================================
cat > backend/.env <<EOF
NODE_ENV=production
PORT=3000
SESSION_SECRET=$SESSION_SECRET
INVITE_CODES=$INVITE_CODES
LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
LIVEKIT_URL=$LIVEKIT_URL
EOF
chmod 600 backend/.env

# ============================================================
# LiveKit prod yaml — regenerate from scratch each run
# ============================================================
cat > infra/livekit.prod.yaml <<EOF
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
#  turn:
#  enabled: true
#  tls_port: 5349
keys:
  $LIVEKIT_API_KEY: $LIVEKIT_API_SECRET
EOF

# ============================================================
# Pull + (re)start
# ============================================================
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

echo "Seeding database..."
docker compose -f docker-compose.prod.yml exec backend node seed/seed.js

echo ""
echo "Stack is up."
echo "  Status: docker compose -f docker-compose.prod.yml ps"
echo "  Logs:   docker compose -f docker-compose.prod.yml logs -f"
