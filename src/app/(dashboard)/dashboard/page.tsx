'use client';

import { useEffect, useState } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CreateProjectForm } from '@/components/features/create-project-form';
import { DragDropZone } from '@/components/features/drag-drop-zone';
import { ProjectList, type ProjectQuota } from '@/components/features/project-list';
import { Plus, X } from 'lucide-react';

function QuotaBar({ quota }: { quota: ProjectQuota }): React.ReactElement {
  const { used, limit, available } = quota;
  const pct = limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const atLimit = available === 0;
  const nearLimit = !atLimit && available <= 1;

  return (
    <div className="flex flex-col gap-1.5 min-w-[180px]">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Projects</span>
        <span className={atLimit ? 'text-red-500 font-semibold' : nearLimit ? 'text-amber-500 font-medium' : ''}>
          {used} / {limit}
          {available > 0 && (
            <span className="ml-1.5 text-muted-foreground font-normal">
              ({available} left)
            </span>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            atLimit
              ? 'bg-red-500'
              : nearLimit
                ? 'bg-amber-500'
                : 'bg-primary'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {atLimit && (
        <p className="text-xs text-red-500">
          Quota reached — contact an admin to increase your limit.
        </p>
      )}
    </div>
  );
}

export default function DashboardPage(): React.ReactElement {
  const [listRefresh, setListRefresh] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [quota, setQuota] = useState<ProjectQuota | null>(null);

  useEffect(() => {
    const dismissed = localStorage.getItem('welcome-dismissed');
    if (!dismissed) {
      setShowWelcome(true);
    }
  }, []);

  const handleCreateSuccess = (): void => {
    setListRefresh((n) => n + 1);
    setCreateOpen(false);
  };

  const atLimit = quota !== null && quota.available === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <div className="flex flex-col items-end gap-3">
          {quota && <QuotaBar quota={quota} />}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <Button
              onClick={() => { if (!atLimit) setCreateOpen(true); }}
              disabled={atLimit}
              title={atLimit ? 'Project quota reached' : undefined}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create project
            </Button>
            <DialogContent showClose={true}>
              <DialogHeader>
                <DialogTitle>Create project</DialogTitle>
                <DialogDescription>
                  Add a new project. Choose a name, framework, and paste your GitHub repository URL.
                </DialogDescription>
              </DialogHeader>
              <CreateProjectForm embedded onSuccess={handleCreateSuccess} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <DragDropZone onSuccess={handleCreateSuccess} disabled={atLimit} />

      {showWelcome && (
        <Card className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-6 w-6"
            onClick={() => {
              setShowWelcome(false);
              localStorage.setItem('welcome-dismissed', 'true');
            }}
          >
            <X className="h-4 w-4" />
          </Button>
          <CardHeader>
            <CardTitle>Welcome to DropDeploy</CardTitle>
            <CardDescription>
              Get your site online in two ways: drop a ZIP, HTML file, or folder directly onto the zone below for instant publishing — or click <strong>Create project</strong> to connect a GitHub repository.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <ProjectList onRefresh={listRefresh} onQuota={setQuota} />
    </div>
  );
}
