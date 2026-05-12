import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, ArrowLeft, AlertCircle, Info, Check, FileCode2 } from 'lucide-react';

interface Requirement { label: string; detail: string }
interface EnvVar { name: string; required: boolean; desc: string }
interface Gotcha { title: string; fix: string }
interface DemoFile { path: string; content: string }
interface DemoApp {
  quickstart?: string;
  files: DemoFile[];
  note?: string;
}

interface FrameworkDoc {
  title: string;
  subtitle: string;
  port: number;
  requires: Requirement[];
  demoApp: DemoApp;
  buildCmd: string;
  envVars?: EnvVar[];
  gotchas?: Gotcha[];
}

const FRAMEWORK_DOCS: Record<string, FrameworkDoc> = {
  static: {
    title: 'Static HTML',
    subtitle: 'Plain HTML, CSS, and JavaScript served by Nginx.',
    port: 80,
    requires: [
      { label: 'index.html in the repo root', detail: 'Nginx serves index.html as the entry point. All other assets (CSS, JS, images) can be in subdirectories.' },
      { label: 'No build step', detail: 'Files are copied directly into the Nginx image. No npm install or compilation happens.' },
    ],
    demoApp: {
      files: [
        {
          path: 'index.html',
          content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My App</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #0f172a;
      color: #f1f5f9;
    }
    .card {
      text-align: center;
      padding: 2rem 3rem;
      border: 1px solid #1e293b;
      border-radius: 12px;
    }
    h1 { color: #3b82f6; margin: 0 0 0.5rem; }
    p  { color: #94a3b8; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello from DropDeploy!</h1>
    <p>Your static site is live.</p>
  </div>
</body>
</html>`,
        },
      ],
      note: 'That is the entire project — just push this one file and deploy.',
    },
    buildCmd: `# No build step — files are served directly by Nginx`,
    gotchas: [
      { title: 'SPA client-side routing', fix: 'The default config does not redirect unknown paths to index.html. Single-page apps that use client-side routing need a custom nginx config. Use the React or Vue framework type instead.' },
      { title: 'All files are public', fix: 'Everything in your repo is copied into the image. Never commit secrets or private files.' },
    ],
  },

  nodejs: {
    title: 'Node.js',
    subtitle: 'Any Node.js server — Express, Fastify, Koa, or the built-in http module.',
    port: 3000,
    requires: [
      { label: 'package.json with a "start" script', detail: 'DropDeploy runs npm start to launch your server.' },
      { label: 'App must listen on port 3000', detail: 'Hard-code 3000 or read process.env.PORT.' },
    ],
    demoApp: {
      files: [
        {
          path: 'package.json',
          content: `{
  "name": "my-node-app",
  "version": "1.0.0",
  "scripts": {
    "start": "node index.js"
  }
}`,
        },
        {
          path: 'index.js',
          content: `const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(\`
    <html>
      <body style="font-family:system-ui;display:flex;justify-content:center;
                   align-items:center;min-height:100vh;margin:0;background:#0f172a;color:#f1f5f9">
        <div style="text-align:center">
          <h1 style="color:#3b82f6">Hello from DropDeploy!</h1>
          <p style="color:#94a3b8">Node.js server running on port \${PORT}</p>
        </div>
      </body>
    </html>
  \`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(\`Server running on http://0.0.0.0:\${PORT}\`);
});`,
        },
      ],
      note: 'No dependencies — uses Node\'s built-in http module. Swap it for Express if you prefer.',
    },
    buildCmd: `npm install --omit=dev
npm start`,
    envVars: [
      { name: 'PORT', required: false, desc: 'Defaults to 3000. Keep it at 3000 to match the Dockerfile.' },
      { name: 'NODE_ENV', required: false, desc: 'Set to production for prod-optimised behaviour.' },
    ],
    gotchas: [
      { title: 'Missing "start" script', fix: 'Add "start": "node index.js" to the scripts block in package.json.' },
      { title: 'App binds to 127.0.0.1', fix: 'Call server.listen(3000, "0.0.0.0"). Binding to localhost rejects connections from outside the container.' },
      { title: 'devDependencies at runtime', fix: 'DropDeploy runs npm install --omit=dev. Move any runtime-required package from devDependencies to dependencies.' },
    ],
  },

  nextjs: {
    title: 'Next.js',
    subtitle: 'Next.js App Router or Pages Router, with optional Prisma integration.',
    port: 3000,
    requires: [
      { label: 'next.config.js / .ts / .mjs in the root', detail: 'This file is how DropDeploy identifies your project as Next.js.' },
      { label: '"build" and "start" scripts in package.json', detail: '"build": "next build" and "start": "next start" must both be present.' },
    ],
    demoApp: {
      quickstart: 'npx create-next-app@latest my-next-app',
      files: [
        {
          path: 'next.config.js',
          content: `/** @type {import('next').NextConfig} */
const nextConfig = {};
module.exports = nextConfig;`,
        },
        {
          path: 'package.json',
          content: `{
  "name": "my-next-app",
  "version": "1.0.0",
  "scripts": {
    "dev":   "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next":      "^15.0.0",
    "react":     "^18.0.0",
    "react-dom": "^18.0.0"
  }
}`,
        },
        {
          path: 'app/page.tsx',
          content: `export default function Home() {
  return (
    <main style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      minHeight: '100vh', fontFamily: 'system-ui',
      background: '#0f172a', color: '#f1f5f9',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ color: '#3b82f6' }}>Hello from DropDeploy!</h1>
        <p style={{ color: '#94a3b8' }}>Next.js app is live.</p>
      </div>
    </main>
  );
}`,
        },
        {
          path: 'app/layout.tsx',
          content: `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
        },
      ],
      note: 'The quickstart command is the fastest path. The files above show the minimum required structure if you are building from scratch.',
    },
    buildCmd: `npm install
# if prisma/schema.prisma exists:
npx prisma generate
npm run build
npm start`,
    envVars: [
      { name: 'DATABASE_URL', required: false, desc: 'Runtime database connection string. Required if your app queries a DB.' },
      { name: 'NEXT_PUBLIC_*', required: false, desc: 'Baked into the client bundle at build time. Add them in the dashboard before deploying.' },
      { name: 'NEXTAUTH_SECRET', required: false, desc: 'Required if using NextAuth.' },
      { name: 'NEXTAUTH_URL', required: false, desc: 'Set to your full DropDeploy subdomain URL.' },
    ],
    gotchas: [
      { title: 'NEXT_PUBLIC_ vars are empty', fix: 'These are baked in at build time. Add them to the dashboard env vars before you click Deploy.' },
      { title: 'Prisma "PrismaClient did not initialize"', fix: 'Set DATABASE_URL as a runtime env var. The placeholder value used during the build is not a real connection.' },
      { title: 'output: "export" is not supported', fix: 'DropDeploy runs next start which requires a server. Remove output: "export" from next.config, or use the React framework type for fully static output.' },
    ],
  },

  react: {
    title: 'React (Vite)',
    subtitle: 'React apps built with Vite, served as static files by Nginx.',
    port: 80,
    requires: [
      { label: 'package.json with a "build" script', detail: '"build": "vite build". DropDeploy runs this and copies dist/ into Nginx.' },
      { label: 'Output goes to dist/', detail: 'Do not change the Vite output directory in vite.config.' },
    ],
    demoApp: {
      quickstart: 'npm create vite@latest my-react-app -- --template react',
      files: [
        {
          path: 'src/App.jsx',
          content: `export default function App() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      minHeight: '100vh', fontFamily: 'system-ui',
      background: '#0f172a', color: '#f1f5f9',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ color: '#3b82f6' }}>Hello from DropDeploy!</h1>
        <p style={{ color: '#94a3b8' }}>React + Vite app is live.</p>
      </div>
    </div>
  );
}`,
        },
        {
          path: 'src/main.jsx',
          content: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);`,
        },
        {
          path: 'index.html',
          content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`,
        },
      ],
      note: 'The quickstart command scaffolds everything. Edit src/App.jsx to build your app.',
    },
    buildCmd: `npm install
npm run build
# Output in dist/ is served by Nginx — no start command needed`,
    envVars: [
      { name: 'VITE_*', required: false, desc: 'Prefix env vars with VITE_ to expose them to the client bundle at build time.' },
    ],
    gotchas: [
      { title: 'Routes 404 on refresh', fix: 'Nginx is configured with try_files to serve index.html — React Router history mode works correctly.' },
      { title: 'Assets load with wrong paths', fix: 'DropDeploy passes --base=/ for absolute paths. Do not set a custom base in vite.config.' },
    ],
  },

  vue: {
    title: 'Vue (Vite)',
    subtitle: 'Vue 3 apps built with Vite, served as static files by Nginx.',
    port: 80,
    requires: [
      { label: 'package.json with a "build" script', detail: '"build": "vite build". Output goes to dist/.' },
      { label: 'Output goes to dist/', detail: 'Do not override the Vite output directory in vite.config.ts.' },
    ],
    demoApp: {
      quickstart: 'npm create vue@latest my-vue-app',
      files: [
        {
          path: 'src/App.vue',
          content: `<template>
  <div class="container">
    <h1>Hello from DropDeploy!</h1>
    <p>Vue 3 + Vite app is live.</p>
  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, sans-serif;
  background: #0f172a;
  color: #f1f5f9;
}
.container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  text-align: center;
  gap: 0.5rem;
}
h1 { color: #10b981; }
p  { color: #94a3b8; }
</style>`,
        },
        {
          path: 'src/main.js',
          content: `import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');`,
        },
      ],
      note: 'Run npm create vue@latest and follow the prompts. Replace src/App.vue with the file above to verify deployment.',
    },
    buildCmd: `npm install
npm run build
# Output in dist/ is served by Nginx — no start command needed`,
    envVars: [
      { name: 'VITE_*', required: false, desc: 'Prefix env vars with VITE_ to expose them at build time.' },
    ],
    gotchas: [
      { title: 'Vue Router history mode — 404 on refresh', fix: 'Nginx is configured with try_files so history mode works correctly.' },
    ],
  },

  svelte: {
    title: 'Svelte (Vite)',
    subtitle: 'Svelte apps built with Vite (create-svelte), served as static files by Nginx.',
    port: 80,
    requires: [
      { label: 'package.json with a "build" script that outputs to dist/', detail: 'Standard Svelte + Vite template does this. SvelteKit with adapter-node outputs to build/ — use Node.js framework for that.' },
    ],
    demoApp: {
      quickstart: 'npm create vite@latest my-svelte-app -- --template svelte',
      files: [
        {
          path: 'src/App.svelte',
          content: `<script>
  const message = 'Hello from DropDeploy!';
</script>

<main>
  <h1>{message}</h1>
  <p>Svelte + Vite app is live.</p>
</main>

<style>
  :global(body) {
    font-family: system-ui, sans-serif;
    background: #0f172a;
    color: #f1f5f9;
    margin: 0;
  }
  main {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    text-align: center;
    gap: 0.5rem;
  }
  h1 { color: #f97316; }
  p  { color: #94a3b8; }
</style>`,
        },
        {
          path: 'src/main.js',
          content: `import App from './App.svelte';

const app = new App({ target: document.getElementById('app') });

export default app;`,
        },
      ],
      note: 'Use the Vite Svelte template (not SvelteKit). For SvelteKit with adapter-node, use the Node.js framework type instead.',
    },
    buildCmd: `npm install
npm run build
# Output in dist/ is served by Nginx — no start command needed`,
    gotchas: [
      { title: 'SvelteKit with adapter-node', fix: 'Outputs to build/, not dist/. Use the Node.js framework type and set your start script to "node build".' },
    ],
  },

  django: {
    title: 'Django',
    subtitle: 'Django projects using the development server. Suitable for demos and internal tools.',
    port: 8000,
    requires: [
      { label: 'requirements.txt in the repo root with django', detail: 'DropDeploy runs pip install -r requirements.txt.' },
      { label: 'manage.py in the repo root', detail: 'DropDeploy identifies Django projects by manage.py and starts with it.' },
    ],
    demoApp: {
      quickstart: 'pip install django && django-admin startproject myproject . && python manage.py startapp hello',
      files: [
        {
          path: 'requirements.txt',
          content: `django>=4.2`,
        },
        {
          path: 'myproject/settings.py',
          content: `# Add to your existing settings.py:

import os

SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-only-secret-change-in-production')

DEBUG = os.environ.get('DEBUG', 'True') == 'True'

# Read allowed hosts from env var — include your DropDeploy subdomain
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')

INSTALLED_APPS = [
    'django.contrib.staticfiles',
    'hello',
    # ... other apps
]

ROOT_URLCONF = 'myproject.urls'`,
        },
        {
          path: 'myproject/urls.py',
          content: `from django.urls import path
from hello import views

urlpatterns = [
    path('', views.index),
]`,
        },
        {
          path: 'hello/views.py',
          content: `from django.http import HttpResponse

def index(request):
    html = """
    <html>
      <body style="font-family:system-ui;display:flex;justify-content:center;
                   align-items:center;min-height:100vh;margin:0;
                   background:#0f172a;color:#f1f5f9">
        <div style="text-align:center">
          <h1 style="color:#16a34a">Hello from DropDeploy!</h1>
          <p style="color:#94a3b8">Django app is live.</p>
        </div>
      </body>
    </html>
    """
    return HttpResponse(html)`,
        },
      ],
      note: 'Run the quickstart command from your project root to scaffold the project, then add the files above.',
    },
    buildCmd: `pip install -r requirements.txt
python manage.py runserver 0.0.0.0:8000`,
    envVars: [
      { name: 'SECRET_KEY', required: true, desc: 'Django requires a secret key. Never commit it — add via dashboard.' },
      { name: 'DEBUG', required: false, desc: 'Set to False in production.' },
      { name: 'ALLOWED_HOSTS', required: true, desc: 'Add your DropDeploy subdomain or Django returns 400 on every request.' },
      { name: 'DATABASE_URL', required: false, desc: 'Use dj-database-url to read this in settings.py.' },
    ],
    gotchas: [
      { title: 'DisallowedHost — 400 on every request', fix: 'Add your DropDeploy subdomain to ALLOWED_HOSTS, or read it from an env var as shown in the demo app.' },
      { title: 'Static files not loading', fix: 'The dev server does not serve staticfiles/ in production. Set DEBUG=True for demos, or add WhiteNoise.' },
    ],
  },

  fastapi: {
    title: 'FastAPI',
    subtitle: 'FastAPI applications served by Uvicorn.',
    port: 8000,
    requires: [
      { label: 'requirements.txt with fastapi and uvicorn', detail: 'DropDeploy runs pip install -r requirements.txt then starts uvicorn.' },
      { label: 'main.py in the repo root with app = FastAPI()', detail: 'DropDeploy runs uvicorn main:app. Module = main, instance = app.' },
    ],
    demoApp: {
      files: [
        {
          path: 'requirements.txt',
          content: `fastapi
uvicorn[standard]`,
        },
        {
          path: 'main.py',
          content: `from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI()

@app.get("/", response_class=HTMLResponse)
def root():
    return """
    <html>
      <body style="font-family:system-ui;display:flex;justify-content:center;
                   align-items:center;min-height:100vh;margin:0;
                   background:#0f172a;color:#f1f5f9">
        <div style="text-align:center">
          <h1 style="color:#0d9488">Hello from DropDeploy!</h1>
          <p style="color:#94a3b8">FastAPI app is live.</p>
        </div>
      </body>
    </html>
    """

@app.get("/api/health")
def health():
    return {"status": "ok"}`,
        },
      ],
      note: 'Two files — that\'s the entire deployable project. Push both and click Deploy.',
    },
    buildCmd: `pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000`,
    envVars: [
      { name: 'DATABASE_URL', required: false, desc: 'Pass to SQLAlchemy or databases for DB connections.' },
      { name: 'SECRET_KEY', required: false, desc: 'For JWT or session signing.' },
    ],
    gotchas: [
      { title: 'App object not at main:app', fix: 'If your FastAPI instance is in a different file or named differently, you need a custom Dockerfile.' },
      { title: 'Missing uvicorn in requirements.txt', fix: 'Add uvicorn[standard]. Without it the container fails to start.' },
    ],
  },

  flask: {
    title: 'Flask',
    subtitle: 'Flask applications served by Gunicorn.',
    port: 5000,
    requires: [
      { label: 'requirements.txt with flask', detail: 'DropDeploy also installs gunicorn automatically alongside your requirements.' },
      { label: 'app.py in the repo root with app = Flask(__name__)', detail: 'Gunicorn starts with app:app — module is app.py, instance is app.' },
    ],
    demoApp: {
      files: [
        {
          path: 'requirements.txt',
          content: `flask`,
        },
        {
          path: 'app.py',
          content: `from flask import Flask

app = Flask(__name__)

@app.route('/')
def hello():
    return """
    <html>
      <body style="font-family:system-ui;display:flex;justify-content:center;
                   align-items:center;min-height:100vh;margin:0;
                   background:#0f172a;color:#f1f5f9">
        <div style="text-align:center">
          <h1 style="color:#a3a3a3">Hello from DropDeploy!</h1>
          <p style="color:#94a3b8">Flask app is live.</p>
        </div>
      </body>
    </html>
    """

@app.route('/api/health')
def health():
    return {'status': 'ok'}`,
        },
      ],
      note: 'Two files — requirements.txt and app.py. Gunicorn is installed automatically by DropDeploy.',
    },
    buildCmd: `pip install -r requirements.txt gunicorn
gunicorn app:app --bind 0.0.0.0:5000 --workers 2`,
    envVars: [
      { name: 'SECRET_KEY', required: true, desc: 'Required for sessions and flash messages.' },
      { name: 'DATABASE_URL', required: false, desc: 'Pass to Flask-SQLAlchemy or another ORM.' },
    ],
    gotchas: [
      { title: 'Flask app not named app', fix: 'If your Flask instance is named server, update gunicorn to app:server.' },
      { title: 'Debug mode in production', fix: 'Gunicorn ignores app.run(debug=True) but it\'s still a security risk. Remove it.' },
    ],
  },

  go: {
    title: 'Go',
    subtitle: 'Go applications compiled to a static binary and served from Alpine Linux.',
    port: 8080,
    requires: [
      { label: 'go.mod in the repo root', detail: 'DropDeploy runs go build from the root of your repo.' },
      { label: 'go.sum committed to the repo', detail: 'Required for go mod download to reproduce the dependency tree.' },
      { label: 'App listens on port 8080', detail: 'Hard-code :8080 or read os.Getenv("PORT").' },
      { label: 'Main package in the repo root', detail: 'go build -o /app/server . compiles the root package.' },
    ],
    demoApp: {
      quickstart: 'mkdir my-go-app && cd my-go-app && go mod init my-go-app',
      files: [
        {
          path: 'go.mod',
          content: `module my-go-app

go 1.22`,
        },
        {
          path: 'main.go',
          content: `package main

import (
\t"fmt"
\t"log"
\t"net/http"
\t"os"
)

func handler(w http.ResponseWriter, r *http.Request) {
\tw.Header().Set("Content-Type", "text/html")
\tfmt.Fprintln(w, \`
<html>
  <body style="font-family:system-ui;display:flex;justify-content:center;
               align-items:center;min-height:100vh;margin:0;
               background:#0f172a;color:#f1f5f9">
    <div style="text-align:center">
      <h1 style="color:#06b6d4">Hello from DropDeploy!</h1>
      <p style="color:#94a3b8">Go server is live.</p>
    </div>
  </body>
</html>\`)
}

func main() {
\tport := os.Getenv("PORT")
\tif port == "" {
\t\tport = "8080"
\t}

\thttp.HandleFunc("/", handler)
\thttp.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
\t\tfmt.Fprintln(w, \`{"status":"ok"}\`)
\t})

\tlog.Printf("Server running on :%s", port)
\tlog.Fatal(http.ListenAndServe(":"+port, nil))
}`,
        },
      ],
      note: 'No external dependencies — uses Go\'s built-in net/http. Run go mod tidy after creating go.mod.',
    },
    buildCmd: `go mod download
CGO_ENABLED=0 GOOS=linux go build -o server .
./server`,
    envVars: [
      { name: 'PORT', required: false, desc: 'Read with os.Getenv("PORT"). Defaults to 8080 if you hard-code it.' },
    ],
    gotchas: [
      { title: 'Main package not in repo root', fix: 'If your main is at cmd/server/main.go, change the build command to go build ./cmd/server. This requires a custom Dockerfile.' },
      { title: 'CGO dependencies', fix: 'CGO_ENABLED=0 disables cgo. If your app uses cgo (e.g. sqlite3), use a different base image.' },
    ],
  },

  rust: {
    title: 'Rust',
    subtitle: 'Rust applications compiled in release mode and served from Debian Slim.',
    port: 8080,
    requires: [
      { label: 'Cargo.toml in the repo root', detail: 'DropDeploy runs cargo build --release.' },
      { label: 'Cargo.lock committed to the repo', detail: 'For reproducible builds.' },
      { label: 'App listens on port 8080', detail: 'Bind to 0.0.0.0:8080.' },
    ],
    demoApp: {
      quickstart: 'cargo new my-rust-app && cd my-rust-app',
      files: [
        {
          path: 'Cargo.toml',
          content: `[package]
name = "my-rust-app"
version = "0.1.0"
edition = "2021"

[dependencies]
actix-web = "4"`,
        },
        {
          path: 'src/main.rs',
          content: `use actix_web::{web, App, HttpServer, HttpResponse, Responder};

async fn hello() -> impl Responder {
    HttpResponse::Ok()
        .content_type("text/html")
        .body(r#"
<html>
  <body style="font-family:system-ui;display:flex;justify-content:center;
               align-items:center;min-height:100vh;margin:0;
               background:#0f172a;color:#f1f5f9">
    <div style="text-align:center">
      <h1 style="color:#f97316">Hello from DropDeploy!</h1>
      <p style="color:#94a3b8">Rust + Actix-Web server is live.</p>
    </div>
  </body>
</html>"#)
}

async fn health() -> impl Responder {
    web::Json(serde_json::json!({ "status": "ok" }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .unwrap_or(8080);

    println!("Server running on port {port}");

    HttpServer::new(|| {
        App::new()
            .route("/", web::get().to(hello))
            .route("/health", web::get().to(health))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}`,
        },
      ],
      note: 'Add serde_json = "1" to Cargo.toml dependencies if you want the health endpoint. Actix-Web is the most popular Rust web framework.',
    },
    buildCmd: `cargo build --release
./target/release/<your-binary-name>`,
    envVars: [
      { name: 'PORT', required: false, desc: 'Read with std::env::var("PORT"). Defaults to 8080.' },
      { name: 'DATABASE_URL', required: false, desc: 'Pass to sqlx or diesel for DB connections.' },
    ],
    gotchas: [
      { title: 'Build takes 5–15 minutes', fix: 'Rust compilation is slow on first build. Docker layer caching makes later deploys faster. This is normal.' },
      { title: 'Multiple binaries in the workspace', fix: 'DropDeploy picks the first executable in target/release/. Make sure your server binary is the only one, or it is the first alphabetically.' },
    ],
  },

  java: {
    title: 'Java / Spring Boot',
    subtitle: 'Spring Boot applications built with Maven and run on Eclipse Temurin JRE 21.',
    port: 8080,
    requires: [
      { label: 'pom.xml in the repo root', detail: 'DropDeploy uses Maven (mvn package) to build. Gradle is not yet supported.' },
      { label: 'Spring Boot with embedded Tomcat', detail: 'The JAR must be self-executable. Standard Spring Boot starters include this.' },
      { label: 'App listens on port 8080', detail: 'Spring Boot defaults to 8080. Do not change server.port unless you also update the Dockerfile.' },
    ],
    demoApp: {
      quickstart: 'Go to start.spring.io — select Maven, Java 21, add Spring Web dependency, and download.',
      files: [
        {
          path: 'pom.xml',
          content: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
                             https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.0</version>
  </parent>

  <groupId>com.example</groupId>
  <artifactId>demo</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <name>demo</name>

  <properties>
    <java.version>21</java.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>`,
        },
        {
          path: 'src/main/java/com/example/demo/DemoApplication.java',
          content: `package com.example.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class DemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}`,
        },
        {
          path: 'src/main/java/com/example/demo/HelloController.java',
          content: `package com.example.demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HelloController {

    @GetMapping("/")
    public String hello() {
        return """
            <html>
              <body style="font-family:system-ui;display:flex;justify-content:center;
                           align-items:center;min-height:100vh;margin:0;
                           background:#0f172a;color:#f1f5f9">
                <div style="text-align:center">
                  <h1 style="color:#ef4444">Hello from DropDeploy!</h1>
                  <p style="color:#94a3b8">Spring Boot app is live.</p>
                </div>
              </body>
            </html>
            """;
    }

    @GetMapping("/api/health")
    public java.util.Map<String, String> health() {
        return java.util.Map.of("status", "ok");
    }
}`,
        },
      ],
      note: 'Use start.spring.io for the fastest setup. The pom.xml above is a minimal working alternative if you prefer to build from scratch.',
    },
    buildCmd: `mvn dependency:go-offline -q
mvn package -DskipTests -q
java -jar target/*.jar`,
    envVars: [
      { name: 'SPRING_DATASOURCE_URL', required: false, desc: 'JDBC connection string (e.g. jdbc:postgresql://host:5432/db).' },
      { name: 'SPRING_DATASOURCE_USERNAME', required: false, desc: 'Database username.' },
      { name: 'SPRING_DATASOURCE_PASSWORD', required: false, desc: 'Database password — always via env var.' },
      { name: 'SERVER_PORT', required: false, desc: 'Defaults to 8080. Change only if you update the Dockerfile accordingly.' },
    ],
    gotchas: [
      { title: 'Build takes 5–10 minutes on first deploy', fix: 'mvn dependency:go-offline downloads all deps. Docker caching makes future deploys faster.' },
      { title: 'Multiple JARs in target/', fix: 'Maven outputs both the main JAR and original-*.jar. COPY target/*.jar fails if multiple exist. The spring-boot-maven-plugin should produce just one executable JAR by default.' },
      { title: 'Tests failing during build', fix: 'DropDeploy passes -DskipTests so tests do not run. Run tests locally before deploying.' },
    ],
  },
};

const SLUG_ORDER = ['static', 'nodejs', 'nextjs', 'react', 'vue', 'svelte', 'django', 'fastapi', 'flask', 'go', 'rust', 'java'];

function Code({ children }: { children: React.ReactNode }): React.ReactElement {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">{children}</code>;
}

function Pre({ children }: { children: string }): React.ReactElement {
  return (
    <pre className="rounded-lg border border-border bg-muted/60 p-4 overflow-x-auto text-sm font-mono leading-relaxed">
      {children}
    </pre>
  );
}

function Callout({ type = 'info', children }: { type?: 'info' | 'warn'; children: React.ReactNode }): React.ReactElement {
  return (
    <div className={`flex gap-3 rounded-lg border p-4 text-sm ${type === 'warn' ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-blue-500/30 bg-blue-500/5'}`}>
      {type === 'warn'
        ? <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
        : <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />}
      <div className="text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = FRAMEWORK_DOCS[slug];
  if (!doc) return { title: 'Framework Docs — DropDeploy' };
  return { title: `${doc.title} — DropDeploy Docs` };
}

export function generateStaticParams() {
  return SLUG_ORDER.map((slug) => ({ slug }));
}

export default async function FrameworkPage({ params }: PageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  const doc = FRAMEWORK_DOCS[slug];
  if (!doc) notFound();

  const idx = SLUG_ORDER.indexOf(slug);
  const prevSlug = idx > 0 ? SLUG_ORDER[idx - 1] : null;
  const nextSlug = idx < SLUG_ORDER.length - 1 ? SLUG_ORDER[idx + 1] : null;
  const prevDoc = prevSlug ? FRAMEWORK_DOCS[prevSlug] : null;
  const nextDoc = nextSlug ? FRAMEWORK_DOCS[nextSlug] : null;

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-500 mb-2">Framework</p>
        <h1 className="text-3xl font-bold tracking-tight mb-3">{doc.title}</h1>
        <p className="text-muted-foreground leading-relaxed">{doc.subtitle}</p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-sm">
          <span className="text-muted-foreground">Container port</span>
          <Code>{doc.port}</Code>
        </div>
      </div>

      {/* Requirements */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Requirements</h2>
        <div className="rounded-xl border border-border bg-card divide-y divide-border text-sm">
          {doc.requires.map((req) => (
            <div key={req.label} className="flex gap-3 px-5 py-4">
              <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">{req.label}</p>
                <p className="text-muted-foreground text-xs leading-relaxed mt-0.5">{req.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Demo app */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-5 w-5 text-blue-500" />
          <h2 className="text-xl font-semibold">Demo app</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          A minimal app that is ready to push and deploy. Copy the files below into a new repository,
          commit, and deploy — it should go live without any changes.
        </p>

        {doc.demoApp.quickstart && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Quickstart</p>
            <Pre>{doc.demoApp.quickstart}</Pre>
          </div>
        )}

        <div className="space-y-4">
          {doc.demoApp.files.map((file) => (
            <div key={file.path} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
                  {file.path}
                </span>
              </div>
              <Pre>{file.content}</Pre>
            </div>
          ))}
        </div>

        {doc.demoApp.note && (
          <Callout type="info">{doc.demoApp.note}</Callout>
        )}
      </section>

      {/* Build commands */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Build &amp; start commands</h2>
        <p className="text-sm text-muted-foreground">
          DropDeploy runs these steps inside the container when you click Deploy.
        </p>
        <Pre>{doc.buildCmd}</Pre>
      </section>

      {/* Env vars */}
      {doc.envVars && doc.envVars.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Environment variables</h2>
          <p className="text-sm text-muted-foreground">
            Set these in <strong className="text-foreground">Project → Env Vars</strong> in the dashboard. Never commit secrets.
          </p>
          <div className="rounded-xl border border-border overflow-hidden text-sm">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="text-left px-4 py-2.5 font-medium text-foreground">Variable</th>
                  <th className="text-left px-4 py-2.5 font-medium text-foreground">Required</th>
                  <th className="text-left px-4 py-2.5 font-medium text-foreground">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {doc.envVars.map((ev) => (
                  <tr key={ev.name}>
                    <td className="px-4 py-3 font-mono text-xs text-foreground whitespace-nowrap">{ev.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{ev.required ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground leading-relaxed">{ev.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Gotchas */}
      {doc.gotchas && doc.gotchas.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Common issues</h2>
          <div className="space-y-3">
            {doc.gotchas.map((g) => (
              <Callout key={g.title} type="warn">
                <p className="font-medium text-foreground mb-1">{g.title}</p>
                <p>{g.fix}</p>
              </Callout>
            ))}
          </div>
        </section>
      )}

      {/* Navigation */}
      <div className="border-t border-border pt-8 flex items-center justify-between text-sm">
        {prevDoc ? (
          <Link href={`/docs/frameworks/${prevSlug}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            {prevDoc.title}
          </Link>
        ) : (
          <Link href="/docs/local-dev" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Local Development
          </Link>
        )}
        {nextDoc ? (
          <Link href={`/docs/frameworks/${nextSlug}`} className="flex items-center gap-1.5 text-blue-500 font-medium hover:underline">
            {nextDoc.title}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
