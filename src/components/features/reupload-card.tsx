'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2, Upload } from 'lucide-react';
import { detectUploadFileType } from '@/lib/upload-utils';

type ReuploadState = 'idle' | 'uploading' | 'success' | 'error';

interface ReuploadCardProps {
  projectId: string;
  onSuccess?: () => void;
  disabled?: boolean;
}

export function ReuploadCard({ projectId, onSuccess, disabled = false }: ReuploadCardProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const mountedRef = useRef(true);
  const [state, setState] = useState<ReuploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      xhrRef.current?.abort();
    };
  }, []);

  const handleFile = useCallback((file: File): void => {
    const fileType = detectUploadFileType(file);
    if (!fileType) {
      setError('Only .zip and .html files are supported');
      setState('error');
      return;
    }

    setError(null);
    setState('uploading');
    setProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', `/api/projects/${projectId}/upload`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (!mountedRef.current) return;
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      xhrRef.current = null;
      if (!mountedRef.current) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        setState('success');
        setProgress(100);
        setTimeout(() => {
          if (!mountedRef.current) return;
          setState('idle');
          onSuccess?.();
        }, 1500);
      } else {
        try {
          const data = JSON.parse(xhr.responseText) as { error?: { message?: string } };
          setError(data?.error?.message ?? 'Upload failed');
        } catch {
          setError(`Upload failed (${xhr.status})`);
        }
        setState('error');
      }
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      if (!mountedRef.current) return;
      setError('Network error — please try again');
      setState('error');
    };

    xhr.onabort = () => { xhrRef.current = null; };

    xhr.send(formData);
  }, [projectId, onSuccess]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Re-upload</CardTitle>
        <CardDescription>Replace the current deployment with a new file.</CardDescription>
      </CardHeader>
      <CardContent>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,.html,.htm"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />

        {state === 'uploading' && (
          <div className="flex flex-col gap-2 mb-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Uploading…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {state === 'success' && (
          <p className="text-sm text-green-600 mb-3 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Deployed successfully!
          </p>
        )}

        {state === 'error' && error && (
          <p className="text-sm text-destructive mb-3">{error}</p>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={state === 'uploading' || disabled}
        >
          {state === 'uploading' ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="mr-2 h-3.5 w-3.5" />
          )}
          Choose file to re-deploy
        </Button>
      </CardContent>
    </Card>
  );
}
