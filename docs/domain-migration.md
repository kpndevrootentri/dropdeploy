# Moving the platform to a new domain

Runbook for moving production from `app.en3.wtf` (tenants at
`<slug>.app.en3.wtf`) to `entrify.site`:

| | Old | New |
|---|---|---|
| Dashboard | `app.en3.wtf` | `entrify.site` (apex) |
| Tenant sites | `<slug>.app.en3.wtf` | `<slug>.entrify.site` |
| Custom-domain CNAME target | `ingress.en3.wtf` | `ingress.entrify.site` |

The app takes its domain from env, so the move is mostly configuration. The
code side is the old-domain edge block (`infra/caddy/legacy-domain.caddy`), the
webhook re-point script, and the CLI default. The steps below are in order.

> [!warning] Every tenant is behind this edge
> The app can serve only one `BASE_DOMAIN` at a time. Between restarting the
> app on the new env (step 6) and recreating Caddy (step 7), requests fail. Run
> those two steps back to back, at a quiet hour.

## 1. DNS

In the `entrify.site` zone, all pointing at the box (`3.109.99.141`):

- `entrify.site` A
- `*.entrify.site` A. This covers tenants, `www` and `ingress`.

Keep every `en3.wtf` record. Old links, old CLIs, GitHub webhooks and custom
domains CNAME'd to `ingress.en3.wtf` go through them until step 10.

## 2. Wildcard certificate

The certificate must cover `entrify.site` and `*.entrify.site`. Issue it over
DNS-01 with the Route 53 plugin, so it renews by itself. The `app.en3.wtf`
certificate is `manual` and does not renew; see
`docs/nginx-to-caddy-cutover.md`.

```bash
sudo apt install python3-certbot-dns-route53   # needs Route 53 credentials for the zone
sudo certbot certonly --dns-route53 -d entrify.site -d '*.entrify.site'
# → /etc/letsencrypt/live/entrify.site/{fullchain,privkey}.pem
```

## 3. Pre-checks

`ingress` is now a reserved slug, because it is the CNAME target. Rename any
existing project that uses it before the move:

```sql
SELECT id, slug, user_id FROM projects WHERE slug = 'ingress';
SELECT hostname, status FROM custom_domains;  -- owners to notify in step 10
```

## 4. OAuth apps

- **GitHub OAuth app:** set the callback URL to
  `https://entrify.site/api/auth/github/callback`. GitHub allows only one
  callback URL, so do this at cutover time.
- **GitLab application:** add `https://entrify.site/api/auth/gitlab/callback`
  as an extra redirect URI. Remove the old one in step 10.

## 5. App env (`ShipEntri/.env`)

Back up first, so the rollback below needs no rebuild:

```bash
cp -a .env .env.pre-migration
cp -a .next .next.prev
cp -a /home/ubuntu/caddy /home/ubuntu/caddy.pre-migration
```

Then set:

```bash
APP_URL="https://entrify.site"
NEXT_PUBLIC_APP_URL="https://entrify.site"
BASE_DOMAIN="entrify.site"
NEXT_PUBLIC_BASE_DOMAIN="entrify.site"
CUSTOM_DOMAIN_CNAME_TARGET="ingress.entrify.site"
# Keep this set. checkRouting() falls back to resolving A records, so domains
# still CNAME'd to ingress.en3.wtf (same IP) keep verifying instead of
# failing their re-checks.
PLATFORM_INGRESS_IP="3.109.99.141"
```

Update any `PLATFORM_EXTRA_HOSTS` entries under the old domain too.

## 6. Build and restart the app

`NEXT_PUBLIC_*` values are inlined at build time, so a restart alone is not
enough. Build with the new env, then restart. Go straight on to step 7.

```bash
npm run build
pm2 restart dropdeploy-app dropdeploy-worker dropdeploy-domains --update-env
```

## 7. Edge

In `/home/ubuntu/caddy`, copy in the new `Caddyfile`,
`docker-compose.caddy.yml` and `sites/` from `infra/caddy/`. Then turn on the
old-domain block:

```bash
mkdir -p sites && cp legacy-domain.caddy sites/
```

In `caddy/.env`:

