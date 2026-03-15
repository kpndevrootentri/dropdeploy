# Production Deployment Guide (VPS)

> Step-by-step guide to deploy DropDeploy on a fresh Ubuntu/Debian VPS.
> For infrastructure sizing, see [estimate.md](./estimate.md).

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Ubuntu/Debian VPS | 22.04 LTS recommended | See [estimate.md](./estimate.md) for sizing |
| Node.js | 22.x | Via NodeSource |
| Docker Engine | 26+ | Not Docker Desktop |
| PostgreSQL | 15+ | Can be managed or self-hosted |
| Redis | 7+ | Can be managed or self-hosted |
| Nginx | Latest stable | Reverse proxy + subdomain routing |
| Domain | Any | Wildcard DNS required: `*.yourdomain.com` |

---

## Step 1 — Initial Server Setup

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Create a non-root deploy user
sudo adduser deploy
sudo usermod -aG sudo deploy
sudo usermod -aG docker deploy   # added after Docker install below

# Switch to deploy user for the rest of this guide
su - deploy
```

---

## Step 2 — Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node -v   # v22.x.x
npm -v
```

---

## Step 3 — Install Docker Engine

```bash
# Install dependencies
sudo apt install -y ca-certificates curl gnupg

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repo
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin

# Add deploy user to docker group (no sudo needed for docker commands)
sudo usermod -aG docker deploy
newgrp docker

# Verify
docker --version
docker run --rm hello-world
```

---

## Step 4 — Install PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib

# Start and enable on boot
sudo systemctl enable --now postgresql

# Create database and user
sudo -u postgres psql <<'EOF'
CREATE USER dropdeploy WITH PASSWORD 'your_strong_password_here';
CREATE DATABASE dropdeploy OWNER dropdeploy;
GRANT ALL PRIVILEGES ON DATABASE dropdeploy TO dropdeploy;
EOF
```

Test the connection:
```bash
psql postgresql://dropdeploy:kpndevroot@localhost:5432/dropdeploy -c "\l"
```

---

## Step 5 — Install Redis

```bash
sudo apt install -y redis-server

# Bind to localhost only (security)
sudo sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis/redis.conf

# Enable and start
sudo systemctl enable --now redis-server

# Verify
redis-cli ping   # PONG
```

---

## Step 6 — Install Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

---

## Step 7 — DNS Configuration

In your domain registrar / DNS provider, add:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `<your-vps-ip>` |
| `A` | `*` | `<your-vps-ip>` |
| `CNAME` | `www` | `@` |

The wildcard `*` record is required for subdomain routing (`myapp.yourdomain.com`).

> Wait for DNS propagation (up to 24 hours) before setting up SSL.

---

## Step 8 — Clone and Configure the App

```bash
# Clone the repository
git clone https://github.com/your-username/dropDeploy.git /home/ubuntu/dropdeploy
cd /home/ubuntu/dropdeploy

# Install dependencies (production only)
npm ci --omit=dev

# Copy and edit the environment file
cp .env.example .env
nano .env
```

Fill in `.env`:

```env
# Database
DATABASE_URL="postgresql://dropdeploy:your_strong_password_here@localhost:5432/dropdeploy"

# Redis
REDIS_HOST="127.0.0.1"
REDIS_PORT="6379"

# Auth — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET="<64-char-hex-string>"
JWT_EXPIRES_IN="7d"

# Encryption — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENV_ENCRYPTION_KEY="<64-char-hex-string>"

# Docker
DOCKER_SOCKET="/var/run/docker.sock"

# Storage — use absolute paths in production
PROJECTS_DIR="/home/ubuntu/.dropdeploy/projects"
DOCKER_DATA_DIR="/home/ubuntu/.dropdeploy/docker"

# App URL — use your actual domain
NEXT_PUBLIC_APP_URL="https://app.yourdomain.com"

# Deployment — both must be set to the same domain
BASE_DOMAIN="yourdomain.com"
NEXT_PUBLIC_BASE_DOMAIN="yourdomain.com"
NGINX_CONFIG_PATH="/etc/nginx/sites-enabled"

# Worker tuning (optional — defaults shown)
BULLMQ_CONCURRENCY="5"          # max simultaneous builds (1–20)
BULLMQ_JOB_TIMEOUT_MS="900000"  # per-job timeout in ms (default: 15 min)

