# Email: sending, testing and getting into inboxes

The site sends three kinds of email: signup confirmations, the weekly newsletter, and the daily TED import
report. All of them go out through SMTP. POP3 only reads a mailbox, so it is not used.

## 1. Get the outgoing (SMTP) details

Your mail provider shows two sets of settings for a mailbox. Look for the one called **outgoing server**,
**SMTP** or **sending**:

- server name (for example `mail.yourprovider.com`, not the POP3 or IMAP one)
- port, usually **465** (encrypted from the start) or **587** (upgrades to encryption)
- username, usually the full address `support@tendrelark.eu`
- password

If the provider has no outgoing option, use a sending service instead. It gives you the same four details.

## 2. Build the SMTP_URL setting

Passwords with characters such as `@ : / # ? %` must be encoded inside the address. Let the tool do it:

```bash
SMTP_PASSWORD='the password' npm run mail:url -- --host mail.yourprovider.com --port 465 --user support@tendrelark.eu
```

It prints the finished `SMTP_URL=...` value. Put it in your production settings, and never commit it.
Port 465 produces `smtps://`, any other port produces `smtp://`.

## 3. Test it

With `SMTP_URL` set in your environment:

```bash
npm run mail:test -- --to you@example.com
```

It connects, logs in, sends a test email and says what is wrong in plain words if it fails, for example a wrong
password, a wrong server name, or an encryption setting that does not match the port.
It also writes the result to the `email_log` table.

Also check that `MAIL_FROM` uses an address your provider lets this login send as. The default is
`Tendrelark <support@tendrelark.eu>`.

## 4. Check the records that keep mail out of spam

Receivers decide whether to trust a message using three DNS records on your domain.

| Record | What it does | Where it lives |
| --- | --- | --- |
| **SPF** | Lists who may send mail for `tendrelark.eu` | TXT record on `tendrelark.eu`, starts with `v=spf1` |
| **DKIM** | Signs each message so it cannot be forged | TXT or CNAME record at `<selector>._domainkey.tendrelark.eu` |
| **DMARC** | Says what to do with mail that fails, and where to send reports | TXT record at `_dmarc.tendrelark.eu` |

Your sending provider shows the exact SPF include and the DKIM record (with its selector name). Add them where
you manage the domain, then run:

```bash
npm run dns:check -- --domain tendrelark.eu --dkim-selector SELECTOR
```

A good starting DMARC record, which only monitors and sends you reports:

```
v=DMARC1; p=none; rua=mailto:support@tendrelark.eu
```

Once the reports look clean for a few weeks, change `p=none` to `p=quarantine`.

Rules the check enforces: exactly one SPF record, ending in `~all` or `-all` (never `+all`); one DMARC record
with a policy; a published, non empty DKIM key. Receivers cache DNS, so allow up to a day for changes.

## 5. Final check

1. `npm run mail:test` arrives in a normal inbox, not spam.
2. `npm run dns:check` shows no `FAIL` lines.
3. In your mail app, open the test email's headers (often "Show original") and look for `spf=pass`,
   `dkim=pass` and `dmarc=pass`.
4. `npm run ted:daily` sends the TED report to support@tendrelark.eu.
