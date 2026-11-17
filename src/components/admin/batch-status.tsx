/** Batch status shared by the admin Batches list and a batch's own page. */

export type BatchStage = 'Active' | 'Upcoming' | 'Ended' | 'Archived';

interface BatchDates {
  startsAt: string;
  endsAt: string;
  archivedAt: string | null;
  joinOpen: boolean;
}

const PILL = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
const GREEN = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
const BLUE = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
const GREY = 'bg-muted text-muted-foreground';

const STAGE_STYLE: Record<BatchStage, string> = { Active: GREEN, Upcoming: BLUE, Ended: GREY, Archived: GREY };

export const formatDay = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function batchStage(batch: BatchDates): BatchStage {
  if (batch.archivedAt) return 'Archived';
  const now = Date.now();
  if (new Date(batch.endsAt).getTime() <= now) return 'Ended';
  if (new Date(batch.startsAt).getTime() > now) return 'Upcoming';
  return 'Active';
}

/** Whether the join link works right now: the server also refuses closed, ended and archived batches. */
export const isJoinable = (batch: BatchDates): boolean => {
  const stage = batchStage(batch);
  return batch.joinOpen && (stage === 'Active' || stage === 'Upcoming');
};

export function StagePill({ stage }: { stage: BatchStage }): React.ReactElement {
  return <span className={`${PILL} ${STAGE_STYLE[stage]}`}>{stage}</span>;
}

export function JoiningPill({ open, long = false }: { open: boolean; long?: boolean }): React.ReactElement {
  const label = open ? 'Open' : 'Closed';
  return <span className={`${PILL} ${open ? GREEN : GREY}`}>{long ? `Joining ${label.toLowerCase()}` : label}</span>;
}

export function RolePill({ role }: { role: 'STUDENT' | 'MENTOR' }): React.ReactElement {
  return <span className={`${PILL} ${role === 'MENTOR' ? BLUE : GREY}`}>{role === 'MENTOR' ? 'Mentor' : 'Student'}</span>;
}
