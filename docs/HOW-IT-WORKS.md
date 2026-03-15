# How It Works

> End-to-end explanation of DropDeploy's runtime behavior.
> For code structure and conventions, see [ARCHITECTURE.md](./ARCHITECTURE.md).
> For deep-dive on subdomain routing, see [subdomain-routing.md](./subdomain-routing.md).

---

## 1. Overview

DropDeploy lets users deploy projects instantly by pasting a GitHub repository URL. The system clones the repo, scans dependencies, builds a Docker image, starts a container, and returns a live subdomain URL — with no per-project Nginx config required.

```mermaid
graph LR
    A[Paste GitHub URL] --> B[Queue Job]
    B --> C[Clone Repo]
    C --> D[Scan Packages]
    D --> E[Build Docker Image]
    E --> F[Start Container]
    F --> G[Live URL Ready]

    style A fill:#e0f2fe
    style G fill:#dcfce7
```

**Two processes run side by side:**

| Process | Command | Purpose |
|---------|---------|---------|
| **Next.js app** | `npm run dev` / `npm start` | UI + API routes + in-app reverse proxy |
| **BullMQ worker** | `npm run worker` | Background deployment jobs |

---

## 2. System Architecture

```mermaid
graph TB
    subgraph Client["Browser"]
        UI[React UI + shadcn/ui]
    end

    subgraph Server["Next.js Server (port 3001 dev / 3000 prod)"]
        API[API Routes]
        MW[Middleware — JWT]
        SVC[Services]
        PROXY[In-App Reverse Proxy]
    end

    subgraph Worker["Worker Process"]
        BW[BullMQ Worker]
    end

    subgraph External["Infrastructure"]
        PG[(PostgreSQL)]
        RD[(Redis)]
        DK[Docker Engine]
        NG[Nginx — forwards all traffic to Next.js]
    end

    UI -->|HTTP| API
    API --> MW
    API --> SVC
    SVC --> PG
    SVC -->|enqueue| RD
    RD -->|dequeue| BW
    BW --> SVC
    SVC --> DK
    UI -.->|"*.yourdomain.com"| NG
    NG -->|"all traffic → :3000"| PROXY
    PROXY -->|"DB lookup → containerPort"| DK
```

---

## 3. Database Models

```mermaid
erDiagram
    User ||--o{ Project : owns
    User ||--o{ AuditLog : generates
    Project ||--o{ Deployment : has
    Project ||--o{ EnvironmentVariable : has
    Project ||--o{ AuditLog : scoped_to

    User {
        string id PK "cuid"
        string email UK
        string passwordHash "bcrypt"
        enum role "USER | CONTRIBUTOR"
        bool mustResetPassword
        datetime createdAt
        datetime updatedAt
    }

    Project {
        string id PK "cuid"
        string name
        string slug UK "used as subdomain"
        string description "optional"
        enum source "GITHUB"
        string githubUrl "optional"
        enum type "STATIC | NODEJS | NEXTJS | DJANGO | REACT | FASTAPI | FLASK | VUE | SVELTE"
        string branch "default: main"
        string userId FK
        datetime createdAt
        datetime updatedAt
    }

    Deployment {
        string id PK "cuid"
        enum status "QUEUED | BUILDING | DEPLOYED | FAILED | CANCELLED"
        string buildStep "CLONING | SCANNING | BUILDING_IMAGE | STARTING"
        int containerPort "dynamic host port"
        string subdomain UK
        text buildLog "full build output"
        string commitHash "HEAD at deploy time"
        datetime startedAt
        datetime completedAt
        string projectId FK
        datetime createdAt
        datetime updatedAt
    }

    EnvironmentVariable {
        string id PK "cuid"
        string key
        text encryptedValue "AES-256-GCM"
        string iv "16-byte nonce"
        string authTag "GCM authentication tag"
        enum environment "ALL | DEVELOPMENT | STAGING | PRODUCTION"
        string projectId FK
        datetime createdAt
        datetime updatedAt
    }

    AuditLog {
        string id PK "cuid"
        string action "ENV_CREATED | ENV_UPDATED | ENV_DELETED | DEPLOY_TRIGGERED | PROJECT_SETTINGS_UPDATED | PROJECT_DELETED"
        string targetKey
        string userId FK
        string projectId FK
        datetime createdAt
    }
```

---

## 4. User Flows

