# Architecture & Folder Structure

> Scalable 4-layer architecture aligned with the [PRD](./PRD.md).
> For end-to-end runtime behavior, see [HOW-IT-WORKS.md](./HOW-IT-WORKS.md).

---

## 1. High-Level Architecture

```mermaid
graph TB
    subgraph Presentation["Presentation Layer"]
        AR[Next.js App Router]
        RC[React Components]
        H[Custom Hooks]
    end

    subgraph Application["Application Layer"]
        API[API Routes]
        MW[Middleware — JWT Auth]
        SVC[Services — Auth / Project / Deployment / Docker / Git / EnvVar / Encryption / Nginx / Admin]
    end

    subgraph Domain["Domain Layer"]
        T[TypeScript Types & DTOs]
        V[Zod Validators]
        E[AppError Hierarchy]
    end

    subgraph Infrastructure["Infrastructure Layer"]
        REPO[Repositories — Prisma]
        Q[Queue — BullMQ + Redis]
        D[Docker — dockerode]
        G[Git — simple-git]
        N[Nginx — Reverse Proxy]
        ENC[AES-256-GCM Encryption]
    end

    Presentation --> Application
    Application --> Domain
    Application --> Infrastructure
    Domain -.->|shared types| Presentation
    Domain -.->|shared types| Infrastructure
```

| Layer | Responsibility | Key Rule |
|-------|---------------|----------|
| **Presentation** | Pages, components, hooks | No business logic — only renders data and dispatches actions |
| **Application** | API handlers + services | Orchestrates domain logic; validates input via Zod |
| **Domain** | Types, DTOs, validators, errors | Pure definitions — no I/O, no side effects |
| **Infrastructure** | DB, queue, Docker, Git, encryption | All external I/O lives here; accessed only through interfaces |

---

## 2. Component Interaction

```mermaid
graph LR
    Browser -->|HTTP| API[API Routes]
    API -->|getSession| Auth[Auth Service]
    API -->|CRUD| PS[Project Service]
    API -->|deploy| DS[Deployment Service]
    API -->|exec| DTS[Docker Terminal Service]
    API -->|env vars| EVS[EnvVar Service]
    API -->|admin ops| AS[Admin Service]

    DS -->|enqueue| Q[BullMQ Queue]
    Q -->|process| W[Worker]
    W -->|orchestrate| DS

    DS -->|clone/pull| GS[Git Service]
    DS -->|build/run| DocS[Docker Service]
    EVS -->|encrypt/decrypt| ES[Encryption Service]

    PS --> PR[Project Repo]
    DS --> DR[Deployment Repo]
    Auth --> UR[User Repo]
    EVS --> EVR[EnvVar Repo]
    AS --> ALR[AuditLog Repo]

    PR --> DB[(PostgreSQL)]
    DR --> DB
    UR --> DB
    EVR --> DB
    ALR --> DB
    Q --> Redis[(Redis)]
```

---

## 3. Folder Structure

