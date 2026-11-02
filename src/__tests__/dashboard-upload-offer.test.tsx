/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import DashboardPage from '@/app/(dashboard)/dashboard/page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
// Stand-ins: the upload itself is not under test, only what the dashboard tells the tour after it.
jest.mock('@/components/features/drag-drop-zone', () => ({
  DragDropZone: ({ onSuccess }: { onSuccess?: () => void }) => (
    <button type="button" onClick={onSuccess}>finish upload</button>
  ),
}));
jest.mock('@/components/features/product-tour', () => ({
  ProductTour: ({ hasLive }: { hasLive: boolean | null }) => <p>tour sees: {String(hasLive)}</p>,
}));

let hasUploaded = false;

beforeAll(() => {
  // Uploads are live the moment the server answers, so the refreshed list already has one.
  const liveProject = {
    id: 'p1', name: 'first-site', slug: 'first-site', description: null, source: 'UPLOAD', type: 'STATIC',
    githubUrl: null, createdAt: '2026-11-01T00:00:00.000Z',
    deployments: [{
      id: 'd1', status: 'DEPLOYED', subdomain: 'first-site', containerPort: null, buildStep: null,
      createdAt: '2026-11-01T00:00:00.000Z',
    }],
  };
  global.fetch = jest.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url === '/api/projects'
        ? {
            success: true,
            data: hasUploaded ? [liveProject] : [],
            quota: { used: hasUploaded ? 1 : 0, limit: 5, available: hasUploaded ? 4 : 5 },
          }
        : { success: true, data: [] },
  })) as unknown as typeof fetch;
});

it('holds the tour offer while an upload hands over to the project page', async () => {
  render(<DashboardPage />);
  await screen.findByText('tour sees: false');

  hasUploaded = true;
  fireEvent.click(screen.getByRole('button', { name: 'finish upload' }));

  // The list has refreshed and shows the live project, yet the tour is told to wait.
  await screen.findByText('first-site');
  expect(screen.getByText('tour sees: null')).toBeTruthy();
});
