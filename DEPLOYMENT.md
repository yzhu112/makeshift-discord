# Deployment Guide — Makeshift Discord

Everything on a single Vultr Tokyo VPS. Caddy serves the static frontend, proxies `/api/*` to Express, and proxies `/livekit/*` to LiveKit. TLS is automatic via Let's Encrypt.

## Stack

```
Vultr Tokyo $5/mo (1 vCPU / 1 GB RAM, Ubuntu 24.04)
├── Caddy        — TLS, static frontend, reverse proxy
├── Express      — port 3000 (internal only)
├── LiveKit      — Docker, host network
└── SQLite       — /opt/makeshift-discord/data/
```

---

## 1. Provision the VPS

- Create a **Ubuntu 24.04** instance in the **Tokyo** region ($5/mo plan).
- Add your SSH public key during setup.
- Note the public IP.

---

## 2. Domain

Buy `yuhong-zhu.xyz` at Porkbun (~$1 first year, disable auto-renew at checkout).

Create one DNS A record:
```
@   A   <Vultr IP>
```

---

## 3. Install Dependencies

SSH into the VPS, then:

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm
npm install -g pnpm

# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Docker (for LiveKit)
curl -fsSL https://get.docker.com | sh
```

---

## 4. Clone and Build

```bash
git clone <your-repo> /opt/makeshift-discord
cd /opt/makeshift-discord

# Build frontend
cd frontend
pnpm install
VITE_API_BASE_URL=/api pnpm build
# Output lands in frontend/dist/

# Install backend
cd ../backend
pnpm install --prod
```

---

## 5. Backend — Environment and Systemd

Create `/opt/makeshift-discord/backend/.env`:
```
NODE_ENV=production
PORT=3000
SESSION_SECRET=<random 64-char hex string>
LIVEKIT_API_KEY=prodkey
LIVEKIT_API_SECRET=prodsecret
LIVEKIT_URL=wss://yuhong-zhu.xyz/livekit
```

> Generate a session secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Create `/etc/systemd/system/makeshift-discord.service`:
```ini
[Unit]
Description=Makeshift Discord backend
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/makeshift-discord/backend
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
EnvironmentFile=/opt/makeshift-discord/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now makeshift-discord
```

---

## 6. LiveKit

Create `/opt/makeshift-discord/infra/livekit.prod.yaml`:
```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true   # required — tells LiveKit to advertise the public IP in ICE candidates
turn:
  enabled: true
  tls_port: 5349          # TURN-over-TLS fallback for China (looks like HTTPS, bypasses GFW UDP drops)
keys:
  prodkey: prodsecret
```

Start LiveKit:
```bash
docker run -d --restart=always \
  --network host \
  -v /opt/makeshift-discord/infra/livekit.prod.yaml:/etc/livekit.yaml \
  livekit/livekit-server --config /etc/livekit.yaml
```

> `--network host` is required. Without it, LiveKit sees the container's internal IP and ICE negotiation fails for all remote users.

---

## 7. Caddy

Replace `/etc/caddy/Caddyfile` with:
```
yuhong-zhu.xyz {
    # Frontend static files
    root * /opt/makeshift-discord/frontend/dist
    try_files {path} /index.html
    file_server

    # Backend API
    handle /api/* {
        reverse_proxy localhost:3000
    }

    # LiveKit WebSocket (signaling)
    handle /livekit/* {
        uri strip_prefix /livekit
        reverse_proxy localhost:7880
    }
}
```

```bash
sudo systemctl reload caddy
```

Caddy will automatically obtain a TLS certificate from Let's Encrypt on first request. Port 80 must be open for the HTTP challenge.

---

## 8. Vultr Firewall

In the Vultr dashboard, open these ports:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80 | TCP | Caddy (Let's Encrypt HTTP challenge) |
| 443 | TCP | Caddy HTTPS |
| 7881 | TCP | LiveKit TCP media fallback |
| 5349 | TCP + UDP | LiveKit TURN/TLS |
| 50000–60000 | UDP | LiveKit WebRTC media |

---

## 9. Smoke Test

```bash
# Backend health
curl https://yuhong-zhu.xyz/api/health

# Frontend
curl -I https://yuhong-zhu.xyz
```

**China path test:** have your Chinese friend run `curl https://yuhong-zhu.xyz` before the first session. If the TLS handshake completes, the path works. TURN-over-TLS on port 5349 handles the UDP fallback if needed.

---

## Deploying Updates

```bash
cd /opt/makeshift-discord
git pull

# If frontend changed
cd frontend && pnpm build

# Restart backend if backend changed
sudo systemctl restart makeshift-discord
```

No Caddy restart needed for frontend changes — it reads from `dist/` on every request.