### 4.1 Registration & Login

```mermaid
sequenceDiagram
    actor U as User
    participant P as /register page
    participant API as POST /api/auth/register
    participant AS as AuthService
    participant DB as PostgreSQL

    U->>P: Fill email + password
    P->>API: POST { email, password }
    API->>API: Zod validate (registerSchema)
    API->>AS: register(email, password)
    AS->>AS: bcrypt.hash(password, 10)
    AS->>DB: INSERT user (role: USER)
    AS->>AS: sign JWT (jose, HS256)
    AS-->>API: { accessToken }
    API->>API: setAuthCookie(httpOnly)
    API-->>P: 201 Created
    P->>P: redirect to /dashboard
```

Login follows the same flow but verifies the password instead of creating a user. Logout clears the `auth-token` cookie via `POST /api/auth/logout`.

### 4.2 Project Creation

1. User clicks **"New Project"** on the dashboard.
2. Fills in: project name, GitHub URL, framework type, and optionally a branch (defaults to `main`).
3. `POST /api/projects` validates input with Zod (`createProjectSchema`).
4. `ProjectService.create()` generates a unique slug and inserts a `Project` row.
5. Dashboard refreshes to show the new project tile.

### 4.3 Project Detail Page

The project detail page has **three tabs**:

| Tab | Contents |
|-----|----------|
| **Overview** | Deployment status, live URL, build log, deployment history (paginated) |
| **Settings** | Edit name, description, framework type, deploy branch, environment variables, or delete the project |
| **Advanced** | Container details, interactive terminal, Docker CLI commands reference |

---

## 5. Deployment Pipeline

This is the core of DropDeploy. When a user clicks **"Deploy"**, the following pipeline executes:

```mermaid
flowchart TB
    T["User clicks Deploy"] --> S1

    subgraph API["API Layer (synchronous)"]
        S1["Step 1: POST /api/projects/:id/deploy"]
        S1 --> S2["Step 2: Acquire Redis lock → create QUEUED record → enqueue job"]
    end

    S2 -->|async via Redis| S3

    subgraph WK["Worker Process (asynchronous)"]
        S3["Step 3: Worker picks up job"]
        S3 --> S4["Step 4: Clone or update repo (CLONING)"]
        S4 --> S4b["Step 4b: Scan packages for blocked deps (SCANNING)"]
        S4b --> S5["Step 5: Resolve & inject env vars"]
        S5 --> S6["Step 6: Build Docker image (BUILDING_IMAGE)"]
        S6 --> S7["Step 7: Run container (STARTING)"]
        S7 --> S8["Step 8: Finalize deployment record (DEPLOYED)"]
    end

    S8 --> S9["Step 9: In-app proxy routes traffic by DB lookup"]
    S9 --> LIVE["Live at slug.yourdomain.com"]

    style T fill:#e0f2fe
    style LIVE fill:#dcfce7
```

### Step 1: Trigger deploy

**File:** `src/app/api/projects/[id]/deploy/route.ts`

- Extracts user session from JWT cookie via `getSession(req)`.
- Calls `deploymentService.createDeployment(projectId, userId)`.

### Step 2: Create record & enqueue

**File:** `src/services/deployment/deployment.service.ts` — `createDeployment()`

1. Acquires a **Redis advisory lock** (5s TTL) to prevent double-click races.
2. Cancels any existing `QUEUED` deployment for the same project (supersede pattern).
3. Checks if a build is currently `BUILDING` for this project — if so, the new record is held in the DB and **not** enqueued yet (smart queue).
4. Inserts a `Deployment` row with `status: QUEUED`.
5. If no build is running, pushes a job onto the BullMQ `deployments` queue:
   ```json
   { "deploymentId": "clxyz...", "projectId": "clxyz..." }
   ```

### Step 3: Worker picks up the job

**File:** `src/workers/deployment.worker.ts`

- Runs as a **separate process** via `npm run worker`.
- BullMQ `Worker` listens on the `deployments` queue.
- **Concurrency:** configurable via `BULLMQ_CONCURRENCY` (default: 5).
- **Timeout:** configurable via `BULLMQ_JOB_TIMEOUT_MS` (default: 15 minutes).
- On startup, calls `recoverStuckDeployments()` — marks any `BUILDING` deployments as `FAILED` and re-enqueues orphaned `QUEUED` ones from a previous crash.
- Writes a **heartbeat** to Redis (`worker:health`, 90s TTL) for health monitoring.
- Calls `deploymentService.buildAndDeploy(deploymentId)`.

