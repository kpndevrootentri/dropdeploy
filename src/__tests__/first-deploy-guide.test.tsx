/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DashboardPage from '@/app/(dashboard)/dashboard/page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { dismiss: jest.fn() }) }));

let projectCount = 0;
// Holds /api/git-providers open until a test lets it finish.
let providersGate: Promise<void> = Promise.resolve();

beforeAll(() => {
  // The dashboard's API, as seen by an account with `projectCount` projects.
  global.fetch = jest.fn(async (url: string) => ({
    ok: true,
    json: async () => {
      if (url === '/api/projects') {
        const data = Array.from({ length: projectCount }, (_, n) => ({
          id: `p${n}`, name: `app${n}`, slug: `app${n}`, description: null, source: 'GITHUB',
          type: 'STATIC', githubUrl: null, createdAt: '2026-11-01T00:00:00.000Z', deployments: [],
        }));
        return { success: true, data, quota: { used: projectCount, limit: 5, available: 5 - projectCount } };
      }
      if (url === '/api/git-providers') {
        await providersGate;
        return { success: true, data: [] };
      }
      return { success: true, data: { seen: true } };
    },
  })) as unknown as typeof fetch;
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
  providersGate = Promise.resolve();
});

const URL_PLACEHOLDER = 'https://github.com/username/repo';

it('asks a fresh account how to deploy, and opens the URL route ready to paste', async () => {
  render(<DashboardPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Paste a GitHub URL/ }));

  const dialog = await screen.findByRole('dialog');
  // Pasting a URL never fills in the name, so the hint must not say it does.
  expect(dialog.textContent).toContain("Paste your repository's URL below, give the project a name");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText(URL_PLACEHOLDER)));
});

it('leaves the cursor where the user put it when the providers finish loading', async () => {
  let finishProviders: () => void = () => {};
  providersGate = new Promise((resolve) => {
    finishProviders = resolve;
  });
  render(<DashboardPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Paste a GitHub URL/ }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText(URL_PLACEHOLDER)));

  const nameField = screen.getByPlaceholderText('my-awesome-app');
  nameField.focus();
  await act(async () => finishProviders());
  expect(document.activeElement).toBe(nameField);
});

it('opens the GitHub route with the GitHub button focused', async () => {
  render(<DashboardPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Connect GitHub/ }));

  const dialog = await screen.findByRole('dialog');
  await waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toContain('GitHub');
  });
});

it('spotlights the drop zone for files, and Esc clears it', async () => {
  render(<DashboardPage />);
  const choice = await screen.findByRole('button', { name: /Drop files/ });
  fireEvent.click(choice);

  const zone = document.querySelector<HTMLElement>('[data-tour="drop_zone"]');
  expect(document.activeElement).toBe(zone);
  // Raised above the spotlight's click-catcher, so it stays clickable in the cut-out.
  expect(zone?.className).toContain('z-[95]');
  await waitFor(() => expect(document.querySelector('[data-spotlight]')).not.toBeNull());
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(document.querySelector('[data-spotlight]')).toBeNull());
  expect(choice.getAttribute('aria-pressed')).toBe('false');
});

it('clears the drop-zone spotlight on a click outside it', async () => {
  render(<DashboardPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Drop files/ }));
  await waitFor(() => expect(document.querySelector('[data-spotlight]')).not.toBeNull());

  fireEvent.click(document.querySelector('[data-spotlight-backdrop]') as HTMLElement);
  await waitFor(() => expect(document.querySelector('[data-spotlight]')).toBeNull());
});

it('is gone once the account has a project', async () => {
  projectCount = 1;
  render(<DashboardPage />);
  await screen.findByText('app0');
  expect(screen.queryByText('Deploy your first project')).toBeNull();
});
