'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/** Space between the target's edge and the cut-out's. */
export const SPOTLIGHT_PADDING = 6;
// Long enough to cover a smooth scroll to the next target, which the cut-out chases.
const GLIDE_MS = 450;

/**
 * Dims the page except one element, and follows it. The dim fades in, the
 * cut-out glides to each new target, and a soft halo pulses around it; all of
 * that is off for reduced-motion users.
 *
 * With `onOutsideClick`, clicks outside the cut-out are caught and reported,
 * and the target must sit above z-[90] to stay clickable. Without it, the
 * whole page is blocked.
 *
 * `onMeasure` gets the target's box on every re-measure (scroll, resize).
 */
export function Spotlight({
  target,
  onOutsideClick,
  onMeasure,
}: {
  target: HTMLElement;
  onOutsideClick?: () => void;
  onMeasure?: (box: DOMRect) => void;
}): React.ReactElement | null {
  const [box, setBox] = useState<DOMRect | null>(null);
  const [isGliding, setIsGliding] = useState(false);
  const previousTarget = useRef<HTMLElement | null>(null);
  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;

  useLayoutEffect(() => {
    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = target.getBoundingClientRect();
        setBox(next);
        onMeasureRef.current?.(next);
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [target]);

  // Glide only when moving to a new target. Transitions left on would make
  // the cut-out trail behind the page whenever the user scrolls.
  useEffect(() => {
    const isNewTarget = previousTarget.current !== null && previousTarget.current !== target;
    previousTarget.current = target;
    if (!isNewTarget) return;
    setIsGliding(true);
    const timer = setTimeout(() => setIsGliding(false), GLIDE_MS);
    return () => clearTimeout(timer);
  }, [target]);

  if (!box) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90]" aria-hidden="true" data-spotlight-backdrop="" onClick={onOutsideClick} />
      <div
        aria-hidden="true"
        data-spotlight=""
        className={cn(
          'pointer-events-none fixed z-[91] rounded-[10px]',
          'animate-in fade-in-0 duration-300 motion-reduce:animate-none',
          // transition-none otherwise: duration-300 above would make every move animate,
          // and the cut-out would trail the page on scroll.
          isGliding
            ? 'transition-[top,left,width,height] ease-out motion-reduce:transition-none'
            : 'transition-none',
        )}
        style={{
          top: box.top - SPOTLIGHT_PADDING,
          left: box.left - SPOTLIGHT_PADDING,
          width: box.width + SPOTLIGHT_PADDING * 2,
          height: box.height + SPOTLIGHT_PADDING * 2,
          // The dim is this element's shadow, spread over the whole viewport.
          boxShadow: '0 0 0 200vmax rgb(0 0 0 / 0.55)',
        }}
      >
        <span className="absolute inset-0 rounded-[inherit] border-2 border-white/70" />
        <span className="absolute inset-0 rounded-[inherit] motion-safe:animate-spotlight-pulse" />
      </div>
    </>,
    document.body,
  );
}