```
dropDeploy/
├── src/
│   ├── app/                           # Next.js App Router
│   │   ├── (auth)/                    # Auth route group
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── layout.tsx
│   │   ├── (dashboard)/               # Protected routes
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── dashboard/admin/       # Admin panel (CONTRIBUTOR only)
│   │   │   ├── projects/[id]/page.tsx # Project detail (tabs: overview, settings, advanced)
│   │   │   └── layout.tsx
│   │   ├── api/
│   │   │   ├── auth/                  # login, logout, register, session, reset-password
│   │   │   ├── projects/
│   │   │   │   ├── route.ts           # GET (list) / POST (create)
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts       # GET / PATCH / DELETE
│   │   │   │       ├── deploy/route.ts
│   │   │   │       ├── terminal/route.ts
│   │   │   │       ├── env-vars/      # GET / POST / PATCH / DELETE
│   │   │   │       ├── deployments/   # list + logs + stream + cancel + retry
│   │   │   │       └── analytics/route.ts
│   │   │   ├── admin/                 # users + projects (CONTRIBUTOR only)
│   │   │   ├── proxy/[slug]/[[...path]]/route.ts  # In-app reverse proxy
│   │   │   └── health/                # health + health/worker
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx                   # Landing page
│   │
│   ├── components/
│   │   ├── ui/                        # Reusable primitives (Button, Card, ...)
│   │   ├── features/                  # Feature components
│   │   │   ├── auth-header.tsx
│   │   │   ├── create-project-form.tsx
│   │   │   ├── dashboard-nav.tsx
│   │   │   ├── project-list.tsx       # Auto-polling project grid
│   │   │   ├── project-tile.tsx       # Status badge + deploy button
│   │   │   └── terminal.tsx           # Interactive container terminal
│   │   ├── theme-provider.tsx
│   │   └── theme-toggle.tsx
│   │
│   ├── hooks/
│   │   ├── use-fetch-mutation.ts      # Generic API mutation hook
│   │   ├── use-terminal.ts            # Terminal state + command execution
│   │   └── index.ts
│   │
│   ├── lib/                           # Shared utilities & infra clients
│   │   ├── api-error.ts               # Centralized error → HTTP response
│   │   ├── auth-cookie.ts             # httpOnly cookie management
│   │   ├── blocked-packages.ts        # Built-in malicious package blocklist
│   │   ├── config.ts                  # Zod-validated env (getConfig())
│   │   ├── errors.ts                  # AppError hierarchy
│   │   ├── get-session.ts             # JWT → { userId, role, ... } extraction
│   │   ├── logger.ts                  # Winston logger (LOG_LEVEL configurable)
│   │   ├── prisma.ts                  # Singleton Prisma client
│   │   ├── queue.ts                   # IDeploymentQueue interface + BullMQ impl
│   │   ├── rate-limit.ts              # Per-route rate limiting via Redis
│   │   ├── redis.ts                   # ioredis connection factory
│   │   ├── require-contributor.ts     # CONTRIBUTOR role guard middleware
│   │   └── utils.ts                   # cn(), slugify(), sleep()
│   │
│   ├── repositories/                  # Data access layer
│   │   ├── user.repository.ts         # IUserRepository + implementation
│   │   ├── project.repository.ts      # IProjectRepository + slug uniqueness
│   │   ├── deployment.repository.ts   # IDeploymentRepository + subdomain/port transfer
│   │   ├── env-var.repository.ts      # IEnvironmentVariableRepository
│   │   ├── audit-log.repository.ts    # IAuditLogRepository (immutable audit trail)
│   │   └── index.ts
│   │
│   ├── services/                      # Business logic
│   │   ├── auth/                      # Register, login, JWT signing/verify
│   │   ├── project/                   # CRUD with ownership checks
│   │   ├── deployment/
│   │   │   ├── deployment.service.ts  # Orchestrates the full build pipeline
│   │   │   ├── package-scanner.ts     # npm/pip package security scanning
│   │   │   └── index.ts
│   │   ├── docker/
│   │   │   ├── docker.service.ts      # Build image + run container
│   │   │   ├── docker-terminal.service.ts  # Exec commands in containers
│   │   │   ├── dockerfile.templates.ts     # Per-type Dockerfile strings (9 types)
│   │   │   ├── nextjs-config-patcher.ts    # ESM/CJS config patching for Next.js
│   │   │   └── index.ts
│   │   ├── git/
│   │   │   ├── git.service.ts         # Clone-once + branch switching
│   │   │   └── index.ts
│   │   ├── env-var/
│   │   │   ├── env-var.service.ts     # Create/list/update/delete with audit logging
│   │   │   └── index.ts
│   │   ├── encryption/
│   │   │   ├── encryption.service.ts  # AES-256-GCM encrypt/decrypt
│   │   │   └── index.ts
│   │   ├── nginx/
│   │   │   ├── nginx.service.ts       # Write/remove per-project configs (production-only, currently unused)
│   │   │   └── index.ts
│   │   └── admin/
│   │       ├── admin.service.ts       # User/project management for CONTRIBUTOR role
│   │       └── index.ts
│   │
│   ├── types/                         # Domain types & DTOs
│   │   ├── api.types.ts               # ApiResponse<T>, PaginatedResponse
│   │   ├── deployment.types.ts        # DeploymentStatus, DeploymentJob
│   │   ├── project.types.ts           # ProjectType, CreateProjectDto
│   │   ├── env-var.types.ts           # EnvEnvironment, EncryptedPayload
│   │   └── index.ts
│   │
│   ├── validators/                    # Zod schemas
│   │   ├── auth.validator.ts          # registerSchema, loginSchema
│   │   ├── project.validator.ts       # createProjectSchema, updateProjectSchema
│   │   ├── env-var.validator.ts       # createEnvVarSchema, updateEnvVarSchema
│   │   └── index.ts
│   │
│   ├── __tests__/
│   │   └── package-scanner.test.ts
│   │
│   └── workers/
│       └── deployment.worker.ts       # BullMQ worker (concurrency: 5, timeout: 15 min)
│
├── prisma/
│   └── schema.prisma                  # User, Project, Deployment, EnvironmentVariable, AuditLog models
├── docker/
│   ├── templates/                     # Placeholder for additional Dockerfile templates
│   └── nginx/                         # Example reverse-proxy config
├── scripts/
│   ├── setup-dev.sh                   # One-shot local dev setup
│   ├── seed-contributor.ts            # Create/upsert CONTRIBUTOR account
│   └── fix-db-permissions.sql        # DB permission fix for production
└── docs/
    ├── PRD.md                         # Product requirements
    ├── ARCHITECTURE.md                # This file
    ├── HOW-IT-WORKS.md                # End-to-end runtime behavior
    ├── subdomain-routing.md           # Deep dive: in-app reverse proxy
    ├── deployment.md                  # Production VPS deployment guide
    ├── TODO.md                        # Improvement roadmap
    └── learn.md                       # Codebase learning guide
```

