import type { DomainStatus } from '@prisma/client';

export type { DomainStatus };

export type DnsRecordKind = 'A' | 'CNAME' | 'TXT';

/**
 * One DNS record the user must publish.
 *
 * Carries the record name twice on purpose. Registrars overwhelmingly ask for
 * the name *relative to the zone* — GoDaddy, Namecheap and Cloudflare all label
 * that field "Host" or "Name" and append the zone themselves. Pasting the fully
 * qualified name into it silently creates `host.example.com.example.com`, which
 * is the single most common way a custom-domain setup fails. So `host` is what
 * the UI shows first, and `name` is kept for the minority of providers that
 * want it fully qualified.
 */
export interface DnsInstruction {
  kind: DnsRecordKind;
  /** Fully qualified, e.g. `_dropdeploy-verify.todo.example.com`. */
  name: string;
  /** Relative to the zone, e.g. `_dropdeploy-verify.todo`. `@` means the root. */
  host: string;
  /** The registrable domain the user administers, e.g. `example.com`. */
  zone: string;
  value: string;
  note?: string;
}

/**
 * A custom domain as the API returns it and the settings panel renders it.
 *
 * Dates are ISO strings, not `Date`, because this crosses the wire — the client
 * component consumes exactly this shape.
 */
export interface DomainView {
  id: string;
  hostname: string;
  status: DomainStatus;
  isPrimary: boolean;
  redirectToPrimary: boolean;
  isApex: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  dnsRecords: DnsInstruction[];
}
