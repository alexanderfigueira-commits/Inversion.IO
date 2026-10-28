# Legal review pack

For the lawyer reviewing the Tendrelark website. The facts below were taken from the code and database schema
as they stand. The questions are things we could not answer ourselves. **Nothing here is legal advice, and the
site's privacy page is a plain language draft written without legal review.**

## 1. What the site is

A website for https://www.tendrelark.eu aimed at businesses in Portugal, Luxembourg and Belgium. It shows public
tender notices (from TED, the EU's official procurement journal) with links to the official notice, publishes a
weekly newsletter, and offers contact enquiries about tender intelligence and custom AI automation services.
Customers are businesses. There are no customer accounts, payments or logins yet. Only the operator logs in.

Who is the controller: the entity named by `LEGAL_ENTITY_NAME` and `LEGAL_ENTITY_DETAILS`, **not yet filled in**.

## 2. Personal data inventory

| Where | What | Why | Kept |
| --- | --- | --- | --- |
| Newsletter subscribers | email, optional role (IT consultancy, engineering firm and so on), status, the consent text version and time, confirmation time, unsubscribe time, where the signup came from, number of times the form was submitted | Send the weekly newsletter; prove consent; do not email people who unsubscribed | Until the person asks for deletion. An unsubscribed address stays as a suppression record |
| Contact enquiries | name, email, optional company, interest, message, consent time | Reply to the person | No fixed period today (see questions) |
| Email log | recipient address, subject, kind, status, time | Debug delivery problems | Deleted after 90 days (`EMAIL_LOG_RETENTION_DAYS`) |
| Newsletter deliveries | which subscriber got which issue, success or failure | Do not send an issue twice; retry failures | With the subscriber record |
| Server logs | request method, path, status code and duration. No IP address and no query string are written by the application | Fault finding | Set by the host (not decided yet) |
| Rate limiting | client IP held in memory for up to an hour, never written to disk | Stop abuse of the forms | In memory only |
| Backups | A copy of everything above, encrypted with AES-256-GCM | Recover from loss | 14 days on the server (`BACKUP_KEEP_DAYS`); the off-server copy period is not decided |
| Tender notices | Public information from TED. Notices name public buyers and may include business contact details the buyer chose to publish | The service itself | Stored indefinitely |

Not collected: cookies, analytics, advertising identifiers, IP addresses in the database, payment data,
special category data. Form tokens are timing checks signed with a server secret, not stored per person.

## 3. Consent and signup, exactly as built

- Newsletter checkbox wording (version `2026-10-v1`): "Send me the Tendrelark weekly tender newsletter. I can
  unsubscribe at any time with one click." The checkbox is unticked by default and required. A link to the
  privacy page sits next to it.
- **Double opt in.** A confirmation email with a link valid for 48 hours is sent. The link opens a page with a
  button, and only the button press confirms, so automated mail scanners cannot confirm by opening the link.
- Every newsletter email carries a one click unsubscribe link and the `List-Unsubscribe` headers.
- Signing up again with the same address never creates a second record, it only raises a counter.
- The contact form has a required consent checkbox: "I agree that Tendrelark may use these details to reply to
  me." The privacy page says the legal basis is steps at the person's request before a contract plus legitimate
  interest. Please confirm that is the right framing.

## 4. How each right is met today

| Right | How |
| --- | --- |
| Access, portability | Admin area "Data requests" (or `npm run privacy:export`) produces a JSON copy of everything held for an email address |
| Erasure | Admin area (or `npm run privacy:erase`) deletes the subscriber record, enquiries, deliveries and email log rows for an address. Only a counter of requests remains. Backups keep older copies until they expire |
| Rectification | By hand, by the operator, on request |
| Objection, withdrawal of consent | One click unsubscribe in every email; or by writing to the contact address |
| Restriction | By hand. Not automated |
| Complaint | The privacy page names the CNPD (Portugal), the CNPD (Luxembourg) and the APD/GBA (Belgium) |

## 5. Processors and transfers (to be filled in)

| Role | Provider | Location | Agreement |
| --- | --- | --- | --- |
| Hosting | _not chosen_ | | needed |
| Email sending | _not chosen_ | | needed |
| Backup storage off the server | _not chosen_ | | needed |
| DNS | _to confirm_ | | |

No analytics or advertising providers are used. Whether any of the providers above transfers data outside the EU/EEA
depends on the choices still to be made.

## 6. Questions for the lawyer

**Controller and notices**
1. Which entity is the controller, and what must the footer and privacy page show (name, registered address, tax
   number, contact)? Is a data protection officer required?
2. Does the privacy page cover what Articles 13 and 14 require for these two forms? What should change?

**Newsletter (business to business)**
3. Which consent and soft opt in rules apply to B2B marketing email in Portugal, Luxembourg and Belgium? Is the
   current checkbox and double opt in sufficient, or more than needed?
4. Is keeping unsubscribed addresses as a suppression record acceptable, and what should the privacy page say?

**Retention**
5. What retention periods do you recommend for contact enquiries, subscriber records, and backups, and what should
   happen to enquiries that never become a customer?
6. Is the statement "a deleted record can remain in an encrypted backup until it expires" acceptable, and what maximum backup
   retention would you accept?

**Terms of use and the service**
7. Terms for a free website and newsletter: no guarantee of completeness or accuracy of tender information, no legal
   advice, limitation of liability, acceptable use, intellectual property.
8. Re-use of TED data: confirm the EU's re-use terms for TED notices and what attribution we must show. The same for
   national sources if we import them later (Portugal's BASE dataset is described as public domain, Belgium and
   Luxembourg are unconfirmed).
9. Personal data inside public notices (business contact details published by buyers): any obligations when we
   republish or store it?
10. The custom AI automations service: what contract terms, liability limits and data processing terms are needed,
    and which EU AI Act transparency duties could apply?

**Operations**
11. Do we need a record of processing activities, a data breach procedure (72 hour notification), and a data
    processing agreement template for customers? Please list what to prepare before launch.
12. Cookie law: the site sets no cookies. Does anything else on the site require a notice or consent?

## 7. To prepare before the meeting

- Fill in `LEGAL_ENTITY_NAME` and `LEGAL_ENTITY_DETAILS` and the contact address.
- Choose hosting, email and backup providers, so section 5 can be completed.
- Print the current `/privacy` page and the signup forms (home page and `/newsletter`).
- After the review, update `src/web/views/pages.js` (privacy text), add the terms page, and bump `CONSENT_VERSION` in
  `src/newsletter/subscribers.js` if the consent wording changes, so each subscriber's consent stays traceable to the
  text they agreed to.
