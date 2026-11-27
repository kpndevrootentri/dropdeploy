/** Build logs of finished deployments are cleared after this many days; rows stay. */
export const BUILD_LOG_RETENTION_DAYS = 30;
/**
 * Newest deployments per project whose logs are always kept. Keep it at 10 or more:
 * the admin and batch mentor viewers list only a project's newest 10 and call an empty log never recorded.
 */
export const BUILD_LOGS_KEPT = 10;

/** Deployments that finished before this may have had their build log cleared. */
export function buildLogCutoff(): Date {
  return new Date(Date.now() - BUILD_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** What a log viewer shows for a finished deployment with no log; the retention note only once it could apply. */
export function emptyBuildLogText(finishedAt: string): string {
  return new Date(finishedAt) < buildLogCutoff()
    ? `No build log. Logs are kept for ${BUILD_LOG_RETENTION_DAYS} days, and always for the last ${BUILD_LOGS_KEPT} deployments and the live one.`
    : 'No build log.';
}
