import Link from 'next/link';
import { ErrorPageContent } from '@/lib/error-page';

export default function NotFound(): React.ReactElement {
  return (
    <ErrorPageContent
      digits={['4', '0', '4']}
      title="Page Not Found"
      description="The page you're looking for doesn't exist."
      actions={
        <Link href="/dashboard" className="ep-btn ep-btn-ghost">
          Back to dashboard
        </Link>
      }
    />
  );
}
