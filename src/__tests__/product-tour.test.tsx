/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { ProductTour } from '@/components/features/product-tour';

// The URL's query string, as next/navigation would report it. Changing it and
// re-rendering stands in for a client-side navigation, which keeps the page
// mounted — the condition that broke replay once per visit.
let mockSearch = '';
const mockRouter = {
  replace: jest.fn(() => {
    mockSearch = '';
  }),
};

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { dismiss: jest.fn() }) }));

let tourSeen = true;
const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => ({
  json: async () => (init?.method === 'POST' ? { success: true } : { success: true, data: { seen: tourSeen } }),
}));

beforeAll(() => {
  // jsdom does no layout; give the tour the browser APIs it measures with.
  global.fetch = fetchMock as unknown as typeof fetch;
  window.matchMedia = jest.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  window.scrollTo = jest.fn();
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.getClientRects = function getClientRects() {
    return [this.getBoundingClientRect()] as unknown as DOMRectList;
  };
  global.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };

  for (const id of ['live_url', 'user_menu']) {
    const el = document.createElement('div');
    el.dataset.tour = id;
    document.body.appendChild(el);
  }
});

beforeEach(() => {
  mockSearch = '';
  tourSeen = true;
  jest.clearAllMocks();
});

function tourEndBodies(): unknown[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/onboarding/tour' && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)));
}

it('replays from the menu more than once without a page reload', async () => {
  const { rerender } = render(<ProductTour hasLive />);

  for (const attempt of [1, 2]) {
    mockSearch = 'tour=1';
    rerender(<ProductTour hasLive />);
    expect(await screen.findByText('Step 1 of 2')).toBeTruthy();
    expect(mockRouter.replace).toHaveBeenCalledTimes(attempt);

    rerender(<ProductTour hasLive />); // the URL is now clean
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByText('Step 1 of 2')).toBeNull();
  }

  expect(tourEndBodies()).toEqual([
    { outcome: 'skipped', source: 'menu', last_step: 'live_url' },
    { outcome: 'skipped', source: 'menu', last_step: 'live_url' },
  ]);
});

it('offers an unseen tour once, and not again after a replay on the same page', async () => {
  tourSeen = false;
  const { rerender } = render(<ProductTour hasLive />);
  await act(async () => {});
  expect(toast).toHaveBeenCalledTimes(1);

  mockSearch = 'tour=1';
  rerender(<ProductTour hasLive />);
  expect(await screen.findByText('Step 1 of 2')).toBeTruthy();
  rerender(<ProductTour hasLive />); // the URL is now clean
  await act(async () => {});

  // The open offer was withdrawn, and the tour that just ran is not re-offered.
  expect(toast.dismiss).toHaveBeenCalled();
  expect(toast).toHaveBeenCalledTimes(1);
});