### Step 4: Clone or update repo

**File:** `src/services/git/git.service.ts` — `ensureRepo()`

```mermaid
flowchart TD
    A{Repo exists locally?}
    A -->|No| B[git clone -b branch --single-branch]
    A -->|Yes| C[git fetch origin]
    C --> D[Update refspec for full branch discovery]
    D --> E{Shallow clone?}
    E -->|Yes| F[git fetch --unshallow]
    E -->|No| G[git checkout branch]
    F --> G
    G --> H[git reset --hard origin/branch]
    B --> I[Repo ready + HEAD commit hash]
    H --> I
```

- **First deploy:** Clones into `PROJECTS_DIR/<slug>/` (default: `~/.dropdeploy/projects/`).
- **Subsequent deploys:** Fetches latest, switches branch if needed, hard-resets to `origin/<branch>`.
- Returns the current HEAD commit hash, stored in `deployment.commitHash`.

### Step 4b: Package security scan

**File:** `src/services/deployment/package-scanner.ts`

- Scans `package.json`, `requirements.txt`, and `pyproject.toml` against a built-in blocklist of known-malicious packages (typosquats, cryptominers, credential stealers).
- Additional packages can be blocked via the `BLOCKED_PACKAGES` env var.
- If any match is found, the deployment is marked `FAILED` immediately.

### Step 5: Select Dockerfile template

**File:** `src/services/docker/dockerfile.templates.ts`

Updates `buildStep` to `BUILDING_IMAGE`. Based on `project.type`, one of nine templates is used:

| Type | Base Image | Internal Port | Strategy |
|------|-----------|--------------|----------|
| `STATIC` | `nginx:alpine` | 80 | Copy files into Nginx html directory |
| `NODEJS` | `node:22-alpine` | 3000 | `npm install --omit=dev` + `npm start` |
| `NEXTJS` | `node:22-alpine` (multi-stage) | 3000 | Builder + runner; `NEXT_PUBLIC_*` injected as build args |
| `REACT` | `node:22-alpine` → `nginx:alpine` | 80 | Vite/CRA build, serve via Nginx |
| `VUE` | `node:22-alpine` → `nginx:alpine` | 80 | Vite build, serve via Nginx |
| `SVELTE` | `node:22-alpine` → `nginx:alpine` | 80 | Vite/SvelteKit build, serve via Nginx |
| `DJANGO` | `python:3.13-slim` | 8000 | `pip install -r requirements.txt` + `manage.py runserver` |
| `FASTAPI` | `python:3.13-slim` | 8000 | `pip install -r requirements.txt` + `uvicorn main:app` |
| `FLASK` | `python:3.13-slim` | 5000 | `pip install -r requirements.txt` + `gunicorn app:app` |

> **Custom Dockerfile:** If the repo contains a `Dockerfile` in its root, it is detected and used instead of the template (BuildKit syntax directives are stripped for compatibility).

> **Next.js:** `nextjs-config-patcher.ts` adjusts the Next.js config for standalone output when needed. Environment variables prefixed with `NEXT_PUBLIC_` are extracted and passed as Docker build args so they are available at build time.

### Step 6: Build Docker image

**File:** `src/services/docker/docker.service.ts` — `buildImage()`

1. Writes `.dockerignore` to the repo directory to prevent `.env` files from leaking into the image.
2. Builds via `dockerode` with tag `dropdeploy/<slug>:latest`.
3. Streams build output line by line; secret values are scrubbed from the log.
4. Each log line is published to Redis channel `build:{deploymentId}` for SSE streaming to the browser.
5. Logs are flushed to the DB every 30 lines.

### Step 7: Run container

**File:** `src/services/docker/docker.service.ts` — `runContainer()`

Updates `buildStep` to `STARTING`.

1. Queries active ports from `DEPLOYED` deployments to avoid conflicts.
2. Probes random ports (TCP server test) within range **8000–9999** until a free one is found.
3. Creates and starts the container with per-type resource limits:

