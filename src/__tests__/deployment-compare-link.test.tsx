/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import ProjectDetailPage from '@/app/(dashboard)/projects/[id]/page';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'p1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const sha = (c: string): string => c.repeat(40);
const row = (id: string, commitHash: string, rollbackOfId: string | null = null) => ({
  id, status: 'DEPLOYED', subdomain: null, containerPort: null, buildStep: null, buildLog: null, commitHash,
  startedAt: null, completedAt: null, createdAt: '2026-11-01T00:00:00.000Z', imageTag: null, rollbackOfId,
});

// Newest first: a push on top of a rollback to d1, which undid d2.
const project = {
  id: 'p1', name: 'site', cohortId: null, slug: 'site', description: null, source: 'GITHUB', type: 'STATIC',
  githubUrl: 'https://github.com/o/r', branch: 'main', isPrivate: false, useStaticHosting: true, autoDeploy: false,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', previousDeployedCommit: null,
  deployments: [row('d3', sha('c')), row('r1', sha('a'), 'd1'), row('d2', sha('b')), row('d1', sha('a'))],
};

beforeAll(() => {
  global.fetch = jest.fn(async (url: string) => ({
    ok: true,
    json: async () => (url === '/api/projects/p1' ? { success: true, data: project } : { success: false }),
  })) as unknown as typeof fetch;
});

it('gives a rollback row no compare link, and compares the next deploy against the rolled-back commit', async () => {
  render(<ProjectDetailPage />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Deployments' }))[0]);
  await screen.findByText(/rollback of d1/);

  expect(screen.getAllByRole('link', { name: /Compare/ }).map((a) => a.getAttribute('href'))).toEqual([
    `https://github.com/o/r/compare/${sha('a')}...${sha('c')}`,
    `https://github.com/o/r/compare/${sha('a')}...${sha('b')}`,
  ]);
});
