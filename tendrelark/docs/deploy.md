# Deploying Tendrelark

This is one complete, workable path: a single Linux server running Docker, with Caddy in front for automatic
HTTPS. The files are in `deploy/`. The Compose file is validated, but the container build has not been run end
to end by us (the build machine had no Docker engine), so treat your first deploy as the real test and follow
the checks below.

**Why one server and a volume.** The database is one file, and the site keeps its rate limiter and scheduler in
memory, so run exactly **one** instance. The database must sit on a volume that survives redeploys, otherwise
every stored notice disappears on the next deploy. The app refuses to start in production without `DATABASE_PATH`
for that reason.

## 0. What you need

- A small Linux server (1 GB of memory is enough) from any provider, with Docker installed
  (https://docs.docker.com/engine/install/).
- Access to the DNS settings for `tendrelark.eu`.
- The outgoing email details (see `docs/email.md`).
- About an hour.

## 1. Point the domain at the server

Create these DNS records, with your server's public IP address:

| Name | Type | Value |
| --- | --- | --- |
| `tendrelark.eu` | A | server IP |
| `www.tendrelark.eu` | A | server IP |

Add matching `AAAA` records if the server has an IPv6 address. Caddy can only get certificates once both names
resolve to the server, so wait until `ping www.tendrelark.eu` shows the right IP.

## 2. Prepare the server

Allow only SSH, HTTP and HTTPS through the firewall, for example with `ufw`:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 3. Get the code

```bash
git clone https://github.com/alexanderfigueira-commits/Inversion.IO.git
```

```bash
cd Inversion.IO/tendrelark/deploy
```

Use the branch you want live (`git checkout BRANCH`).

## 4. Fill in the settings

```bash
cp production.env.example production.env
```

```bash
chmod 600 production.env
```

Edit `production.env`:

- `APP_SECRET`: run `openssl rand -hex 32` and paste the result.
- `ADMIN_PASSWORD`: a long password.
- `SMTP_URL`: build it with `npm run mail:url` (see `docs/email.md`). No quotes around any value.
- `BACKUP_PASSPHRASE`: at least 12 characters, and keep a copy in a password manager. Without it, backups cannot be opened.
- `LEGAL_ENTITY_NAME` and `LEGAL_ENTITY_DETAILS` once known.

## 5. Start it

```bash
docker compose up -d --build
```

```bash
docker compose logs -f app
```

You should see the database path `/data/tendrelark.db`, `Scheduler on: daily TED import at 06:00 UTC ...` and
`Tendrelark listening on port 3000`. There should be **no** warnings. A warning about the database being inside
the app directory, or about SMTP or backups, means a setting is missing.

Open https://www.tendrelark.eu. The first visit can take a few seconds while Caddy obtains the certificate.
`http://tendrelark.eu` should redirect to `https://www.tendrelark.eu`.

## 6. First checks, in this order

Run these inside the app container:

```bash
docker compose exec app npm run mail:test -- --to you@example.com
```

```bash
docker compose exec app npm run sources:verify
```

```bash
docker compose exec app npm run ted:first-run
```

`ted:first-run` is the first real contact with TED. It prints a report. Paste it into the TED issue on GitHub.
If it lists problems, they are about the shape of TED's data and are fixed in code, not here.

```bash
docker compose exec app npm run ted:daily
```

That runs a full daily cycle and emails the report to support@tendrelark.eu.

```bash
docker compose exec app npm run db:backup
```

Then, from your own computer (or any machine with Node 22):

```bash
npm run check:production -- https://www.tendrelark.eu --save before.json
```

## 7. Prove the data survives a redeploy

This is the check that matters most. Recreate the container, then compare:

```bash
docker compose up -d --build --force-recreate app
```

```bash
npm run check:production -- https://www.tendrelark.eu --compare before.json
```

It must say `Persistence confirmed`. If it says the database is a different one, the volume is not being used:
stop, and fix the volume before going further.

## 8. After the first deploy

- Copy backups off the server (`docs/backups.md`), and do the restore drill once.
- Turn on the outside monitor (`docs/monitoring.md`).
- Set the brand photo: copy it to `public/img/logo-photo.webp` (or `.jpg`) and rebuild.

## Updating the site

```bash
git pull
```

```bash
docker compose up -d --build
```

Then `npm run check:production -- https://www.tendrelark.eu`. Add `--compare before.json` after saving a
fresh baseline first when a change touches the database.

## Rolling back

```bash
git checkout PREVIOUS_COMMIT
```

```bash
docker compose up -d --build
```

Schema changes only ever add migrations. A newer database refuses to start on older code (it says so in the log),
so to go back across a schema change, restore the backup taken before the update (`docs/backups.md`).

## Never do this

- `docker compose down -v` deletes the volumes, including the database. Use `docker compose down` or `restart`.
- Do not run two copies of the app against the same database.
- Do not commit `production.env`. It is in `.gitignore`.

## Other hosting

Any host works if it gives you: one always-on instance, a persistent volume with `DATABASE_PATH` pointing into it,
HTTPS in front, and the settings from `production.env.example` as environment variables. Set `TRUST_PROXY` to the
number of proxies in front of the app (1 for a single load balancer). Hosts that wipe the disk on each deploy,
or that run several copies, do not fit this app as it is.
