# Monitoring and alerts

Nobody should learn from a customer that the site or the TED import stopped. Three layers, from inside to outside.

## 1. The app emails you when it breaks

With `SMTP_URL` set, the app emails `ALERT_EMAIL` (default `support@tendrelark.eu`) when:

| Event | Subject starts with |
| --- | --- |
| A page fails with a server error (500) | `[Tendrelark ALERT] Server error on GET /path` |
| The process crashes unexpectedly | `[Tendrelark ALERT] The site crashed` |
| The nightly backup fails | `[Tendrelark ALERT] The nightly backup failed` |
| The daily TED import crashes | `[Tendrelark ALERT] The daily TED import crashed` |
| The source checks crash | `[Tendrelark ALERT] The source checks crashed` |

A separate email, the **daily TED report**, says whether each day's import was done, with the log of every attempt.

To avoid floods, an alert of one kind is sent at most once per `ALERT_THROTTLE_MINUTES` (default 15). The next one
says how many were held back. Alerts contain the page path and the error, never the query string, form contents
or visitor details.

This layer cannot tell you the whole server is down, because a dead server cannot send email. That is layer 2.

## 2. An outside check every 30 minutes

`.github/workflows/production-check.yml` runs `bin/check-production.js` against the live `/healthz` page. It fails when:

- the site does not answer
- no TED notices are stored, or the last successful import is older than 48 hours
- the latest import returned nothing or failed, or the daily cycle did not complete
- the daily TED report was not emailed
- backups are configured but the last good one is older than 36 hours, or the latest attempt failed

Set it up once:

1. In the repository, open **Settings > Secrets and variables > Actions > Variables**.
2. Add a variable named `TENDRELARK_URL` with the value `https://www.tendrelark.eu`.
3. Merge the workflow into the default branch. Scheduled workflows only run from there.
4. Make sure GitHub notifications for failed Actions runs are on for whoever should be told
   (**Settings > Notifications** on your GitHub account, under Actions).

The job does nothing while the variable is missing, so it will not complain before the site exists. GitHub's
schedule is best effort, so a run can be a few minutes late.

## 3. Check by hand

```bash
npm run check:production -- https://www.tendrelark.eu
```

Add `MAX_HOURS_SINCE_SUCCESS=30` in front to be stricter than the default 48 hours. The same script,
with `--save` and `--compare`, proves notices survive a deploy. See the README.

## Test that alerts really reach you

1. Layer 1: temporarily stop the SMTP login working (wrong password), or from a scratch copy request a page that errors,
   and check an alert arrives. Easier: run `npm run mail:test` and `npm run ted:daily` and confirm both emails land.
2. Layer 2: stop the app for a few minutes, then trigger **Actions > Production check > Run workflow**. It must fail
   and you must get the email.
3. Write down who receives which alert, so the answer to "who is told at 3 am" is not a surprise.
