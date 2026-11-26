# CLI and Claude integration

Entrify can be driven from three places, and all of them run the same npm package, `entrify-deploy`, whose source is `plugin/`:

| Surface | What the user does | What runs | Login |
|---|---|---|---|
| Terminal / CI | `entrify deploy`, `entrify upload ./site` | the `entrify` CLI | `entrify auth login`, or `ENTRIFY_TOKEN` |
| Claude Code | "deploy this" or `/entrify:deploy` | the `deploy` skill, which runs the CLI with `--json` | same as the terminal |
| Claude Desktop | "deploy this page to Entrify" | the Entrify extension (`public/downloads/entrify.mcpb`), which runs `entrify mcp`: an MCP server with two tools | an `ent_` API token pasted into the extension, passed as `ENTRIFY_TOKEN`; else the saved login |

This page is for maintainers. User-facing docs live on the site under `/docs` and in `plugin/README.md`.

## 1. Where the code lives

```
plugin/                              npm package entrify-deploy (bins: entrify, dropdeploy)
  src/cli.ts                         commands, flags, help, human vs --json output
  src/api.ts                         EntrifyApi: the HTTP client, error mapping, timeouts
  src/auth.ts                        where the token and URL come from; credentials file
  src/upload.ts                      bundling files for `entrify upload` and the MCP tool
  src/mcp.ts                         `entrify mcp`: stdio MCP server (hand-written JSON-RPC)
  src/detector.ts                    git remote/branch, local project checks for `deploy`
  src/util.ts                        CliError, EXIT codes, parseArgs, apiErrorMessage
  src/*.test.ts, src/test-helpers.ts node:test suites; a fake Entrify API in each
  .claude-plugin/marketplace.json    Claude Code marketplace (lists the `entrify` plugin)
  plugins/entrify/.claude-plugin/plugin.json
  plugins/entrify/skills/deploy/SKILL.md   the Claude Code skill
public/deploy.md                     byte-for-byte copy of SKILL.md, served at /deploy.md
src/__tests__/deploy-skill-sync.test.ts  enforces that copy and the plugin.json version
```

`plugin/` is its own package with its own `tsconfig.json`. The app's root `tsconfig.json` excludes it, because `next build` type-checks every file the root tsconfig includes, and the server never installs `plugin/node_modules` (`fflate` would be missing).

The public mirror `github.com/kpndevrootentri/entrify-cli` is a copy of `plugin/`. `plugin/` is the source of truth. The Claude Code marketplace install points at the mirror.

## 2. Authentication

`readCredentials()` in `plugin/src/auth.ts` decides which login a command uses:

1. If `ENTRIFY_TOKEN` (or the old `DROPDEPLOY_TOKEN`) is set, it is used with `ENTRIFY_URL || DROPDEPLOY_URL || https://entrify.site`. An empty `ENTRIFY_URL` means the default, because config templates often leave it as `""`.
2. Otherwise it reads the login saved by `entrify auth login`: `~/.config/dropdeploy/credentials.json`, or `%APPDATA%\dropdeploy\credentials.json` on Windows. The file is written atomically with mode `0600`. The folder keeps the old name so logins from earlier versions still work.

`auth login` calls `POST /api/auth/token`, which returns the same JWT the browser gets, in the body instead of a cookie. The JWT lasts `JWT_EXPIRES_IN` (7 days). `entrify auth token` prints the saved token for `ENTRIFY_TOKEN`. It reads only the file, so it never echoes back a stale token from the environment.

