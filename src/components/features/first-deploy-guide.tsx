'use client';

import { FileUp, Github, Link2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type FirstDeployChoice = 'upload' | 'github' | 'url';

/** The pulsing ring that marks where to act inside Create project (the pulse is off for reduced motion). */
export const GUIDE_RING = 'ring-2 ring-primary ring-offset-2 ring-offset-background motion-safe:animate-guide-pulse';

const CHOICES: { id: FirstDeployChoice; icon: typeof Github; title: string; body: string }[] = [
  {
    id: 'upload',
    icon: FileUp,
    title: 'Drop files',
    body: 'An HTML file, a .zip or a folder. Live in seconds, no build step.',
  },
  {
    id: 'github',
    icon: Github,
    title: 'Connect GitHub',
    body: 'Pick any repository from your account, private ones included.',
  },
  {
    id: 'url',
    icon: Link2,
    title: 'Paste a GitHub URL',
    body: 'Deploy a public repository straight from its link.',
  },
];

/** The three ways to deploy a first project, as buttons. Shared by the dashboard card and the welcome modal. */
export function FirstDeployChoices({
  picked = null,
  onPick,
  className,
}: {
  picked?: FirstDeployChoice | null;
  onPick: (choice: FirstDeployChoice) => void;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-3', className)}>
      {CHOICES.map(({ id, icon: Icon, title, body }) => (
        <button
          key={id}
          type="button"
          aria-pressed={picked === id}
          onClick={() => onPick(id)}
          className={cn(
            // flex-col: a button centres its content, which misaligns cards of unequal text length.
            'flex flex-col rounded-lg border p-4 text-left transition-colors hover:border-primary hover:bg-accent/40',
            'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
            picked === id && 'border-primary bg-accent/40',
          )}
        >
          <Icon className="mb-2 h-5 w-5 text-primary" aria-hidden="true" />
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        </button>
      ))}
    </div>
  );
}

/**
 * Shown on the dashboard while an account has no projects. It asks how the
 * user wants to deploy; the dashboard then points at the place to do it, and
 * the user does it themselves — nothing is blocked or done on their behalf.
 */
export function FirstDeployGuide({
  picked,
  onPick,
}: {
  picked: FirstDeployChoice | null;
  onPick: (choice: FirstDeployChoice) => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deploy your first project</CardTitle>
        <CardDescription>How do you want to start?</CardDescription>
      </CardHeader>
      <CardContent>
        <FirstDeployChoices picked={picked} onPick={onPick} />
      </CardContent>
    </Card>
  );
}
