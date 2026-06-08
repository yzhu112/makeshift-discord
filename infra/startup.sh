#!/bin/bash
set -e

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# pnpm
npm install -g pnpm

# Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Docker
curl -fsSL https://get.docker.com | sh

# Clone repo
git clone https://github.com/yzhu112/makeshift-discord.git /opt/makeshift-discord

# Install all deps (pnpm workspace installs both frontend + backend in one shot)
cd /opt/makeshift-discord
pnpm install --prod

# Build frontend
cd frontend
VITE_API_BASE_URL=/api pnpm build

# Caddy config
cat > /etc/caddy/Caddyfile <<'EOF'
yuhong-zhu.xyz {
    root * /opt/makeshift-discord/frontend/dist
    try_files {path} /index.html
    file_server

    handle /api/* {
        reverse_proxy localhost:3000
    }

    handle /livekit/* {
        uri strip_prefix /livekit
        reverse_proxy localhost:7880
    }
}
EOF
systemctl reload caddy
