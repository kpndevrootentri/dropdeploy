import { containerNameFor, type LabelledContainer } from '@/lib/docker-ops';

/** Same alphabet project slugs are generated from (see project.repository). */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Project containers whose project no longer exists. Deliberately narrow, as
 * removing one also deletes its images and data volume, and the platform's
 * own app, database and Redis may run in Docker on the same host:
 *
 * - it must carry the `dropdeploy.slug` label (only project images set it, so
 *   platform containers and anything else on the host never match),
 * - its name must be exactly `containerNameFor(label)` (a deploy's temporary
 *   `-next-` candidate never matches; it is cleaned up by its own deploy),
 * - and no project may have that slug.
 *
 * `projectSlugs` must come from a database read that succeeded; a failed read
 * must abort the cleanup, never be passed as an empty set.
 */
export function findOrphanContainers(containers: LabelledContainer[], projectSlugs: Set<string>): LabelledContainer[] {
  return containers.filter(
    (c) => SLUG.test(c.slug) && c.name === containerNameFor(c.slug) && !projectSlugs.has(c.slug),
  );
}
