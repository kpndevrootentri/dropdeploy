/**
 * The dashboard product tour: one entry per step, in order.
 *
 * Each `id` is also the `data-tour` attribute on the element the step points
 * at, and the `last_step` recorded when the tour ends. A step whose element is
 * not on screen is skipped rather than shown pointing at nothing.
 *
 * Plain data with no imports, so both the browser and the validator can read it.
 */
export const TOUR_STEP_IDS = [
  'live_url',
  'project_open',
  'create_project',
  'drop_zone',
  'user_menu',
] as const;

export type TourStepId = (typeof TOUR_STEP_IDS)[number];

export interface TourStep {
  id: TourStepId;
  title: string;
  body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'live_url',
    title: 'Your site is live',
    body: 'This is its public address. Copy it to share, or open it in a new tab.',
  },
  {
    id: 'project_open',
    title: 'Everything else lives inside',
    body: 'Open a project for environment variables, domains, who can access it, the Showcase, and a terminal.',
  },
  {
    id: 'create_project',
    title: 'Deploy from a repository',
    body: 'Paste a GitHub or GitLab URL to add another project. Your remaining project slots are shown here.',
  },
  {
    id: 'drop_zone',
    title: 'Or just drop files',
    body: 'Drag a folder, .zip or .html file anywhere on this page. It goes live with no build step.',
  },
  {
    id: 'user_menu',
    title: 'Docs, settings, and this tour',
    body: 'Everything account-related is in this menu, including a way to take this tour again.',
  },
];
