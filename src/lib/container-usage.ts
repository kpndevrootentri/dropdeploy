/** Dependency-free so both the worker and tests can use it without Docker or Redis. */

/** Live resource use of a running container, from one Docker stats sample. */
export interface ContainerUsage {
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryLimitBytes: number;
}

/** The subset of Docker's stats payload {@link containerUsageFromStats} reads. */
export interface RawContainerStats {
  cpu_stats?: { cpu_usage?: { total_usage?: number; percpu_usage?: number[] }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: Record<string, number> };
}

/**
 * The same arithmetic `docker stats` uses. CPU is relative to one core, so a
 * container busy on two cores reads 200%. Memory excludes the reclaimable page
 * cache (`inactive_file` on cgroup v2, `total_inactive_file` on v1). Returns
 * null for a stopped container, whose stats carry no memory usage.
 */
export function containerUsageFromStats(s: RawContainerStats): ContainerUsage | null {
  const usage = s.memory_stats?.usage;
  if (usage === undefined) return null;
  const cpuDelta = (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
  const cpus = s.cpu_stats?.online_cpus || s.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
  const cache = s.memory_stats?.stats?.inactive_file ?? s.memory_stats?.stats?.total_inactive_file ?? 0;
  return {
    cpuPercent: cpuDelta > 0 && systemDelta > 0 ? (cpuDelta / systemDelta) * cpus * 100 : 0,
    memoryUsedBytes: Math.max(usage - cache, 0),
    memoryLimitBytes: s.memory_stats?.limit ?? 0,
  };
}