On the server, `getSession()` (`src/lib/get-session.ts`) accepts the cookie, `Authorization: Bearer <jwt>`, or `Authorization: Bearer ent_…`, an API token made at `/settings#api-tokens`. The cookie always wins, so a browser session never becomes a token session. An API token is checked by its sha256 hash, then limited by `apiTokenBlockReason()` in `src/lib/api-token-scope.ts`. Its scope is Deploy only (the default) or Full access. Creating one (`POST /api/tokens`) needs the user's current password (`authService.confirmPassword`, rate-limited like password changes), so a stolen login such as a 7-day CLI JWT cannot turn itself into a token that never expires. A token stops working when it expires or is revoked, and every token is revoked when the password is changed or reset (`setPassword`), the user is suspended (`setSuspended`) or an admin signs them out (`revokeSessions`). The CSRF check in `src/proxy.ts` refuses cross-origin browser writes to any platform path, but lets through requests with no `Origin`, which covers the CLI.

When the server answers 401, the CLI says what to do, and the advice depends on where the token came from. A token from the environment gets "set a new `ENTRIFY_TOKEN` (and update Claude Desktop's config)". A saved login gets "run `entrify auth login`". Both use code `AUTH_EXPIRED` and exit 3.

## 3. Commands

| Command | What it does | Server calls |
|---|---|---|
| `deploy [--project-id] [--create] [--dir]` | Builds the project from its pushed git remote and follows the build | `GET /api/projects`, `POST /api/detect-type`, `POST /api/projects`, `POST /api/projects/:id/deploy`, log stream |
| `upload <path> [--name] [--project-id] [--dry-run]` | Publishes an `.html` file, a folder or a `.zip` as a static site; no git | `GET /api/projects`, `POST /api/projects/upload`, `POST /api/projects/:id/upload` |
| `status`, `logs [--deployment] [--lines] [--follow]` | Latest deployment, URL and build log | `GET …/deployments`, `GET …/logs`, `GET …/logs/stream` |
| `env list / set / push / unset` | Environment variables (values are never printed) | `…/env-vars` |
| `rollback [--to]`, `cancel` | Previous successful deployment; stop a queued or running build | `…/rollback`, `…/cancel` |
| `projects` | Every project and its status | `GET /api/projects` |
| `mcp` | Starts the MCP server for Claude Desktop (section 6) | as `upload` |
| `auth login / status / token / logout` | Login management | `POST /api/auth/token` |

`deploy`, `status`, `logs`, `env`, `rollback` and `cancel` find the project from the current directory's git remote. `--project-id <id|slug>` picks one directly.

### Output for scripts and agents

With `--json`, every command prints exactly one JSON object on stdout: `{"ok": true, ...}` or `{"ok": false, "error": {"code", "message"}, ...}`. Commands never prompt without a terminal or with `--json`.

| Exit | Meaning | Typical codes |
|---|---|---|
| 0 | ok | |
| 1 | failed | `DEPLOY_FAILED`, `DEPLOY_TIMEOUT`, `DEPLOY_CANCELLED`, `NETWORK`, `TIMEOUT`, `HTTP_<status>`, `ERROR` |
| 2 | needs input | `NO_PROJECTS`, `NO_PROJECT_MATCH`, `NAME_TAKEN`, `INVALID_NAME`, `INVALID_PATH`, `NO_INDEX_HTML`, `PROJECT_SOURCE`, `TOO_LARGE`, `TOO_MANY_FILES`, `QUOTA_EXCEEDED`, `PROJECT_NOT_FOUND`, `NOT_UPLOAD_PROJECT`, `UPLOAD_PROJECT`, `USAGE` |
| 3 | not logged in | `NOT_LOGGED_IN`, `AUTH_EXPIRED` |

Agents should branch on `error.code`, never on the wording. Network failures read `Could not reach <url>: <reason>`, and the token is removed from that text. Server validation errors include the first detail (`Validation failed: <reason>`).

## 4. Publishing static files (`entrify upload`)

```
path ──► bundlePath() ──► deploySite() ──────────────► server
          file / folder /    name rule, NAME_TAKEN,      POST /api/projects/upload        (new site)
          .zip → one file    quota, --project-id,        POST /api/projects/:id/upload    (new version)
          + files/skipped    --dry-run (no request)      → { project, deployment, url }
```

`plugin/src/upload.ts` returns data and never prints, so the CLI and the MCP server share it.

