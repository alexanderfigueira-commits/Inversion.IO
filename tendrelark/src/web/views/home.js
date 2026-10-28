import { html, raw } from '../../lib/html.js';
import { formatDate } from '../../lib/dates.js';
import { layout } from '../layout.js';
import { check, noticeCard, signupForm } from '../components.js';

const FAQ = [
  {
    q: 'Do you submit bids for us?',
    a: 'No. We never decide whether you should bid and we never submit anything on your behalf. We prepare information and reduce repetitive work. You review it, you decide, you submit.',
  },
  {
    q: 'Is the tender list complete?',
    a: 'No, and we will not pretend it is. Our importer reads TED. National portals are reviewed by hand and are not imported. The sources page shows exactly what is covered, how, and what we can and cannot say about automated retrieval for each platform. Always check the official notice.',
  },
  {
    q: 'Is this legal advice?',
    a: 'No. We help you find and assess tenders. Questions about eligibility, award criteria or procedural rules should go to your own legal adviser.',
  },
  {
    q: 'What do you do with my email address?',
    a: 'We use it to send the weekly newsletter you asked for, and nothing else. You confirm by email first, and every issue has a one click unsubscribe.',
  },
];

const LOGO_MARK = raw(
  '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><rect width="40" height="40" rx="10" fill="var(--brand)"/><path d="M8 25c5.5 0 9.5-3.5 12-10 2.5 6.5 6.5 10 12 10" fill="none" stroke="var(--brand-contrast)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="11" r="2.4" fill="#e7a93a"/></svg>',
);

/** The brand photo sits under the text in the lower left. Without the photo file it shows the mark. */
function logoFigure(logoPhoto) {
  return logoPhoto
    ? html`<figure class="logo-figure"><img src="${logoPhoto}" alt="A paper bird resting on a dark green Tendrelark folder" loading="lazy" decoding="async"></figure>`
    : html`<figure class="logo-figure fallback">${LOGO_MARK}</figure>`;
}

