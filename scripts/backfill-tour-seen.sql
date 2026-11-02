-- One-off, run once after `npm run db:push` has created users.tour_seen_at
-- and users.welcome_seen_at:
--
--   psql -d dropdeploy -f scripts/backfill-tour-seen.sql
--
-- The dashboard tour is offered when a user's first project goes live. Without
-- this, every account that already has a live project is offered it at once
-- on the day it ships. They can still take it from the user menu.
--
-- The welcome modal greets accounts with no projects. Without this, someone
-- who used DropDeploy before it shipped and later deletes all their projects
-- is greeted as a brand-new user.
--
-- Safe to run more than once: rows already marked are left alone.
UPDATE "users" u
SET "tour_seen_at" = now()
WHERE u."tour_seen_at" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "deployments" d
    JOIN "projects" p ON p."id" = d."project_id"
    WHERE p."user_id" = u."id" AND d."status" = 'DEPLOYED'
  );

UPDATE "users" u
SET "welcome_seen_at" = now()
WHERE u."welcome_seen_at" IS NULL
  AND EXISTS (SELECT 1 FROM "projects" p WHERE p."user_id" = u."id");