| Type | Memory | CPU Shares |
|------|--------|------------|
| STATIC | 128 MB | 256 |
| REACT | 128 MB | 256 |
| VUE | 128 MB | 256 |
| SVELTE | 128 MB | 256 |
| FLASK | 256 MB | 512 |
| NODEJS | 512 MB | 1024 |
| DJANGO | 512 MB | 512 |
| FASTAPI | 512 MB | 512 |
| NEXTJS | 1024 MB | 1024 |

4. Passes runtime env vars (all non-`NEXT_PUBLIC_*` variables) to the container.

### Step 8: Finalize deployment

Back in `buildAndDeploy()`:

1. Clears stale subdomains: `clearSubdomainForOtherDeployments()` sets the old deployment's subdomain to `null` (avoids unique constraint violation).
2. Clears stale ports: `clearPortForOtherDeployments()` releases the old container's port record.
3. Updates the deployment record:
   - `status: DEPLOYED`
   - `containerPort: <assigned port>`
   - `subdomain: <project-slug>`
   - `completedAt: <timestamp>`
   - `commitHash: <HEAD SHA>`
   - `buildStep: null` (cleared)
4. Publishes `__DONE__` to the Redis SSE channel.
5. Calls `enqueueNextForProject()` — if another `QUEUED` deployment was held back, it is now enqueued.

### Step 9: Traffic routing

Routing is **fully dynamic and database-driven** — no Nginx config files are written per project:

```mermaid
graph LR
    U["Browser"] -->|"my-blog.yourdomain.com/about"| NG["Nginx (wildcard *.yourdomain.com)"]
    NG -->|"forward to :3000 with Host header"| MW["Next.js Middleware (proxy.ts)"]
    MW -->|"rewrite → /api/proxy/my-blog/about"| PX["/api/proxy/[slug]/[[...path]]"]
    PX -->|"SELECT containerPort WHERE subdomain='my-blog'"| DB[(PostgreSQL)]
    PX -->|"http://127.0.0.1:{port}/about"| C["Docker Container"]

    style U fill:#e0f2fe
    style C fill:#dcfce7
```

For full details on how the proxy works, see [subdomain-routing.md](./subdomain-routing.md).

---

## 6. Build Progress Tracking

Deployments track granular progress via the `buildStep` field:

```mermaid
stateDiagram-v2
    [*] --> QUEUED
    QUEUED --> CLONING: Worker picks up job
    CLONING --> SCANNING: Repo ready
    SCANNING --> BUILDING_IMAGE: Packages scanned
    BUILDING_IMAGE --> STARTING: Image built
    STARTING --> DEPLOYED: Container running
    CLONING --> FAILED: Clone error
    SCANNING --> FAILED: Blocked package found
    BUILDING_IMAGE --> FAILED: Build error
    STARTING --> FAILED: Container error
    QUEUED --> CANCELLED: User cancels
    FAILED --> QUEUED: User retries
    DEPLOYED --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
```

**Frontend indicators:**
- Completed steps: checkmark
- Active step: spinner
- Pending steps: empty circle

**Duration tracking:**
- `startedAt` set when the worker begins processing
- `completedAt` set on success or failure
- UI shows elapsed time during builds, total duration after completion

**Build log streaming:**
- Each log line is published to Redis channel `build:{deploymentId}`
- `GET /api/projects/:id/deployments/:deploymentId/logs/stream` exposes an SSE endpoint
- Full build log is stored in `deployment.buildLog` upon completion

---

## 7. Interactive Terminal

After deployment, users can execute commands inside the container from the **Advanced** tab.

```mermaid
sequenceDiagram
    actor U as User
    participant T as Terminal UI
    participant API as POST /terminal
    participant DTS as DockerTerminalService
    participant D as Docker Engine

    U->>T: Type command
    T->>API: { command: "ls -la" }
    API->>DTS: executeCommand(projectId, "ls -la")
    DTS->>DTS: Validate against allowlist
    DTS->>D: docker exec (create + start)
    D-->>DTS: Multiplexed stream
    DTS->>DTS: Demux stdout/stderr
    DTS-->>API: { stdout, stderr, exitCode }
    API-->>T: Display output
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/show-logs` | Last 500 lines of container logs |
| `/tail-logs` | Last 100 lines of container logs |
| `/env` | Environment variables |
| `/files` | List working directory contents |
| `/help` | Command reference |

### Safety

- Commands validated against an **allowlist** (ls, cat, pwd, echo, env, npm, node, python, curl, etc.).
- **30-second timeout** per command.
- Docker's multiplexed stdout/stderr stream is properly demuxed.

