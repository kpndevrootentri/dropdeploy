/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminProjectsPage from '@/app/(dashboard)/dashboard/admin/projects/page';

// A tiny router: changing only the query re-renders the page without remounting it, as in Next.
let mockQuery = '';
const mockListeners = new Set<() => void>();
const mockNavigate = (url: string): void => {
  mockQuery = url.split('?')[1] ?? '';
  mockListeners.forEach((l) => l());
};
jest.mock('next/navigation', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  const subscribe = (l: () => void) => { mockListeners.add(l); return () => mockListeners.delete(l); };
  return {
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => mockQuery)),
    useRouter: () => ({ replace: mockNavigate }),
  };
});
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const project = (id: string, name: string, status: string) => ({
  id, name, slug: name, type: 'STATIC', source: 'GITHUB', autoDeploy: false, stoppedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  user: { id: 'u1', email: 'dev@entri.me', role: 'USER' },
  deployments: [{
    id: `d-${id}`, status, createdAt: '2026-11-01T00:00:00.000Z', containerPort: null,
    buildStep: status === 'FAILED' ? 'BUILDING_IMAGE' : null,
    failureReason: status === 'FAILED' ? 'npm error Missing script: "build"' : null,
  }],
});

let bulkBody: unknown;

beforeEach(() => {
  // Opened from the System tab's "Review failed deploys" link.
  mockQuery = 'status=failed';
  bulkBody = undefined;
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/projects/bulk/redeploy') {
      bulkBody = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ success: true, data: [{ id: 'p-failed', ok: true }] }) };
    }
    return {
      ok: true,
      json: async () => ({ success: true, data: [project('p-failed', 'broken-site', 'FAILED'), project('p-live', 'ok-site', 'DEPLOYED')] }),
    };
  }) as unknown as typeof fetch;
});

it('opens filtered to projects whose latest deploy failed', async () => {
  render(<AdminProjectsPage />);
  expect(await screen.findByText('broken-site')).toBeTruthy();
  expect(screen.queryByText('ok-site')).toBeNull();
  expect(screen.getByRole('button', { name: 'Failed (1)' }).getAttribute('aria-pressed')).toBe('true');
});

it('keeps the filter and the URL in step', async () => {
  render(<AdminProjectsPage />);
  await screen.findByText('broken-site');

  // The admin "Projects" tab links to the bare URL: the filter turns off.
  act(() => mockNavigate('/dashboard/admin/projects'));
  expect(screen.getByText('ok-site')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Failed (1)' }).getAttribute('aria-pressed')).toBe('false');

  // The toggle writes the URL, so a reload or a copied link shows the same view.
  fireEvent.click(screen.getByRole('button', { name: 'Failed (1)' }));
  expect(mockQuery).toBe('status=failed');
  expect(screen.queryByText('ok-site')).toBeNull();
});

it('never sends a bulk action to a ticked row the filter hides', async () => {
  render(<AdminProjectsPage />);
  await screen.findByText('broken-site');

  // Tick the live project with the filter off, then filter it out of view.
  fireEvent.click(screen.getByRole('button', { name: 'Failed (1)' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select ok-site' }));
  fireEvent.click(screen.getByRole('button', { name: 'Failed (1)' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select broken-site' }));

  const bar = screen.getByText('1 selected').parentElement!;
  fireEvent.click(within(bar).getByRole('button', { name: 'Redeploy' }));
  await waitFor(() => expect(bulkBody).toEqual({ projectIds: ['p-failed'] }));
});
