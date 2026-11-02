'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as Popover from '@radix-ui/react-popover';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spotlight, SPOTLIGHT_PADDING } from '@/components/features/spotlight';
import { TOUR_STEPS, type TourStep, type TourStepId } from '@/lib/product-tour';
import type { TourEnded } from '@/validators/onboarding.validator';

// Derived from the schema the server validates against, so the two cannot
// drift apart.
type Source = TourEnded['source'];
type Outcome = TourEnded['outcome'];

const OFFER_TOAST_ID = 'product-tour-offer';
// Distance from the spotlight's edge to the card.
const CARD_OFFSET = SPOTLIGHT_PADDING + 8;
// Space kept between the card and the edges of the viewport.
const VIEWPORT_GAP = 16;
// Until a card has rendered there is no height to measure; about one card on a phone.
const CARD_HEIGHT_GUESS = 200;
// The sticky dashboard header, plus a little air.
const HEADER_OFFSET = 72;

function findTarget(id: TourStepId): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${id}"]`);
  return el && el.getClientRects().length > 0 ? el : null;
}

const viewportBottomLeft = {
  getBoundingClientRect: (): DOMRect =>
    new DOMRect(VIEWPORT_GAP, window.innerHeight - VIEWPORT_GAP, 0, 0),
};

function reportEnd(outcome: Outcome, source: Source, lastStep: TourStepId | null): void {
  void fetch('/api/onboarding/tour', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome, source, last_step: lastStep }),
  })
    // A lost save only means the offer comes back on the next visit.
    .catch(() => {});
}

/**
 * The dashboard product tour.
 *
 * Offered once, by a toast, the first time the user has a live project — not
 * before, since a tour of an empty dashboard explains nothing. Declining is
 * permanent; `/dashboard?tour=1` (the user menu) replays it any time.
 *
 * `hasLive` is null until the project list has loaded: the tour points at
 * project tiles, so it waits for them. `useSearchParams` makes this need a
 * <Suspense> boundary in its parent.
 */
export function ProductTour({ hasLive }: { hasLive: boolean | null }): React.ReactElement | null {
  const router = useRouter();
  const isReplay = useSearchParams().get('tour') === '1';
  const [run, setRun] = useState<{ source: Source; steps: TourStep[] } | null>(null);
  // StrictMode runs mount effects twice in development; one replay per ?tour=1.
  const replayHandled = useRef(false);
  const started = useRef(false);

  const start = useCallback((source: Source): void => {
    // Resolved once, up front, so "Step n of N" stays honest.
    const steps = TOUR_STEPS.filter((step) => findTarget(step.id) !== null);
    if (steps.length === 0) return;
    started.current = true;
    void fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'product_tour_started', meta: { source } }),
    })
      // Analytics only; the tour runs either way.
      .catch(() => {});
    setRun({ source, steps });
  }, []);

  useEffect(() => {
    // Changing only the query does not remount this page, so re-arm once the
    // URL is clean, or the menu could replay only once per visit.
    if (!isReplay) {
      replayHandled.current = false;
      return;
    }
    if (hasLive === null || replayHandled.current) return;
    replayHandled.current = true;
    router.replace('/dashboard', { scroll: false });
    start('menu');
  }, [isReplay, hasLive, router, start]);

  useEffect(() => {
    // Once the tour has run on this page, offering it again would be noise.
    if (!hasLive || isReplay || started.current) return;

    // The toast outlives this page; whichever of its exits happens first wins,
    // and leaving the page withdraws the offer without recording an answer.
    let isAnswered = false;
    const answer = (fn: () => void) => (): void => {
      if (isAnswered) return;
      isAnswered = true;
      fn();
    };
    const controller = new AbortController();

    fetch('/api/onboarding/tour', { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (isAnswered || !data?.success || data.data?.seen !== false) return;
        toast('Your project is live', {
          id: OFFER_TOAST_ID,
          description: 'Want a 30-second tour of your dashboard?',
          duration: Infinity,
          action: { label: 'Show me', onClick: answer(() => start('auto')) },
          cancel: { label: 'Not now', onClick: answer(() => reportEnd('declined', 'auto', null)) },
          onDismiss: answer(() => reportEnd('declined', 'auto', null)),
        });
      })
      // Aborted on unmount, or the request failed: either way, no offer this visit.
      .catch(() => {});

    return () => {
      isAnswered = true;
      controller.abort();
      toast.dismiss(OFFER_TOAST_ID);
    };
  }, [hasLive, isReplay, start]);

  if (!run) return null;

  return (
    <TourSteps
      steps={run.steps}
      onEnd={(outcome, lastStep) => {
        setRun(null);
        reportEnd(outcome, run.source, lastStep);
      }}
    />
  );
}

