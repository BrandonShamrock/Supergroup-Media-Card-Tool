# Latest connectivity diagnostic validation

This release adds the authenticated DealerOS network diagnostic. Final local checks:

- Clean `npm ci --no-audit --no-fund` and `npm run build` passed.
- `CHROMIUM_PATH=/usr/bin/chromium npm test`: **49 tests passed** (35 unit/database/security/worker tests and 14 browser tests), no skips.
- Foreground API, stock background worker, new diagnostic background handler and unchanged campaign worker bundled with esbuild and imported successfully as Node ESM.
- PostgreSQL/PGlite executed all four migrations. New assertions cover diagnostic authorization, two-minute cooldown, single claim, browser-role access denial and preservation of stock job state.
- Tests cover DNS/TLS/TCP/timeout/aggregate classifications, code-only redaction, redirect refusal, strict TLS/SNI, per-family results, headers-only GET body cancellation, proxy-presence redaction, unsafe TLS environment prevention and authenticated UI queue feedback.
- `git diff --check` passed. There is no configured lint script.
- Netlify account/API credentials and DealerOS credentials are absent here. No request was made from the actual Netlify runtime, and no root cause or redirect has been confirmed. Follow [diagnostic deployment/log instructions](DEALEROS_NETWORK_DIAGNOSTICS.md).
- No PostX settings or sending process were modified or enabled. Production must retain `POSTX_LIVE_SENDING_ENABLED=false`.

Prior release validation records follow for context; their test totals are superseded above.

# Latest stock-refresh fix validation

This release adds `202611110001_background_stock_refresh.sql` and an authenticated Netlify Background Function. Validation for this release:

- Clean `npm ci` and `npm run build`.
- `CHROMIUM_PATH=/usr/bin/chromium npm test`: 39 passing tests (26 unit/database/security/worker tests, 13 browser tests).
- Real 31 MiB streamed fixture accepted; only normalized stock retained. Simulated 45-second upstream latency succeeds using a virtual clock, with no real API call or 45-second sleep.
- Oversized/aborted streams, HTTP/network/JSON/validation errors, safe logging, database guard failure, duplicate dispatch/claim, stale leases, status timeouts and bounded stock pagination covered.
- All three migrations executed against PostgreSQL/PGlite; atomic rollback, no stock deletion on failure, single-claim jobs, terminal success and old-worker failure guards checked.
- Foreground, background and unchanged campaign worker bundles compile/import with Node ESM.
- No live DealerOS/Supabase refresh, production Netlify account limits/memory profile, migration application or deployment claimed. Background Functions availability was confirmed by the owner. The exact synchronous account override could not be inspected; official Netlify CLI 27.17.0 reports a site-specific lookup/default 30-second sync timeout and 900-second background timeout. See [limit investigation/deployment details](STOCK_REFRESH.md).
- PostX sending configuration, worker code, budgets and activation remain unchanged. No real messages sent.

The previous implementation's validation record follows for context; its 26-test total is superseded by the current 39-test release.

# Implementation validation

Validated locally on the integration feature branch:

- `npm ci --no-audit --no-fund`: passed with the committed lockfile.
- `npm run build`: passed; workflow code is split into separate chunks, with no large-chunk warning.
- `CHROMIUM_PATH=/usr/bin/chromium npm test`: **26 tests passed** (16 unit/database/security/worker tests and 10 browser tests). No skips or expected failures.
- Both Netlify Functions were bundled using esbuild for Node/ESM and the generated bundles imported successfully.
- `git diff --check`: passed.
- Frontend output was checked for server credential variable names; service-role, DealerOS and PostX credential bindings are not included.
- No lint script exists in this repository. Source was formatted with Prettier.

SQL tests execute both migrations using embedded PostgreSQL/PGlite with simulated Supabase Auth roles and user claims. They verify 57 seeded mappings, staged UPSERT and absent-stock removal, unchanged records without duplication, empty/shrinking feed protection, exclusive sync leases, unauthorized/RLS access denial, service-only queue RPCs, campaign idempotency and content fingerprints, single-claim batches, unknown interrupted attempts, removal of attempted/cancelled recipient PII, preservation of unfinished queue data, and independent historical vehicle snapshots.

Shared/server tests cover primary order-1 image extraction, response completeness/identifier checks, ambiguous dealership candidates, phone normalization, invalid/duplicate recipients, ordered case-sensitive template payloads, verified batch limits, correlated PostX outcomes, public image host/type/size/signature/expiry checks, explicit server authorization, disabled sending, exactly one mocked attempt, timeout-as-unknown, and pre-send configuration mismatch.

Browser tests mock Supabase Auth, backend data and image requests. They cover login/session restoration/loading/failure/sign-out, unauthenticated nested paths, vehicle selection, CSV and actual XLSX fixture parsing, audience validation, dealership settings, disabled final sending and mobile overflow. Fixtures contain invented examples only.

The first integration test runs revealed an XLSX library API change and navigation resets during dependency loading/auth events; these were corrected and the final full suite passed. This report describes the final run, not those earlier failed diagnostic runs.

Not validated here: live Supabase/PostgREST deployment, live DealerOS feed envelope/image fields/completeness, PostX template approval or endpoint limit, async signed-media lifetime, actual Netlify scheduling/runtime/Free-plan quotas, or any real message submission. Credentials were not available. PGlite/mocks and esbuild are not claims of live infrastructure compatibility. Follow `docs/DEPLOYMENT.md` before production activation. Live sending remains off by default.
