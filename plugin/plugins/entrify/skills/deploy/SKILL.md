---
name: deploy
description: Deploy the current project, or an HTML page, file or folder, to Entrify and get a live URL. Use when the user wants to deploy, ship, publish, host or put their app or a web page online, share a live link, or check, fix, see logs of or roll back an Entrify deployment.
argument-hint: "[path] [--project-id <id|slug>]"
allowed-tools: Bash(entrify *) Bash(git status *)
---

# Deploy to Entrify

Deploy the current project with the `entrify` CLI (npm package `entrify-deploy`) and report the live URL. Entrify builds from the git remote, so only pushed commits are deployed.

Always pass `--json`. Each command then prints one JSON object: `{"ok": true, ...}` or `{"ok": false, "error": {"code": "...", "message": "..."}, ...}`. Exit codes: 0 ok, 1 failed, 2 needs input, 3 not logged in. Branch on `error.code`, not on the wording.

Arguments: $ARGUMENTS. If they include `--project-id <id|slug>`, pass it to every `entrify` command below.

If the user means a page or files (for example an HTML file you just made, or a path in the arguments) rather than the repository, do steps 1 and 2, then follow **Deploy a file or folder** instead of steps 3 to 5.

## 1. Check the CLI

Run `entrify --version`.

- If the command is missing or the version is below 1.4.0, ask: "The Entrify CLI isn't installed or is out of date. Install it with `npm install -g entrify-deploy`?" On yes, run it, then check the version again.
- If `npm` is missing, tell the user to install Node.js LTS (https://nodejs.org, or `brew install node` on macOS), then stop.

## 2. Check the login

Run `entrify auth status --json`. If it exits with 3:

- Never ask for the password in the chat.
- Tell the user to run `! entrify auth login`. The `!` runs it in this session and hides the password as they type.
- Wait for them to confirm, then continue.

## 3. Check the code is pushed

Run `git status --porcelain --branch`. If there are uncommitted changes, or the branch is ahead of its remote, explain that Entrify deploys what is pushed and ask whether to commit and push first. Don't push without the user's OK.

## 4. Deploy

Run `entrify deploy --json`. A build can take several minutes, so use a 10-minute timeout.

- **`ok: true`**: tell the user the site is live at `url`. Check it answers with `curl -s -o /dev/null -w "%{http_code}" <url>`, and say so if it isn't 200. Relay any `warnings`.
- **`NO_PROJECTS` or `NO_PROJECT_MATCH`**: there's no Entrify project for this repository. Ask whether to create one; on yes run `entrify deploy --create --json`. If they'd rather use an existing project, list them with `entrify projects --json` and pass `--project-id`.
- **`UPLOAD_PROJECT`**: the project was made by uploading files, so there's no repository to build. Upload a new version with **Deploy a file or folder**, passing `--project-id`.
- **`INVALID_PROJECT`**: relay `errors` (for example, no git remote) and help fix them.
- **`DEPLOY_FAILED`**: go to step 5.

## 5. Fix a failed deploy (at most 3 attempts)

Read `cause`, `fix` and `logTail`. For more of the log, run `entrify logs --json --lines 400`.

- **The code or its config is wrong** (missing dependency, build error, app listening on 127.0.0.1 instead of 0.0.0.0 and `$PORT`): fix it in the repo, show the user the change, commit and push with their OK, then deploy again.
- **The app needs settings** (for example "Set SESSION_SECRET"): run `entrify env list --json` to see which names are set. Ask the user for the missing values, or offer `entrify env push <file>` for a `.env` file they choose. Never print secret values or put them in commits. Then deploy again.
- **The server failed** (for example "out of disk space"): stop and tell the user it isn't their code.

After 3 failed attempts, stop and summarise what you tried and the last error.

## Deploy a file or folder

Nothing needs to be committed or pushed: the files are uploaded as a static site.

1. Put the page in one `.html` file, or put it and its local assets (CSS, JS, images, linked by relative paths) in one folder with `index.html` at the top. A `.zip` with `index.html` at its root also works. Dotfiles, `node_modules` and symlinks are skipped. Only web file types are published (HTML, CSS, JS, JSON, XML, TXT, images, fonts); keep the site to 500 files.
2. Choose a descriptive name: 3 to 50 letters, digits, spaces, `-` or `_`.
3. If you did not create the folder in this chat, run `entrify upload <path> --name "<name>" --dry-run --json` first, show the user `files` and ask before uploading.
4. Run `entrify upload <path> --name "<name>" --json`, with a 10-minute timeout.

- **`ok: true`**: tell the user the site is live at `url`, whether it is a new site (`created: true`) or a new version of `project.slug`, and the `files` uploaded. If `skipped` is not empty, say those files were not published and links to them will not work. To redeploy later in this chat, run the same command with `--project-id <project.slug>`.
- **`NAME_TAKEN`**: the user already has a site with that name, `project.slug`. Ask whether to update that site (rerun with `--project-id <slug>`) or pick another name. Never update it without their OK. If the message says it is deployed from git, only a new name works.
- **`NO_INDEX_HTML`, `INVALID_PATH`, `INVALID_NAME`, `TOO_LARGE`** (over 50 MB) **or `TOO_MANY_FILES`** (over 500): relay the message and fix the folder or the name.
- **`PROJECT_SOURCE`**: the folder is a project's source (it has `package.json`). Build it and upload the build folder (such as `dist/`), or deploy the repository with steps 3 to 5.
- **`QUOTA_EXCEEDED`**: the user has no projects left for a new site. Relay the message: they can delete a site or ask an admin for a higher limit.
- **`TIMEOUT`**: the site may have been created anyway. Check `entrify projects --json` before uploading again.
- **`PROJECT_NOT_FOUND` or `NOT_UPLOAD_PROJECT`**: the `--project-id` is wrong or is a git project. List sites with `entrify projects --json`.

## Other requests

- **Is it live?** `entrify status --json`
- **Logs:** `entrify logs --json`; add `--follow` while a build is running.
- **Roll back:** confirm with the user first, because it replaces what's live, then run `entrify rollback --json`.
- **Stop a stuck build:** `entrify cancel --json`
- **Environment variables:** `entrify env list|set KEY=VALUE|push [file]|unset KEY --json`. Changes apply on the next deploy.