# Admin / contributor account (used by seed script)
# Set these to auto-provision the first CONTRIBUTOR account on startup
CONTRIBUTOR_EMAIL="admin@yourdomain.com"
CONTRIBUTOR_PASSWORD="<strong-password>"

# Security — comma-separated list of additional blocked packages (npm/pip)
# These are merged with the built-in blocklist at deploy time
# BLOCKED_PACKAGES="my-bad-pkg,another-evil-lib"

# Logging level: error | warn | info | http | verbose | debug | silly
LOG_LEVEL="info"
```

Create storage directories:

```bash
mkdir -p /home/ubuntu/.dropdeploy /projects
mkdir -p /home/ubuntu/.dropdeploy/docker
```

---

## Step 8b — Seed the Contributor (Admin) Account

The seed script creates the initial CONTRIBUTOR (admin) account. Run it once after the database is set up. If `CONTRIBUTOR_EMAIL` / `CONTRIBUTOR_PASSWORD` are set in `.env`, those values are used automatically; otherwise pass them inline:

```bash
cd /home/ubuntu/dropdeploy

# Using values from .env
npx tsx scripts/seed-contributor.ts

# Or pass inline
CONTRIBUTOR_EMAIL="admin@yourdomain.com" \
CONTRIBUTOR_PASSWORD="<strong-password>" \
npx tsx scripts/seed-contributor.ts
```

> The account is created with `mustResetPassword: true`, so the admin must set a new password on first login. If the account already exists, the script is a no-op.

---

## Step 9 — Database Setup

```bash
cd /home/ubuntu/dropdeploy

# Generate Prisma client
npm run db:generate

# Push schema to database (creates all tables)
npm run db:push
```

Verify tables were created:
```bash
psql postgresql://dropdeploy:your_strong_password_here@localhost:5432/dropdeploy \
  -c "\dt"
