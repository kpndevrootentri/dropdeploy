import { demuxLogs } from '@/lib/container-logs';

/** One frame of Docker's multiplexed log stream: 1 = stdout, 2 = stderr. */
const frame = (stream: number, text: string): Buffer => {
  const payload = Buffer.from(text);
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

describe('demuxLogs', () => {
  it('joins stdout and stderr frames in order, without their headers', () => {
    const raw = Buffer.concat([frame(1, 'started\n'), frame(2, 'warning: x\n'), frame(1, 'listening\n')]);
    expect(demuxLogs(raw)).toBe('started\nwarning: x\nlistening\n');
  });

  it('passes TTY output, which has no headers, through as is', () => {
    expect(demuxLogs(Buffer.from('2026-11-10T00:00:00Z hello\n'))).toBe('2026-11-10T00:00:00Z hello\n');
  });

  it('keeps what arrived of a frame cut short', () => {
    expect(demuxLogs(frame(1, 'complete line\n').subarray(0, 12))).toBe('comp');
  });

  it('returns an empty string for no output', () => {
    expect(demuxLogs(Buffer.alloc(0))).toBe('');
  });

  it('keeps only the newest output past the cap, from a whole line', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}\n`);
    const out = demuxLogs(Buffer.concat(lines.map((l) => frame(1, l))), 50);
    expect(out.startsWith('[earlier output truncated]\n')).toBe(true);
    const kept = out.slice('[earlier output truncated]\n'.length);
    expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(50);
    expect(kept.endsWith('line 99\n')).toBe(true);
    expect(lines).toContain(kept.split('\n')[0] + '\n');
  });
});
