# Outreach drafts for the source checks

Three emails, one per country, ready to send from support@tendrelark.eu. Each file has the local language
version first and an English version after it. Read them, put your name at the bottom, and send them.

| Issue | Who | File |
| --- | --- | --- |
| Belgium (#8) | BOSA e-Procurement helpdesk | `belgium-bosa.md` |
| Portugal (#9) | IMPIC (Portal BASE) | `portugal-impic.md` |
| Luxembourg (#10) | Portail des marchés publics | `luxembourg-pmp.md` |

Addresses: Belgium and Luxembourg come from the research note of 27 October 2026. We did not find a direct
address for IMPIC, so use the contact form or address published on the IMPIC or Portal BASE website.

When an answer arrives:

1. Paste it into the matching GitHub issue.
2. Update the finding in `src/db/seed.js` (`retrieval_finding`, `import_feasibility`, `finding_checked_on`) so the
   sources page matches. Only mark a source "verified" once an importer exists and has stored records.
3. If access is allowed, open a new issue for the importer.

Keep the questions short. Officials answer short, specific emails.