- **An `.html`/`.htm` file** is sent as is. The server writes it as `index.html`.
- **A folder** needs `index.html` at its top level, matched exactly; `Index.html` is refused because the Linux server would refuse it. It is zipped in memory with `fflate`. The walk skips dotfiles (`.env`, `.git`), `node_modules` and symlinks, at every depth.
- **A folder with `package.json` at its top** is refused (`PROJECT_SOURCE`). It's a project's source, and publishing it would expose config files without making a working site. Upload the build output (`dist/`) or use `entrify deploy`.
- **A `.zip`** is sent as is. Its entries are listed without unpacking.
- **File types the server won't publish** (anything but the web types below) are left out of a folder and reported as `skipped`. For a `.zip` they're reported as `skipped`, because the server drops them.
- **A name already used by one of your projects** stops with `NAME_TAKEN`. A site is only replaced when `--project-id` names it, so a live site is never overwritten by accident. A git project with that name can't be uploaded to (`NOT_UPLOAD_PROJECT`).
- **A new site needs a free project** in the user's quota, checked from the `quota` that `GET /api/projects` returns. The server reads the whole upload before it checks the limit, so checking first saves sending up to 50 MB for nothing.
- **The upload timeout is 2 minutes plus 1 s per 100 KB** (about 11 minutes at 50 MB). If a new site times out, the message warns it may have been created anyway.

On the server (`src/services/upload/`), a zip with a single top-level folder is unwrapped. `index.html` must then be at the root. The last 5 uploads of a site are kept, so `entrify rollback` can restore one.

### Rules the CLI copies from the server

The CLI checks these before sending, to give clear errors and avoid wasted uploads. If one changes on the server, change the CLI too: they sit together under a "keep in sync" comment at the top of `plugin/src/upload.ts`.

| Rule | Server | CLI |
|---|---|---|
| 50 MB per upload | `UPLOAD_MAX_FILE_BYTES` in `src/lib/upload-utils.ts` | `MAX_BYTES` |
| 500 files per zip | `MAX_FILES` in `src/services/upload/upload.service.ts` | `MAX_FILES` |
| Published file types | `ALLOWED_EXTENSIONS` in `upload.service.ts` | `PUBLISHED_TYPES` |
| Site name: 3–50 of `a-z A-Z 0-9 space _ -` | `uploadProjectSchema` in `src/validators/project.validator.ts` | `SITE_NAME`, `NOT_SITE_NAME_CHARS`, `SITE_NAME_MAX` |

Published types: `.html .htm .css .js .mjs .cjs .json .svg .ico .png .jpg .jpeg .gif .webp .avif .woff .woff2 .ttf .eot .xml .txt .map .webmanifest`.

## 5. Claude Code plugin

Users install it with `/plugin install entrify --marketplace kpndevrootentri/entrify-cli`, then say "deploy this". The skill is `plugins/entrify/skills/deploy/SKILL.md`. Its `allowed-tools` are `Bash(entrify *)` and `Bash(git status *)`.

What the skill does:
1. Checks the CLI version (`entrify --version`, at least the version the skill needs) and offers `npm install -g entrify-deploy`.
2. Checks the login (`entrify auth status --json`). It never asks for a password in the chat; it asks the user to run `! entrify auth login`.
3. Decides whether the user means the repository or a page or file:
   - **Repository:** `entrify deploy --json`. If the build fails, it reads the log, fixes the cause and deploys again, at most 3 times, and asks before pushing code.
   - **Page or file:** `entrify upload <path> --name "…" --json`. For a folder it didn't create in that chat, it runs `--dry-run` first and shows the file list. On `NAME_TAKEN` it asks whether to update that site or pick another name. It reports `skipped` files.

Two copies must stay identical: `public/deploy.md` (for people who save the skill to `~/.claude/commands/`) and `SKILL.md`. `plugin.json`'s version must equal `plugin/package.json`'s. `src/__tests__/deploy-skill-sync.test.ts` fails if either drifts.

