# Reliable large DealerOS refresh

## Diagnosis and execution limits

The confirmed DealerOS response is one complete feed: Postman measured **38.07 seconds and 21.72 MB**. The old implementation aborted at 15 seconds, then rejected responses over 20 MiB after buffering them. A 38-second request necessarily exceeded the first limit. Postman's MB unit and compression/decoding basis are not established, so 21.72 MB should not be treated as an exact decoded-byte measurement; it is close to/above the old size cap depending on units. Both hard-coded assumptions were unsuitable.

The checked-in deployment uses normal Netlify Node functions with esbuild and has no custom runtime timeout or memory setting. No Netlify account token/site link is available in this workspace, so **the exact deployed synchronous timeout, memory override, usage balance and account response overrides could not be inspected**. The owner confirmed Background Functions are available for this site.

Investigation on 2026-11-11:

- Inspected the published official `netlify-cli@27.17.0` npm artifact, `dist/utils/dev.js`. `SYNCHRONOUS_FUNCTION_TIMEOUT` is 30 seconds; linked sites use `siteInfo.functions_timeout ?? siteInfo.functions_config?.timeout` when available. This is evidence of the CLI fallback and account-specific lookup, **not proof that production is configured to exactly 30 seconds**.
- The same official artifact sets `BACKGROUND_FUNCTION_TIMEOUT = 900` and identifies this as 15 minutes. The implementation uses the platform's `-background` filename convention; it does not extend a synchronous timeout.
- Standard documented function-boundary limits to check for the account are 6 MB for buffered synchronous request/response payloads and 256 KB for background invocation payloads. Streaming response limits do not solve upstream fetch duration. Crucially, these are **function invocation/response limits**, not a 20 MB maximum on outbound `fetch` responses inside a function. This design keeps dispatch/status payloads tiny and caps browser stock pages at 1 MiB, well below either ordinary buffered response ceiling. It does not return DealerOS's raw feed from any endpoint.
- Reference documentation: [Functions overview](https://docs.netlify.com/build/functions/overview/) and [Background Functions](https://docs.netlify.com/build/functions/background-functions/). Direct retrieval of those pages was blocked with HTTP 403 by this workspace's network proxy, so no claim is made that account limits were verified through those pages. Official CLI source reference: [Netlify CLI dev utilities](https://github.com/netlify/cli/blob/v27.17.0/src/utils/dev.ts). An administrator can confirm actual values via the linked site's Netlify dashboard/API before activation; `netlify dev` with authenticated account access reads the site's overrides.

The supported solution here is an available Netlify Background Function, not a paid queue or an additional hosted worker. Supabase Free only stores compact job status and the existing normalized stock. No raw JSON, additional image URLs, image files, new Storage bucket or ongoing stock snapshots are added. Background invocation usage still counts against the Netlify plan: verify your current allowance/credits and default Node memory (typically 1024 MiB) in the site account. The large-feed regression does not constitute a production memory profile.

## New flow

1. Browser calls the existing authenticated `api?action=refresh` endpoint.
2. The server validates Supabase Auth and application authorization, then requests a durable job/lease in Supabase. An existing queued/running job is reused; it is not replaced by another overlapping refresh.
3. The server invokes `stock-refresh-background` with only the UUID job ID (well under 1 KB), forwarding the current authorized user's bearer token to the trusted Netlify deployment origin. The token never appears in the body or logs. The origin cannot be supplied through browser input or the request Host header.
4. The foreground response is HTTP 202 with a job ID. It means queued/dispatch attempted, **not synchronization succeeded**. A dispatch timeout is recorded as unconfirmed because Netlify may already have accepted it.
5. The background handler independently verifies the user and allowlist, then atomically claims that user's current queued job. Netlify retries/repeated invocations find no queued claim and do not repeat the work.
6. DealerOS fetch/download has a **180-second** total abort budget and a **64 MiB decoded-body cap**, with byte counting during stream reads. This supports 25–30 MB feeds and >40-second responses while retaining a safety limit. It does not wait 15 minutes for a broken upstream. Abort/size failures cancel the stream promptly. Compressed Content-Length is not trusted as a decoded size.
7. Only after the complete JSON and full-feed validation pass are normalized records sent to the existing staging/UPSERT transaction. All original ID, duplicate, >20% shrink, empty-feed, primary-image `order === 1`, removal and unchanged-record safeguards remain. Success status and stock commit occur in the same database transaction.
8. The UI polls a small authenticated status endpoint every three seconds while a job is queued/running, showing success/failure and correlation ID. It loads updated stock only after success. Jobs continue if the browser closes, and a later visit reads persisted status.
9. Stock data is now delivered to the browser in cursor-based pages, dynamically bounded to 1 MiB per response. The app no longer returns every normalized record/signed URL in one potentially oversized dashboard response.

Leases last 12 minutes; the original transaction still rejects expired/mismatched leases. A queued job that does not start within two minutes is marked `DISPATCH_TIMEOUT` when status is checked. An expired running job becomes `WORKER_INTERRUPTED`. A new request can then retry safely. No lease/status failure deletes committed stock. If no browser is open, terminal timeout detection happens on the next status read; it does not require a new scheduled function. Upstream/network/database failures do not auto-loop indefinitely. No optimistic success is shown just because Netlify accepted a job.

## Deployment steps (not performed by this change)

1. Review/merge through your normal process. This branch is pushed for review only; no deploy or merge has been performed.
2. Apply **`supabase/migrations/202611110001_background_stock_refresh.sql`**, after the two original integration migrations. Do this with no refresh currently in progress. It adds only job metadata to the singleton status table and service-only request/claim/status RPCs. It wraps, rather than rewrites, the existing synchronization transaction. Old/queued jobs from before this release should be allowed to finish before deployment.
3. Keep existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `STOCK_API_BEARER_TOKEN` in Netlify's **Functions** scope, with the correct deployment context. The same two authorized user records are required. No new secret is needed.
4. The dispatcher prefers `STOCK_BACKGROUND_ORIGIN` if explicitly configured, otherwise Netlify's `DEPLOY_URL`. If `DEPLOY_URL` is not exposed in your Functions runtime, set **`STOCK_BACKGROUND_ORIGIN`** (Functions scope) to the exact reviewed deployment's HTTPS `*.netlify.app` origin, with no path/query/credentials. The production Netlify site alias can be used when release coordination ensures dispatcher/worker versions match. Do not point a preview dispatcher at production. Custom domains and localhost are intentionally rejected to avoid forwarding authorization to arbitrary origins.
5. Deploy the frontend and functions together after migration. Verify `stock-refresh-background` appears as a **Background Function**, not synchronous, and confirm entitlement/current invocation allowance. Existing `[functions]` directory/esbuild configuration discovers the new suffix automatically; there is no unsupported timeout setting to add to `netlify.toml`.
6. Ensure deployment protection/passwords do not block same-deployment background dispatch. If a protected deploy intercepts it, the job times out with a dispatch diagnostic; do not disable production authentication or send tokens elsewhere as a workaround. Use a correctly accessible deployment origin consistent with your Netlify protection policy.
7. With PostX sending settings unchanged, refresh as an authorized user. Initial acceptance should be fast, progress should remain queued/running beyond 40 seconds, and eventual success must show the committed count/last-refresh time. Verify both job logs and several source vehicles. Repeat once to verify no duplicate stock records. Test failure/large-reduction cases only in a safe staging project or with mocks.

If Background Functions are later removed from the account, this approach must not be deployed as a normal function under a larger client timeout. The smallest prerequisite is restoring that already-confirmed capability or separately approving/reviewing a Supabase Edge worker with its own Free-plan wall-clock/memory/CPU constraints. No untested Edge fallback or paid infrastructure is silently enabled.

## Diagnostics

Logs are structured JSON with an explicit whitelist: event, random job UUID, phase, error code, bytes, elapsed milliseconds, numeric upstream HTTP status, normalized record count and sanitized SQLSTATE. No bearer token, headers, raw error message/stack, response body, customer data, records, signed image URL or upstream URL is logged. Persistent UI errors use fixed safe messages and the same correlation ID.

Codes distinguish:

- `STOCK_CONFIG`, `BACKGROUND_CONFIG`: missing server credential or invalid dispatch origin.
- `UPSTREAM_TIMEOUT`, `UPSTREAM_NETWORK`, `UPSTREAM_HTTP`: fetch/download deadline, transport failure or HTTP status.
- `FEED_TOO_LARGE`, `FEED_JSON`, `FEED_VALIDATION`: decoded size cap, invalid/truncated JSON or full-feed validation.
- `STOCK_SHRINK_BLOCKED`, `STOCK_DUPLICATES`, `STOCK_KEY_CHANGED`, `STOCK_LEASE_EXPIRED`: database safeguards.
- `DATABASE_REQUEST`, `DATABASE_CLAIM`, `DATABASE_TIMEOUT`, `DATABASE_APPLY`, `DATABASE_STATUS`: database execution or status failure.
- `DISPATCH_UNCONFIRMED`, `DISPATCH_TIMEOUT`, `WORKER_INTERRUPTED`: acceptance ambiguity, missing startup, or interrupted job. The first is a log warning, not proof of failure.
- `BACKGROUND_AUTH_OR_START_FAILURE`, `WORKER_FAILURE`: sanitized authorization/startup or unexpected worker failure.

Database application is still one atomic normalized RPC. A slow/unavailable Supabase endpoint or database statement limit is a distinct deployment constraint; diagnose SQLSTATE and elapsed time rather than disabling the transaction or deleting stock in batches. If a client loses the commit response after the transaction committed, its lease-guarded failure update cannot overwrite the committed success; status polling reads the truth from the database.

## Regression coverage and boundaries

Automated tests use a real 31 MiB JSON body, chunked reading, misleading Content-Length, stream cancellation, a simulated 45-second upstream latency using a virtual clock, download timeout, HTTP/network/JSON/field failures, safe log redaction, database refusal, duplicate dispatch/claim handling and persisted lease/terminal status. PostgreSQL/PGlite executes the upgrade on the original schema and checks atomic failure preserves existing stock and last-success time. Browser tests verify asynchronous acceptance, polling, terminal errors and paginated reads. No real DealerOS credential or Netlify account access is present here, so no successful live refresh is claimed.

**PostX is out of scope and unchanged.** Its existing pre-submission full-feed checks retain their 18/22-second budgets. Given the newly confirmed DealerOS latency, those paths can still fail pre-submission; they require a separate approved design change before any live sending. This fix does not activate, reconfigure or extend PostX sending.