---

## 4. Key Conventions

| Concern | Convention |
|---------|-----------|
| **HTTP handling** | API routes parse body → validate with Zod → call service → return JSON |
| **Error handling** | Custom `AppError` hierarchy (`lib/errors.ts`) caught by `handleApiError()` (`lib/api-error.ts`) |
| **DB access** | Only through repositories — no Prisma imports in API routes or components |
| **Queue** | `IDeploymentQueue` interface in `lib/queue.ts`; BullMQ implementation behind it |
| **Auth** | JWT (HS256 via `jose`) stored in httpOnly `auth-token` cookie |
| **Session** | `getSession(req)` extracts `{ userId, email, role, mustResetPassword }` from JWT; every protected route calls it |
| **Config** | Centralized Zod-validated env in `lib/config.ts` via `getConfig()` |
| **DI pattern** | Services take dependencies via constructor; export both the class and a wired singleton |
| **Repo pattern** | Each repository defines an interface (e.g., `IUserRepository`) in the same file as its implementation |
| **Authorization** | Services check `resource.userId === session.userId`; return 404 (not 403) to hide existence |
| **Role guard** | `requireContributor(session)` in `lib/require-contributor.ts` protects admin routes |
| **Encryption** | Env var values encrypted with AES-256-GCM; `iv` and `authTag` stored alongside `encryptedValue` |
| **Logging** | Winston logger via `lib/logger.ts`; level controlled by `LOG_LEVEL` env var |

---

## 5. Data Flow Examples

### Authentication (register)

```mermaid
sequenceDiagram
    participant B as Browser
    participant R as POST /api/auth/register
    participant V as registerSchema (Zod)
    participant A as AuthService
    participant UR as UserRepository
    participant DB as PostgreSQL

    B->>R: { email, password }
    R->>V: validate input
    V-->>R: parsed data
    R->>A: register(email, password)
    A->>UR: findByEmail(email)
    UR->>DB: SELECT
    DB-->>UR: null (not found)
    A->>A: bcrypt.hash(password)
    A->>UR: create({ email, passwordHash })
    UR->>DB: INSERT
    A->>A: sign JWT (HS256)
    A-->>R: { accessToken }
    R->>R: setAuthCookie(token)
    R-->>B: 201 + Set-Cookie
```

### Deployment (trigger → live URL)

