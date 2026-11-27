jest.mock('@/lib/prisma', () => ({ prisma: { deployment: { findMany: jest.fn(async () => []) } } }));
const mockLogError = jest.fn();
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: (...args: unknown[]) => mockLogError(...args) }),
}));

process.env.NEXT_PUBLIC_APP_URL = 'https://dash.test/';

/* eslint-disable @typescript-eslint/no-require-imports */
const { ContainerHealthService } = require('@/services/health/container-health.service');
const { DeploymentRepository } = require('@/repositories/deployment.repository');
const { answersHttp } = require('@/services/docker/docker.service');
const { prisma } = require('@/lib/prisma');
/* eslint-enable @typescript-eslint/no-require-imports */
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { OutgoingEmail } from '@/services/email';

const T0 = new Date('2026-11-27T10:00:00Z');
const UPDATED = new Date('2026-11-01T00:00:00Z');
const MIN = 60_000;
const RUNNING = { status: 'running', running: true, ports: [{ hostPort: 4001, containerPort: 3000 }] };
const NO_ANSWER = 'The app is running but did not answer within 10 s.';

type HealthRow = { containerPort: number; project: Record<string, unknown> & { id: string; user: Record<string, unknown> } };

function row(id = 'p1', over: Record<string, unknown> = {}): HealthRow {
  return {
    containerPort: 4001,
    project: {
      id, slug: `site-${id}`, stoppedAt: null, unhealthySince: null, healthReason: null, healthAlertedAt: null,
      updatedAt: UPDATED, user: { email: `${id}@entri.me`, suspendedAt: null }, ...over,
    },
  };
}

/** The repositories write back into `rows`, so each sweep reads what the last one wrote. */
function setup(rows: HealthRow[], { info = RUNNING as object | null, answers = true } = {}) {
  let clock = T0;
  const projects = {
    setHealth: jest.fn(async (id: string, data: object) => { Object.assign(rows.find((r) => r.project.id === id)!.project, data); }),
  };
  const deployments = { findLiveContainers: jest.fn(async () => rows) };
  const docker = { getContainerInfo: jest.fn<Promise<object | null>, [string]>(async () => info) };
  const probe = jest.fn(async () => answers);
  const email = { send: jest.fn<Promise<boolean>, [OutgoingEmail]>(async () => true) };
  const service = new ContainerHealthService(deployments, projects, docker, probe, email, () => clock);
  const sweeps = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await service.sweep();
      clock = new Date(clock.getTime() + MIN);
    }
  };
  const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };
  return { service, projects, deployments, docker, probe, email, sweeps, advance };
}

beforeEach(() => mockLogError.mockClear());

