'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GraduationCap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminRequest } from '@/components/admin/admin-request';

interface Membership {
  role: 'STUDENT' | 'MENTOR';
  joinedAt: string;
  cohort: { id: string; name: string; program: string; startsAt: string; endsAt: string };
}

const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function MyBatchesPage(): React.ReactElement {
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminRequest<Membership[]>('/api/cohorts').then(setMemberships).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (!memberships) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Your batches</h1>
        <p className="text-sm text-muted-foreground">Courses you study or mentor on Entrify.</p>
      </div>
      {memberships.length === 0 && (
        <p className="text-sm text-muted-foreground">You are not in a batch. Open the join link from your course to join one.</p>
      )}
      {memberships.map(({ role, cohort }) => (
        <Card key={cohort.id}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
              {cohort.name}
            </CardTitle>
            <CardDescription>
              {cohort.program} · {day(cohort.startsAt)} – {day(cohort.endsAt)} · you are a {role === 'MENTOR' ? 'mentor' : 'student'}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {role === 'MENTOR' ? (
              <Link href={`/dashboard/batches/${cohort.id}`} className="underline underline-offset-4">
                See your students, add students and read build logs
              </Link>
            ) : (
              <p className="text-muted-foreground">New projects you create are added to this batch, so your mentors can follow your progress.</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
