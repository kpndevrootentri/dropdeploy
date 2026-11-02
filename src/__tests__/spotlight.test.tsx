/**
 * @jest-environment jsdom
 */
import { fireEvent, render, waitFor } from '@testing-library/react';
import { Spotlight, SPOTLIGHT_PADDING } from '@/components/features/spotlight';

const GLIDE_CLASS = 'transition-[top,left,width,height]';

beforeAll(() => {
  global.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

// jsdom does no layout, so each target reports the box it is given.
function targetAt(left: number, top: number, width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => new DOMRect(left, top, width, height);
  document.body.appendChild(el);
  return el;
}

const cutOut = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-spotlight]');

it('sits on its target, and glides only when the target changes', async () => {
  const first = targetAt(100, 50, 200, 40);
  const second = targetAt(400, 300, 120, 60);
  const { rerender } = render(<Spotlight target={first} />);

  await waitFor(() => expect(cutOut()?.style.left).toBe(`${100 - SPOTLIGHT_PADDING}px`));
  expect(cutOut()?.className).not.toContain(GLIDE_CLASS);
  expect(cutOut()?.className).toContain('transition-none');

  rerender(<Spotlight target={second} />);
  await waitFor(() => expect(cutOut()?.style.top).toBe(`${300 - SPOTLIGHT_PADDING}px`));
  expect(cutOut()?.className).toContain(GLIDE_CLASS);
  expect(cutOut()?.style.width).toBe(`${120 + SPOTLIGHT_PADDING * 2}px`);

  // Off again once the glide is done, so scrolling never makes it trail.
  await waitFor(() => expect(cutOut()?.className).not.toContain(GLIDE_CLASS), { timeout: 1500 });
  expect(cutOut()?.className).toContain('transition-none');
});

it('reports outside clicks only when asked to', async () => {
  const onOutsideClick = jest.fn();
  const { unmount } = render(<Spotlight target={targetAt(0, 0, 10, 10)} onOutsideClick={onOutsideClick} />);
  await waitFor(() => expect(cutOut()).not.toBeNull());
  fireEvent.click(document.querySelector('[data-spotlight-backdrop]') as HTMLElement);
  expect(onOutsideClick).toHaveBeenCalledTimes(1);
  unmount();
});
