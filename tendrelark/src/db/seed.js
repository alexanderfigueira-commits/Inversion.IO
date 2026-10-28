// The tender sources we rely on. Seeding refreshes descriptive and research fields only. It never
// touches verification columns, so a restart cannot erase what the last reachability check found.
//
// Two separate questions are tracked for every source:
//
//   1. Is the site reachable?  `status`, set only by `npm run sources:verify` (or the scheduler).
//      Nothing here is marked verified.
//   2. Can we retrieve its notices automatically?  `retrieval_finding`:
//        'unverified'   not tested, or the research could not confirm it
//        'unavailable'  researched, and no documented automated interface exists
//        'verified'     an importer exists and has stored records
//      TED has an importer, so the public page derives its state from real ingestion runs and
//      ignores the value below. For the national sources nothing is imported, so none of them can
//      be 'verified' until an importer is built and has stored records.
//
// The national findings come from the research note "National Tender Sources for Portugal,
// Luxembourg and Belgium", dated 27 October 2026, which cites an official page for each claim.
// They have not been re-checked against the live portals from the build environment, which
// cannot reach them. Re-check them before changing a finding.

const RESEARCH_DATE = '2026-10-27';

export const SOURCES = [
  {
    slug: 'ted',
    name: 'TED, Tenders Electronic Daily',
    country: 'EU',
    kind: 'eu_portal',
    url: 'https://ted.europa.eu/en/',
    check_url: 'https://ted.europa.eu/en/',
    description:
      'The official EU journal for public procurement. Notices above the EU thresholds from all three countries are published here, so it is the cleanest single feed for the top tier.',
    how_we_use_it:
      'Our importer reads notices for Portugal, Luxembourg and Belgium through the public TED API and stores each one with a link back to its notice on TED. The retrieval line shows whether it has stored notices yet.',
    method: 'api_ingest',
    sort_order: 10,
    retrieval_finding: 'unverified',
    import_feasibility:
      'The TED Search API allows anonymous access to published notices and needs no key. It covers everything above EU thresholds in all three countries, so national sources only add below threshold and national only notices.',
    finding_checked_on: RESEARCH_DATE,
    extra_hosts: [],
    reference_links: [{ label: 'TED API documentation', url: 'https://docs.ted.europa.eu/api/latest' }],
  },
  {
    slug: 'base-pt',
    name: 'Portal BASE',
    country: 'PRT',
    kind: 'national_portal',
    url: 'https://www.base.gov.pt/',
    check_url: 'https://www.base.gov.pt/',
    description:
      'Portugal’s public contracts portal, run by IMPIC. By law it shows the announcements published in the Diário da República and in the EU Official Journal, so national and TED notices appear together in one place.',
    how_we_use_it:
      'Reviewed by hand to check a buyer’s history and typical contract values when we assess a tender. Not imported.',
    method: 'manual_review',
    sort_order: 20,
    retrieval_finding: 'unverified',
    import_feasibility:
      'Good for an archive, weak for weekly freshness. IMPIC states that BASE public data can be extracted automatically and free of charge. The open dataset “Anúncios de 2012 a 2026” on dados.gov.pt is public domain and in open formats, but updated only every two weeks, and its listed last update was 8 March 2026. Whether the feed is stale or the metadata is wrong is unverified. No live API is documented, and we have not downloaded or imported the dataset.',
    finding_checked_on: RESEARCH_DATE,
    extra_hosts: [],
    reference_links: [
      { label: 'About Portal BASE', url: 'https://www.base.gov.pt/Base4/en/the-portal/base' },
      { label: 'Open dataset: Anúncios de 2012 a 2026', url: 'https://dados.gov.pt/en/datasets/contratos-publicos-portal-base-impic-anuncios-de-2012-a-2026/' },
      { label: 'Portaria 318-B/2023 (portal rules)', url: 'https://www.base.gov.pt/Base4/media/aezdh4bi/portaria-318-b_2023_portal-base.pdf' },
    ],
  },
  {
    slug: 'dre-pt',
    name: 'Diário da República',
    country: 'PRT',
    kind: 'official_gazette',
    url: 'https://diariodarepublica.pt/',
    check_url: 'https://diariodarepublica.pt/',
    description:
      'Portugal’s official gazette (2nd series). It is the legally binding publication for Portuguese procurement announcements.',
    how_we_use_it:
      'Reviewed by hand for national procedures that do not appear on TED. Not imported.',
    method: 'manual_review',
    sort_order: 30,
    retrieval_finding: 'unverified',
    import_feasibility:
      'Not assessed on its own. BASE shows the announcements published in the Diário da República, so the BASE dataset is the import candidate rather than the gazette itself. IMPIC notes that the announcement data covers only publicised procedures: public tender, and limited tender with prior qualification.',
    finding_checked_on: RESEARCH_DATE,
    extra_hosts: [],
    reference_links: [{ label: 'Portaria 318-A/2023 (announcements)', url: 'https://www.base.gov.pt/Base4/media/zc2fe1uw/portaria-318-a_2023_anuncios.pdf' }],
  },
  {
    slug: 'pmp-lu',
    name: 'Portail des marchés publics',
    country: 'LUX',
    kind: 'national_portal',
    url: 'https://marches.public.lu/fr.html',
    check_url: 'https://marches.public.lu/fr.html',
    description:
      'Luxembourg’s public procurement portal (marches.public.lu, with the application at pmp.lu). It publishes prior information notices, national and European contract notices, restricted and negotiated procedure calls, design contests and award notices. The government says it shows only part of the notices published in Luxembourg, because every contract notice also appears in the printed press.',
    how_we_use_it:
      'Reviewed by hand for national opportunities and tender documents. Not imported. National only Luxembourg notices are partly covered, so we rely on TED for the above threshold tier.',
    method: 'manual_review',
    sort_order: 40,
    retrieval_finding: 'unavailable',
    import_feasibility:
      'Low, so we rely on TED for now. No API is documented, and the only procurement dataset on data.public.lu holds specifications, technical clauses and price documents, not notices, with no licence stated. The portal offers an email alert service for new notices. An older official training deck lists RSS subscriptions for contract notices. Whether RSS still exists, what it carries and what reuse terms apply is unverified.',
    finding_checked_on: RESEARCH_DATE,
    extra_hosts: ['pmp.lu', 'pmp.b2g.etat.lu'],
    reference_links: [
      { label: 'Portal description', url: 'https://marches.public.lu/fr/acteurs/direction/portail-marches-publics.html' },
      { label: 'guichet.lu: coverage of the portal', url: 'https://guichet.public.lu/fr/entreprises/gestion-juridique-comptabilite/marche-public-concession/appel-offre/consulter-annonces-marches-publics.html' },
    ],
  },
  {
    slug: 'eprocurement-be',
    name: 'e-Procurement platform (publicprocurement.be)',
    country: 'BEL',
    kind: 'national_portal',
    url: 'https://www.publicprocurement.be/',
    check_url: 'https://www.publicprocurement.be/',
    description:
      'Belgium’s federal e-Procurement platform, run by FPS BOSA. Federal, regional and local authorities publish here. Each notice shows a “Published on TED” field, which makes it easy to tell which notices are already on TED. The platform migrated recently, so older TED notices may still link to legacy addresses such as enot.publicprocurement.be.',
    how_we_use_it:
      'Reviewed by hand for Belgian opportunities, including those below the EU thresholds. Not imported.',
    method: 'manual_review',
    sort_order: 50,
    retrieval_finding: 'unverified',
    import_feasibility:
      'Potentially the best of the three, but access is not confirmed. A contractor write-up, not BOSA itself, says the platform was built API first and follows OpenAPI 3. We found no public developer documentation, terms or registration process, so whether access is open, needs a key or needs a formal agreement is unverified. For people, registered users can save search profiles and receive new matching notices by email.',
    finding_checked_on: RESEARCH_DATE,
    extra_hosts: [],
    reference_links: [
      { label: 'BOSA: public procurement', url: 'http://bosa.belgium.be/en/themes/public-procurement' },
      { label: 'Example notice with the “Published on TED” field', url: 'https://www.publicprocurement.be/publication-workspaces/68ba25c6-604d-4dd9-833b-c05842fef206' },
    ],
  },
];

