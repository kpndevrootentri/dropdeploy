#!/usr/bin/env bash
# DropDeploy – development setup (PRD tech stack)

set -e

echo "DropDeploy – dev setup"
echo "Start PostgreSQL and Redis first: docker compose up -d --wait (or run your own and edit .env)."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example – set ENV_ENCRYPTION_KEY (openssl rand -hex 32) and JWT_SECRET."
fi

npm install
npx prisma generate
npx prisma db push --accept-data-loss 2>/dev/null || true

echo "Done. Run: npm run dev (and optionally npm run worker in another terminal)."
