/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DashboardPage from '@/app/(dashboard)/dashboard/page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { dismiss: jest.fn() }) }));

let projectCount = 0;
let isWelcomeSeen = false;
// Holds the welcome check open until a test lets it finish.
let welcomeGate: Promise<void> = Promise.resolve();
const fetchMock = jest.fn(async (url: string, init?: RequestInit) => ({
  ok: true,
  json: async () => {
    if (url === '/api/projects') {
      const data = Array.from({ length: projectCount }, (_, n) => ({
        id: `p${n}`, name: `app${n}`, slug: `app${n}`, description: null, source: 'GITHUB',
        type: 'STATIC', githubUrl: null, createdAt: '2026-11-01T00:00:00.000Z', deployments: [],
      }));
      return { success: true, data, quota: { used: projectCount, limit: 5, available: 5 - projectCount } };
    }
    if (url === '/api/onboarding/welcome' && init?.method !== 'POST') {
      await welcomeGate;
      return { success: true, data: { seen: isWelcomeSeen, email: 'new.person@example.com' } };
    }
    if (url === '/api/git-providers') return { success: true, data: [] };
    return { success: true, data: { seen: true } };
  },
}));

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
  // jsdom does no layout or media queries.
  window.matchMedia = jest.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = jest.fn();
  global.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

beforeEach(() => {
  projectCount = 0;
  isWelcomeSeen = false;
  welcomeGate = Promise.resolve();
  fetchMock.mockClear();
});

const welcomeSaves = (): number =>
  fetchMock.mock.calls.filter(([url, init]) => url === '/api/onboarding/welcome' && init?.method === 'POST').length;

it('greets a new account, and a choice carries straight on into that route', async () => {
  render(<DashboardPage />);
  const welcome = await screen.findByRole('dialog', { name: 'Welcome to DropDeploy, new.person' });

  fireEvent.click(within(welcome).getByRole('button', { name: /Paste a GitHub URL/ }));
  await screen.findByRole('dialog', { name: 'Create project' });
  expect(screen.queryByRole('dialog', { name: /Welcome to DropDeploy/ })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText('https://github.com/username/repo')));
  expect(welcomeSaves()).toBe(1);
});

it('closes on "I\'ll look around first", saves that, and leaves the dashboard card', async () => {
  render(<DashboardPage />);
  await screen.findByRole('dialog', { name: /Welcome to DropDeploy/ });
  fireEvent.click(screen.getByRole('button', { name: "I'll look around first" }));

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(welcomeSaves()).toBe(1);
  expect(screen.getByText('Deploy your first project')).toBeTruthy();
});

it('does not come back once it has been closed', async () => {
  isWelcomeSeen = true;
  render(<DashboardPage />);
  await screen.findByText('Deploy your first project');
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/onboarding/welcome')).toBe(true));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('stays shut when the user picked a route on the card before the check came back', async () => {
  let finishWelcome: () => void = () => {};
  welcomeGate = new Promise((resolve) => {
    finishWelcome = resolve;
  });
  render(<DashboardPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Drop files/ }));
  await waitFor(() => expect(document.querySelector('[data-spotlight]')).not.toBeNull());

  await act(async () => finishWelcome());
  await act(async () => {});
  expect(screen.queryByRole('dialog', { name: /Welcome to DropDeploy/ })).toBeNull();
  // Not greeted, so not saved either: it may still greet them on a later visit.
  expect(welcomeSaves()).toBe(0);
});

it('is not even asked about for an account that has projects', async () => {
  projectCount = 1;
  render(<DashboardPage />);
  await screen.findByText('app0');
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/onboarding/welcome')).toBe(false);
  expect(screen.queryByRole('dialog')).toBeNull();
});
