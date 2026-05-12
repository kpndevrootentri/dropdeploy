import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ArrowLeft, AlertCircle, Info } from 'lucide-react';

export const metadata: Metadata = { title: 'Git Setup — DropDeploy Docs' };

function Code({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">{children}</code>
  );
}

function Pre({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <pre className="rounded-lg border border-border bg-muted/60 p-4 overflow-x-auto text-sm font-mono leading-relaxed mt-3">
      {children}
    </pre>
  );
}

function Callout({ type, children }: { type: 'info' | 'warn'; children: React.ReactNode }): React.ReactElement {
  const isWarn = type === 'warn';
  return (
    <div className={`flex gap-3 rounded-lg border p-4 text-sm ${isWarn ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-blue-500/30 bg-blue-500/5'}`}>
      {isWarn
        ? <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
        : <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />}
      <div className="text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}

export default function GitSetupPage(): React.ReactElement {
  return (
    <div className="space-y-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-500 mb-2">Getting Started</p>
        <h1 className="text-3xl font-bold tracking-tight mb-3">Git Setup</h1>
        <p className="text-muted-foreground leading-relaxed">
          DropDeploy deploys directly from Git. Here is what your repository needs to look like
          and how to connect private repos.
        </p>
      </div>

      {/* Public repos */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Public repositories</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          No setup needed. Paste the HTTPS clone URL of any public repo ending in <Code>.git</Code> and DropDeploy
          will clone it without any credentials.
        </p>
        <Pre>{`https://github.com/your-username/my-project.git
https://gitlab.com/your-username/my-project.git`}</Pre>
      </section>

      {/* Private repos */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Private repositories</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Connect your GitHub or GitLab account via OAuth — DropDeploy stores an access token
          so it can clone private repos on your behalf. You only need to do this once per provider.
        </p>
        <ol className="space-y-3 text-sm text-muted-foreground">
          <li className="flex gap-3">
            <span className="font-mono text-blue-500 shrink-0">01</span>
            <span>In the Create Project dialog, click the <strong className="text-foreground">GitHub</strong> or <strong className="text-foreground">GitLab</strong> button.</span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-blue-500 shrink-0">02</span>
            <span>A popup opens — authorise DropDeploy to read your repositories.</span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-blue-500 shrink-0">03</span>
            <span>The picker loads your repos. Search by name and click one to select it.</span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-blue-500 shrink-0">04</span>
            <span>Your connection is saved — all future deployments use the stored token automatically.</span>
          </li>
        </ol>
        <Callout type="info">
          You can connect both GitHub and GitLab at the same time from{' '}
          <Link href="/settings" className="text-blue-500 hover:underline">Settings → Connected Accounts</Link>.
        </Callout>
      </section>

      {/* Branch */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Branch selection</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          DropDeploy defaults to <Code>main</Code>. If your default branch is <Code>master</Code> or
          anything else, update the branch field in the Create Project form before deploying.
          When a repo is selected via the picker the branch is set automatically from the repo&apos;s default.
        </p>
        <Callout type="warn">
          DropDeploy always deploys the <em>latest commit</em> on that branch at the time you click Deploy.
          There is no automatic redeploy on push — you trigger each deployment manually.
        </Callout>
      </section>

      {/* Repo requirements */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Repository requirements</h2>
        <div className="space-y-3 text-sm text-muted-foreground">
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {[
              {
                label: 'Framework file must be in the repo root',
                detail: 'next.config.js, package.json, go.mod, Cargo.toml, pom.xml, manage.py, etc. — one of these is how DropDeploy identifies your framework.',
              },
              {
                label: 'Lock files should be committed',
                detail: 'package-lock.json, yarn.lock, Cargo.lock, go.sum — committing them makes builds faster and reproducible.',
              },
              {
                label: 'Do not gitignore your source files',
                detail: 'DropDeploy builds from source. Make sure source code, requirements.txt, and any config files are committed.',
              },
              {
                label: 'Build artefacts (dist/, .next/, target/) can stay gitignored',
                detail: 'DropDeploy runs the build step itself inside Docker. You do not need to commit compiled output.',
              },
            ].map((row) => (
              <div key={row.label} className="px-5 py-4">
                <p className="font-medium text-foreground mb-0.5">{row.label}</p>
                <p className="text-muted-foreground text-xs leading-relaxed">{row.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gitignore template */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Recommended .gitignore additions</h2>
        <p className="text-muted-foreground text-sm">
          These paths are safe to ignore — DropDeploy never needs them in the repo:
        </p>
        <Pre>{`# Build output — DropDeploy builds these itself
.next/
dist/
build/
target/

# Runtime secrets — use the Env Vars dashboard instead
.env
.env.local
.env.production

# OS / editor noise
.DS_Store
*.swp`}</Pre>
      </section>

      <div className="border-t border-border pt-8 flex items-center justify-between text-sm">
        <Link href="/docs/getting-started" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Project Creation
        </Link>
        <Link href="/docs/local-dev" className="flex items-center gap-1.5 text-blue-500 font-medium hover:underline">
          Local Development
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
