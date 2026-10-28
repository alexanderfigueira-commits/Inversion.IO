import { html } from '../../lib/html.js';
import { COUNTRY_NAMES } from '../../config.js';
import { INTEREST_LABELS } from '../../enquiries.js';
import { layout, pageHead, flash } from '../layout.js';
import { check } from '../components.js';

export function tenderIntelligencePage({ config }) {
  const body = html`
  ${pageHead({
    eyebrow: 'Tender intelligence',
    title: 'Find the tenders that fit, and see exactly where each one comes from',
    lede: 'We monitor EU and Portuguese public procurement, shortlist what is relevant to your firm, and give you a clear, linked summary you can act on. You make the bid decision.',
  })}
  <section class="section">
    <div class="container split">
      <div class="prose">
        <h2>What you get</h2>
        <ul>
          <li><strong>A shortlist, not a firehose.</strong> Notices filtered by the fields that matter to you: country, type of work, buyer and deadline.</li>
          <li><strong>The facts up front.</strong> Title, buyer, country, publication date and deadline, taken from the notice itself.</li>
          <li><strong>A link to the official notice</strong> on every single item, so you can verify it in seconds.</li>
          <li><strong>A short assessment</strong> of what the buyer is asking for, and the points worth checking before you commit time.</li>
        </ul>
        <h2>What it is not</h2>
        <ul>
          <li>It is not a guarantee that we have seen every notice. The <a href="/sources">sources page</a> shows what is covered and how.</li>
          <li>It is not legal advice, and it does not replace reading the tender documents.</li>
          <li>It does not decide for you. Bid or no bid is your call.</li>
        </ul>
      </div>
      <div class="grid">
        <article class="card">
          <h3>How it works</h3>
          <ol>
            <li>You tell us what you do and which kinds of contract you want.</li>
            <li>We read TED notices through its public API and review the national platforms for Portugal, Luxembourg and Belgium by hand.</li>
            <li>You receive a shortlist with source links, and the assessment for the ones you want to look at closely.</li>
          </ol>
        </article>
        <article class="card">
          <h3>Start with the free newsletter</h3>
          <p>The quickest way to see how we work is the <a href="/newsletter">weekly tender newsletter</a>. Browse the <a href="/newsletter/archive">archive</a> first if you like.</p>
          <div class="btn-row"><a class="btn" href="/contact">Talk to us</a><a class="btn btn-secondary" href="/tenders">Browse stored tenders</a></div>
        </article>
      </div>
    </div>
  </section>`;
  return layout({
    config,
    path: '/tender-intelligence',
    title: 'Tender intelligence',
    description: 'Source linked public tender intelligence for Portugal, Luxembourg and Belgium: a relevant shortlist, the key facts, and a link to the official notice on every item.',
    body,
  });
}