export function seedSources(db, sources = SOURCES) {
  const upsert = db.prepare(`
    INSERT INTO sources (slug, name, country, kind, url, check_url, description, how_we_use_it, method, sort_order,
      retrieval_finding, import_feasibility, finding_checked_on, extra_hosts, reference_links)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      country = excluded.country,
      kind = excluded.kind,
      url = excluded.url,
      check_url = excluded.check_url,
      description = excluded.description,
      how_we_use_it = excluded.how_we_use_it,
      method = excluded.method,
      sort_order = excluded.sort_order,
      retrieval_finding = excluded.retrieval_finding,
      import_feasibility = excluded.import_feasibility,
      finding_checked_on = excluded.finding_checked_on,
      extra_hosts = excluded.extra_hosts,
      reference_links = excluded.reference_links
  `);
  for (const s of sources) {
    upsert.run(
      s.slug, s.name, s.country, s.kind, s.url, s.check_url, s.description, s.how_we_use_it, s.method, s.sort_order,
      s.retrieval_finding ?? 'unverified', s.import_feasibility ?? null, s.finding_checked_on ?? null,
      JSON.stringify(s.extra_hosts ?? []), JSON.stringify(s.reference_links ?? []),
    );
  }
  // Drop entries that left the list (for example a renamed source), unless a newsletter link uses them.
  const slugs = sources.map((s) => s.slug);
  db.prepare(
    `DELETE FROM sources WHERE slug NOT IN (${slugs.map(() => '?').join(',')}) AND id NOT IN (SELECT source_id FROM newsletter_links)`,
  ).run(...slugs);
  return sources.length;
}
