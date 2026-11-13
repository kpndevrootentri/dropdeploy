# @entrify/cli

Official CLI for [Entrify](https://entrify.site): deploy any project from the terminal in seconds.

Formerly `dropdeploy-cli`. To switch: `npm uninstall -g dropdeploy-cli && npm install -g @entrify/cli`. Your saved login carries over.

```bash
npm install -g @entrify/cli
```

This installs the `entrify` command. The older `dropdeploy` command is installed too and does the same thing, so existing scripts keep working.

---

## Quick start

```bash
# Log in (one time)
entrify auth login

# Deploy from any git repo
entrify deploy
```

---

## Commands

### `entrify auth login`
Log in to your Entrify account.

```bash
entrify auth login                          # interactive login
entrify auth login --email you@example.com  # pre-fill email
```

Password is always entered interactively; it is never passed as a flag. Logins last 7 days. After that, any command tells you to log in again.

### `entrify auth status`
Show the currently logged-in account.

### `entrify auth logout`
Clear saved credentials.

---

### `entrify deploy`
Trigger a deployment for the current repository.

```bash
entrify deploy                          # auto-match project by git remote
entrify deploy --project-id my-app      # deploy to a specific project
entrify deploy --project-id=my-app      # same
entrify deploy --dir /path/to/repo      # use a different directory
```

Entrify deploys from your **git remote**, not local files. Push your changes before deploying.

The project is matched by your `origin` remote, whether it's an HTTPS or SSH URL. If several projects use the same repo, the one on your current branch wins. The server always builds the **project's** branch; the CLI warns you when that isn't the branch you have checked out.

During the build, the CLI streams live output:

```
▶ Entrify

  Checking repository… ✓
  Validating project… ✓
  Detecting framework… ✓  NEXTJS (next.config.js)
  Resolving project… ✓  my-app (my-app)
  Triggering deployment… ✓

  ›  Cloning repository
  ›  Building Docker image
  ›  Starting container

✓ Deployed successfully

  Live URL  →  https://my-app.entrify.site
```

On failure, the last 20 lines of the build log and a probable cause are printed.

---

### `entrify projects`
List all your projects and their current status.

```
Your projects:
  my-app        My App         DEPLOYED
    → https://my-app.entrify.site

  api-server    API Server     FAILED
```

---

### `entrify help`
Print the full command reference.

### `entrify --version`
Print the installed version.

---

## CI / automation

Skip interactive login by setting environment variables:

```bash
export ENTRIFY_TOKEN=your-jwt-token
export ENTRIFY_URL=https://entrify.site

entrify deploy --project-id my-app
```

`DROPDEPLOY_TOKEN`, `DROPDEPLOY_URL` and `DROPDEPLOY_EMAIL` still work. Without a terminal, the CLI never prompts. If it can't match the repository to a project, it exits with an error asking for `--project-id`.

---

## Supported frameworks

Entrify auto-detects your framework from the repository contents:

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

Always install globally so the `entrify` command is available system-wide:

```bash
npm install -g @entrify/cli
```

Verify the installation:

```bash
entrify --version
```

---

## License

MIT
