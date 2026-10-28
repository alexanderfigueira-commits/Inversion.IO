// Each migration runs once, in order, inside a transaction. Never edit one that has
// shipped: add a new entry at the end instead. The applied version lives in PRAGMA user_version.

export const migrations = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Where our tender information comes from, and whether we have checked it lately.
      CREATE TABLE sources (
        id                   INTEGER PRIMARY KEY,
        slug                 TEXT NOT NULL UNIQUE,
        name                 TEXT NOT NULL,
        country              TEXT NOT NULL CHECK (country IN ('EU','PRT','LUX','BEL')),
        kind                 TEXT NOT NULL CHECK (kind IN ('eu_portal','national_portal','official_gazette')),
        url                  TEXT NOT NULL CHECK (url LIKE 'https://%'),
        check_url            TEXT NOT NULL CHECK (check_url LIKE 'https://%'),
        description          TEXT NOT NULL,
        how_we_use_it        TEXT NOT NULL,
        method               TEXT NOT NULL CHECK (method IN ('api_ingest','manual_review')),
        sort_order           INTEGER NOT NULL DEFAULT 0,
        -- What we know about automated retrieval. For sources with an importer (TED) the public
        -- page derives this from real ingestion runs. For the rest it is the recorded finding.
        retrieval_finding    TEXT NOT NULL DEFAULT 'unverified' CHECK (retrieval_finding IN ('verified','unavailable','unverified')),
        import_feasibility   TEXT,
        finding_checked_on   TEXT,
        -- Other hosts that count as this source when validating links (JSON array of hostnames), and
        -- official reference pages shown on /sources (JSON array of { label, url }).
        extra_hosts          TEXT NOT NULL DEFAULT '[]',
        reference_links      TEXT NOT NULL DEFAULT '[]',
        status               TEXT NOT NULL DEFAULT 'unverified'
                               CHECK (status IN ('unverified','verified','degraded','unreachable')),
        last_checked_at      TEXT,
        last_verified_at     TEXT,
        last_http_status     INTEGER,
        last_response_ms     INTEGER,
        last_error           TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE source_checks (
        id          INTEGER PRIMARY KEY,
        source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        checked_at  TEXT NOT NULL,
        outcome     TEXT NOT NULL CHECK (outcome IN ('ok','refused','failed')),
        http_status INTEGER,
        response_ms INTEGER,
        final_url   TEXT,
        error       TEXT
      );
      CREATE INDEX idx_source_checks_source ON source_checks (source_id, checked_at DESC);

      -- One row per TED notice. publication_number is the natural key, which is what makes
      -- re-running an ingestion safe: the same notice is updated, never duplicated.
      CREATE TABLE ted_notices (
        id                 INTEGER PRIMARY KEY,
        publication_number TEXT NOT NULL UNIQUE,
        title              TEXT,
        buyer_name         TEXT,
        primary_country    TEXT,
        notice_type        TEXT,
        publication_date   TEXT,
        deadline_at        TEXT,
        url                TEXT NOT NULL CHECK (url LIKE 'https://%'),
        raw                TEXT NOT NULL,
        content_hash       TEXT NOT NULL,
        first_seen_at      TEXT NOT NULL,
        last_seen_at       TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        last_run_id        INTEGER
      );
      CREATE INDEX idx_ted_notices_pubdate  ON ted_notices (publication_date DESC);
      CREATE INDEX idx_ted_notices_deadline ON ted_notices (deadline_at);

      CREATE TABLE ted_notice_countries (
        notice_id INTEGER NOT NULL REFERENCES ted_notices(id) ON DELETE CASCADE,
        country   TEXT NOT NULL,
        PRIMARY KEY (notice_id, country)
      );
      CREATE INDEX idx_ted_notice_countries_country ON ted_notice_countries (country, notice_id);

      CREATE TABLE ted_notice_cpv (
        notice_id INTEGER NOT NULL REFERENCES ted_notices(id) ON DELETE CASCADE,
        cpv_code  TEXT NOT NULL,
        PRIMARY KEY (notice_id, cpv_code)
      );
      CREATE INDEX idx_ted_notice_cpv_code ON ted_notice_cpv (cpv_code);

      CREATE TABLE ingestion_runs (
        id          INTEGER PRIMARY KEY,
        source_slug TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        status      TEXT NOT NULL CHECK (status IN ('running','ok','partial','empty','failed')),
        window_from TEXT,
        window_to   TEXT,
        fields_tier TEXT,
        fetched     INTEGER NOT NULL DEFAULT 0,
        inserted    INTEGER NOT NULL DEFAULT 0,
        updated     INTEGER NOT NULL DEFAULT 0,
        unchanged   INTEGER NOT NULL DEFAULT 0,
        failed      INTEGER NOT NULL DEFAULT 0,
        error       TEXT
      );
      CREATE INDEX idx_ingestion_runs_source ON ingestion_runs (source_slug, started_at DESC);

      CREATE TABLE subscribers (
        id                    INTEGER PRIMARY KEY,
        email                 TEXT NOT NULL UNIQUE,
        role                  TEXT,
        status                TEXT NOT NULL CHECK (status IN ('pending','confirmed','unsubscribed')),
        confirm_token_hash    TEXT,
        confirm_expires_at    TEXT,
        consent_text_version  TEXT NOT NULL,
        consented_at          TEXT NOT NULL,
        confirmed_at          TEXT,
        unsubscribed_at       TEXT,
        signup_source         TEXT,
        submit_count          INTEGER NOT NULL DEFAULT 1,
        last_submitted_at     TEXT NOT NULL,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL
      );
      CREATE INDEX idx_subscribers_status ON subscribers (status);

      -- One issue covers one country. Drafts never appear on public pages.
      CREATE TABLE newsletter_issues (
        id           INTEGER PRIMARY KEY,
        slug         TEXT NOT NULL UNIQUE,
        title        TEXT NOT NULL,
        issue_date   TEXT NOT NULL CHECK (issue_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        country      TEXT NOT NULL CHECK (country IN ('PRT','LUX','BEL')),
        content      TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
        published_at TEXT,
        sent_at      TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_newsletter_issues_public ON newsletter_issues (status, issue_date DESC);

      -- Official source links for an issue. Each must belong to a source in the directory, and the
      -- CHECK keeps non secure links out. What is stored here is exactly what the public page shows.
      CREATE TABLE newsletter_links (
        id        INTEGER PRIMARY KEY,
        issue_id  INTEGER NOT NULL REFERENCES newsletter_issues(id) ON DELETE CASCADE,
        position  INTEGER NOT NULL,
        source_id INTEGER NOT NULL REFERENCES sources(id),
        notice_id INTEGER REFERENCES ted_notices(id) ON DELETE SET NULL,
        label     TEXT NOT NULL,
        detail    TEXT,
        url       TEXT NOT NULL CHECK (url LIKE 'https://%'),
        UNIQUE (issue_id, url)
      );
      CREATE INDEX idx_newsletter_links_issue ON newsletter_links (issue_id, position);

      CREATE TABLE newsletter_deliveries (
        issue_id      INTEGER NOT NULL REFERENCES newsletter_issues(id) ON DELETE CASCADE,
        subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
        status        TEXT NOT NULL CHECK (status IN ('sent','failed')),
        error         TEXT,
        attempted_at  TEXT NOT NULL,
        PRIMARY KEY (issue_id, subscriber_id)
      );

      CREATE TABLE enquiries (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        email      TEXT NOT NULL,
        company    TEXT,
        interest   TEXT NOT NULL CHECK (interest IN ('tender_intelligence','ai_automation','both','other')),
        message    TEXT NOT NULL,
        consented_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE email_log (
        id         INTEGER PRIMARY KEY,
        to_email   TEXT NOT NULL,
        subject    TEXT NOT NULL,
        kind       TEXT NOT NULL,
        status     TEXT NOT NULL CHECK (status IN ('sent','failed','logged')),
        error      TEXT,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'erasure tombstones',
    sql: `
      -- Hashes of addresses erased on request, so an old backup that is restored can have those erasures applied
      -- again. Only a keyed hash is kept, never the address, and erased_at stops a person who signed up again
      -- later from being deleted by mistake.
      CREATE TABLE erasures (
        email_hash TEXT PRIMARY KEY,
        erased_at  TEXT NOT NULL
      );
    `,
  },
];
