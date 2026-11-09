'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface Stats {
  userCount: number;
  projectCount: number;
}

export default function AdminOverviewPage(): React.ReactElement {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/stats')
      .then((r) => r.json())
      .then((res: { success: boolean; data?: Stats; error?: { message: string } }) => {
        if (res.success && res.data) setStats(res.data);
        else setError(res.error?.message ?? 'Failed to load stats');
      })
      .catch(() => setError('Failed to load stats'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Admin Overview</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Total Users</CardDescription>
              <CardTitle className="text-4xl">{stats?.userCount ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Total Projects</CardDescription>
              <CardTitle className="text-4xl">{stats?.projectCount ?? 0}</CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}
    </div>
  );
}
