import { readFile } from 'fs/promises';
import { join } from 'path';
import { NextResponse } from 'next/server';

// Serves /llms-full.txt — all DropDeploy documentation merged into one file
// for LLMs that can consume larger context windows (llmstxt.org spec).
export async function GET(): Promise<NextResponse> {
  const docsDir = join(process.cwd(), 'docs');

  const files = [
    { label: 'llms.txt (index)', path: join(process.cwd(), 'public', 'llms.txt') },
    { label: 'HOW-IT-WORKS.md', path: join(docsDir, 'HOW-IT-WORKS.md') },
    { label: 'ARCHITECTURE.md', path: join(docsDir, 'ARCHITECTURE.md') },
    { label: 'deploy.md (Claude Code skill)', path: join(process.cwd(), 'public', 'deploy.md') },
  ];

  const sections = await Promise.all(
    files.map(async ({ label, path }) => {
      const content = await readFile(path, 'utf-8');
      return `<!-- ${label} -->\n\n${content}`;
    }),
  );

  const body = sections.join('\n\n---\n\n');

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
