import dns from 'node:dns/promises';

const OK = 'pass';
const WARN = 'warn';
const FAIL = 'fail';

const flatten = (records) => (records ?? []).map((r) => (Array.isArray(r) ? r.join('') : String(r)));

async function txt(resolver, name) {
  try {
    return flatten(await resolver.resolveTxt(name));
  } catch (err) {
    if (['ENOTFOUND', 'ENODATA'].includes(err.code)) return [];
    throw err;
  }
}

async function cname(resolver, name) {
  try {
    return (await resolver.resolveCname(name)) ?? [];
  } catch (err) {
    if (['ENOTFOUND', 'ENODATA'].includes(err.code)) return [];
    throw err;
  }
}

/** SPF says which servers may send mail for the domain. Exactly one record, ending in -all or ~all. */
export function judgeSpf(records) {
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r));
  if (!spf.length) {
    return { status: FAIL, record: null, message: 'No SPF record. Add a TXT record on the domain that starts with v=spf1 and includes your sending provider.' };
  }
  if (spf.length > 1) {
    return { status: FAIL, record: spf[0], message: 'More than one SPF record. Receivers ignore all of them. Merge them into a single record.' };
  }
  const record = spf[0];
  if (/\s\+all\b|\s\?all\b/i.test(record)) return { status: FAIL, record, message: 'The record ends in +all or ?all, which lets anyone send as your domain. End it with -all or ~all.' };
  if (!/\s[-~]all\b/i.test(record)) return { status: WARN, record, message: 'The record has no -all or ~all ending, so it says nothing about other senders. Add ~all (or -all once you are sure).' };
  if (!/\binclude:|\bip4:|\bip6:|\ba\b|\bmx\b|\bredirect=/i.test(record)) return { status: WARN, record, message: 'The record lists no sending servers. Add the include: for your mail provider.' };
  return { status: OK, record, message: 'SPF is present and ends in a clear policy. Check that your sending provider’s include: is listed.' };
}

/** DMARC says what receivers should do with mail that fails SPF and DKIM, and where to send reports. */
export function judgeDmarc(records) {
  const dmarc = records.filter((r) => /^v=DMARC1\s*;/i.test(r));
  if (!dmarc.length) {
    return { status: FAIL, record: null, message: 'No DMARC record. Add a TXT record at _dmarc.<domain>, for example: v=DMARC1; p=none; rua=mailto:support@<domain>' };
  }
  if (dmarc.length > 1) return { status: FAIL, record: dmarc[0], message: 'More than one DMARC record. Keep only one.' };
  const record = dmarc[0];
  const policy = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(record)?.[1]?.toLowerCase();
  if (!policy) return { status: FAIL, record, message: 'The DMARC record has no valid p= policy (none, quarantine or reject).' };
  const hasReports = /(?:^|;)\s*rua\s*=/i.test(record);
  if (policy === 'none') {
    return { status: WARN, record, message: `Policy is none, which only monitors.${hasReports ? '' : ' Add rua=mailto:... to receive reports.'} Move to quarantine once your reports look clean.` };
  }
  return { status: hasReports ? OK : WARN, record, message: hasReports ? `Policy is ${policy} with reports enabled.` : `Policy is ${policy}. Add rua=mailto:... so you see problems.` };
}

/** DKIM signs each message. The key lives at <selector>._domainkey.<domain>, as a TXT record or a CNAME to the provider. */
export function judgeDkim(selector, txtRecords, cnameRecords) {
  const key = txtRecords.find((r) => /v=DKIM1|(?:^|;)\s*p=/i.test(r));
  if (key) {
    if (/(?:^|;)\s*p=\s*(;|$)/i.test(key)) return { selector, status: FAIL, message: 'The key is empty, which means it was revoked.' };
    return { selector, status: OK, message: 'A DKIM key is published.' };
  }
  if (cnameRecords.length) return { selector, status: OK, message: `Points to ${cnameRecords[0]}, which is how most providers publish their key.` };
  return { selector, status: FAIL, message: 'Not found. Your provider shows the exact record to add, and the selector is its name.' };
}

/**
 * Looks up the records that decide whether mail from the domain reaches inboxes. DKIM needs the
 * selector your provider gave you, so it is only checked when one is passed in.
 */
export async function checkEmailDns(domain, { resolver = dns, dkimSelectors = [] } = {}) {
  const name = String(domain).trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) throw new Error(`"${domain}" does not look like a domain name.`);

  const [spfRecords, dmarcRecords] = await Promise.all([txt(resolver, name), txt(resolver, `_dmarc.${name}`)]);
  const dkim = [];
  for (const selector of dkimSelectors) {
    const host = `${selector}._domainkey.${name}`;
    dkim.push(judgeDkim(selector, await txt(resolver, host), await cname(resolver, host)));
  }
  const spf = judgeSpf(spfRecords);
  const dmarc = judgeDmarc(dmarcRecords);
  const all = [spf, dmarc, ...dkim];
  return { domain: name, spf, dmarc, dkim, ok: all.every((r) => r.status !== FAIL), allClear: all.every((r) => r.status === OK) };
}
