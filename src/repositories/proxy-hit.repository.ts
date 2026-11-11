import { prisma } from '@/lib/prisma';

export interface IProxyHitRepository {
  countOlderThan(cutoff: Date): Promise<number>;
  deleteOlderThan(cutoff: Date): Promise<number>;
}

export class ProxyHitRepository implements IProxyHitRepository {
  async countOlderThan(cutoff: Date): Promise<number> {
    return prisma.proxyHit.count({ where: { createdAt: { lt: cutoff } } });
  }

  // ponytail: one deleteMany; batch it if proxy_hits grows to tens of millions of rows.
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const { count } = await prisma.proxyHit.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return count;
  }
}

export const proxyHitRepository = new ProxyHitRepository();
