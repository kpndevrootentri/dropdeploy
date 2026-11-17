'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GraduationCap, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface AddToBatchCardProps {
  projectId: string;
  cohortId: string | null;
  onAdded: () => void;
}

interface Membership {
  role: 'STUDENT' | 'MENTOR';
  cohort: { id: string; name: string };
}

/**
 * Lets a student put an older project in their batch. Shows a short note once the project is
 * in a batch, and nothing for anyone who isn't an active student.
 */
export function AddToBatchCard({ projectId, cohortId, onAdded }: AddToBatchCardProps): React.ReactElement | null {
  const [batch, setBatch] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState(false);
  // Set on success, so a stale poll that still says cohortId: null can't bring the button back.
  const [added, setAdded] = useState(false);
  const inBatch = cohortId !== null || added;

  useEffect(() => {
    if (cohortId !== null) return;
    let ignore = false;
    fetch('/api/cohorts')
      .then((res) => res.json())
      // Newest-joined first, so the first STUDENT row is the batch the server will pick.
      .then((body: { success?: boolean; data?: Membership[] }) => {
        if (!ignore) setBatch(body.success ? body.data?.find((m) => m.role === 'STUDENT')?.cohort ?? null : null);
      })
      .catch(() => { /* no batch information: the card stays hidden */ });
    return () => { ignore = true; };
  }, [cohortId]);

  if (inBatch) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="h-4 w-4" aria-hidden />Batch</CardTitle>
          <CardDescription>In a batch: its mentors can see this project.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!batch) return null;

  const add = async (): Promise<void> => {
    if (!confirm(`Current and future mentors of ${batch.name} can open this project's private site and read its build logs, including builds from before today. This stays if you leave the batch. Only an admin can undo it.`)) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/cohort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cohortId: batch.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? 'Could not add the project to the batch');
      toast.success(`Added to ${body.data.name}`);
      setAdded(true);
      onAdded();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="h-4 w-4" aria-hidden />Batch</CardTitle>
        <CardDescription>Made this before you joined {batch.name}? Add it so your mentors can see it.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" disabled={adding} onClick={() => void add()}>
          {adding ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />Adding…</> : `Add to ${batch.name}`}
        </Button>
      </CardContent>
    </Card>
  );
}
