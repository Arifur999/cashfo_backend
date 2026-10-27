# Deploying Cashfo to srv1881651

Target: `smartly.softech.agency` on the Hostinger VPS (Ubuntu 24.04, 8 GB),
beside `furnify.softech.agency`, `softech.agency` and
`travance.softech.agency`, which must keep running untouched.

This is the box's *adding another site* runbook -- the one
`travelar_backend/deploy` wrote for Travelar -- applied to Cashfo: an API
container with its own Postgres, and the admin panel (`cashfo` repo) in front
of it.

## How a change reaches the live site

```
pull request (either repo)
  -> GitHub Actions CI: lint, typecheck, unit tests, build, Docker image
     (the API also: every migration on an empty database + the bootstrap)
merge to main
  -> CI again as the quality gate, then the image is pushed to
     ghcr.io/arifur999/cashfo-api or ghcr.io/arifur999/cashfo-web
  -> within 2 min, smartly-deploy.timer on the VPS sees the new digest
  -> docker compose up -d   (a new API image runs smartly-migrate first)
  -> waits until smartly-api and smartly-web are both healthy
  -> otherwise re-tags the previous images, starts them again, and never
     tries that build again
```

A red CI run publishes nothing, so the site keeps running the last good
release. A push that only changes docs (or, in this repo, `deploy/`) publishes
nothing either, so it restarts nothing. CI has no push trigger of its own:
on `main` it runs only as Deploy's quality gate, so each merge is tested once.

A release replaces the containers, which takes a few seconds. During that
window nginx answers with a 503 "Updating" page that reloads itself, not a
bare 502. Nothing in GitHub can reach the server: its runners are filtered on
port 22, so the server pulls instead, and no SSH key is stored in GitHub.

The two repos release independently. A change that needs both sides should
reach the API first and keep it backward compatible, since the web image may
arrive a few minutes earlier or later. For the same reason, and because a
rollback restores code but not the schema, **migrations must be additive**
(new tables, nullable or defaulted columns).

### Branches

`main` is the live site. Work happens on a branch, reaches `main` through a
pull request, and CI must be green before merging. To make GitHub enforce
that: repo Settings -> Branches -> Add branch protection rule for `main` ->
*Require status checks to pass before merging* -> pick the CI checks. (On a
private repo, branch protection needs GitHub Pro. Without it nothing is
enforced, but a red quality gate still publishes nothing.)

## How it fits together

```
                      :80 / :443
                          |
            hatim_backend-nginx-1   (furnify's proxy, shared)
     |               |                  |                       |
 furnify...    softech.agency   travance.softech.agency   smartly.softech.agency
                                                                |
                                                          smartly-web:3000
                                                                |  /api/auth/* and server calls
                                                          smartly-api:5000
                                                                |
                                                          smartly-db   (internal network)
          ---------------- hatim_backend_default ----------------
```

- **No host ports.** nginx reaches `smartly-web` by name over
  `hatim_backend_default`. `smartly-api` and Postgres are only on the stack's
  internal network: the panel talks to the API server-side, and passes
  better-auth's public endpoints (`/api/auth/*`, for Google sign-in and the
  Infra dashboard) on to it.
- **Unique names.** Every service is `smartly-*`, because Docker adds each
  service name as a DNS alias on the shared network.
- **Memory.** Each container has a ceiling: db 512 MB, API 768 MB, web
  512 MB, migrate 384 MB, backup 128 MB.
- **Our own vhost file.** It lives at
  `/opt/smartly/nginx/smartly.softech.agency.conf` and is bind mounted into
  the proxy's `conf.d`. It is never appended to furnify's `nginx.conf`,
  which furnify's deploy rewrites.

## First-time setup

**1. DNS.** `smartly.softech.agency` already has an `A` record for
`187.127.124.251`. `attach-site.sh` checks it again before asking Let's
Encrypt for anything.

