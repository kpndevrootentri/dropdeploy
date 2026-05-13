# Deploy to DropDeploy

Deploy the current project to DropDeploy using the git-based deployment pipeline.

## Arguments
- `--project-id <id|slug>` — skip project selection and deploy to a specific project

## Steps

### 1. Check CLI is installed
Run:
```
which dropdeploy 2>/dev/null || echo "NOT_FOUND"
```
If NOT_FOUND, ask the user:
> "dropdeploy CLI is not installed. Would you like me to install it now? (yes/no)"

**If the user says no** — stop and tell them they can install it manually with `npm install -g dropdeploy-cli`.

**If the user says yes** — proceed with the following sub-steps:

#### 1a. Check if npm is available
Run:
```
which npm 2>/dev/null || echo "NPM_NOT_FOUND"
```

**If npm is found** — install the CLI globally:
```
npm install -g dropdeploy-cli
```
Wait for it to complete, then verify with `which dropdeploy`. If still not found, tell the user the install failed and stop.

**If npm is NOT found** — tell the user:
> "npm is not installed. I'll install Node.js (LTS) and npm first."

Then install Node.js LTS using the appropriate method for the platform:

- **macOS** — check if Homebrew is available (`which brew`). If yes:
  ```
  brew install node@lts || brew install node
  ```
  Then reload the PATH so `npm` is available in this session:
  ```
  export PATH="$(brew --prefix)/bin:$PATH"
  ```
  If Homebrew is NOT available, install it first:
  ```
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ```
  Then install Node: `brew install node`

- **Linux (Debian/Ubuntu)** — use NodeSource:
  ```
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs
  ```

- **Linux (RHEL/Fedora/CentOS)** — use NodeSource:
  ```
  curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash - && sudo yum install -y nodejs
  ```

- **Windows** — tell the user to download the LTS installer from https://nodejs.org and rerun the skill after installation.

After Node/npm installation, verify npm is available, then install the CLI:
```
npm install -g dropdeploy-cli
```
Verify with `which dropdeploy` before proceeding. If it fails, stop and report the error.

### 2. Check authentication
Run:
```
dropdeploy auth status
```
If the output contains "Not logged in":
- **Never ask for the password in the chat.**
- Tell the user to run the login command themselves using the `!` prefix so the password is entered directly in the terminal (hidden input, never visible in the conversation):
  ```
  ! dropdeploy auth login
  ```
  The CLI will interactively prompt for URL, email, and password with the password hidden.
- Wait **one turn** for the user to confirm they have logged in. If they don't confirm, remind them once and stop.

### 3. Run the deployment

Build the command:
- Base command: `dropdeploy deploy`
- If `--project-id <value>` was passed in ARGUMENTS, append `--project-id <value>`

Run it — the CLI auto-detects the project from the current directory's git remote:
```
dropdeploy deploy
```

The CLI handles:
- Repository validation
- Framework detection
- Project matching via git remote URL
- Live progress bar (step-by-step)
- Build log streaming

If the output contains "unpushed commits", pause and warn the user:
> "You have unpushed commits. DropDeploy deploys from the remote — run `git push` first, then redeploy."
Then ask if they want to push and retry.

### 4. Interpret the result

Use the **exit code** as the source of truth, not string matching:

**Exit code 0 → success.**
Tell the user the deployment succeeded and relay the Live URL printed in the CLI output. Example:
> "Deployed! Live at: https://my-app.en3.wtf"

**Exit code 1 → failure.**
Check what the output contains:
- If it contains "Deployment failed": relay the "Probable cause" and "Suggested fix" lines. Ask if they want to fix it and try again.
- If no build was triggered (validation error): relay the specific error and tell the user what to do.

## Notes
- DropDeploy deploys from the git remote, not local files. Ensure changes are pushed before deploying.
- If no project matches the git remote automatically, the CLI will prompt the user to pick one interactively.
- Use `dropdeploy projects` to list available projects and their current status.
