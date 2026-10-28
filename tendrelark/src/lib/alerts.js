/**
 * Emails the operator when something breaks. Throttled per kind, so one broken page hit a thousand times
 * sends one email, and the next one says how many were held back. Alert text carries no request bodies,
 * no query strings (they can hold tokens) and no visitor details.
 */
export function createAlerter({ config, mailer, log = console, now = () => Date.now() }) {
  const lastSent = new Map();
  const held = new Map();
  const throttleMs = config.alerts.throttleMinutes * 60_000;

  async function alert(kind, subject, details = '') {
    const t = now();
    const previous = lastSent.get(kind);
    if (previous !== undefined && t - previous < throttleMs) {
      held.set(kind, (held.get(kind) ?? 0) + 1);
      return { sent: false, throttled: true };
    }
    lastSent.set(kind, t);
    const skipped = held.get(kind) ?? 0;
    held.delete(kind);
    const text = [
      `${subject}`,
      '',
      String(details).slice(0, 3000),
      '',
      skipped ? `${skipped} similar alert${skipped === 1 ? ' was' : 's were'} held back since the last email.` : '',
      `Site: ${config.siteUrl}`,
      `Time: ${new Date(t).toISOString()}`,
      'Where to look: the admin dashboard, and `npm run check:production`.',
    ].filter((l, i, all) => l !== '' || (i > 0 && all[i - 1] !== '')).join('\n');
    try {
      await mailer.send({ to: config.alerts.to, kind: 'alert', subject: `[Tendrelark ALERT] ${subject}`.slice(0, 200), text });
      return { sent: true };
    } catch (err) {
      // If email itself is what is broken, the log is all we have. Never let alerting throw.
      log.error?.(`Could not send an alert email (${subject}): ${err.message}`);
      return { sent: false, error: err.message };
    }
  }

  return { alert };
}

/** What goes into an error alert: where it happened and the error, and nothing from the visitor. */
export function describeRequestError(req, err) {
  const stack = String(err?.stack ?? err).split('\n').slice(0, 8).join('\n');
  return `${req.method} ${req.path}\n\n${stack}`;
}

/** An alerter that does nothing, for tests and for code that has none wired in. */
export const noAlerts = { alert: async () => ({ sent: false }) };
