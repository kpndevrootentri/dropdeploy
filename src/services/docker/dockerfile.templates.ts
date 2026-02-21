/**
 * Dockerfile templates per project type (PRD §5.4).
 */

export const DOCKERFILE_TEMPLATES = {
  STATIC: `
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`.trim(),

  NODEJS: `
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
`.trim(),

  NEXTJS: `
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

ARG {{NEXT_PUBLIC_BUILD_ARGS}}
ENV {{NEXT_PUBLIC_BUILD_ARGS}}={{NEXT_PUBLIC_BUILD_ARGS}}
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
`.trim(),

  DJANGO: `
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
`.trim(),

  REACT: `
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`.trim(),

  FASTAPI: `
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`.trim(),

  FLASK: `
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY . .
EXPOSE 5000
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:5000", "--workers", "2"]
`.trim(),

  VUE: `
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`.trim(),

  SVELTE: `
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`.trim(),
} as const;

export type DockerfileProjectType = keyof typeof DOCKERFILE_TEMPLATES;

/**
 * Container ports per project type — co-located with templates so adding
 * a new project type only requires changes in this one file.
 */
export const CONTAINER_PORTS: Record<DockerfileProjectType, number> = {
  STATIC:  80,
  NODEJS:  3000,
  NEXTJS:  3000,
  DJANGO:  8000,
  REACT:   80,
  FASTAPI: 8000,
  FLASK:   5000,
  VUE:     80,
  SVELTE:  80,
};

/**
 * Generates ARG + ENV lines for NEXT_PUBLIC_* variables so they're
 * available at Next.js build time. These are public by definition
 * (bundled into client JS), so embedding them in the image is safe.
 */
export function injectNextPublicBuildArgs(
  template: string,
  buildArgKeys: string[],
): string {
  const nextPublicKeys = buildArgKeys.filter((k) => k.startsWith('NEXT_PUBLIC_'));
  if (nextPublicKeys.length === 0) {
    return template.replace('{{NEXT_PUBLIC_BUILD_ARGS}}\n', '');
  }
  const lines = nextPublicKeys
    .map((key) => `ARG ${key}\nENV ${key}=$${key}`)
    .join('\n');
  return template.replace('{{NEXT_PUBLIC_BUILD_ARGS}}', lines);
}
