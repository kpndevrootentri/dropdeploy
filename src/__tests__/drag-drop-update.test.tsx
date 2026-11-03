/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { DragDropZone } from '@/components/features/drag-drop-zone';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const opened: string[] = [];
class FakeXhr {
  upload = {};
  withCredentials = false;
  open(_method: string, url: string): void { opened.push(url); }
  send(): void {}
  abort(): void {}
}

beforeEach(() => {
  opened.length = 0;
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
});

const sites = [
  { id: 'p1', name: 'portfolio', slug: 'portfolio' },
  { id: 'p2', name: 'blog', slug: 'blog' },
];

function pick(container: HTMLElement, filename: string): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['<h1>hi</h1>'], filename, { type: 'text/html' })] } });
}

describe('DragDropZone: new version of an existing site', () => {
  it('pre-selects the matching site, hides the name field and posts to that site', () => {
    const { container } = render(<DragDropZone uploadProjects={sites} />);
    pick(container, 'portfolio-v2.html');

    expect((screen.getByLabelText('Where should this go?') as HTMLSelectElement).value).toBe('p1');
    expect(screen.queryByLabelText('What do you want to call your site?')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Replace portfolio\./ }));
    expect(opened).toEqual(['/api/projects/p1/upload']);
  });

  it('switching to a new site brings back the name field and the create endpoint', () => {
    const { container } = render(<DragDropZone uploadProjects={sites} />);
    pick(container, 'portfolio-v2.html');
    fireEvent.change(screen.getByLabelText('Where should this go?'), { target: { value: '' } });

    expect(screen.getByLabelText('What do you want to call your site?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(opened).toEqual(['/api/projects/upload']);
  });

  it('at the quota, an unmatched file waits for the user to pick a site', () => {
    const { container } = render(<DragDropZone uploadProjects={sites} canCreate={false} />);
    pick(container, 'resume.html');

    expect(screen.queryByLabelText('What do you want to call your site?')).toBeNull();
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Where should this go?'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByRole('button', { name: /Replace blog\./ }));
    expect(opened).toEqual(['/api/projects/p2/upload']);
  });
});