**2. Images.** Merge to `main` in both repos and wait for each *Deploy*
workflow to go green. Both packages (`cashfo-api`, `cashfo-web`) are private,
so the server has to log in to ghcr.io before it can pull them: see
[Private repos and images](#private-repos-and-images).

**3. Google sign-in.** The OAuth client's authorized redirect URI must be
`https://smartly.softech.agency/api/auth/callback/google` (and the origin
`https://smartly.softech.agency`).

**4. On the VPS, as root:**

```bash
# the repo is private: set up its deploy key first (Private repos and images)
git clone git@github-cashfo_backend:Arifur999/cashfo_backend.git /root/smartly-src
cd /root/smartly-src/deploy

# asks for the super admin's email: their login and the Let's Encrypt contact
read -rp "Super admin email: " E && bash bootstrap.sh "$E"
bash set-env.sh GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET         # Google sign-in; can wait
bash set-env.sh RESEND_API_KEY IMGBB_API_KEY BETTER_AUTH_API_KEY   # email, avatars, dashboard; can wait
bash set-env.sh VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT  # reminder push; can wait (see below)
bash install.sh                        # start the stack, create the super admin, install the timers
bash attach-site.sh                    # certificate + vhost, checks the neighbours
```

Each script stops at the first problem and says what to fix, and each is safe
to re-run.

- `attach-site.sh` refuses to call certbot until DNS points here, so a typo
  does not spend Let's Encrypt's rate limit.
- It tests the proxy config in a throwaway container before recreating the
  real one (the only moment the other sites blink: a 2-3 second restart of
  the shared nginx, once).
- It compares furnify, softech.agency and travance before and after, and
  withdraws its own block if any of them changed.

Reminder push (Habit Tracker reminders on phones and computers) needs a VAPID
key pair, made once and then kept: a new pair orphans every device that
subscribed with the old one. Make it once the stack runs, then set it with the
`set-env.sh` line above; `VAPID_SUBJECT` is a contact address for the push
services, e.g. `mailto:support@softech.agency`. Without it the bell still gets
every reminder.

```bash
docker exec smartly-api node_modules/.bin/web-push generate-vapid-keys
```

The API runs two timers of its own, inside the container: the reminder
scheduler (every minute) and housekeeping (every five minutes: customer
checkouts left unpaid past their time, plans whose paid period or free trial
ran out, "your plan ends in 3 days" notices, referral commissions leaving
their refund window, and hourly, used-up one-time codes). Both are on by default;
`REMINDERS_DISABLED=1` / `HOUSEKEEPING_DISABLED=1` (set with `set-env.sh`) turn
one off. Housekeeping takes a Postgres advisory lock per tick, so a second API
container never doubles it, and a customer's own billing or referral page
does the same work for them when it opens.

Referral withdrawals are confirmed with a six-digit code sent by email, so
they need `RESEND_API_KEY`; without it, starting a withdrawal answers 503
`EMAIL_NOT_CONFIGURED`. There is no SMS provider yet (the code goes by email).

**5. Sign in** at `https://smartly.softech.agency/login` with
`SUPER_ADMIN_EMAIL` and its password -- or with Google, when that address is a
Google account:

```bash
grep SUPER_ADMIN_PASSWORD /opt/smartly/.env
```

More super admins can be added from Security -> Admins.

**6. Check from anywhere:**

```bash
curl -sI https://smartly.softech.agency/login | head -1
echo | openssl s_client -connect smartly.softech.agency:443 \
  -servername smartly.softech.agency 2>/dev/null | openssl x509 -noout -subject
for d in softech.agency furnify.softech.agency travance.softech.agency; do
  curl -s -o /dev/null -w "$d -> %{http_code}\n" "https://$d/"
done
```

## Making it permanent on the furnify side

`smartly-vhost.timer` puts the mount back if a furnify release drops it, but
it is better if that never happens. Add this line to the nginx service's
`volumes:` in the **furnify repo's** compose file, under the `./nginx.conf`
line, and commit it:

```yaml
- /opt/smartly/nginx/smartly.softech.agency.conf:/etc/nginx/conf.d/smartly.softech.agency.conf:ro
```

## Private repos and images

The repos and their images are private. GitHub Actions needs nothing for that,
but the box needs two kinds of read-only access. Both are set up once and
survive reboots.

**Pulling images: log the box in to ghcr.io.** Once for the whole box:
Travelar's and softech.agency's agents use the same login. Make a classic
token (GitHub -> Settings -> Developer settings -> Personal access tokens ->
Tokens (classic) -> *Generate new token*) with only the `read:packages` scope,
then, as root, paste it when asked:

```bash
docker login ghcr.io -u Arifur999
```

Docker keeps it in `/root/.docker/config.json`. If the token has an expiry
date, write it down: after it every pull fails, `journalctl -u smartly-deploy`
says so, and the site stays on its last release until the box logs in again.

**Pulling code: a read-only deploy key per clone.** GitHub accepts a deploy
key on one repo only, so each clone on the box gets its own key under its own
`Host` alias:

| Clone | Repo | As |
|---|---|---|
| `/root/smartly-src` | `cashfo_backend` | root |
| `/root/travelar-src` | `travelar_backend` | root |
| `/root/softech-src` | `softech_agency` | root |
| `/srv/hatim/hatim_Backend` | `ss_backend` (furnify) | the user in its `VPS_USER` secret: its Deploy workflow runs `git fetch` there |

For one row at a time, as the user in the last column:

```bash
REPO=cashfo_backend DIR=/root/smartly-src
ssh-keygen -t ed25519 -N "" -C "srv1881651 $REPO" -f ~/.ssh/deploy_$REPO
printf 'Host github-%s\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/deploy_%s\n  IdentitiesOnly yes\n' "$REPO" "$REPO" >> ~/.ssh/config
cat ~/.ssh/deploy_$REPO.pub
```

GitHub -> that repo -> Settings -> Deploy keys -> *Add deploy key*: paste the
`ssh-ed25519 ...` line and leave *Allow write access* off. Then:

```bash
git -C "$DIR" remote set-url origin "git@github-$REPO:Arifur999/$REPO.git"
git -C "$DIR" pull
```

The first connection asks whether to trust github.com. Answer `yes` only if
the fingerprint it shows is `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`.

**Moving a running box off the old public images.** Once, after both repos'
first green *Deploy* under the new names:

```bash
sed -i -e 's|^API_IMAGE=.*|API_IMAGE=ghcr.io/arifur999/cashfo-api:latest|' \
       -e 's|^WEB_IMAGE=.*|WEB_IMAGE=ghcr.io/arifur999/cashfo-web:latest|' /opt/smartly/.env
systemctl start smartly-deploy && journalctl -u smartly-deploy -n 20 --no-pager
```

When `docker ps --filter name=smartly-` shows both containers on the new
images, delete the old packages: GitHub -> your profile -> Packages ->
`cashfo_backend` (then `cashfo`) -> Package settings -> *Delete this package*.
They were renamed, not hidden, because GitHub cannot make a public package
private again.

## Operations

```bash
# state
docker ps --filter name=smartly-
systemctl list-timers 'smartly-*'
journalctl -u smartly-deploy -u smartly-vhost --since '1 hour ago'

# release now instead of waiting up to 2 minutes
systemctl start smartly-deploy

# pause releases during hands-on work (the deploy timer skips while it exists)
touch /opt/smartly/.maintenance      # ... and rm /opt/smartly/.maintenance afterwards

# roll back to a specific commit (pin, then release)
systemctl stop smartly-deploy.timer
sed -i 's|^WEB_IMAGE=.*|WEB_IMAGE=ghcr.io/arifur999/cashfo-web:<sha>|' /opt/smartly/.env
cd /opt/smartly && docker compose up -d
# undo the pin later: set it back to :latest and `systemctl start smartly-deploy.timer`

# logs
docker logs -f smartly-web
docker logs -f smartly-api

# change a setting: asks for each value (secrets hidden), saves, applies
bash /root/smartly-src/deploy/set-env.sh MAIL_FROM
# after editing /opt/smartly/.env by hand instead
cd /opt/smartly && docker compose up -d

# update the scripts, the compose file or the vhost after they change in git
cd /root/smartly-src && git pull
bash deploy/bootstrap.sh && bash deploy/install.sh && bash deploy/attach-site.sh

# backups: /opt/smartly/backups, root-only, 14 days. They sit on the same disk
# as the database, so copy them off the box regularly (a VPS reinstall or disk
# failure takes both). Restore steps are in deploy/ops/backup/backup.sh.

# when a migration fails: the agent marks it rolled back and restarts the
# previous release by itself (journalctl -u smartly-deploy shows it). If that
# step failed, do it by hand with the NEW image, then release again:
#   cd /opt/smartly && docker compose run --rm --no-deps smartly-migrate \
#     node_modules/.bin/prisma migrate resolve --rolled-back <migration_name>
#   docker compose up -d

# smartly's certificate: smartly-cert.timer checks daily and renews inside 30
# days of expiry. To run the check now:
systemctl start smartly-cert && journalctl -u smartly-cert -n 5 --no-pager

# every certificate on the box (all domains share furnify's certbot volumes;
# furnify's certbot service only runs when called, so something has to renew
# softech's and furnify's too)
cd /srv/hatim/hatim_Backend
docker compose run --rm certbot renew
docker exec hatim_backend-nginx-1 nginx -t && docker exec hatim_backend-nginx-1 nginx -s reload
```

## Never, on this box

- `docker compose down` in `/srv/hatim/hatim_Backend` -- stops furnify.
- Editing furnify's `nginx.conf`, or the server blocks of any other site.
- `sed -i` on a file that is bind mounted into the proxy. It swaps the inode,
  and the container keeps reading the old file. Write in place instead
  (`cat tmp > file`).
- `nginx -s reload` without `nginx -t` first.
- Pasting a command's *output* back into the terminal: every line runs as a
  command (`apt install nginx` among them).
- hPanel -> OS & Panel -> reinstall or change OS, which wipes everything.
- `docker compose down -v` in `/opt/smartly`, which deletes the database volume.
