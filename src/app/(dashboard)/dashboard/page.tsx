'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
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
import { ProjectList, type ProjectItem, type ProjectQuota } from '@/components/features/project-list';
import { ProductTour } from '@/components/features/product-tour';
import { FirstDeployGuide, type FirstDeployChoice } from '@/components/features/first-deploy-guide';
import { WelcomeModal } from '@/components/features/welcome-modal';
import { Plus } from 'lucide-react';

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
  const [quota, setQuota] = useState<ProjectQuota | null>(null);
  const [hasLive, setHasLive] = useState<boolean | null>(null);
  // Sites a dropped file can replace instead of becoming a new project.
  const [uploadProjects, setUploadProjects] = useState<ProjectItem[]>([]);
  const [guideChoice, setGuideChoice] = useState<FirstDeployChoice | null>(null);
  // The drop zone opens the new project's page 1.4 s after an upload. Until then
  // the tour offer is held back, so it shows on return instead of flashing now.
  const [isLeaving, setIsLeaving] = useState(false);
  // The email the welcome modal greets; null while it is not showing.
  const [welcomeEmail, setWelcomeEmail] = useState<string | null>(null);
  // Set once the user starts a deploy, so a slow welcome check can't open on top of it.
  const hasStartedRef = useRef(false);

  const handleCreateSuccess = (): void => {
    setListRefresh((n) => n + 1);
    setCreateOpen(false);
  };

  const atLimit = quota !== null && quota.available === 0;
  // No projects yet, and room to create one: show the first-deploy guide.
  const isFresh = quota !== null && quota.used === 0 && quota.available > 0;
  const formGuide = isFresh && (guideChoice === 'github' || guideChoice === 'url') ? guideChoice : undefined;

  const pickGuide = (choice: FirstDeployChoice): void => {
    hasStartedRef.current = true;
    setGuideChoice(choice);
    if (choice !== 'upload') setCreateOpen(true);
  };

  // Only an account with no projects is asked, and only until it closes the modal once.
  useEffect(() => {
    if (!isFresh) return;
    const controller = new AbortController();
    fetch('/api/onboarding/welcome', { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data.data?.seen === false && !hasStartedRef.current) setWelcomeEmail(data.data.email ?? '');
      })
      // Aborted on unmount, or the request failed: no welcome this visit, nothing lost.
      .catch(() => {});
    return () => controller.abort();
  }, [isFresh]);

  const closeWelcome = (): void => {
    setWelcomeEmail(null);
    // A lost save only means the modal shows once more on the next visit.
    void fetch('/api/onboarding/welcome', { method: 'POST' }).catch(() => {});
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <div className="flex flex-col items-end gap-3" data-tour="create_project">
          {quota && <QuotaBar quota={quota} />}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <Button
              onClick={() => {
                if (atLimit) return;
                hasStartedRef.current = true;
                setCreateOpen(true);
              }}
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
              <CreateProjectForm embedded onSuccess={handleCreateSuccess} guide={formGuide} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isFresh && <FirstDeployGuide picked={guideChoice} onPick={pickGuide} />}

      <DragDropZone
        onSuccess={() => {
          setIsLeaving(true);
          handleCreateSuccess();
        }}
        uploadProjects={uploadProjects}
        canCreate={!atLimit}
        // Replacing a site needs no free slot, so only an account with nothing to replace is shut out.
        disabled={atLimit && uploadProjects.length === 0}
        highlighted={isFresh && guideChoice === 'upload'}
        onDismissHighlight={() => setGuideChoice(null)}
      />

      <ProjectList
        onRefresh={listRefresh}
        onQuota={setQuota}
        onLive={setHasLive}
        onProjects={(projects) => setUploadProjects(projects.filter((p) => p.source === 'UPLOAD'))}
      />

      <WelcomeModal
        open={welcomeEmail !== null}
        email={welcomeEmail ?? ''}
        onPick={(choice) => {
          closeWelcome();
          pickGuide(choice);
        }}
        onClose={closeWelcome}
      />

      <Suspense fallback={null}>
        <ProductTour hasLive={isLeaving ? null : hasLive} />
      </Suspense>
    </div>
  );
}
