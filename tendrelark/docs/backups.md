# Backups

Everything lives in one database file: stored TED notices, subscribers, newsletter issues and enquiries.
If the disk is lost and there is no copy elsewhere, you start again. This guide sets up nightly backups, gets a
copy off the server, and shows how to prove a restore works.

## What the app does for you

Set `BACKUP_DIR` and the running app takes a backup every night at `BACKUP_AT_UTC` (default 03:00 UTC):

1. It takes a consistent snapshot of the live database. This is safe while the site is running.
2. It compresses it, and encrypts it with AES-256-GCM when `BACKUP_PASSPHRASE` is set.
3. It **restores the finished file to a scratch copy and checks it**: integrity check, and the same number of
   notices and subscribers as the original. A backup that cannot be restored counts as a failure.
4. It deletes backups older than `BACKUP_KEEP_DAYS` (default 30), always keeping the newest three.
5. It records the result. `/healthz` shows it, and `npm run check:production` fails if the last good backup is
   older than 36 hours or the latest attempt failed.

A failed backup is retried every 30 minutes, up to four times that day.

```bash
BACKUP_DIR=/data/backups
BACKUP_PASSPHRASE=a long passphrase, at least 12 characters
```

Store the passphrase in a password manager, **separately from the backups**. Without it a backup cannot be
opened, and it cannot be recovered. The backups hold subscriber email addresses, so do not run without a
passphrase in production.

A backup folder on the same disk protects against mistakes and corruption, but not against losing the disk.
That is why the next step matters.

## Copy backups off the server

Pick one. All of them only need to copy the `BACKUP_DIR` folder somewhere else once a day, after 03:30 UTC.
The files are already encrypted, so the destination does not need to be trusted with their contents.

- **Object storage** (any S3 compatible service) with a tool such as `rclone`:
  `rclone sync /data/backups remote:tendrelark-backups` from a daily cron job on the host.
- **Another server** with `rsync`:
  `rsync -a /data/backups/ backup-user@other-host:/backups/tendrelark/`
- **Your provider's disk snapshots**, if it offers them, as an extra layer. Treat them as a bonus, not the only copy.

Whichever you choose, check from the destination side that yesterday's file is there, and keep the destination
retention a bit longer than `BACKUP_KEEP_DAYS` (for example 30 days).

## Commands

```bash
npm run db:backup                         # take one now, verify it, prune old ones
npm run db:backups                        # list what is in BACKUP_DIR
npm run db:verify-backup -- --from FILE   # restore to a scratch file and check it, leaves nothing behind
npm run db:restore -- --from FILE --to /data/restored.db
```

`db:restore` refuses to overwrite an existing file unless you add `--force`. It unpacks and checks the
backup next to the target first, and only then moves it into place, so a bad backup never replaces a good
database. Stop the app before restoring over the live database.

## The restore drill (do this once now, then every few months)

1. Copy yesterday's backup from the **off server location** to a scratch machine.
2. Set `BACKUP_PASSPHRASE` to the passphrase from your password manager.
3. Run `npm run db:restore -- --from FILE --to ./restored.db`.
4. Run `DATABASE_PATH=./restored.db npm run db:check`.
5. Confirm the notice count and the "Created at" date look right, and that the integrity check says `ok`.

If all five steps work, your backups are real.

## Restoring in an emergency

1. Stop the app.
2. `npm run db:restore -- --from FILE --to /data/tendrelark.db --force`
3. Start the app, then run `npm run check:production -- https://www.tendrelark.eu`.
4. Anything published after the backup (up to a day of newsletter edits or signups) is lost. Notices are
   recovered by the next TED import, because it re-reads recent days. Run `npm run ted:ingest -- --from YYYY-MM-DD`
   for older gaps, then `npm run ted:reconcile`.
