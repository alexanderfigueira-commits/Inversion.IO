/**
 * Builds the SMTP_URL setting from the details a mail provider gives you. The username and password
 * go into a web address, so characters such as @ : / # ? % must be encoded. Doing that by hand is the
 * most common reason a correct password "does not work".
 *
 * Port 465 uses an encrypted connection from the start (smtps://). Port 587 (and 25) start plain and
 * upgrade to encryption (smtp://), which is what nodemailer does automatically when the server offers it.
 */
export function buildSmtpUrl({ host, port, user, password }) {
  const cleanHost = String(host ?? '').trim().toLowerCase();
  const isName = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(cleanHost);
  const isLocal = cleanHost === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(cleanHost); // a relay on this machine or network
  if (!isName && !isLocal) {
    throw new Error(`"${host}" does not look like a server name. Use something like mail.example.com, without https:// or a path.`);
  }
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) throw new Error('The port must be a number such as 465 or 587.');
  if (!user) throw new Error('A username is needed. It is usually the full address, for example support@tendrelark.eu.');
  if (password === undefined || password === '') throw new Error('A password is needed.');

  const scheme = portNumber === 465 ? 'smtps' : 'smtp';
  return `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${cleanHost}:${portNumber}`;
}

/** The URL with the password hidden, safe to print in logs. */
export function redactSmtpUrl(smtpUrl) {
  try {
    const u = new URL(smtpUrl);
    if (u.password) u.password = '*****';
    return u.toString();
  } catch {
    return '(not a valid SMTP_URL)';
  }
}

/** Reads the parts back out of an SMTP_URL, decoded, so the CLI can show what the app will use. */
export function describeSmtpUrl(smtpUrl) {
  const u = new URL(smtpUrl);
  return {
    secureFromStart: u.protocol === 'smtps:',
    host: u.hostname,
    port: Number(u.port) || (u.protocol === 'smtps:' ? 465 : 587),
    user: decodeURIComponent(u.username),
    hasPassword: Boolean(u.password),
  };
}
