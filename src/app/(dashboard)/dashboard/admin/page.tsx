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

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/users').then((r) => r.json()),
      fetch('/api/admin/projects').then((r) => r.json()),
    ])
      .then(([usersRes, projectsRes]) => {
        setStats({
          userCount: usersRes.data?.length ?? 0,
          projectCount: projectsRes.data?.length ?? 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Admin Overview</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
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
