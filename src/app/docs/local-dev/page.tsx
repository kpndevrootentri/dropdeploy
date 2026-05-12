import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ArrowLeft, Info } from 'lucide-react';

export const metadata: Metadata = { title: 'Local Development — DropDeploy Docs' };

function Code({ children }: { children: React.ReactNode }): React.ReactElement {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">{children}</code>;
}

function Pre({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <pre className="rounded-lg border border-border bg-muted/60 p-4 overflow-x-auto text-sm font-mono leading-relaxed mt-3">
      {children}
    </pre>
  );
}

function Callout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm">
      <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
      <div className="text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}

const PORT_TABLE = [
  { framework: 'Static HTML',       slug: 'static',  port: 80 },
  { framework: 'Node.js',           slug: 'nodejs',  port: 3000 },
  { framework: 'Next.js',           slug: 'nextjs',  port: 3000 },
  { framework: 'React (Vite)',      slug: 'react',   port: 80 },
  { framework: 'Vue (Vite)',        slug: 'vue',     port: 80 },
  { framework: 'Svelte (Vite)',     slug: 'svelte',  port: 80 },
  { framework: 'Django',            slug: 'django',  port: 8000 },
  { framework: 'FastAPI',           slug: 'fastapi', port: 8000 },
  { framework: 'Flask',             slug: 'flask',   port: 5000 },
  { framework: 'Go',                slug: 'go',      port: 8080 },
  { framework: 'Rust',              slug: 'rust',    port: 8080 },
  { framework: 'Java / Spring Boot',slug: 'java',    port: 8080 },
];

export default function LocalDevPage(): React.ReactElement {
  return (
    <div className="space-y-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-500 mb-2">Getting Started</p>
        <h1 className="text-3xl font-bold tracking-tight mb-3">Local Development</h1>
        <p className="text-muted-foreground leading-relaxed">
          The best way to catch build errors before deploying is to run the same Docker build locally.
          DropDeploy generates a Dockerfile for your project — you can test it yourself with two commands.
        </p>
      </div>

      {/* Install Docker */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Install Docker</h2>
        <p className="text-sm text-muted-foreground">
          Docker Desktop is available for Mac, Windows, and Linux at{' '}
          <a
            href="https://docs.docker.com/get-docker/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            docs.docker.com/get-docker
          </a>. Verify it works:
        </p>
        <Pre>{`docker --version`}</Pre>
      </section>

      {/* Get the Dockerfile */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. Get the Dockerfile</h2>
        <p className="text-sm text-muted-foreground">
          DropDeploy generates the Dockerfile automatically — you do not need one in your repo.
          But to test locally, find your framework in the{' '}
          <Link href="/docs/frameworks/nextjs" className="text-blue-500 hover:underline">Frameworks</Link>{' '}
          section, copy the Dockerfile shown there, and save it as <Code>Dockerfile</Code> in your project root.
        </p>
        <Callout>
          Delete the local <Code>Dockerfile</Code> after testing. DropDeploy generates its own at deploy time and
          ignores any Dockerfile in your repo.
        </Callout>
      </section>

      {/* Build and run */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. Build and run</h2>
        <p className="text-sm text-muted-foreground">
          Run these two commands from your project root:
        </p>
        <Pre>{`docker build -t my-app .
docker run --rm -p 8080:<CONTAINER_PORT> my-app`}</Pre>
        <p className="text-sm text-muted-foreground">
          Replace <Code>&lt;CONTAINER_PORT&gt;</Code> with the port your framework uses (see the table below).
          Then open <Code>http://localhost:8080</Code> in your browser.
        </p>
        <Callout>
          If you have environment variables, pass them with <Code>-e KEY=value</Code> or{' '}
          <Code>--env-file .env</Code>:
          <Pre>{`docker run --rm -p 8080:3000 --env-file .env my-app`}</Pre>
        </Callout>
      </section>

      {/* Port reference */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Container port reference</h2>
        <p className="text-sm text-muted-foreground">
          Use this table to fill in <Code>&lt;CONTAINER_PORT&gt;</Code> above.
        </p>
        <div className="rounded-xl border border-border overflow-hidden text-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left px-4 py-2.5 font-medium text-foreground">Framework</th>
                <th className="text-left px-4 py-2.5 font-medium text-foreground">Container port</th>
                <th className="text-left px-4 py-2.5 font-medium text-foreground">Example run command</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PORT_TABLE.map((row) => (
                <tr key={row.slug} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 text-muted-foreground">
                    <Link href={`/docs/frameworks/${row.slug}`} className="text-foreground hover:text-blue-500 transition-colors">
                      {row.framework}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-muted-foreground">{row.port}</td>
                  <td className="px-4 py-2.5 font-mono text-muted-foreground text-xs">
                    {`docker run -p 8080:${row.port} my-app`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Common issues */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Common build errors</h2>
        <div className="rounded-xl border border-border bg-card divide-y divide-border text-sm">
          {[
            {
              error: 'COPY failed: file not found',
              fix: 'The file referenced in the Dockerfile does not exist at that path in your repo. Check spelling and that the file is committed to git (not in .gitignore).',
            },
            {
              error: 'npm ERR! missing script: start',
              fix: 'Your package.json has no "start" script. Add one: "start": "node index.js" (or whatever starts your server).',
            },
            {
              error: 'Error: listen EADDRINUSE',
              fix: 'The port your app binds to does not match what the Dockerfile EXPOSEs. Check your app listens on the correct port.',
            },
            {
              error: 'Build takes >10 minutes',
              fix: 'Rust and Java builds can be slow. This is normal on first run — Docker layer caching makes subsequent builds faster.',
            },
            {
              error: 'Container exits immediately',
              fix: 'Your app is crashing on startup. Run docker run -it my-app sh and inspect the container, or check the build log output for panics/errors.',
            },
          ].map((row) => (
            <div key={row.error} className="px-5 py-4">
              <Code>{row.error}</Code>
              <p className="mt-1.5 text-muted-foreground text-xs leading-relaxed">{row.fix}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-border pt-8 flex items-center justify-between text-sm">
        <Link href="/docs/git-setup" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Git Setup
        </Link>
        <Link href="/docs/frameworks/static" className="flex items-center gap-1.5 text-blue-500 font-medium hover:underline">
          Framework Docs
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