```bash
BASE_DOMAIN=entrify.site
WILDCARD_CERT=/etc/letsencrypt/live/entrify.site/fullchain.pem
WILDCARD_KEY=/etc/letsencrypt/live/entrify.site/privkey.pem
LEGACY_BASE_DOMAIN=app.en3.wtf
LEGACY_WILDCARD_CERT=/etc/letsencrypt/live/app.en3.wtf/fullchain.pem
LEGACY_WILDCARD_KEY=/etc/letsencrypt/live/app.en3.wtf/privkey.pem
```

Validate before swapping, then recreate the container. The mounts and env
changed, so `caddy reload` is not enough:

```bash
docker compose -f docker-compose.caddy.yml run --rm caddy caddy validate --config /etc/caddy/Caddyfile
docker compose -f docker-compose.caddy.yml up -d
```

The old-domain block does this:

- Pages on `app.en3.wtf` redirect (308) to `entrify.site`.
- `app.en3.wtf/api/*` is proxied in place, not redirected. GitHub drops
  webhook deliveries that get a redirect, and fetch strips the CLI's
  `Authorization` header on a cross-origin redirect.
- `<slug>.app.en3.wtf/<path>` redirects (308) to `<slug>.entrify.site/<path>`.

## 8. Verify

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://entrify.site/login                 # 200
curl -sS -o /dev/null -w "%{http_code}\n" https://<slug>.entrify.site/               # tenant's own status
curl -sSI https://www.entrify.site/ | grep -i '^location'                             # https://entrify.site/
curl -sSI https://app.en3.wtf/login | grep -i '^location'                            # https://entrify.site/login
curl -sSI 'https://<slug>.app.en3.wtf/a?b=1' | grep -i '^location'                   # https://<slug>.entrify.site/a?b=1
curl -sS https://app.en3.wtf/api/auth/session                                        # {"success":true,"data":null}, the app answering, not a 308
```

Sign in, connect GitHub (the callback from step 4), and deploy one project.

## 9. Re-point GitHub webhooks

Existing hooks still post to `app.en3.wtf`. Step 7 keeps them working, but only
until the old domain goes. Re-register each one against the new `APP_URL`:

```bash
npx tsx scripts/repoint-github-webhooks.ts
```

A `FAIL` line usually means the owner disconnected GitHub. That owner can
turn auto-deploy off and on again once they reconnect.

## Rollback

The code runs on either domain, so rolling back needs no revert. Use the
backups from step 5:

```bash
cp -a .env.pre-migration .env
rm -rf .next && mv .next.prev .next
pm2 restart dropdeploy-app dropdeploy-worker dropdeploy-domains --update-env
cd /home/ubuntu && rm -rf caddy && mv caddy.pre-migration caddy
cd caddy && docker compose -f docker-compose.caddy.yml up -d
```

Then set the GitHub OAuth callback back to the old URL. If step 9 already ran,
re-run the script with the old `APP_URL` in place.

## 10. Afterwards

- **CLI.** Publish `dropdeploy-cli` 1.0.4: `cd plugin && npm publish`. It
  defaults to `entrify.site` and rewrites saved `app.en3.wtf` logins. Tokens
  stay valid because `JWT_SECRET` is unchanged. Older CLIs keep working through
  the proxied `/api/*` until retirement.
- **Sessions.** Browser cookies are per host, so everyone signs in once on
  `entrify.site`.
- **Custom domains.** Ask owners from step 3 to change their CNAME to
  `ingress.entrify.site`. Until they do, those domains depend on `en3.wtf` DNS.
- **Retire the old domain** before its certificate expires on 2026-12-03:
  1. Delete `sites/legacy-domain.caddy` and run `docker compose up -d`.
  2. Remove the old GitLab redirect URI.
  3. Delete the old certificate:
     ```bash
     sudo certbot delete --cert-name app.en3.wtf
     sudo certbot delete --cert-name app.en3.wtf-0001
     ```
  4. Drop the `en3.wtf` records only once no custom domain points at
     `ingress.en3.wtf`.
- **Clean-up.** Remove the `ponytail:` legacy-URL remap in `plugin/src/auth.ts`
  in a later CLI release.