## 6. Claude Desktop (`entrify mcp`)

`entrify mcp` is a stdio MCP server, hand-written in `plugin/src/mcp.ts` rather than built on the MCP SDK, which would pull express and about 10 other packages into the CLI:
- **Protocol:** JSON-RPC 2.0, one message per line, with stdin read through `readline`. It negotiates protocol versions `2025-06-18`, `2025-03-26` and `2024-11-05`. It answers `initialize`, `ping`, `tools/list` and `tools/call`, and never replies to notifications. Errors are `-32700` (bad JSON), `-32600` (a batch or other non-object), `-32601` (unknown method) and `-32602` (unknown tool).
- **stdout:** carries protocol messages only; all printing lives in `cli.ts`. One stray line breaks the connection, and Desktop shows the server as failed without a reason. `mcp.test.ts` asserts every stdout line is JSON.
- **Concurrency:** requests aren't awaited in order, so a `ping` is answered while an upload runs.
- **Login:** read again on every call, so a fresh `entrify auth login` works without restarting Desktop.

Two tools. `list_my_sites` (read-only) returns the user's sites and quota from `GET /api/projects`. `deploy_to_entrify` (marked destructive, since `project_id` replaces a site) takes `name`, `html`, optional `files` (extra text files by relative path) and optional `project_id`. It deliberately has **no path input**: the model must not be able to publish files from the user's disk, for example after a prompt injection. `files` keys are refused if absolute, if they contain `\`, `..`, `.` or empty segments, if they're `index.html` or `__proto__`, or if their type isn't published. It goes through the same `deploySite()` as the CLI, so the same name, quota and replace rules apply. A failure comes back as `isError` with `Entrify deploy failed (<code>): <message>` (or `Entrify list failed`). `toolMessage()` in `mcp.ts` rewrites the CLI's messages by error code so they name tool arguments (`project_id`), not flags (`--project-id`), and a missing or expired token points to `/settings#api-tokens` and the extension's settings. `initialize` returns `instructions` telling the model to check `list_my_sites` first and never replace a site without the user's OK.

### Setup today, and why it was hard (checked 2026-11-25)

The README route is: install the CLI, `entrify auth login` in a terminal, find absolute paths with `which node` and `which entrify`, add an `mcpServers.entrify` entry to `claude_desktop_config.json`, then restart Desktop. On a real Mac this failed for reasons worth knowing:
- **Nothing was configured:** `claude_desktop_config.json` had no `mcpServers`, so Desktop had no Entrify tool and could only ask the user to do things.
- **The wrong CLI was installed:** only the old `dropdeploy-cli` 1.0.3, not `entrify-deploy`.
- **Claude couldn't do the setup itself:** Desktop's own shell runs in its Cowork sandbox VM, which has an allowlist of reachable hosts. From there it can't install software on the Mac, edit Desktop's config, read the saved login or restart Desktop.
- **The paths break easily:** absolute nvm paths change when the Node version changes.
- **The login expires:** the JWT lasts 7 days, so a token in the config goes stale every week.

What fixes it:
- **One-click Desktop extension:** `plugin/mcpb/manifest.json` describes an MCP Bundle that Desktop runs with its own Node and a token field it keeps in the OS keychain. `npm run pack:mcpb` (in `plugin/`) builds `dist/` and writes `public/downloads/entrify.mcpb`; `src/__tests__/mcpb-sync.test.ts` fails if the bundle's version drifts from `plugin/package.json`, so rerun it on every version bump.
- **Scoped API tokens:** long-lived `ent_…` tokens made at `/settings#api-tokens` (`src/services/api-token/`, `src/lib/api-token-scope.ts`). Only their sha256 is stored. Deploy only tokens may call just the upload, deploy, deployment and log routes; no token may use admin, auth, token, onboarding, cohort, git-provider or terminal routes, or a path with `%`, `//` or dot segments.