### Terminal UI Features

- Robbyrussell-style prompt (green/red arrow based on last exit code)
- Command history navigation (arrow keys)
- Slash command autocomplete dropdown
- Resizable terminal height (150–700px drag handle)
- Copy-to-clipboard for commands

---

## 8. Environment Variables

Environment variables are stored **encrypted** in the database per project, then injected into containers at deploy time.

**Encryption:** AES-256-GCM (key from `ENV_ENCRYPTION_KEY`). Each value stores `encryptedValue`, `iv`, and `authTag` for integrity verification.

**Per-environment overrides:**
- `ALL` — applied in every deployment
- `DEVELOPMENT` / `STAGING` / `PRODUCTION` — override `ALL` for that specific environment

**Injection at build time:**
- Variables prefixed `NEXT_PUBLIC_*` are extracted as Docker build args (needed for Next.js SSG/SSR).
- All other variables are passed as container runtime env.

**API:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects/:id/env-vars` | List env vars (values masked) |
| `POST` | `/api/projects/:id/env-vars` | Create env var (encrypted) |
| `PATCH` | `/api/projects/:id/env-vars/:varId` | Update env var value |
| `DELETE` | `/api/projects/:id/env-vars/:varId` | Delete env var |

---

## 9. Error Handling & Retries

### Deployment Failures

If any pipeline step fails (clone, scan, build, or run):

1. Status set to `FAILED`, `completedAt` recorded.
2. Full error output stored in `deployment.buildLog`.
3. `__DONE__` published to the Redis SSE channel so the browser stops polling.
4. User can **retry** the deployment: `POST /api/projects/:id/deployments/:deploymentId/retry` resets status to `QUEUED` and re-enqueues.

### Deployment Cancellation

`POST /api/projects/:id/deployments/:deploymentId/cancel` — only works on `QUEUED` deployments before the worker picks them up. Sets status to `CANCELLED`.

### Worker Crash Recovery

On worker startup, `recoverStuckDeployments()`:
1. Marks all `BUILDING` deployments as `FAILED` (incomplete from previous crash).
2. Re-enqueues all orphaned `QUEUED` deployments that were held back.

### Redis Unavailability

- Deployment record is still written to PostgreSQL (`status: QUEUED`).
- Job is **not** enqueued — a warning is logged.
- After Redis recovers, the worker's startup recovery will re-enqueue the held deployments.

---

## 10. Authentication & Authorization

### Authentication Flow

```mermaid
flowchart LR
    subgraph Registration
        R1[Email + Password] --> R2[Zod Validate]
        R2 --> R3[bcrypt Hash — 10 rounds]
        R3 --> R4[Store in DB]
        R4 --> R5[Sign JWT — HS256]
        R5 --> R6[Set httpOnly Cookie]
    end

    subgraph "Every Request"
        E1[Cookie sent] --> E2[Middleware extracts JWT]
        E2 --> E3[jose.verify]
        E3 -->|Valid| E4["getSession() → { userId, email, role, mustResetPassword }"]
        E3 -->|Invalid| E5[Redirect to /login]
    end
