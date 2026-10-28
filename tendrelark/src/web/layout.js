import { html, raw, esc } from '../lib/html.js';

const NAV = [
  { href: '/tender-intelligence', label: 'Tender intelligence' },
  { href: '/ai-automations', label: 'AI automations' },
  { href: '/tenders', label: 'Tenders' },
  { href: '/sources', label: 'Sources' },
  { href: '/newsletter', label: 'Newsletter' },
  { href: '/contact', label: 'Contact' },
];

const LOGO = raw(
  `<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><rect width="40" height="40" rx="10" fill="var(--brand)"/><path d="M8 25c5.5 0 9.5-3.5 12-10 2.5 6.5 6.5 10 12 10" fill="none" stroke="var(--brand-contrast)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="11" r="2.4" fill="#e7a93a"/></svg>`,
);

function navList(current) {
  return html`<ul>${NAV.map(
    (item) => html`<li><a href="${item.href}"${current === item.href || (item.href !== '/' && current.startsWith(`${item.href}/`)) ? raw(' aria-current="page"') : ''}>${item.label}</a></li>`,
  )}</ul>`;
}

/**
 * Wraps page content in the site shell. `path` is the request path, used for the canonical link
 * and the active nav item.
 */
export function layout({ config, path, title, description, body, noindex = false, ogType = 'website', extraHead = '' }) {
  const fullTitle = title === 'Tendrelark' ? 'Tendrelark | Public tender intelligence for Portugal, Luxembourg and Belgium' : `${title} | Tendrelark`;
  const canonical = `${config.siteUrl}${path === '/' ? '/' : path}`;
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Tendrelark',
    url: `${config.siteUrl}/`,
    logo: `${config.siteUrl}/img/favicon.svg`,
    description:
      'Tender intelligence and custom AI automations for IT consultancies, engineering and professional services firms, and independent bid consultants in Portugal, Luxembourg and Belgium.',
    areaServed: ['Portugal', 'Luxembourg', 'Belgium'],
    email: config.contact.email,
  };

  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullTitle}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  ${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
  <meta property="og:site_name" content="Tendrelark">
  <meta property="og:type" content="${ogType}">
  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${config.siteUrl}/img/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#14532d">
  <link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="Tendrelark weekly tender newsletter" href="/newsletter/archive.xml">
  <link rel="stylesheet" href="/css/site.css">
  ${extraHead}
  <script type="application/ld+json">${raw(JSON.stringify(organization).replaceAll('<', '\\u003c'))}</script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container header-row">
      <a class="brand" href="/" aria-label="Tendrelark, home">${LOGO}<span>Tendrelark</span></a>
      <nav class="nav-desktop" aria-label="Main">${navList(path)}</nav>
      <details class="nav-mobile">
        <summary>Menu</summary>
        <nav aria-label="Main, mobile">${navList(path)}</nav>
      </details>
    </div>
  </header>
  <main id="main">${body}</main>
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <a class="brand" href="/" aria-label="Tendrelark, home">${LOGO}<span>Tendrelark</span></a>
          <p class="muted">Public tender intelligence and custom AI automations for Portugal, Luxembourg and Belgium. Every source linked. Every decision yours.</p>
        </div>
        <div>
          <h2>Explore</h2>
          <ul>
            <li><a href="/tender-intelligence">Tender intelligence</a></li>
            <li><a href="/ai-automations">AI automations</a></li>
            <li><a href="/tenders">Tenders</a></li>
            <li><a href="/sources">Sources and coverage</a></li>
            <li><a href="/newsletter/archive">Newsletter archive</a></li>
          </ul>
        </div>
        <div>
          <h2>Get in touch</h2>
          <ul>
            <li><a href="mailto:${config.contact.email}">${config.contact.email}</a></li>
            <li><a href="/contact">Contact form</a></li>
            <li><a href="/newsletter">Weekly newsletter</a></li>
            <li><a href="/privacy">Privacy</a></li>
          </ul>
        </div>
      </div>
      <p class="fine">&copy; ${new Date().getUTCFullYear()} ${config.contact.legalName}.${config.contact.legalDetails ? ` ${config.contact.legalDetails}.` : ''} Tender information comes from public sources and may be incomplete or out of date. Always check the official notice before you decide. This site does not provide legal advice.</p>
    </div>
  </footer>
</body>
</html>`;
}

export function pageHead({ eyebrow, title, lede }) {
  return html`<section class="page-head">
    <div class="container">
      ${eyebrow ? html`<span class="eyebrow">${eyebrow}</span>` : ''}
      <h1>${title}</h1>
      ${lede ? html`<p class="lede">${lede}</p>` : ''}
    </div>
  </section>`;
}

export function flash(kind, message) {
  if (!message) return '';
  return html`<div class="flash ${kind}" role="${kind === 'error' ? 'alert' : 'status'}"><p>${message}</p></div>`;
}

export { esc };
