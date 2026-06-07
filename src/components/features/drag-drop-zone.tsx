'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Upload,
  FileArchive,
  FileCode,
  Folder,
  Loader2,
  CheckCircle2,
  AlertCircle,
  CloudUpload,
  Rocket,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { detectUploadFileType } from '@/lib/upload-utils';

function nameFromFilename(filename: string): string {
  return filename
    .replace(/\.(zip|html|htm)$/i, '')
    .replace(/[^a-zA-Z0-9 _-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50) || 'my-site';
}

type DropState = 'idle' | 'dragging' | 'modal';
type UploadState = 'idle' | 'zipping' | 'uploading' | 'success' | 'error';

interface DroppedFile {
  file: File | null;
  folderName: string | null;
  isFolder: boolean;
}

export interface DragDropZoneProps {
  onSuccess?: () => void;
  disabled?: boolean;
}

// readEntries returns at most 100 entries per call; loop until the batch is empty.
async function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    all.push(...batch);
  } while (batch.length > 0);
  return all;
}

async function readAllFilesFromEntry(
  entry: FileSystemEntry,
  zip: JSZip,
  basePath = ''
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    await new Promise<void>((resolve, reject) => {
      fileEntry.file((f) => {
        const zipPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        zip.file(zipPath, f);
        resolve();
      }, reject);
    });
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const children = await readAllDirectoryEntries(dirEntry.createReader());
    for (const child of children) {
      await readAllFilesFromEntry(child, zip, dirPath);
    }
  }
}