```mermaid
sequenceDiagram
    participant B as Browser
    participant API as POST /deploy
    participant DS as DeploymentService
    participant DR as DeploymentRepo
    participant Q as BullMQ
    participant W as Worker
    participant GS as GitService
    participant DocS as DockerService
    participant DB as PostgreSQL

    B->>API: Deploy button click
    API->>DS: createDeployment(projectId, userId)
    DS->>DS: Acquire Redis advisory lock
    DS->>DR: cancel existing QUEUED
    DS->>DR: create(status: QUEUED)
    DR->>DB: INSERT
    DS->>Q: add({ deploymentId, projectId })
    API-->>B: 201 Deployment queued

    Note over W: Separate process
    Q->>W: job received
    W->>DS: buildAndDeploy(deploymentId)
    DS->>DR: update(status: BUILDING)
    DS->>GS: ensureRepo(url, slug, branch)
    GS-->>DS: repo ready + commitHash
    DS->>DS: scanPackages (blocked list check)
    DS->>DS: resolveEnvVars (decrypt + split build/runtime)
    DS->>DocS: buildImage(slug, repoPath, buildArgs)
    DocS-->>DS: image built
    DS->>DocS: runContainer(image, type, runtimeEnv)
    DocS-->>DS: containerPort
    DS->>DR: clearSubdomainForOtherDeployments
    DS->>DR: clearPortForOtherDeployments
    DS->>DR: update(status: DEPLOYED, port, subdomain)
    DR->>DB: UPDATE
```

### Terminal command

```mermaid
sequenceDiagram
    participant B as Browser
    participant API as POST /terminal
    participant DTS as DockerTerminalService
    participant D as Docker Engine

    B->>API: { command: "ls -la" }
    API->>DTS: executeCommand(projectId, command)
    DTS->>DTS: validate against allowlist
    DTS->>D: exec create + start
    D-->>DTS: multiplexed stream
    DTS->>DTS: demux stdout/stderr
    DTS-->>API: { stdout, stderr, exitCode }
    API-->>B: JSON response
```

---

## 6. Scaling the Codebase

| Adding... | Where to put it |
|-----------|----------------|
| New feature service | `services/<feature>/` with constructor DI |
| New database entity | `prisma/schema.prisma` + `repositories/<entity>.repository.ts` |
| New API endpoint | `app/api/<resource>/route.ts` |
| New UI feature | `components/features/<feature>.tsx` |
| New React hook | `hooks/use-<feature>.ts` |
| New background job | `workers/<job>.worker.ts` + queue in `lib/queue.ts` |
| New config variable | Add to Zod schema in `lib/config.ts` |

---

## 7. PRD Mapping

| PRD Section | Implementation |
|-------------|----------------|
| 5.1 Auth | `AuthService`, JWT (HS256), `UserRepository`, `/api/auth/*`, `mustResetPassword` flag |
| 5.2 Projects | `ProjectService`, `ProjectRepository`, `GitService` |
| 5.3 Type Detection | `ProjectType` enum (9 types), `DOCKERFILE_TEMPLATES` in `services/docker/dockerfile.templates.ts` |
| 5.4 Build & Deploy | `DeploymentService`, `DockerService`, `GitService`, `deployment.worker.ts`, `package-scanner.ts` |
| 5.5 Status | `DeploymentStatus` enum (QUEUED/BUILDING/DEPLOYED/FAILED/CANCELLED), `buildStep` tracking (CLONING/SCANNING/BUILDING_IMAGE/STARTING) |
| 5.6 URLs | In-app reverse proxy (`/api/proxy/[slug]/[[...path]]`), database-driven routing, wildcard Nginx forwards all traffic to Next.js |
| 5.7 Branches | `project.branch` field, `GitService.ensureRepo()` with branch switching |
| 5.8 Terminal | `DockerTerminalService`, `/api/projects/:id/terminal`, slash commands |
| 5.9 Env Vars | `EnvironmentVariableService`, AES-256-GCM encryption, per-environment overrides, `AuditLog` entries |
| 5.10 Admin | `AdminService`, CONTRIBUTOR role, `/api/admin/*`, `requireContributor()` guard |