export function homePage({ config, latest, stats, token, logoPhoto = null }) {
  const body = html`
  <section class="hero">
    <div class="container hero-grid">
      <div>
        <span class="eyebrow">Public tender intelligence for Portugal, Luxembourg and Belgium</span>
        <h1>Public tenders you can assess quickly, with every source one click away.</h1>
        <p class="lede">Tendrelark helps IT consultancies, engineering and professional services firms, and independent bid consultants find and assess relevant EU and Portuguese public tenders. We take on the repetitive bid work. Every bid decision and every submission stays with you.</p>
        <div class="btn-row">
          <a class="btn" href="/newsletter">Get the weekly newsletter</a>
          <a class="btn btn-secondary" href="/sources">See where our data comes from</a>
        </div>
      </div>
      <aside class="hero-panel" aria-labelledby="every-item">
        <h2 id="every-item">What every tender we show includes</h2>
        <ul class="checks">
          ${check('The notice title and the buyer')}
          ${check('The country, and the deadline when the notice states one')}
          ${check('A link to the official notice, so you can check it yourself')}
          ${check('Nothing you cannot trace back to its source')}
        </ul>
      </aside>
    </div>
  </section>

  <section class="section" aria-labelledby="who">
    <div class="container">
      <div class="section-head">
        <h2 id="who">Who we work with</h2>
        <p>Teams that bid for public contracts and do not have spare hours to read every notice.</p>
      </div>
      <div class="grid grid-3">
        <article class="card">
          <h3>IT consultancies</h3>
          <p>Digital, software and IT services tenders move fast and the notices run long. We help you spot the ones that fit your capabilities and your calendar before you spend a day reading the wrong one.</p>
        </article>
        <article class="card">
          <h3>Engineering and professional services firms</h3>
          <p>Design, supervision and advisory contracts are spread across TED and national portals. We bring the relevant ones together, with the buyer and the deadline up front.</p>
        </article>
        <article class="card">
          <h3>Independent bid consultants</h3>
          <p>You serve several clients with the same limited hours. Reliable, linked tender information helps you shortlist for each of them while your own judgment stays at the centre.</p>
        </article>
      </div>
    </div>
  </section>

  <section class="section alt" aria-labelledby="offer">
    <div class="container">
      <div class="section-head">
        <h2 id="offer">What we offer</h2>
        <p>Two services. Both are built so that you can see where information came from and you stay in charge of every decision.</p>
      </div>
      <div class="grid grid-2">
        <a class="card card-link" href="/tender-intelligence">
          <h3>Public tender intelligence</h3>
          <p>Relevant EU and Portuguese opportunities, found and assessed, each traceable to its official source.</p>
          <p class="more">See how it works &rarr;</p>
        </a>
        <a class="card card-link" href="/ai-automations">
          <h3>Custom AI automations</h3>
          <p>Small, specific automations for the repetitive parts of bidding. You review the output, you decide, you submit.</p>
          <p class="more">See what we automate &rarr;</p>
        </a>
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="trust">
    <div class="container">
      <div class="section-head">
        <h2 id="trust">Why you can rely on it, and where to be careful</h2>
      </div>
      <div class="grid grid-3">
        <div class="card"><span class="num" aria-hidden="true">1</span><h3>Every item links to its source</h3><p>We show you the official notice behind everything, so you can read it yourself and do not have to take our word for it.</p></div>
        <div class="card"><span class="num" aria-hidden="true">2</span><h3>Coverage you can inspect</h3><p>The <a href="/sources">sources page</a> lists each official platform we use, whether we import from it or review it by hand, what we can say about automated retrieval, and when we last confirmed it was reachable.</p></div>
        <div class="card"><span class="num" aria-hidden="true">3</span><h3>Your decisions stay yours</h3><p>We do not decide to bid and we do not submit for you. Our job is to give you clear information faster.</p></div>
      </div>
    </div>
  </section>

  <section class="section alt" aria-labelledby="latest">
    <div class="container">
      <div class="section-head">
        <h2 id="latest">Recently stored from TED</h2>
        <p>The newest notices from buyers in Portugal, Luxembourg and Belgium that we hold in our database${stats.latest_publication ? html`, up to ${formatDate(stats.latest_publication)}` : ''}.</p>
      </div>
      ${latest.length
        ? html`<ul class="notice-list">${latest.map((n) => noticeCard(n))}</ul><p><a href="/tenders">Browse all stored notices &rarr;</a></p>`
        : html`<div class="empty"><p><strong>No TED notices are stored yet.</strong></p><p>They appear here as soon as the first ingestion run completes.</p></div>`}
    </div>
  </section>

  <section class="section" id="newsletter" aria-labelledby="news">
    <div class="container split">
      <div>
        <span class="eyebrow">Weekly newsletter</span>
        <h2 id="news">One email a week with the tenders worth a look</h2>
        <p>Each week we pick the Portuguese, Luxembourg and Belgian tenders that look most relevant to IT, engineering and professional services firms. Every item links to its official notice. Read earlier issues in the <a href="/newsletter/archive">archive</a> before you sign up.</p>
        <p class="muted small">Notices come from TED. The national platforms for Portugal, Luxembourg and Belgium are reviewed by hand, and the <a href="/sources">sources page</a> says plainly what can and cannot be retrieved automatically from each.</p>
        ${logoFigure(logoPhoto)}
      </div>
      <div class="signup-card">${signupForm({ token, idPrefix: 'home', source: 'home' })}</div>
    </div>
  </section>

  <section class="section alt" aria-labelledby="faq">
    <div class="container narrow">
      <h2 id="faq">Straight answers</h2>
      ${FAQ.map((item) => html`<details class="faq"><summary>${item.q}</summary><p>${item.a}</p></details>`)}
    </div>
  </section>`;

  return layout({
    config,
    path: '/',
    title: 'Tendrelark',
    description:
      'Find and assess relevant EU and Portuguese public tenders. Source linked tender intelligence and custom AI automations for IT consultancies, engineering and professional services firms, and bid consultants in Portugal, Luxembourg and Belgium.',
    body,
  });
}