## 7. Tests

```bash
cd plugin && npm run typecheck && npm test && npm run build              # CLI: node:test via tsx
npx jest src/__tests__/deploy-skill-sync.test.ts                         # skill copy + version
```

- **Fake API:** each CLI test file starts a fake Entrify API on a random port. `src/test-helpers.ts` holds the shared multipart parser.
- **Isolation:** tests set `HOME` and `APPDATA` to a temp folder, so the real saved login is never read or written.
- **The MCP test:** `mcp.test.ts` spawns `node --import tsx src/cli.ts mcp` and talks JSON-RPC to it, including a message split across two writes, a garbage line and notifications. Batches (`-32600`) are handled in `mcp.ts` but have no automated test yet.
- **Not type-checked:** test files and `test-helpers.ts` are excluded from `npm run typecheck` (tsx runs them without type checks) and from the build, so they're never published.

## 8. Releasing a new CLI version

Order matters. The skill and `/deploy.md` require a minimum CLI version, so npm must have it before they go live.

1. **Bump versions:** `plugin/package.json` and `plugins/entrify/.claude-plugin/plugin.json`, and the skill's minimum version if the skill needs new CLI features. Copy `SKILL.md` to `public/deploy.md`.
   - **Rebuild the Desktop extension:** run `cd plugin && npm run pack:mcpb` and commit `public/downloads/entrify.mcpb`. Its manifest version comes from `plugin/mcpb/manifest.json`, which must match `package.json`; `mcpb-sync.test.ts` fails otherwise. Bump `version` in `plugin/server.json` too.
2. **Run the checks** in section 7. Then merge, using a single-line merge commit: `gh pr merge N --merge --body ""`.
3. **Publish to npm** (a maintainer with 2FA): `cd plugin && npm publish --otp=<code>`. `prepublishOnly` builds `dist/`. Check the contents first with `npm pack --dry-run`: only `dist/`, `README.md` and `package.json`. Then list it in the MCP Registry: `cd plugin && mcp-publisher login github && mcp-publisher publish`. The registry checks that `mcpName` in the published package matches `plugin/server.json`.
4. **Update prod:** `git pull` on the server. If only `public/deploy.md` and `plugin/` changed, no rebuild or restart is needed. Next serves files that already existed in `public/` from disk, which was confirmed on 2026-11-25: `/deploy.md` updated with the same BUILD_ID. Check with `curl https://entrify.site/deploy.md`.
5. **Sync the mirror:** clone `kpndevrootentri/entrify-cli`, then `rsync -a --delete --exclude .git --exclude node_modules --exclude dist <repo>/plugin/ ./`. Run `npm ci && npm test` there and open a PR. `diff -r` against `plugin/` should show nothing.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `entrify: command not found` | CLI not installed (an old `dropdeploy` may be) | `npm i -g entrify-deploy`, never `npx entrify` (another package owns that name) |
| `AUTH_EXPIRED`, exit 3 | The 7-day login expired | `entrify auth login`. With `ENTRIFY_TOKEN`, set a new token (and update Desktop's config) |
| `NAME_TAKEN` | A project with that name exists | `--project-id <slug>` to update it, or another `--name` |
| `PROJECT_SOURCE` | Uploading a project's source folder | Upload its build output, or use `entrify deploy` |
| Files in `skipped` | Not a published web type | Convert them (e.g. PDF → link elsewhere) or leave them out |
| Desktop has no Entrify tool | No `mcpServers.entrify` in `claude_desktop_config.json`, or a bad `node`/`entrify` path | See section 6. Check Desktop's `mcp.log` in `~/Library/Logs/Claude/` |
| Desktop server fails to start without a reason | Something wrote to stdout in mcp mode | Only `cli.ts` may print; `mcp.test.ts` catches this |
| `UPLOAD_PROJECT` from `entrify deploy` | The project was made by uploading files | `entrify upload <path> --project-id <slug>` |
