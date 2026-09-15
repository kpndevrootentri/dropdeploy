/**
 * BullMQ worker that re-checks custom-domain DNS in the background.
 * Run with: npm run worker:domains
 *
 * Why a background job at all: people add a domain, copy the DNS records, go
 * and paste them at their registrar, and never come back to press "Verify".
 * Without this they would sit on PENDING_DNS forever despite having done
 * everything right. It is also the half of the takeover defence that no user
 * action would ever trigger — re-checking domains that are already live, so a
 * hostname whose ownership record has been pulled stops being served.
 *
 * One repeatable job wakes on an interval and checks a batch, rather than one
 * job per domain: the work is a handful of DNS queries, and a single job keeps
 * the queue size independent of how many domains the platform hosts.
 */

import { Worker, Queue, type Job } from 'bullmq';
import { getRedisConnection } from '@/lib/redis';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { domainService } from '@/services/domain';
import { domainRepository } from '@/repositories/domain.repository';

const log = createLogger('domain-worker');

const QUEUE_NAME = 'domain-checks';
const JOB_NAME = 'recheck';

/** How often the sweep runs. */
const SWEEP_INTERVAL_MS = 2 * 60_000;
/** Domains examined per sweep — bounds DNS fan-out per tick. */
const BATCH_SIZE = 50;
/** Shortest gap between two checks of the same domain. */
const MIN_RECHECK_MS = 2 * 60_000;
/** Longest gap, reached after repeated failures. */
const MAX_RECHECK_MS = 60 * 60_000;

/**
 * Hostnames we have already asked the edge to issue for, and the earliest we
 * may ask again.
 *
 * In-process rather than persisted: a worker restart costs at most one extra
 * request, which is cheaper than a migration and a column. `instances: 1` in
 * the PM2 config is what makes a single in-memory map sufficient.
 */
const issuanceAttempts = new Map<string, { attempts: number; nextAt: number }>();

function mayTriggerIssuance(hostname: string): boolean {
  const state = issuanceAttempts.get(hostname);
  return state === undefined || Date.now() >= state.nextAt;
}

/** Same doubling curve as the DNS re-check, so both back off alike. */
function recordIssuanceAttempt(hostname: string): void {
  const attempts = (issuanceAttempts.get(hostname)?.attempts ?? 0) + 1;
  issuanceAttempts.set(hostname, {
    attempts,
    nextAt: Date.now() + nextCheckDelayMs(attempts - 1),
  });
}

/**
 * Exponential back-off keyed on consecutive failures. A domain whose owner has
 * not touched DNS in an hour does not need to be probed every two minutes, and
 * backing off is what keeps a large set of abandoned domains from becoming a
 * standing load on both our resolver and theirs.
 */
function nextCheckDelayMs(failureCount: number): number {
  return Math.min(MIN_RECHECK_MS * 2 ** Math.max(0, failureCount), MAX_RECHECK_MS);
}

async function sweep(): Promise<void> {
  const now = Date.now();
  const candidates = await domainRepository.findDueForRecheck(
    new Date(now - MIN_RECHECK_MS),
    BATCH_SIZE,
  );

  let checked = 0;
  let triggered = 0;
  for (const domain of candidates) {
    const due =
      domain.lastCheckedAt === null ||
      now - domain.lastCheckedAt.getTime() >= nextCheckDelayMs(domain.failureCount);
    if (!due) continue;

    try {
      const result = await domainService.runCheck(domain);
      checked++;
      log.debug('Domain re-checked', {
        hostname: domain.hostname,
        from: domain.status,
        to: result.status,
      });

      // PROVISIONING is the one state nothing else will move. DNS is right and
      // issuance is authorised, but the certificate is only created by a real
      // TLS handshake — so make one, rather than waiting for a human to.
      if (result.status === 'PROVISIONING' && mayTriggerIssuance(domain.hostname)) {
        recordIssuanceAttempt(domain.hostname);
        const reached = await domainService.triggerIssuance(domain.hostname);
        log.info('Requested certificate', { hostname: domain.hostname, reached });
        triggered++;
      }

      // Once it is serving, forget the back-off so a future re-issue starts
      // from a clean slate instead of inheriting an hour-long delay.
      if (result.status === 'ACTIVE') {
        issuanceAttempts.delete(domain.hostname);
      }
    } catch (err) {
      // One bad domain must not abort the sweep for the rest of the batch.
      log.warn('Domain re-check failed', {
        hostname: domain.hostname,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (checked > 0) {
    log.info('Domain sweep complete', { candidates: candidates.length, checked, triggered });
  }
}

async function main(): Promise<void> {
  const config = getConfig();

  if (!config.CUSTOM_DOMAINS_ENABLED) {
    log.warn('CUSTOM_DOMAINS_ENABLED is off — domain worker will idle');
  }

  const connection = getRedisConnection();
  const queue = new Queue(QUEUE_NAME, { connection });

  // A fixed job id means restarting the worker re-uses the same schedule rather
  // than stacking a second repeatable job on top of the first.
  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { every: SWEEP_INTERVAL_MS },
      jobId: 'domain-recheck-sweep',
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 20 },
    },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async (_job: Job): Promise<void> => {
      if (!getConfig().CUSTOM_DOMAINS_ENABLED) return;
      await sweep();
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.error('Domain sweep job failed', { jobId: job?.id, error: err.message });
  });

  log.info('Domain worker started', { intervalMs: SWEEP_INTERVAL_MS, batchSize: BATCH_SIZE });

  const shutdown = async (signal: string): Promise<void> => {
    log.info('Shutting down domain worker', { signal });
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((err) => {
  log.error('Domain worker failed to start', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