```

- **JWT-based** using `jose` (HS256 algorithm).
- Token stored in `auth-token` httpOnly, secure cookie.
- **Middleware** (`src/middleware.ts`) protects `/dashboard/*` routes.
- `mustResetPassword` flag forces password change on first login (used for seeded accounts).
- Session endpoint: `GET /api/auth/session`.
- Logout: `POST /api/auth/logout` clears the cookie.

### Authorization

- Every API route calls `getSession(req)` to extract `{ userId, role }`.
- Services verify **ownership**: `resource.userId === session.userId`.
- Unauthorized access returns **404** (not 403) to avoid leaking resource existence.
- Admin routes call `requireContributor(session)` which throws `ForbiddenError` if role ≠ `CONTRIBUTOR`.

---

## 11. API Reference

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/logout` | Logout (clear cookie) |
| `GET` | `/api/auth/session` | Validate current session |
| `POST` | `/api/auth/reset-password` | Change password (requires session) |

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects` | List user's projects |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/projects/:id` | Get project details |
| `PATCH` | `/api/projects/:id` | Update project |
| `DELETE` | `/api/projects/:id` | Delete project |

### Deployments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects/:id/deploy` | Trigger deployment |
| `GET` | `/api/projects/:id/deployments` | List deployments (paginated) |
| `GET` | `/api/projects/:id/deployments/:dId/logs` | Get full build log |
| `GET` | `/api/projects/:id/deployments/:dId/logs/stream` | SSE stream of build logs |
| `POST` | `/api/projects/:id/deployments/:dId/cancel` | Cancel QUEUED deployment |
| `POST` | `/api/projects/:id/deployments/:dId/retry` | Retry FAILED deployment |

### Environment Variables

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects/:id/env-vars` | List env vars (values masked) |
| `POST` | `/api/projects/:id/env-vars` | Create env var |
| `PATCH` | `/api/projects/:id/env-vars/:varId` | Update env var value |
| `DELETE` | `/api/projects/:id/env-vars/:varId` | Delete env var |

### Terminal & Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects/:id/terminal` | Execute container command |
| `GET` | `/api/projects/:id/analytics` | Project analytics |

### Admin (CONTRIBUTOR only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/users` | List all users |
| `POST` | `/api/admin/users` | Create user |
| `PATCH` | `/api/admin/users/:userId/role` | Change user role |
| `DELETE` | `/api/admin/users/:userId` | Delete user |
| `GET` | `/api/admin/projects` | List all projects |
| `PATCH` | `/api/admin/projects/:projectId/transfer` | Transfer project ownership |
| `POST` | `/api/admin/projects/:projectId/deploy` | Force deployment |
| `POST` | `/api/admin/projects/:projectId/stop` | Stop container |
| `POST` | `/api/admin/projects/:projectId/restart` | Restart container |

### Utility

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check (DB connectivity) |
| `GET` | `/api/health/worker` | Worker health check (Redis heartbeat) |
| `*` | `/api/proxy/:slug/[[...path]]` | In-app reverse proxy (all HTTP methods) |

---

## 12. Running Locally

### Prerequisites

- Node.js 22+
- PostgreSQL
- Redis
- Docker daemon running

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env — required: DATABASE_URL, JWT_SECRET, ENV_ENCRYPTION_KEY, BASE_DOMAIN, NEXT_PUBLIC_BASE_DOMAIN

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Set up the database
npm run db:generate    # Generate Prisma client
npm run db:push        # Apply schema

# (Optional) Seed admin account
CONTRIBUTOR_EMAIL=admin@example.com \
CONTRIBUTOR_PASSWORD=strongpassword \
npx tsx scripts/seed-contributor.ts

# Start the app (two terminals)
npm run dev            # Terminal 1: Next.js dev server (http://localhost:3001)
npm run worker         # Terminal 2: BullMQ deployment worker
```

### Environment Variables

| Variable | Example | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/dropdeploy` | PostgreSQL connection |
| `JWT_SECRET` | 32+ character string | JWT signing key |
| `ENV_ENCRYPTION_KEY` | 64-char hex string | AES-256-GCM encryption for env vars |
| `BASE_DOMAIN` | `yourdomain.com` | Subdomain base for deployed apps |
| `NEXT_PUBLIC_BASE_DOMAIN` | `yourdomain.com` | Same, exposed to client |
| `REDIS_HOST` | `localhost` | Redis host for BullMQ |
| `REDIS_PORT` | `6379` | Redis port |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker daemon socket |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3001` | Frontend URL |
| `PROJECTS_DIR` | `~/.dropdeploy/projects` | Cloned repo storage (default) |
| `DOCKER_DATA_DIR` | `~/.dropdeploy/docker` | Docker data storage (default) |
| `BULLMQ_CONCURRENCY` | `5` | Max simultaneous builds (1–20) |
| `BULLMQ_JOB_TIMEOUT_MS` | `900000` | Per-job timeout in ms (default: 15 min) |
| `LOG_LEVEL` | `info` | Winston log level |

---

## 13. Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16 (App Router), React, Tailwind CSS, shadcn/ui |
| Backend | Next.js API Routes, Prisma ORM |
| Auth | bcryptjs, jose (JWT HS256) |
| Queue | BullMQ + Redis |
| Containers | dockerode |
| Routing | In-app reverse proxy (Next.js Route Handler) |
| Database | PostgreSQL |
| Git | simple-git |
| Validation | Zod, TypeScript strict mode |
| Encryption | Node.js crypto (AES-256-GCM) |
| Logging | Winston |
| Testing | Jest + ts-jest |
