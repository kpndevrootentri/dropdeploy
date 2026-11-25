// Shared by the *.test.ts files' fake API servers; excluded from the build like them (tsconfig.json).
import type { IncomingMessage } from 'node:http';

/** The multipart form a fake server received: `(await readForm(req)).get('name')` → `'My Site'`. */
export async function readForm(req: IncomingMessage): Promise<FormData> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new Response(Buffer.concat(chunks), { headers: { 'Content-Type': req.headers['content-type'] ?? '' } }).formData();
}
