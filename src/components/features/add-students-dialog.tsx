'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CopyValue } from '@/components/ui/copy-value';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminRequest } from '@/components/admin/admin-request';
import { extractEmails } from '@/lib/utils';

/** The same limit the server enforces. */
const MAX_EMAILS = 100;

interface AddStudentsResult {
  /** invitePath is null for a mentor while email is on: the invite went by email only. */
  invited: { email: string; invitePath: string | null }[];
  added: string[];
  skipped: { email: string; reason: string }[];
  emailing: boolean;
}

interface AddStudentsDialogProps {
  cohortId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a request went through, so the page can reload its members. */
  onDone: () => void;
}

/** Invite links are returned as paths; people share the full URL. */
const inviteUrl = (path: string): string => `${window.location.origin}${path}`;

/** Adds students to a batch by email, for admins and the batch's mentors, then shows what happened to each. */
export function AddStudentsDialog({ cohortId, open, onOpenChange, onDone }: AddStudentsDialogProps): React.ReactElement {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AddStudentsResult | null>(null);
  const emails = extractEmails(text);

  const changeOpen = (next: boolean): void => {
    // Stay open until the request finishes, so its result (and any one-time links) is always seen.
    if (!next && submitting) return;
    // Start empty next time; the links stay on screen only until the dialog closes.
    if (!next) {
      setText('');
      setError(null);
      setResult(null);
    }
    onOpenChange(next);
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (emails.length === 0) return setError('No email addresses found');
    if (emails.length > MAX_EMAILS) return setError(`Up to ${MAX_EMAILS} at a time; this list has ${emails.length}.`);
    setError(null);
    setSubmitting(true);
    try {
      setResult(await adminRequest<AddStudentsResult>(`/api/cohorts/${cohortId}/students`, { method: 'POST', body: { emails } }));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const links = (result?.invited ?? []).flatMap((i) => (i.invitePath ? [{ email: i.email, url: inviteUrl(i.invitePath) }] : []));

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        className="sm:max-w-lg"
        showClose={!submitting}
        // A stray click on the dimmed page must not throw away links shown only once; Done, the X and Esc still close it.
        onInteractOutside={(event) => { if (result) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Add students</DialogTitle>
          <DialogDescription>People with no Entrify account get an invite to choose a password, and join this batch as students.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="min-w-0 space-y-3 text-sm">
            <p>
              <span className="font-semibold">{result.invited.length}</span> invited ·{' '}
              <span className="font-semibold">{result.added.length}</span> added ·{' '}
              <span className="font-semibold">{result.skipped.length}</span> skipped
            </p>
            {result.invited.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">
                  {!result.emailing
                    ? 'Not emailed (email is off). Send each person their own link: shown once, valid for 7 days.'
                    : links.length > 0
                      ? "Invite emails are on their way, as far as today's email quota allows; Admin → Email lists any held back. These links are a backup: shown once, valid for 7 days."
                      : "Each person gets their invite by email, valid for 7 days. If one doesn't arrive, ask an admin for a new link."}
                </p>
                {links.length > 0 && (
                  <CopyValue label="All links (email, link per line)" value={links.map((l) => `${l.email},${l.url}`).join('\n')} />
                )}
                <ul className="max-h-48 space-y-2 overflow-y-auto pt-1">
                  {result.invited.map((i) => (
                    <li key={i.email}>
                      {i.invitePath ? (
                        <CopyValue label={i.email} value={inviteUrl(i.invitePath)} />
                      ) : (
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate font-mono text-xs">{i.email}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">Invite emailed</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.added.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">Added</p>
                <p className="max-h-32 overflow-y-auto break-all rounded-md bg-muted p-2 font-mono text-xs">{result.added.join(', ')}</p>
              </div>
            )}
            {result.skipped.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">Skipped</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-muted p-2 text-xs">
                  {result.skipped.map((s) => (
                    <li key={s.email} className="break-all">
                      <span className="font-mono">{s.email}</span>: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <form id="add-students-form" onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="add-students-emails">Emails</Label>
              <Textarea
                id="add-students-emails"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                autoFocus
                aria-describedby="add-students-hint"
                placeholder={'one@entri.me\ntwo@entri.me'}
                className="font-mono text-xs"
              />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p id="add-students-hint" className="text-xs text-muted-foreground">One per line, or paste a list. Up to {MAX_EMAILS} at a time.</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {emails.length} email{emails.length === 1 ? '' : 's'} found
                </p>
              </div>
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </form>
        )}
        <DialogFooter className="gap-2">
          {result ? (
            <Button onClick={() => changeOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => changeOpen(false)} disabled={submitting}>Cancel</Button>
              <Button type="submit" form="add-students-form" disabled={submitting || emails.length === 0}>
                {submitting ? 'Adding…' : `Add ${emails.length || ''} student${emails.length === 1 ? '' : 's'}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