function TourSteps({
  steps,
  onEnd,
}: {
  steps: TourStep[];
  onEnd: (outcome: Outcome, lastStep: TourStepId) => void;
}): React.ReactElement | null {
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const nextRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const step = steps[index];
  const isLast = index === steps.length - 1;

  const next = useCallback((): void => {
    if (isLast) onEnd('completed', step.id);
    else setIndex((current) => current + 1);
  }, [isLast, onEnd, step.id]);

  // An element that is gone by the time its step comes up is stepped past
  // rather than pointed at.
  useEffect(() => {
    const el = findTarget(step.id);
    if (el) setTarget(el);
    else next();
  }, [step.id, next]);

  // A target too tall to leave room for the card beside it (the drop zone on a
  // phone) would push the card, and its Next button, off a scroll-locked
  // screen. Then the card pins to the bottom of the viewport instead. The
  // card's height is the previous step's, which is close enough.
  const needsPin = useCallback((targetHeight: number): boolean => {
    const needed = (cardRef.current?.offsetHeight ?? CARD_HEIGHT_GUESS) + CARD_OFFSET + VIEWPORT_GAP;
    return (window.innerHeight - targetHeight) / 2 < needed;
  }, []);

  useLayoutEffect(() => {
    if (!target) return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const { top, height } = target.getBoundingClientRect();
    const pin = needsPin(height);
    setIsPinned(pin);
    // The spotlight chases the target while this scroll runs, which is the glide.
    if (pin) window.scrollTo({ top: window.scrollY + top - HEADER_OFFSET, behavior });
    else target.scrollIntoView({ block: 'center', behavior });
  }, [target, needsPin]);

  // Keeps focus on the card when the step changes, e.g. after Back disappears.
  useEffect(() => {
    nextRef.current?.focus();
  }, [index]);

  if (!target) return null;

  return (
    <>
      {/* No onOutsideClick: the tour points at things, it does not let them be clicked mid-step. */}
      <Spotlight
        target={target}
        // Re-decided on resize as well: rotating a phone can make a target too tall.
        onMeasure={(box) => setIsPinned(needsPin(box.height))}
      />

      <Popover.Root open modal onOpenChange={(open) => !open && onEnd('skipped', step.id)}>
        <Popover.Anchor virtualRef={{ current: isPinned ? viewportBottomLeft : target }} />
        <Popover.Portal>
          <Popover.Content
            ref={cardRef}
            side={isPinned ? 'top' : 'bottom'}
            align="start"
            sideOffset={isPinned ? 0 : CARD_OFFSET}
            collisionPadding={VIEWPORT_GAP}
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              nextRef.current?.focus();
            }}
            // Only Esc or "Skip tour" end it; a stray click on the dimmed page
            // should not throw away the tour.
            onInteractOutside={(event) => event.preventDefault()}
            className="z-[95] w-[min(320px,calc(100vw-2rem))] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg outline-hidden"
          >
            <p className="text-xs text-muted-foreground">
              Step {index + 1} of {steps.length}
            </p>
            <div aria-live="polite">
              {/* Keyed by step so each step's text fades in as the spotlight moves. */}
              <div key={step.id} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
                <h2 id={titleId} className="mt-1 font-semibold">
                  {step.title}
                </h2>
                <p id={bodyId} className="mt-1 text-sm text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" className="-ml-2" onClick={() => onEnd('skipped', step.id)}>
                Skip tour
              </Button>
              <div className="flex gap-2">
                {index > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setIndex((current) => current - 1)}>
                    Back
                  </Button>
                )}
                <Button ref={nextRef} size="sm" onClick={next}>
                  {isLast ? 'Done' : 'Next'}
                </Button>
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
