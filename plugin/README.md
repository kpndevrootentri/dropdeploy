# entrify-deploy

Official CLI for [Entrify](https://entrify.site): deploy any project or HTML page from the terminal, Claude Code or Claude Desktop in seconds.

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

`entrify mcp` runs an MCP server that gives Claude Desktop one tool, `deploy_to_entrify`. Ask Claude to make a page and deploy it to Entrify, and it replies with the live URL. Claude sends the page itself (`name`, `html`, optional text `files` such as `style.css`, and `project_id` to update an existing site), so it can't publish files from your disk. If a site with that name exists, Claude asks whether to update it or use another name.

1. Install the CLI and log in in a terminal: `npm install -g entrify-deploy`, then `entrify auth login`.
2. Find the full paths. Claude Desktop doesn't load your shell's `PATH`, so it needs them:

   ```bash
   which node      # e.g. /opt/homebrew/bin/node
   which entrify   # e.g. /opt/homebrew/bin/entrify
   ```

3. In Claude Desktop, open Settings → Developer → Edit Config (`claude_desktop_config.json`) and add:

   ```json
   {
     "mcpServers": {
       "entrify": {
         "command": "/opt/homebrew/bin/node",
         "args": ["/opt/homebrew/bin/entrify", "mcp"]
       }
     }
   }
   ```

4. Restart Claude Desktop.

With no `env`, the tool uses the login saved by `entrify auth login`. Logins expire after 7 days; log in again in a terminal, with no Desktop restart needed. To use a token instead, add `"env": { "ENTRIFY_TOKEN": "<token>" }` with the output of `entrify auth token` (and `ENTRIFY_URL` if you don't use https://entrify.site). When that token expires, put a new one in the config and restart Claude Desktop.

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
Print the token saved by `entrify auth login`, for `ENTRIFY_TOKEN` in CI or Claude Desktop:

```bash
export ENTRIFY_TOKEN=$(entrify auth token)
```

It ignores `ENTRIFY_TOKEN` in the environment, so it never echoes back an expired token. Tokens expire after 7 days.

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
Run the MCP server for Claude Desktop over stdio. Claude Desktop starts it; see [Use it from Claude Desktop](#use-it-from-claude-desktop).

### `entrify help`
Print the full command reference.

### `entrify --version`
Print the installed version.

---

## CI / automation

Skip interactive login by setting environment variables:

```bash
export ENTRIFY_TOKEN=your-jwt-token     # from entrify auth token; expires after 7 days
export ENTRIFY_URL=https://entrify.site  # optional, this is the default

entrify deploy --project-id my-app
```

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

## License

MIT
