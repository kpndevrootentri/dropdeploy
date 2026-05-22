'use client';

import Link from 'next/link';
import { ErrorPageContent } from '@/lib/error-page';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return (
    <ErrorPageContent
      digits={['5', '0', '0']}
      title="Internal Server Error"
      description="Something went wrong on our end. Please try again."
      actions={
        <>
          <button onClick={reset} className="ep-btn ep-btn-primary">
            Try again
          </button>
          <Link href="/dashboard" className="ep-btn ep-btn-ghost">
            Back to dashboard
          </Link>
        </>
      }
    />
  );
}
