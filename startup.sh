#!/bin/bash
# Vultr first-boot script. Safe to commit. Sets up infra only.
# After this finishes, scp your secrets.env to the VPS and run inject-secrets.sh.
set -euo pipefail

REPO_URL="https://github.com/yzhu112/makeshift-discord.git"
INSTALL_DIR="/opt/makeshift-discord"

# ============================================================
# Docker
# ============================================================
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# ============================================================
# Firewall
# ============================================================
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 7881/tcp
ufw allow 5349/tcp
ufw allow 5349/udp
ufw allow 50000:60000/udp
ufw --force enable

# ============================================================
# Clone (or refresh) repo
# ============================================================
if [ ! -d "$INSTALL_DIR/.git" ]; then
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" pull --ff-only
fi

# ============================================================
# SQLite data dir
# ============================================================
mkdir -p "$INSTALL_DIR/data"

echo ""
echo "Infra ready. Next steps from your laptop:"
echo "  scp secrets.env root@<vps-ip>:$INSTALL_DIR/"
echo "  ssh root@<vps-ip> '$INSTALL_DIR/inject-secrets.sh'"
