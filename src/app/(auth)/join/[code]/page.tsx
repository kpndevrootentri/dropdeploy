import type { Metadata } from 'next';
import { JoinForm } from './join-form';

// The join code is in the URL; never send it to another site in a Referer header.
export const metadata: Metadata = { title: 'Join a batch', referrer: 'no-referrer' };

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<React.ReactElement> {
  const { code } = await params;
  return <JoinForm code={code} />;
}
