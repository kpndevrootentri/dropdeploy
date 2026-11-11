'use client';

import { Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FirstDeployChoices, type FirstDeployChoice } from '@/components/features/first-deploy-guide';

/**
 * The first thing a new account sees: a greeting and the same three ways to
 * deploy as the dashboard card. Picking one closes it and carries on from
 * there; any other way of closing it leaves the card on the dashboard.
 */
export function WelcomeModal({
  open,
  email,
  onPick,
  onClose,
}: {
  open: boolean;
  email: string;
  onPick: (choice: FirstDeployChoice) => void;
  onClose: () => void;
}): React.ReactElement {
  // Users have no display name, only an email; greet by the part before the @.
  const name = email.split('@')[0];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        showClose
        className="sm:max-w-2xl"
        // The choice decides where focus goes next (drop zone, URL field…); don't send it back.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="items-center text-center">
          <span
            className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500"
            aria-hidden="true"
          >
            <Rocket className="h-6 w-6 text-primary" />
          </span>
          <DialogTitle className="text-2xl">Welcome to Entrify{name ? `, ${name}` : ''}</DialogTitle>
          <DialogDescription>
            Put a site online in minutes. How do you want to deploy your first project?
          </DialogDescription>
        </DialogHeader>

        <FirstDeployChoices onPick={onPick} className="mt-4" />

        <div className="mt-4 flex justify-center">
          <Button variant="ghost" onClick={onClose}>
            I&apos;ll look around first
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