```

---

## Step 10 — Build the Next.js App

```bash
cd /home/ubuntu/dropdeploy
npm run build
```

> **Known issue:** Build may fail with Turbopack + ssh2/dockerode ESM incompatibility.
> If it does, the app still runs fine via `npm start` — this is a pre-existing dev toolchain issue, not a runtime problem.

---

## Step 11 — Configure Nginx

> **How subdomain routing works:** All traffic (dashboard + deployed projects) is forwarded
> to the Next.js app on port 3000. The in-app proxy (`proxy.ts`) detects the subdomain from
> the `Host` header and routes the request to the correct container internally — **no per-project
> nginx config files are needed or written**.

### 11a — Main app (dashboard)

Create `/etc/nginx/sites-available/dropdeploy-app`:

```nginx
server {
    listen 80;
    server_name app.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 11b — Wildcard subdomain proxy (deployed projects)

Create `/etc/nginx/sites-available/dropdeploy-projects`:

```nginx
# All deployed project subdomains (*.yourdomain.com) are forwarded to the
# Next.js app. The in-app proxy resolves the container port from the database
# on each request — no per-project config files or nginx reloads required.

server {
    listen 80;
    server_name *.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

> **Important:** The `Host $host` header must be passed through intact — the Next.js proxy
> reads it to extract the slug and route to the correct container.

### Enable sites and test

```bash
sudo ln -s /etc/nginx/sites-available/dropdeploy-app \
           /etc/nginx/sites-enabled/dropdeploy-app

# Remove default site if present
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t        # Test config
sudo nginx -s reload
```

---

## Step 12 — SSL with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx

# Issue cert for the main app domain + wildcard subdomains
# Wildcard requires DNS challenge (not HTTP challenge)
sudo certbot certonly \
  --manual \
  --preferred-challenges dns \
  -d "yourdomain.com" \
  -d "*.yourdomain.com"

# Follow the prompts — add the TXT record to your DNS, then press Enter.
# Cert files will be at /etc/letsencrypt/live/yourdomain.com/

# Auto-renewal
sudo systemctl enable --now certbot.timer
```

After cert is issued, update **both** Nginx server blocks to use SSL.

Replace `/etc/nginx/sites-available/dropdeploy-app`:

```nginx
server {
    listen 443 ssl;
    server_name app.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name app.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

Replace `/etc/nginx/sites-available/dropdeploy-projects`:

```nginx
server {
    listen 443 ssl;
    server_name *.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# HTTP → HTTPS redirect for all project subdomains
server {
    listen 80;
    server_name *.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

Then reload:
```bash
sudo nginx -t && sudo nginx -s reload
```

---

## Step 13 — Process Management with PM2

PM2 keeps both the Next.js app and BullMQ worker running, restarts on crash, and starts on reboot.

```bash
# Install PM2 globally
npm install -g pm2
```

Create `/home/ubuntu/dropdeploy/ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: 'dropdeploy-app',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/home/ubuntu/dropdeploy',
      instances: 1,
      exec_mode: 'fork',
      env_file: '/home/ubuntu/dropdeploy/.env',
      restart_delay: 3000,
      max_restarts: 10,
      log_file: '/home/ubuntu/logs/app.log',
      error_file: '/home/ubuntu/logs/app-error.log',
    },
    {
      name: 'dropdeploy-worker',
      script: 'node_modules/.bin/tsx',
      args: 'src/workers/deployment.worker.ts',
      cwd: '/home/ubuntu/dropdeploy',
      instances: 1,
      exec_mode: 'fork',
      env_file: '/home/ubuntu/dropdeploy/.env',
      restart_delay: 5000,
      max_restarts: 10,
      log_file: '/home/ubuntu/logs/worker.log',
      error_file: '/home/ubuntu/logs/worker-error.log',
    },
  ],
};
```

```bash
mkdir -p /home/ubuntu/logs

# Start both processes
pm2 start /home/ubuntu/dropdeploy/ecosystem.config.js

# Save process list for reboot persistence
pm2 save

# Generate and install startup script
pm2 startup
# Run the command it outputs (starts with sudo env PATH=...)

# Verify both are running
pm2 status
pm2 logs --lines 50
```

---

## Step 13b — Supported Project Types

DropDeploy auto-selects a Dockerfile template based on the `type` set on the project:

| Type | Base Image | Internal Port | Notes |
|------|-----------|--------------|-------|
| `STATIC` | `nginx:alpine` | 80 | Serves static files via Nginx |
| `NODEJS` | `node:22-alpine` | 3000 | `npm install --omit=dev` + `npm start` |
| `REACT` | `node:22-alpine` → `nginx:alpine` | 80 | Vite/CRA build + Nginx static serving |
| `NEXTJS` | `node:22-alpine` (multi-stage) | 3000 | Builder + runner; `NEXT_PUBLIC_*` vars injected as build args |
| `VUE` | `node:22-alpine` → `nginx:alpine` | 80 | Vite build + Nginx static serving |
| `SVELTE` | `node:22-alpine` → `nginx:alpine` | 80 | Vite/SvelteKit build + Nginx static serving |
| `DJANGO` | `python:3.13-slim` | 8000 | `pip install -r requirements.txt` + `manage.py runserver` |
| `FASTAPI` | `python:3.13-slim` | 8000 | `pip install -r requirements.txt` + `uvicorn main:app` |
| `FLASK` | `python:3.13-slim` | 5000 | `pip install -r requirements.txt` + `gunicorn app:app` |

No additional configuration is needed on the server — templates are built into the application.

---

## Step 13c — Package Security Scanning

Before each build, DropDeploy scans `package.json`, `requirements.txt`, and `pyproject.toml` against a built-in blocklist of known-malicious packages (typosquats, cryptominers, credential stealers, etc.). Any match aborts the deployment with a `FAILED` status.

**To add your own blocked packages**, set `BLOCKED_PACKAGES` in `.env`:

```env
BLOCKED_PACKAGES="internal-secret-pkg,legacy-bad-lib"
```

Entries are merged with the built-in list at deploy time. Normalize names with hyphens (PEP 503 rules apply for pip packages).

---

## Step 14 — Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'    # ports 80 and 443
sudo ufw enable
sudo ufw status

# Verify app ports are NOT exposed externally
# 3000 (Next.js), 5432 (Postgres), 6379 (Redis) should be blocked
```

---

## Step 15 — Verify the Deployment

```bash
# Check both processes are up
pm2 status

# Check app responds
curl -I https://app.yourdomain.com

# Check logs for errors
pm2 logs dropdeploy-app --lines 100
pm2 logs dropdeploy-worker --lines 100

# Check Docker daemon is accessible
docker ps

# Check database is reachable
psql postgresql://dropdeploy:your_strong_password_here@localhost:5432/dropdeploy \
  -c "SELECT COUNT(*) FROM users;"

# Check Redis
redis-cli ping
```

---

## Updating to a New Version

```bash
cd /home/ubuntu/dropdeploy

# Pull latest code
git pull origin main

# Install any new dependencies
npm ci --omit=dev

# Run any new migrations
npm run db:push

# Rebuild
npm run build

# Restart processes (zero-downtime reload for app)
pm2 reload dropdeploy-app
pm2 restart dropdeploy-worker

pm2 status
```

---

## Maintenance

### Docker cleanup (run weekly via cron)

```bash
# Add to crontab: crontab -e
0 3 * * 0 docker image prune -f >> /home/ubuntu/logs/docker-prune.log 2>&1
0 3 * * 0 docker container prune -f >> /home/ubuntu/logs/docker-prune.log 2>&1
```

### Database backup (run daily)

```bash
# Add to crontab
0 2 * * * pg_dump postgresql://dropdeploy:password@localhost:5432/dropdeploy \
  | gzip > /home/ubuntu/backups/dropdeploy-$(date +%Y%m%d).sql.gz

# Keep last 30 days
0 2 * * * find /home/ubuntu/backups -name "*.sql.gz" -mtime +30 -delete
```

```bash
mkdir -p /home/ubuntu/backups
```

### Log rotation

PM2 log rotation:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
```

---

## Troubleshooting

| Symptom | Check |
|---|---|
| App not loading | `pm2 logs dropdeploy-app` — check for port/env errors |
| Deployments stuck in BUILDING | Worker crashed — `pm2 restart dropdeploy-worker` |
| Docker build fails | `docker info` — verify daemon is running and accessible |
| Database connection refused | `sudo systemctl status postgresql` |
| Redis connection refused | `sudo systemctl status redis-server` |
| Subdomain not routing | Ensure `*.yourdomain.com` nginx block forwards to `127.0.0.1:3000` with `proxy_set_header Host $host`. Verify `BASE_DOMAIN` in `.env` matches your domain. Run `sudo nginx -t && sudo nginx -s reload`. |
| SSL cert expired | `sudo certbot renew --dry-run` to test; `sudo certbot renew` to renew |
| Out of disk space | Run `docker image prune -f && docker container prune -f` |
| Deployment fails with "blocked package" | A dependency matched the security blocklist — check deployment logs for the package name; remove it from `package.json` / `requirements.txt` or add a legitimate override with care |
| Admin dashboard not accessible | Verify the session JWT contains `role: CONTRIBUTOR`; re-run the seed script if needed |
| Too many concurrent builds overloading server | Lower `BULLMQ_CONCURRENCY` in `.env` and restart the worker |
| Build times out | Increase `BULLMQ_JOB_TIMEOUT_MS` (default 15 min); large images may need more |
| Log output missing / too verbose | Adjust `LOG_LEVEL` in `.env` (`info` recommended for production, `debug` for troubleshooting) |

---

## Process Overview

```
VPS
├── Nginx (80/443)
│   ├── app.yourdomain.com     → 127.0.0.1:3000  (dashboard)
│   └── *.yourdomain.com       → 127.0.0.1:3000  (all projects, same Next.js app)
│
├── PM2
│   ├── dropdeploy-app    (Next.js, port 3000)
│   │     proxy.ts reads Host header → rewrites to /api/proxy/{slug}
│   │     → looks up containerPort in DB → forwards to container
│   └── dropdeploy-worker (BullMQ worker)
│
├── PostgreSQL  (localhost:5432)
├── Redis       (localhost:6379)
└── Docker Engine (/var/run/docker.sock)
    ├── container: proj-a  → host port 8042  (never exposed via nginx directly)
    └── container: proj-b  → host port 8107  (never exposed via nginx directly)
```

---

## Related Docs

- [estimate.md](./estimate.md) — VPS sizing for 50–100 active projects
- [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) — end-to-end runtime behavior
- [TODO.md](./TODO.md) — planned improvements (dynamic Nginx routing, container health checks)
