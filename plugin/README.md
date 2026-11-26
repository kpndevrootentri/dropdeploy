# entrify-deploy

[Entrify](https://entrify.site) deploys websites, apps and HTML pages and gives you a live URL in seconds; `entrify-deploy` is its official CLI and MCP server.
Publish an HTML page three ways: run `entrify upload page.html` in a terminal, say "deploy this page" in Claude Code, or ask Claude Desktop to "deploy this page to Entrify".
Deploy a git repository (Next.js, React, Node.js, Django, FastAPI, Go, static HTML and more) with `entrify deploy`.

Formerly `dropdeploy-cli`. To switch: `npm uninstall -g dropdeploy-cli && npm install -g entrify-deploy`. Your saved login carries over.

```bash
npm install -g entrify-deploy
```

This installs the `entrify` command. The older `dropdeploy` command is installed too and does the same thing, so existing scripts keep working.

---

## Use it from Claude Code

Install the plugin, then ask Claude to "deploy this", or to "deploy this page to Entrify":

```
/plugin install entrify --marketplace kpndevrootentri/entrify-cli
```

On Claude Code older than 2.1.275, run `/plugin marketplace add kpndevrootentri/entrify-cli`, then `/plugin install entrify@entrify`.

Claude installs the CLI if needed, deploys, and reads the build log when a deploy fails. It then fixes the cause (code, settings or environment variables) and deploys again. It asks before pushing code or rolling back, and never asks for your password in the chat. For an HTML page or folder it uploads the files with `entrify upload` instead, and asks before replacing a site you already have.

---

## Use it from Claude Desktop

Install the Entrify extension and Claude Desktop can publish a page it made and reply with the live URL. No terminal or Node.js install needed.

1. Download [entrify.mcpb](https://entrify.site/downloads/entrify.mcpb), double-click it and click **Install**. If no install window opens, go to Claude Desktop's extension settings (**Settings > Extensions**, or on newer versions **Settings > Desktop app**, then **Manage** next to Extensions), open **Advanced settings**, click **Install Extension…** and choose the file.
2. Create an API token at [entrify.site/settings](https://entrify.site/settings#api-tokens) under **API tokens**. **Deploy only** is enough.
3. Paste the token when Claude Desktop asks for it. To change it later, click **Entrify** in the same extension settings.

Then ask Claude to make a page and "deploy this page to Entrify". The extension gives Claude two tools:

| Tool | What it does |
|---|---|
| `deploy_to_entrify` | Publishes a page as a site: `name`, `html`, optional text `files` (such as `style.css`), and `project_id` to publish a new version of an existing site. |
| `list_my_sites` | Lists your sites (name, slug, URL, source) and how many new sites you can still create. Read-only. |

Claude sends the page itself, so it can't publish files from your disk. A new name never overwrites a site: if the name is taken, Claude asks whether to update that site or use another name. When the token expires or you revoke it, create a new one and paste it into **Entrify** in Claude Desktop's extension settings.

### Advanced: set it up by hand

For another MCP client, or without the extension: install the CLI (`npm install -g entrify-deploy`), then add the server to the client's config. In Claude Desktop that is **Settings > Developer > Edit Config** (`claude_desktop_config.json`). Claude Desktop doesn't load your shell's `PATH`, so use full paths from `which node` and `which entrify`:

```json
{
  "mcpServers": {
    "entrify": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/opt/homebrew/bin/entrify", "mcp"],
      "env": { "ENTRIFY_TOKEN": "ent_your_api_token" }
    }
  }
}
```

Restart Claude Desktop after editing. Add `ENTRIFY_URL` to `env` if you don't use https://entrify.site. Without `env`, the server uses the login saved by `entrify auth login`, which expires after 7 days. The paths change when you update Node (for example with nvm); the extension has no such paths.

---

## Quick start

```bash
# Log in (one time)
entrify auth login

# Deploy from any git repo
entrify deploy

# Or publish an HTML file or a folder with index.html
entrify upload ./site
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

### `entrify auth token`
Print the token saved by `entrify auth login`, for `ENTRIFY_TOKEN`:

```bash
export ENTRIFY_TOKEN=$(entrify auth token)
```

It ignores `ENTRIFY_TOKEN` in the environment, so it never echoes back an expired token. Login tokens expire after 7 days; for CI and Claude Desktop, an [API token](#ci--automation) lasts longer.

### `entrify auth logout`
Clear saved credentials.

---

### `entrify deploy`
Trigger a deployment for the current repository.

```bash
entrify deploy                          # auto-match project by git remote
entrify deploy --project-id my-app      # deploy to a specific project
entrify deploy --project-id=my-app      # same
entrify deploy --create                 # create a project from this repo if none matches
entrify deploy --dir /path/to/repo      # use a different directory
```

Entrify deploys from your **git remote**, not local files. Push your changes before deploying. With `--create`, a repository that has no project yet gets one, named after the repository, with its framework detected.

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

### `entrify upload`
Publish files as a static site, with no git needed: one `.html` file, a folder with `index.html` at its top, or a `.zip` with `index.html` at its root.

```bash
entrify upload page.html                     # new site named "page"
entrify upload ./site --name "My Site"       # a folder, with a name
entrify upload ./site --dry-run              # list the files and check the name; upload nothing
entrify upload ./site --project-id my-site   # a new version of a site you uploaded before
```

The name defaults to the file or folder name (`site/index.html` → `site`). If you already have a site with that name, the CLI stops and prints its slug: pass `--project-id <slug>` to upload a new version of it, or choose another `--name`. It never replaces a site you didn't name with `--project-id`. Folders skip dotfiles (such as `.env` and `.git`), `node_modules` and symlinks. Only web file types are published (`.html`, `.css`, `.js`, `.json`, `.xml`, `.txt`, images and fonts); anything else is listed as `skipped` and not uploaded. The limits are 50 MB and 500 files. A folder with `package.json` at its top is refused as a project's source: upload its build output (such as `dist/`) instead, or use `entrify deploy`. A new site needs a free project in your quota.

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

The commands below act on the project matched from the current repository. Pass `--project-id <id|slug>` to choose another.

### `entrify status`
The latest deployment and the live URL. The live version can be older than the latest deployment when the latest one failed.

### `entrify logs`
The build log of the latest deployment.

```bash
entrify logs                     # last 200 lines
entrify logs --lines all
entrify logs --follow            # stream a build that is still running
entrify logs --deployment <id>   # a specific deployment
```

### `entrify env`
Environment variables. Entrify stores the values encrypted, and the CLI never prints them back. Changes apply on the next deploy.

```bash
entrify env list                         # names only
entrify env set API_URL=https://x.io DEBUG=0
entrify env push .env.production         # every variable in a .env file (default: .env)
entrify env unset DEBUG
```

### `entrify rollback`
Go back to the previous successful deployment, or to `--to <deployment-id>`.

### `entrify cancel`
Cancel the deployment that is queued or building.

---

### `entrify mcp`
Run the MCP server (tools `deploy_to_entrify` and `list_my_sites`) over stdio. Claude Desktop's Entrify extension starts it; see [Use it from Claude Desktop](#use-it-from-claude-desktop).

### `entrify help`
Print the full command reference.

### `entrify --version`
Print the installed version.

---

## CI / automation

Skip interactive login by setting environment variables:

```bash
export ENTRIFY_TOKEN=ent_your_api_token  # an API token from https://entrify.site/settings
export ENTRIFY_URL=https://entrify.site  # optional, this is the default

entrify deploy --project-id my-app
```

Create API tokens at [entrify.site/settings](https://entrify.site/settings#api-tokens). Creating one asks for your password. Each expires after 30, 90 or 365 days, or never, and you can revoke it there at any time; changing your password revokes them all. A **Deploy only** token can list projects, upload, deploy existing projects, show status and logs, roll back and cancel; `entrify deploy --create` and `entrify env` need a **Full access** token. The token is shown once, so store it as a CI secret. `$(entrify auth token)` also works, but that login expires after 7 days.

`DROPDEPLOY_TOKEN`, `DROPDEPLOY_URL` and `DROPDEPLOY_EMAIL` still work. Without a terminal, the CLI never prompts. If it can't match the repository to a project, it exits with an error asking for `--project-id` or `--create`.

Add `--json` to any command for a single JSON object on stdout: `{ "ok": true, ... }`, or `{ "ok": false, "error": { "code": "...", "message": "..." }, ... }`. A failed deploy also includes `cause`, `fix` and the last 40 lines of the log (`logTail`). Exit codes:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | The operation failed (for example, the build failed) |
| 2 | Needs input: a flag, a project, a file |
| 3 | Not logged in, or the login expired |

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
npm install -g entrify-deploy
```

Verify the installation:

```bash
entrify --version
```

---

## Publishing (maintainers)

1. Bump `version` in `package.json`, `mcpb/manifest.json`, `server.json` (both places) and `plugins/entrify/.claude-plugin/plugin.json`.
2. `npm run pack:mcpb` rebuilds the Claude Desktop extension at `../public/downloads/entrify.mcpb` in the Entrify app repository, served at https://entrify.site/downloads/entrify.mcpb. The app's tests fail when its version or manifest is out of date.
3. `npm publish`, then publish `server.json` to the [MCP Registry](https://registry.modelcontextprotocol.io): `mcp-publisher login github`, then `mcp-publisher publish`. The registry checks that `mcpName` in the published `package.json` matches `name` in `server.json`.

---

## License

MIT