export function aiAutomationsPage({ config }) {
  const examples = [
    ['Monitoring and alerts', 'A tidy daily or weekly digest of new notices that match your profile, instead of manual searches on several portals.'],
    ['Requirements checklists', 'Pulls the requirements out of long tender documents into a checklist, with a pointer to the page each one came from.'],
    ['Compliance matrix drafts', 'A first draft of the matrix, filled from the checklist and your own past answers, ready for your team to correct.'],
    ['Answer library search', 'Finds your best earlier answers and case descriptions for a new question, so nobody starts from a blank page.'],
    ['Deadlines and clarifications', 'Keeps track of submission dates, clarification windows and who owes what.'],
    ['Submission pack checks', 'Checks that the documents are complete and named the way the buyer asked, before the final review.'],
  ];
  const body = html`
  ${pageHead({
    eyebrow: 'Custom AI automations',
    title: 'Less repetitive bid work. The decisions stay with you.',
    lede: 'We build small, specific automations around the tasks your bid team repeats on every tender. Each one has a review step. Nothing is submitted and no bid decision is made without a person.',
  })}
  <section class="section">
    <div class="container">
      <div class="section-head"><h2>Examples of what we automate</h2><p>Every firm bids differently, so we start from your workflow. These are the kinds of tasks that tend to be worth automating first.</p></div>
      <div class="grid grid-3">
        ${examples.map(([t, d]) => html`<article class="card"><h3>${t}</h3><p>${d}</p></article>`)}
      </div>
    </div>
  </section>
  <section class="section alt">
    <div class="container split">
      <div>
        <h2>How we keep you in control</h2>
        <ul class="checks">
          ${check('A person reviews every output before it is used')}
          ${check('Outputs point back to the passage in the source document they came from')}
          ${check('No automatic submissions, ever')}
          ${check('We agree up front where your documents are processed and stored')}
        </ul>
      </div>
      <div>
        <h2>How a project runs</h2>
        <ol>
          <li><strong>Map.</strong> We walk through how your team bids today.</li>
          <li><strong>Pick one task.</strong> We choose the repetitive step with the clearest payoff.</li>
          <li><strong>Test on past bids.</strong> You see it work on tenders you already know.</li>
          <li><strong>Hand over.</strong> It goes live with a review step and you decide what comes next.</li>
        </ol>
        <div class="btn-row"><a class="btn" href="/contact?interest=ai_automation#form">Discuss an automation</a></div>
      </div>
    </div>
  </section>`;
  return layout({
    config,
    path: '/ai-automations',
    title: 'AI automations',
    description: 'Custom AI automations that reduce repetitive bid work, with a human review step on every output. Nothing is submitted and no bid decision is made without you.',
    body,
  });
}

export function contactPage({ config, token, status, values = {}, interest = '' }) {
  const message =
    status === 'sent'
      ? flash('ok', 'Thank you. Your message is with us and we will reply by email.')
      : status === 'invalid'
        ? flash('error', 'Please check the form: we need your name, a valid email, a message, and your agreement to be contacted.')
        : status === 'slow'
          ? flash('error', 'That was a bit quick, or the page was open for a long time. Please try sending again.')
          : status === 'limit'
            ? flash('error', 'Too many messages from this connection. Please try again in a little while, or email us directly.')
            : '';
  const selected = values.interest || interest;
  const body = html`
  ${pageHead({ eyebrow: 'Contact', title: 'Tell us what you are bidding for', lede: 'A few lines is enough. We reply by email.' })}
  <section class="section" id="form">
    <div class="container split">
      <div>
        ${message}
        <form class="form" method="post" action="/contact" novalidate>
          <input type="hidden" name="t" value="${token}">
          <div class="trap" aria-hidden="true"><label for="c-site">Leave this field empty</label><input id="c-site" type="text" name="website" tabindex="-1" autocomplete="off"></div>
          <div class="field"><label for="c-name">Your name</label><input id="c-name" type="text" name="name" autocomplete="name" required maxlength="120" value="${values.name ?? ''}"></div>
          <div class="field"><label for="c-email">Work email</label><input id="c-email" type="email" name="email" autocomplete="email" required maxlength="254" value="${values.email ?? ''}"></div>
          <div class="field"><label for="c-company">Company <span class="hint">(optional)</span></label><input id="c-company" type="text" name="company" autocomplete="organization" maxlength="160" value="${values.company ?? ''}"></div>
          <div class="field"><label for="c-interest">What are you interested in?</label>
            <select id="c-interest" name="interest">
              ${Object.entries(INTEREST_LABELS).map(([value, label]) => html`<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`)}
            </select>
          </div>
          <div class="field"><label for="c-message">Message</label><textarea id="c-message" name="message" required maxlength="4000">${values.message ?? ''}</textarea></div>
          <div class="field"><label class="check" for="c-consent"><input id="c-consent" type="checkbox" name="consent" value="yes" required><span>I agree that Tendrelark may use these details to reply to me. <a href="/privacy">Privacy</a></span></label></div>
          <div><button class="btn" type="submit">Send message</button></div>
        </form>
      </div>
      <aside class="card">
        <h3>Prefer email?</h3>
        <p><a href="mailto:${config.contact.email}">${config.contact.email}</a></p>
        <p class="muted">We work with firms in ${['PRT', 'LUX', 'BEL'].map((c) => COUNTRY_NAMES[c]).join(', ')}.</p>
      </aside>
    </div>
  </section>`;
  return layout({
    config,
    path: '/contact',
    title: 'Contact',
    description: 'Talk to Tendrelark about tender intelligence or custom AI automations for your bid team in Portugal, Luxembourg or Belgium.',
    body,
  });
}

