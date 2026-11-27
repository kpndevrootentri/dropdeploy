import { cn } from '@/lib/utils';

/** The worker's buildStep values, as what it was doing when a deployment stopped. */
const STEP_TEXT: Record<string, string> = {
  CLONING: 'getting the code',
  SCANNING: 'checking packages',
  BUILDING_IMAGE: 'building',
  EXTRACTING: 'publishing the static files',
  STARTING: 'starting the app',
};

/** Why a FAILED deployment failed: the step it stopped at and a short reason. Renders nothing when neither is known. */
export function DeploymentFailure({ buildStep, failureReason, className }: {
  buildStep: string | null;
  failureReason?: string | null;
  className?: string;
}): React.ReactElement | null {
  if (!buildStep && !failureReason) return null;
  const step = buildStep ? STEP_TEXT[buildStep] ?? buildStep.toLowerCase() : null;
  return (
    <p className={cn('text-xs text-destructive break-words line-clamp-3', className)} title={failureReason ?? undefined}>
      <span className="font-medium">{step ? `Failed while ${step}` : 'Failed'}</span>
      {failureReason && `: ${failureReason}`}
    </p>
  );
}
