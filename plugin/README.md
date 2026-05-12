# dropdeploy-cli

Official CLI for [DropDeploy](https://dropdeploy.app) — deploy any project from the terminal in seconds.

```bash
npm install -g dropdeploy-cli
```

---

## Quick start

```bash
# Log in (one time)
dropdeploy auth login

# Deploy from any git repo
dropdeploy deploy
```

---

## Commands

### `dropdeploy auth login`
Log in to your DropDeploy account.

```bash
dropdeploy auth login                          # interactive login
dropdeploy auth login --email you@example.com  # pre-fill email
```

Password is always entered interactively — it is never passed as a flag.

### `dropdeploy auth status`
Show the currently logged-in account.

### `dropdeploy auth logout`
Clear saved credentials.

---

### `dropdeploy deploy`
Trigger a deployment for the current repository.

```bash
dropdeploy deploy                          # auto-match project by git remote
dropdeploy deploy --project-id my-app     # deploy to a specific project
dropdeploy deploy --dir /path/to/repo     # use a different directory
```

DropDeploy deploys from your **git remote**, not local files. Push your changes before deploying.

During the build, the CLI streams live output:

```
▶ DropDeploy

  Checking repository… ✓
  Validating project… ✓
  Detecting framework… ✓  NEXTJS (next.config.js)
  Resolving project… ✓  my-app (my-app-1)
  Triggering deployment… ✓

  ›  Cloning repository
  ›  Building Docker image
  ›  Starting container

✓ Deployed successfully

  Live URL  →  https://my-app.dropdeploy.app
```

On failure, the last 20 lines of the build log and a probable cause are printed.

---

### `dropdeploy projects`
List all your projects and their current status.

```
Your projects:
  my-app        My App         DEPLOYED
  → https://my-app.dropdeploy.app

  api-server    API Server     FAILED
```

---

### `dropdeploy help`
Print the full command reference.

### `dropdeploy --version`
Print the installed version.

---

## CI / automation

Skip interactive login by setting environment variables:

```bash
export DROPDEPLOY_TOKEN=your-jwt-token
export DROPDEPLOY_URL=https://dropdeploy.app

dropdeploy deploy --project-id my-app
```

---

## Supported frameworks

DropDeploy auto-detects your framework from the repository contents:

| Framework | Detection |
|-----------|-----------|
| Next.js | `next.config.js` / `.ts` / `.mjs` |
| React (Vite) | `vite.config` + React dependency |
| Vue (Vite) | `vite.config` + Vue dependency |
| Svelte | `vite.config` + Svelte dependency |
| Node.js | `package.json` with `start` script |
| Django | `manage.py` |
| FastAPI | `main.py` with `FastAPI()` |
| Flask | `app.py` with `Flask()` |
| Go | `go.mod` |
| Rust | `Cargo.toml` |
| Java / Spring Boot | `pom.xml` |
| Static HTML | `index.html` |

---

## Installation

Always install globally so the `dropdeploy` command is available system-wide:

```bash
npm install -g dropdeploy-cli
```

Verify the installation:

```bash
dropdeploy --version
```

---

## License

MIT
