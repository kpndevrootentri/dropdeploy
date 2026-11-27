// tar-fs ships no types; this covers only what build-context.ts uses.
declare module 'tar-fs' {
  import type { Readable } from 'stream';

  export function pack(cwd: string, opts?: { ignore?: (absPath: string) => boolean }): Readable;
}
