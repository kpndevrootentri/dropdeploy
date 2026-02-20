import { ForbiddenError } from '@/lib/errors';
import type { Session } from '@/lib/get-session';

export function requireContributor(session: Session): void {
  if (session.role !== 'CONTRIBUTOR') {
    throw new ForbiddenError('Contributor access required');
  }
}
