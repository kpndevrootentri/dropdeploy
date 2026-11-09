import type { Metadata } from 'next';
import { InviteForm } from './invite-form';

// The token is in the URL; never send it to another site in a Referer header.
export const metadata: Metadata = { title: 'Accept invite', referrer: 'no-referrer' };

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  return <InviteForm token={token} />;
}