describe('ContainerHealthService.sweep', () => {
  it('leaves a running container that answers alone', async () => {
    const { projects, probe, email, docker, sweeps } = setup([row()]);
    await sweeps(3);
    expect(docker.getContainerInfo).toHaveBeenCalledWith('dropdeploy-site-p1');
    expect(probe).toHaveBeenCalledWith(4001, 10_000);
    expect(projects.setHealth).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('marks a site down on its 3rd failed check in a row and emails the owner once', async () => {
    const { projects, email, sweeps } = setup([row()], { answers: false });
    await sweeps(2);
    expect(projects.setHealth).not.toHaveBeenCalled();
    await sweeps(3);
    expect(projects.setHealth).toHaveBeenCalledTimes(1);
    expect(projects.setHealth).toHaveBeenCalledWith('p1', {
      unhealthySince: T0, healthReason: NO_ANSWER, healthAlertedAt: new Date(T0.getTime() + 2 * MIN), updatedAt: UPDATED,
    });
    expect(email.send).toHaveBeenCalledTimes(1);
    const sent = email.send.mock.calls[0][0];
    expect(sent).toMatchObject({ to: 'p1@entri.me', kind: 'health', subject: 'Your site site-p1.app.test is down' });
    expect(sent.text).toContain('https://dash.test/projects/p1');
    expect(sent.text).toContain(NO_ANSWER);
  });

  it('clears Down on the first answer, and emails a second incident only after 24 h', async () => {
    const rows = [row()];
    const { projects, probe, email, sweeps, advance } = setup(rows, { answers: false });
    await sweeps(3);
    probe.mockResolvedValue(true);
    await sweeps(1);
    expect(rows[0].project).toMatchObject({ unhealthySince: null, healthReason: null });
    expect(projects.setHealth).toHaveBeenLastCalledWith('p1', { unhealthySince: null, healthReason: null, updatedAt: UPDATED });

    probe.mockResolvedValue(false);
    await sweeps(3);
    expect(rows[0].project.unhealthySince).not.toBeNull();
    expect(email.send).toHaveBeenCalledTimes(1);

    probe.mockResolvedValue(true);
    await sweeps(1);
    advance(24 * 60 * MIN);
    probe.mockResolvedValue(false);
    await sweeps(3);
    expect(email.send).toHaveBeenCalledTimes(2);
  });

  it('never checks a site an admin stopped, and clears its old Down', async () => {
    const rows = [row('p1', { stoppedAt: T0, unhealthySince: T0, healthReason: NO_ANSWER })];
    const { projects, docker, probe, email, sweeps } = setup(rows, { answers: false });
    await sweeps(4);
    expect(docker.getContainerInfo).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
    expect(projects.setHealth).toHaveBeenCalledTimes(1);
    expect(rows[0].project.unhealthySince).toBeNull();
  });

  it.each([
    ['a crash loop', { ...RUNNING, status: 'restarting' }, 'The app keeps crashing and Docker is restarting it.'],
    ['a missing container', null, "The site's container is missing."],
    ['an exited container', { ...RUNNING, status: 'exited', running: false }, "The app's container has stopped (exited)."],
    ['a container publishing another port', { ...RUNNING, ports: [{ hostPort: 5432, containerPort: 3000 }] }, "The site's container is not the one its live deployment started."],
  ])('reports %s without probing', async (_label, info, reason) => {
    const rows = [row()];
    const { probe, sweeps } = setup(rows, { info });
    await sweeps(3);
    expect(probe).not.toHaveBeenCalled();
    expect(rows[0].project.healthReason).toBe(reason);
  });

  it('aborts with no writes when Docker itself fails', async () => {
    const rows = [row('p1', { unhealthySince: T0, healthReason: NO_ANSWER }), row('p2'), row('p3', { stoppedAt: T0, unhealthySince: T0 })];
    const { service, projects, docker, email } = setup(rows);
    docker.getContainerInfo.mockImplementation(async (name: string) => {
      if (name === 'dropdeploy-site-p2') throw new Error('connect ENOENT /var/run/docker.sock');
      return RUNNING;
    });
    await expect(service.sweep()).rejects.toThrow('ENOENT');
    expect(projects.setHealth).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('marks but does not email when 5 sites go down at once', async () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => row(id));
    const { email, sweeps } = setup(rows, { answers: false });
    await sweeps(3);
    expect(rows.every((r) => r.project.unhealthySince !== null)).toBe(true);
    expect(email.send).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith('Possible platform outage', { slugs: ['site-a', 'site-b', 'site-c', 'site-d', 'site-e'] });
  });

  it("marks a suspended owner's site but does not email them", async () => {
    const rows = [row('p1', { user: { email: 'p1@entri.me', suspendedAt: T0 } })];
    const { email, sweeps } = setup(rows, { answers: false });
    await sweeps(3);
    expect(rows[0].project.unhealthySince).toEqual(T0);
    expect(rows[0].project.healthAlertedAt).toBeNull();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('starts a fresh streak when a redeploy moves the site to a new port', async () => {
    const rows = [row()];
    const { projects, email, sweeps } = setup(rows, { answers: false });
    await sweeps(3);
    // activate(): the new deployment is live on 4002 and Down is cleared, while
    // dropdeploy-<slug> is still the old container on 4001 until promoteContainer swaps it.
    rows[0].containerPort = 4002;
    Object.assign(rows[0].project, { unhealthySince: null, healthReason: null });
    projects.setHealth.mockClear();
    email.send.mockClear();
    await sweeps(1);
    expect(projects.setHealth).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('returns at once when a sweep is already running', async () => {
    const { service, deployments } = setup([row()]);
    await Promise.all([service.sweep(), service.sweep()]);
    expect(deployments.findLiveContainers).toHaveBeenCalledTimes(1);
  });
});

describe('answersHttp', () => {
  it('closes the connection once the status arrives, even while the body keeps streaming', async () => {
    let closed!: Promise<string>;
    const server = http.createServer((_req, res) => {
      closed = new Promise((resolve) => res.once('close', () => resolve('closed')));
      res.writeHead(200);
      const trickle = setInterval(() => res.write('x'), 10);
      res.once('close', () => clearInterval(trickle));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      expect(await answersHttp((server.address() as AddressInfo).port, 10_000)).toBe(true);
      const open = new Promise((resolve) => setTimeout(() => resolve('still open'), 1000).unref());
      expect(await Promise.race([closed, open])).toBe('closed');
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe('DeploymentRepository.findLiveContainers', () => {
  it('reads only live, container-served deployments', async () => {
    await new DeploymentRepository().findLiveContainers();
    expect((prisma.deployment.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      status: 'DEPLOYED', servingMethod: 'CONTAINER', subdomain: { not: null }, containerPort: { not: null },
    });
  });
});