export function DragDropZone({ onSuccess, disabled = false }: DragDropZoneProps): React.ReactElement {
  const router = useRouter();
  const [dropState, setDropState] = useState<DropState>('idle');
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [projectName, setProjectName] = useState('');
  const [droppedFile, setDroppedFile] = useState<DroppedFile | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  // Holds the dropped FileSystemEntry for folder uploads — avoids the window global slot.
  const entryRef = useRef<FileSystemEntry | null>(null);
  // XHR ref for aborting in-flight uploads on unmount.
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      xhrRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (disabled) return;

    const onDragEnter = (e: DragEvent): void => {
      e.preventDefault();
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) setDropState('dragging');
    };
    const onDragLeave = (e: DragEvent): void => {
      e.preventDefault();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current === 0) setDropState((s) => s === 'dragging' ? 'idle' : s);
    };
    const onDragOver = (e: DragEvent): void => { e.preventDefault(); };
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setDropState('idle');
      handleDrop(e.dataTransfer);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const handleDrop = useCallback((dataTransfer: DataTransfer | null): void => {
    if (!dataTransfer) return;
    const items = dataTransfer.items;
    if (!items || items.length === 0) return;

    const firstItem = items[0];
    const entry = firstItem.webkitGetAsEntry?.();

    if (entry?.isDirectory) {
      setDroppedFile({ file: null, folderName: entry.name, isFolder: true });
      setProjectName(nameFromFilename(entry.name));
      entryRef.current = entry;
      setDropState('modal');
      setUploadState('idle');
      setErrorMessage(null);
      return;
    }

    const file = dataTransfer.files[0];
    if (!file) return;

    if (!detectUploadFileType(file)) {
      setDroppedFile(null);
      setErrorMessage('Only ZIP files, HTML files, or folders are supported');
      setDropState('modal');
      setUploadState('error');
      return;
    }

    setDroppedFile({ file, folderName: null, isFolder: false });
    setProjectName(nameFromFilename(file.name));
    setDropState('modal');
    setUploadState('idle');
    setErrorMessage(null);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!detectUploadFileType(file)) {
      setDroppedFile(null);
      setErrorMessage('Only ZIP files and HTML files are supported');
      setDropState('modal');
      setUploadState('error');
      return;
    }

    setDroppedFile({ file, folderName: null, isFolder: false });
    setProjectName(nameFromFilename(file.name));
    setDropState('modal');
    setUploadState('idle');
    setErrorMessage(null);
  }, []);

  const handleDeploy = useCallback(async (): Promise<void> => {
    if (!droppedFile && uploadState !== 'error') return;
    if (!projectName.trim()) return;

    setErrorMessage(null);
    setUploadProgress(0);

    let fileToUpload: File;

    if (droppedFile?.isFolder) {
      setUploadState('zipping');
      try {
        const entry = entryRef.current;
        if (!entry) {
          setUploadState('error');
          setErrorMessage('Folder reference lost — please drop the folder again.');
          return;
        }
        const zip = new JSZip();
        await readAllFilesFromEntry(entry, zip);
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        fileToUpload = new File([blob], `${droppedFile.folderName ?? 'folder'}.zip`, { type: 'application/zip' });
      } catch {
        setUploadState('error');
        setErrorMessage('Failed to read the folder. Try zipping it first.');
        return;
      }
    } else if (droppedFile?.file) {
      fileToUpload = droppedFile.file;
    } else {
      return;
    }

    setUploadState('uploading');
    const formData = new FormData();
    formData.append('file', fileToUpload);
    formData.append('name', projectName.trim());

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open('POST', '/api/projects/upload');
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (!mountedRef.current) return;
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        xhrRef.current = null;
        if (!mountedRef.current) { resolve(); return; }
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText) as { data?: { project?: { id?: string }; url?: string } };
            const projectId = data?.data?.project?.id;
            if (!projectId) console.warn('DragDropZone: upload succeeded but response missing project.id');
            setResultUrl(data?.data?.url ?? '');
            setUploadState('success');
            setUploadProgress(100);
            onSuccess?.();
            if (projectId) {
              setTimeout(() => { if (mountedRef.current) router.push(`/projects/${projectId}`); }, 1400);
            }
          } catch {
            setUploadState('error');
            setErrorMessage('Unexpected response from server');
          }
        } else {
          try {
            const errData = JSON.parse(xhr.responseText);
            setErrorMessage(errData?.error?.message ?? 'Upload failed');
          } catch {
            setErrorMessage(`Upload failed (${xhr.status})`);
          }
          setUploadState('error');
        }
        resolve();
      };

      xhr.onerror = () => {
        xhrRef.current = null;
        if (!mountedRef.current) { resolve(); return; }
        setErrorMessage('Network error — please try again');
        setUploadState('error');
        resolve();
      };

      xhr.onabort = () => { xhrRef.current = null; resolve(); };

      xhr.send(formData);
    });
  }, [droppedFile, projectName, uploadState, onSuccess, router]);

  const resetModal = useCallback((): void => {
    setDroppedFile(null);
    setProjectName('');
    setUploadState('idle');
    setUploadProgress(0);
    setErrorMessage(null);
    setResultUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const fileIcon = droppedFile?.isFolder
    ? <Folder className="h-5 w-5 text-blue-500" />
    : droppedFile?.file?.name.endsWith('.zip')
      ? <FileArchive className="h-5 w-5 text-amber-500" />
      : <FileCode className="h-5 w-5 text-blue-400" />;

  const displayName = droppedFile?.isFolder ? droppedFile.folderName : droppedFile?.file?.name;

  return (
    <>
      {/* Full-page drag overlay */}
      {dropState === 'dragging' && !disabled && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-primary bg-background/95 px-20 py-14 shadow-2xl">
            <div className="rounded-full bg-primary/10 p-5">
              <CloudUpload className="h-14 w-14 text-primary animate-bounce" />
            </div>
            <p className="text-2xl font-bold text-foreground">Drop to publish</p>
            <p className="text-sm text-muted-foreground">Your site will be live in seconds</p>
          </div>
        </div>
      )}

      {/* Main drop zone */}
      <button
        type="button"
        onClick={() => !disabled && fileInputRef.current?.click()}
        disabled={disabled}
        className={cn(
          'group w-full rounded-2xl border-2 border-dashed transition-all duration-200 text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          disabled
            ? 'cursor-not-allowed border-border/30 bg-muted/20 opacity-60'
            : dropState === 'dragging'
              ? 'border-primary bg-primary/5 scale-[1.005]'
              : 'border-border/50 bg-gradient-to-b from-muted/30 to-muted/10 hover:border-primary/50 hover:bg-primary/[0.03] hover:scale-[1.002] cursor-pointer'
        )}
      >
        <div className="flex flex-col items-center gap-5 px-6 py-10 text-center">
          {/* Icon */}
          <div className={cn(
            'rounded-2xl p-4 transition-colors duration-200',
            disabled
              ? 'bg-muted/50'
              : dropState === 'dragging'
                ? 'bg-primary/15'
                : 'bg-muted/60 group-hover:bg-primary/10'
          )}>
            <CloudUpload className={cn(
              'h-10 w-10 transition-colors duration-200',
              disabled
                ? 'text-muted-foreground/40'
                : dropState === 'dragging'
                  ? 'text-primary animate-bounce'
                  : 'text-muted-foreground group-hover:text-primary'
            )} />
          </div>

          {/* Headline */}
          <div className="space-y-2">
            <p className={cn(
              'text-lg font-semibold',
              disabled ? 'text-muted-foreground' : 'text-foreground'
            )}>
              {dropState === 'dragging' ? 'Release to publish your site' : 'Publish your site in seconds'}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
              {disabled
                ? 'Project quota reached — contact an admin to create more projects'
                : 'Drop your files here, or click the button below to browse. No setup required.'}
            </p>
          </div>

          {/* Supported type pills */}
          {!disabled && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {[
                { icon: <Folder className="h-3.5 w-3.5" />, label: 'Project folder' },
                { icon: <FileArchive className="h-3.5 w-3.5" />, label: 'ZIP file' },
                { icon: <FileCode className="h-3.5 w-3.5" />, label: 'HTML page' },
              ].map(({ icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm"
                >
                  {icon}
                  {label}
                </span>
              ))}
            </div>
          )}

          {/* Browse button */}
          {!disabled && (
            <div
              className={cn(
                'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-all duration-150',
                'bg-primary text-primary-foreground shadow-sm',
                'group-hover:shadow-md group-hover:brightness-105',
                dropState === 'dragging' && 'opacity-0 pointer-events-none'
              )}
              aria-hidden="true"
            >
              <Upload className="h-4 w-4" />
              Browse files
            </div>
          )}

          {/* Pre-built note */}
          {!disabled && dropState !== 'dragging' && (
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-start gap-1.5 rounded-lg border border-amber-200/70 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20 px-3.5 py-2 max-w-sm text-left">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Drop built output only — not source code</p>
                  <p className="text-xs text-amber-700/80 dark:text-amber-400/70">
                    React / Vite → zip <code className="font-mono">dist/</code> &nbsp;·&nbsp; Next.js → zip <code className="font-mono">out/</code> <span className="opacity-70">(not <code className="font-mono">.next/</code>)</span> &nbsp;·&nbsp; AI tools → drop as-is
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,.html,.htm"
          className="hidden"
          onChange={handleFileInputChange}
          tabIndex={-1}
        />
      </button>

      {/* Deploy modal */}
      <Dialog
        open={dropState === 'modal'}
        onOpenChange={(open) => {
          if (!open && uploadState !== 'uploading' && uploadState !== 'zipping') {
            setDropState('idle');
            resetModal();
          }
        }}
      >
        <DialogContent showClose={uploadState !== 'uploading' && uploadState !== 'zipping'}>
          <DialogHeader>
            <DialogTitle>
              {uploadState === 'success' ? 'Your site is live!' : 'Almost there…'}
            </DialogTitle>
            <DialogDescription>
              {uploadState === 'success'
                ? 'Your site was published instantly.'
                : 'Give your site a name and hit Publish.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 pt-1">
            {/* File chip */}
            {displayName && uploadState !== 'error' && uploadState !== 'success' && (
              <div className="flex items-center gap-2.5 rounded-xl border bg-muted/40 px-3.5 py-2.5">
                {fileIcon}
                <span className="truncate text-sm font-medium">{displayName}</span>
              </div>
            )}

            {/* Project name */}
            {uploadState !== 'success' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ddz-name" className="font-medium">
                  What do you want to call your site?
                </Label>
                <Input
                  id="ddz-name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. my-portfolio"
                  maxLength={50}
                  autoFocus
                  disabled={uploadState === 'uploading' || uploadState === 'zipping'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && projectName.trim() && droppedFile) {
                      void handleDeploy();
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">Letters, numbers, spaces, hyphens, underscores</p>
              </div>
            )}

            {/* Progress */}
            {(uploadState === 'uploading' || uploadState === 'zipping') && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {uploadState === 'zipping' ? 'Compressing your folder…' : 'Uploading…'}
                  </span>
                  <span className="font-medium tabular-nums">
                    {uploadState === 'uploading' ? `${uploadProgress}%` : ''}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: uploadState === 'zipping' ? '8%' : `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {uploadState === 'zipping'
                    ? 'Reading your files…'
                    : uploadProgress < 100
                      ? 'Uploading your files…'
                      : 'Almost done — publishing…'}
                </p>
              </div>
            )}

            {/* Success */}
            {uploadState === 'success' && (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <div className="rounded-full bg-green-100 dark:bg-green-950/40 p-4">
                  <Rocket className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-base">Published successfully!</p>
                  {resultUrl && (
                    <a
                      href={resultUrl.startsWith('http') ? resultUrl : `https://${resultUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary underline underline-offset-2 break-all"
                    >
                      {resultUrl}
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Taking you to your project page…</p>
              </div>
            )}

            {/* Error */}
            {(uploadState === 'error' || errorMessage) && (
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950/30">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">Something went wrong</p>
                  <p className="text-xs text-red-600/80 dark:text-red-400/80">
                    {errorMessage ?? 'Please try again.'}
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            {uploadState !== 'success' && (
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => { setDropState('idle'); resetModal(); }}
                  disabled={uploadState === 'uploading' || uploadState === 'zipping'}
                >
                  Cancel
                </Button>
                <Button
                  size="default"
                  onClick={() => { void handleDeploy(); }}
                  disabled={
                    !projectName.trim() ||
                    uploadState === 'uploading' ||
                    uploadState === 'zipping' ||
                    !droppedFile
                  }
                  className="min-w-24"
                >
                  {(uploadState === 'uploading' || uploadState === 'zipping') ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Publishing…</>
                  ) : uploadState === 'error' ? (
                    'Try again'
                  ) : (
                    <><Rocket className="mr-2 h-4 w-4" />Publish</>
                  )}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
