import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';

export const metadata: Metadata = { title: 'Project Creation — DropDeploy Docs' };

function Code({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">
      {children}
    </code>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex gap-5">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-sm font-bold text-blue-500">
        {n}
      </div>
      <div className="flex-1 pb-8 border-l border-dashed border-border pl-5 -ml-[21px]">
        <h3 className="font-semibold text-base mb-2 mt-0.5">{title}</h3>
        <div className="text-muted-foreground text-sm leading-relaxed space-y-2">{children}</div>
      </div>
    </div>
  );
}

export default function GettingStartedPage(): React.ReactElement {
  return (
    <div className="space-y-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-500 mb-2">Getting Started</p>
        <h1 className="text-3xl font-bold tracking-tight mb-3">Project Creation</h1>
        <p className="text-muted-foreground leading-relaxed">
          Deploy your first project in under five minutes — no server knowledge required.
          DropDeploy clones your repository, builds a Docker container, and gives you a live URL.
        </p>
      </div>

      {/* Prerequisites */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <p className="font-semibold text-sm">Before you start</p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[
            'A GitHub or GitLab account with a repository to deploy',
            'Your project runs locally — it builds and starts without errors',
            'You know which framework or language it uses',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Steps */}
      <div className="space-y-0">
        <Step n={1} title="Sign in to DropDeploy">
          <p>
            Go to the <Link href="/login" className="text-blue-500 hover:underline">login page</Link> and
            create a free account with your email, or log in if you already have one.
          </p>
        </Step>

        <Step n={2} title="Open the dashboard and click Create project">
          <p>
            From your dashboard, click the <strong className="text-foreground">Create project</strong> button.
            A dialog will open where you fill in three things: name, repository, and framework.
          </p>
        </Step>

        <Step n={3} title="Connect your repository">
          <p>You have two ways to add your repo:</p>
          <ul className="space-y-1.5 mt-2">
            <li className="flex items-start gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono shrink-0 mt-0.5">A</span>
              <span>
                <strong className="text-foreground">GitHub or GitLab picker</strong> — Click the GitHub or GitLab
                button, authorise DropDeploy once, and pick any repo from the list (including private ones).
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono shrink-0 mt-0.5">B</span>
              <span>
                <strong className="text-foreground">Paste a URL</strong> — Paste any public repository URL
                ending in <Code>.git</Code> (e.g. <Code>https://github.com/you/my-app.git</Code>).
              </span>
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground/70 italic">
            Tip: after you pick a repo DropDeploy auto-detects the framework — the framework selector updates automatically.
          </p>
        </Step>

        <Step n={4} title="Confirm the framework">
          <p>
            DropDeploy inspects your repository files and selects the most likely framework.
            Review the selection and change it if needed — each choice generates a different Dockerfile
            and exposes a different port.
          </p>
          <p>
            See the <Link href="/docs/frameworks/nextjs" className="text-blue-500 hover:underline">Frameworks</Link> section
            for exactly what each option does.
          </p>
        </Step>

        <Step n={5} title="Set environment variables (optional)">
          <p>
            If your app reads from <Code>.env</Code>, add those variables after the project is created
            via <strong className="text-foreground">Project → Env Vars</strong>.
            They are injected securely at runtime — never stored in your image.
          </p>
          <p>
            Exception: <Code>NEXT_PUBLIC_*</Code> variables must be available at{' '}
            <em>build time</em> for Next.js. Add them as env vars before deploying.
          </p>
        </Step>

        <Step n={6} title="Click Deploy">
          <p>
            Hit <strong className="text-foreground">Deploy</strong>. DropDeploy will:
          </p>
          <ol className="list-decimal list-inside space-y-1 mt-1">
            <li>Clone your repository at the selected branch</li>
            <li>Build a Docker image from the generated Dockerfile</li>
            <li>Scan the image for known vulnerabilities</li>
            <li>Start the container and assign a subdomain</li>
          </ol>
          <p className="mt-2">
            Watch the build log live — each step is shown as it completes.
            A typical build takes 1–4 minutes depending on framework and dependencies.
          </p>
        </Step>

        <div className="flex gap-5 pb-2">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
            <Check className="h-4 w-4 text-green-500" />
          </div>
          <div className="flex-1 pt-0.5">
            <h3 className="font-semibold text-base mb-1">Your project is live</h3>
            <p className="text-muted-foreground text-sm">
              Copy the URL from the project page and share it. The same URL is preserved on every future
              deployment — redeploy and it just updates in place.
            </p>
          </div>
        </div>
      </div>

      {/* Next steps */}
      <div className="border-t border-border pt-8 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Next</span>
        <Link
          href="/docs/git-setup"
          className="flex items-center gap-1.5 text-blue-500 font-medium hover:underline"
        >
          Git Setup
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
