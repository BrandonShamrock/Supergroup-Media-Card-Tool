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
