type Field = [number, number | Buffer];

/** The top-level fields of a protobuf message, in order: varints as numbers, length-delimited fields as bytes. */
function fields(buf: Buffer): Field[] {
  const out: Field[] = [];
  let i = 0;
  const varint = (): number => {
    let n = 0;
    for (let shift = 0; i < buf.length; shift += 7) {
      const byte = buf[i++];
      n += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) break;
    }
    return n;
  };
  while (i < buf.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) out.push([field, varint()]);
    else if (wire === 2) {
      const length = varint();
      out.push([field, buf.subarray(i, (i += length))]);
    } else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else break; // BuildKit sends no groups; stop rather than misread the rest.
  }
  return out;
}

const bytes = (message: Field[], field: number): Buffer[] =>
  message.filter(([f, v]) => f === field && Buffer.isBuffer(v)).map(([, v]) => v as Buffer);
const text = (message: Field[], field: number): string => bytes(message, field).pop()?.toString('utf8') ?? '';

/**
 * The text of one BuildKit progress event in a `/build` stream
 * (`{"id":"moby.buildkit.trace","aux":<base64>}`): each step as it starts or
 * is taken from the cache, step errors, and the steps' output. The aux is a
 * protobuf moby.buildkit.v1.StatusResponse; only those fields are read, so
 * pull progress and warnings are left out. dockerode 5.0.1's own decoder
 * prints the steps' output base64-encoded.
 */
export function buildkitTraceText(aux: string): string {
  const status = fields(Buffer.from(aux, 'base64'));
  const lines: string[] = [];
  // Vertex: 3 name, 4 cached, 5 started, 6 completed, 7 error.
  for (const vertex of bytes(status, 1).map(fields)) {
    const error = text(vertex, 7);
    const completed = bytes(vertex, 6).length > 0;
    if (error) lines.push(`ERROR: ${error}`);
    else if (completed && vertex.some(([f, v]) => f === 4 && v === 1)) lines.push(`CACHED ${text(vertex, 3)}`);
    else if (!completed && bytes(vertex, 5).length > 0) lines.push(text(vertex, 3));
  }
  // VertexLog: 4 msg, a chunk of a step's stdout or stderr.
  for (const log of bytes(status, 3).map(fields)) {
    const msg = text(log, 4).trimEnd();
    if (msg) lines.push(msg);
  }
  return lines.filter(Boolean).map((line) => `${line}\n`).join('');
}