export function privacyPage({ config }) {
  const body = html`
  ${pageHead({ eyebrow: 'Privacy', title: 'How we handle your data', lede: 'Short version: we collect very little, we use it only for what you asked for, and we do not track you around the web.' })}
  <section class="section">
    <div class="container prose">
      <h2>Who is responsible</h2>
      <p>${config.contact.legalName} is responsible for the personal data described here. ${config.contact.legalDetails ? `${config.contact.legalDetails}. ` : ''}Contact: <a href="mailto:${config.contact.email}">${config.contact.email}</a>.</p>

      <h2>What we collect, and why</h2>
      <ul>
        <li><strong>Newsletter signup.</strong> Your email address, an optional description of your role, the time you agreed, and which version of the consent wording you saw. We use these to send the weekly tender newsletter. Our legal basis is your consent.</li>
        <li><strong>Contact form.</strong> Your name, email, optional company, and your message. We use them to reply to you. Our legal basis is taking steps at your request before a possible contract, and our legitimate interest in answering business enquiries.</li>
        <li><strong>Tender information.</strong> The tender notices on this site come from public sources. Notices name public buyers and may contain business contact details that the buyer chose to publish.</li>
      </ul>

      <h2>Cookies and tracking</h2>
      <p>This site sets no cookies and has no analytics or advertising trackers. The server keeps ordinary technical logs for security and fault finding.</p>

      <h2>How the newsletter works</h2>
      <p>You confirm your address by email before you receive anything. Every issue contains a one click unsubscribe link. After you unsubscribe we keep your address only as a suppression record, so we do not email you again by mistake, until you ask us to delete it.</p>

      <h2>Who else sees it</h2>
      <p>We use hosting and email delivery providers to run the site and send email. They process data on our behalf. We do not sell personal data.</p>

      <h2>How long we keep it</h2>
      <p>Contact messages are kept while the conversation is active and for a reasonable period afterwards. Newsletter records are kept until you ask us to delete them. Technical email logs, which record that a message was sent to an address, are deleted automatically after ${config.retention.emailLogDays} days. We keep encrypted backups of the database for a limited time, so a record you asked us to delete can remain in a backup until that backup expires (${config.backup.keepDays} days on our own server).</p>

      <h2>Your rights</h2>
      <p>You can ask us to access, correct, delete or restrict your data, to move it, or to stop using it. We can send you a copy of everything we hold about your email address, and delete it on request. Write to <a href="mailto:${config.contact.email}">${config.contact.email}</a>. You can also complain to your data protection authority: the CNPD in Portugal, the CNPD in Luxembourg, or the Data Protection Authority (APD/GBA) in Belgium.</p>
    </div>
  </section>`;
  return layout({
    config,
    path: '/privacy',
    title: 'Privacy',
    description: 'How Tendrelark handles personal data: what we collect for the newsletter and contact form, why, and your rights.',
    body,
  });
}

export function notFoundPage({ config, path }) {
  return layout({
    config,
    path,
    title: 'Page not found',
    description: 'That page does not exist.',
    noindex: true,
    body: html`<section class="section"><div class="container narrow"><h1>We could not find that page</h1><p class="lede">It may have moved, or the link may be mistyped.</p><div class="btn-row"><a class="btn" href="/">Back to the home page</a><a class="btn btn-secondary" href="/tenders">Browse tenders</a></div></div></section>`,
  });
}

export function errorPage({ config, path }) {
  return layout({
    config,
    path,
    title: 'Something went wrong',
    description: 'Something went wrong on our side.',
    noindex: true,
    body: html`<section class="section"><div class="container narrow"><h1>Something went wrong on our side</h1><p class="lede">We have logged the problem. Please try again in a moment.</p><div class="btn-row"><a class="btn" href="/">Back to the home page</a></div></div></section>`,
  });
}
