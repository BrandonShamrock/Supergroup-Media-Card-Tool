# Deployment and safe production activation

This branch is reviewable code, not an activated production integration. No deployment, production database change, live stock refresh or WhatsApp submission was performed. Both actual feed structure and vendor media-carousel behavior must be verified before activation. Do not paste secrets into source files or chat.

## 1. Review and apply database migrations

Back up/inspect the target Supabase project first. Apply once, in order, using the Supabase SQL editor or the Supabase migration CLI:

1. `supabase/migrations/202611100001_integration.sql`
2. `supabase/migrations/202611100002_dealership_seed.sql`
3. `supabase/migrations/202611110001_background_stock_refresh.sql` (for this release; see [large-feed refresh](STOCK_REFRESH.md))
4. `supabase/migrations/202611110002_dealeros_connectivity.sql` (network diagnostics; [deployment/log instructions](DEALEROS_NETWORK_DIAGNOSTICS.md))

The first creates vehicle stock, dealership settings, campaigns, independent vehicle snapshots, private queue batches, PII-free recipient results, sync status, an explicit authorized-user allowlist, RLS and service-only transactional RPCs. The second seeds all 57 supplied PostX group mappings as **inactive, unverified and without DealerOS IDs/templates**. Existing dealership configuration is not deleted by synchronization.

Use the Supabase SQL editor as project administrator to insert the **two existing users' actual Auth UUIDs** into `public.authorized_users(user_id)`. Do not use the invented test UUIDs. Do not add public signup or automatically allow every account. Test both approved users and a non-authorized/unauthenticated request. For emergency revocation, delete the user from this table; subsequent protected operations fail authorization.

PGlite validates migrations locally, including RLS and RPC logic. It is not a substitute for applying and testing them against Supabase/PostgREST in staging.

## 2. Netlify environment variables

Configure variables through Netlify Site configuration → Environment variables. Scope secrets to **Functions**, never Builds or frontend variables. Use the production context only where appropriate; preview contexts should stay sending-disabled and use staging projects. The public Vite settings need **Builds** scope. Do not expose production server credentials to untrusted pull-request builds.

| Variable | Scope | Required value/purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Builds | Public HTTPS URL for the correct Supabase project |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Builds | Browser-safe `sb_publishable_…` key only |
| `SUPABASE_URL` | Functions | Same project's HTTPS URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Functions, secret | Server-only Supabase service-role key; bypasses RLS, so never expose it |
| `STOCK_API_BEARER_TOKEN` | Functions, secret | DealerOS read credential |
| `POSTX_BEARER_TOKEN` | Functions, secret | PostX media-carousel credential |
| `STOCK_IMAGE_ALLOWED_HOSTS` | Functions | Comma-separated exact image hostnames discovered from the real feed; no wildcards, URLs or private hosts |
| `POSTX_LIVE_SENDING_ENABLED` | Functions | Omit or `false` until explicitly approved; `true` is the live kill switch |
| `POSTX_VERIFIED_BATCH_LIMIT` | Functions | Verified limit for **this media-carousel endpoint**, integer 1–500; default 0 blocks queueing |
| `POSTX_BATCH_SIZE` | Functions | Integer 1 through the verified limit; no assumed default |
| `MEDIA_MIN_VALIDITY_SECONDS` | Functions | Signed-image safety window, at least 900 seconds; default 900. Set to the vendor-confirmed maximum media-fetch delay plus safety margin |

Redeploy after changes, especially Vite build variables. Netlify builds with `npm run build`, publishes `dist`, uses the existing SPA rewrite and bundles functions from `netlify/functions`. The worker declares a once-per-minute schedule and intentionally handles **one batch only** per invocation. Scheduled functions run on published production deployments, not ordinary deploy previews. Confirm this is available on the selected Netlify Free plan and check scheduled-function logs/status without logging tokens or recipient data. Check scheduled functions cannot be invoked as public HTTP endpoints on the actual deployment.

Do not rely on a browser, detached local process, normal long-running HTTP handler, paid queue or Supabase paid feature. At one batch/minute, 10,000 recipients at batch size 500 require about 20 minutes; lower verified limits take longer. Monitor function usage and Free-plan quotas before choosing production volume. If the confirmed endpoint limit is very small, throughput/quotas need a separate operational review.

## 3. Verify stock with sending disabled

Keep `POSTX_LIVE_SENDING_ENABLED=false` throughout these checks.

1. Deploy a reviewed branch only when ready; this work does not deploy automatically.
2. Sign in as an approved user and refresh stock. Confirm successful server-only access to `GET https://api.dealeros.co.za/api/listings/list?with=listingImages` and its actual full-feed shape. Supported envelopes: raw array, `{data: array}` or `{listings: array}`. Known pagination/total mismatches are rejected. If the provider returns a different envelope or primary-image field, adapt parsing and fixtures in a separate reviewed change, not by weakening deletion safeguards.
3. Confirm `stock_id` is unique. It is chosen only when every feed row has a unique nonempty value; otherwise `id` must be unique. Persisted identifier strategy cannot silently change later. Null/invalid essential year/mileage/price/dealership fields block the complete sync rather than dropping individual rows.
4. Verify total count and at least several actual vehicles/dealership IDs. The API must really return the entire feed; an envelope without a total cannot prove upstream completeness. Server validation and the shrink threshold cannot detect every plausible partial feed. Compare against DealerOS before trusting first sync.
5. Repeat refresh and confirm no duplicates and unchanged rows do not rewrite. Compare sample removed/updated vehicles only in staging. Overlapping refreshes are rejected by a 3-minute lease.
6. A reduction **greater than 20%** blocks the atomic sync. Empty/malformed/failed responses never remove stock. Investigate with DealerOS. There is intentionally no UI bypass. For a legitimate larger reduction, an administrator must review the feed and take an explicitly reviewed database action; do not repeatedly lower counts to force acceptance.
7. Only numeric `order === 1` images are stored; absent images block selection. Add exact verified public media hosts to `STOCK_IMAGE_ALLOWED_HOSTS`. The image validator rejects redirects, private/reserved addresses, unapproved hosts, non-HTTPS URLs, non-JPEG/PNG types/signatures, files over 5 MiB and signed URLs whose expiry cannot be verified or is too near.

Image URLs are refreshed from DealerOS at queue time and before each batch. URLs are fetched publicly **without** DealerOS/PostX credentials. Only the primary URL is stored in current stock; no images go to Supabase Storage. Campaign snapshots omit image URLs and retain compact vehicle details. CloudFront Expires and Policy/Signature URLs are supported. Public IPv4 is required by the current validator; IPv6-only/CDN configurations must be reviewed before support is added. Allowlisted media domains must be trusted operator-controlled/CDN domains, not user-provided hosts.

## 4. Verify dealership and PostX configuration

For each active dealership:

1. Compare the discovered DealerOS ID/name against the supplied PostX group. Seed group IDs are **not** DealerOS IDs. No ambiguous candidate is automatically approved.
2. Obtain the approved template from PostX and verify exact name, card count (2–10), required recipient/card variable names, case and order.
3. Enter variable mappings and explicitly check both mapping verification and template approval. Mark the dealership active only after review.
4. Obtain written/vendor documentation confirming the media-carousel endpoint recipient limit, response statuses/reference semantics and acceptable media lifetime. Set a conservative `POSTX_BATCH_SIZE` no larger than the verified `POSTX_VERIFIED_BATCH_LIMIT`, capped at 500. Do not copy a general bulk-send limit.
5. Verify the actual `listingImages` URL fields, PostX acceptance/failure response shape and maximum response time with vendor-approved fixtures or a sandbox. SDK/payload examples are not proof of approval. No delivery/read/engagement metrics are fabricated.

Queued campaigns freeze configuration and vehicle metadata. If settings or selected stock change before processing, a batch fails pre-submission validation. Exact approved template copy is controlled by PostX; the UI is an illustrative carousel preview, not a template renderer. Existing campaigns should be finished or cancelled through reviewed administrator procedures before changing dealership configuration.

## 5. Customer data and retention

Use invented test rows until release approval. Operators must have a lawful purpose and required marketing/WhatsApp consent, maintain opt-outs through their governed customer processes, minimize data and follow the organization's POPIA policies. This application does not infer or prove consent from a spreadsheet, perform suppression-list synchronization or provide legal compliance certification. Do not activate if consent/suppression requirements cannot be met operationally.

Original files are never uploaded or saved. Parsing and column mapping happen in browser memory; validated names/numbers are transmitted over HTTPS to the authenticated private queue only for preview/submission. Preview processing does not persist recipients. Queue batches retain names/numbers only while pending. After an attempt they are removed atomically, including uncertain outcomes. Only external references, status, conversation IDs and fixed non-PII error summaries remain. Names/numbers are not exposed in history or public storage. Phone numbers are not stored in recipient results; use references to reconcile in PostX.

The scheduled worker runs cleanup even when live sending is disabled: correlation results expire after 90 days. Pending recipients are retained privately until processing or explicit operator cancellation, so cleanup never discards information needed by unfinished campaigns. Review queues at least weekly and use Cancel pending in history to remove abandoned pending data. In-flight submissions cannot be recalled. Campaign metadata/snapshots remain for audit. Schedule monitoring is necessary for retention to occur. Database backups and PostX retention follow their own policies; clearing application rows does not erase provider backups. Agree retention and operator access with the data owner before production use.

## 6. Explicit activation and monitored first submission

1. Complete staging checks above, inspect tests/build, confirm scheduled worker availability and quotas, and obtain **explicit approval to enable live PostX sending**.
2. Check recipient consent/opt-outs, exact group/template approval and media-fetch delay. Set an adequate signed-image validity window; a successful fetch now cannot guarantee future asynchronous availability. If DealerOS URL lifetime is shorter than PostX's confirmed retrieval window, do **not** activate; a provider-supported durable media solution is required. Do not upload additional stock images to Supabase as a workaround.
3. Set `POSTX_LIVE_SENDING_ENABLED=true` and redeploy deliberately. Set only the verified endpoint limit/batch size. No code in this branch turns it on.
4. With owner approval, send a minimal campaign to consented internal test recipients, review every card and mapping, and enter the final confirmation. This is a real send, not part of automated testing.
5. Confirm accepted/failed/unknown correlation references, campaign totals and worker timing in history and PostX. Accepted does not mean delivered. Increase volume only after successful observation.
6. Set the kill switch back to `false` and redeploy if uncertain. An already-running request may still finish; disabling is not a recall. Queued data remains private until processing or explicit cancellation under the stated policy.

## 7. Interruptions, reconciliation and limitations

The database claims queued batches with row locks (`FOR UPDATE SKIP LOCKED`). A claimed batch is not eligible for another attempt. The worker uses an overall 22-second network abort budget and one bounded batch; validate actual Netlify runtime limits/timing before activation. Normal completion saves per-recipient outcomes atomically with PII removal. If PostX was attempted and the response times out, fails HTTP/schema correlation, or cannot be safely recorded, the outcome is unknown. Crashed processing older than 3 minutes becomes unknown at the next scheduled cleanup. **There is no automatic resend of failed/unknown batches.**

Campaign UUID idempotency and a content fingerprint prevent duplicate queueing of the same named audience/selection on retry, including after a page reload. Reusing the same ID returns the existing campaign. This does not claim PostX supports an idempotency header. The system does not invent a reconciliation endpoint. Use batch external references in history to investigate in PostX. An administrator must establish rejected/not-submitted status before designing any manual recovery; there is intentionally no unsafe Retry button. New campaign names are treated as intentional new campaigns, so users must not rename an uncertain campaign just to retry.

No production migrations, Netlify CLI deployment, live API compatibility/limits, signed-media lifetime, vendor-approved templates, live scheduler execution or real customer sends were verified from this workspace because credentials/deployment access are absent. Network destination access must also permit the exact Supabase project host, `api.dealeros.co.za`, `api.postx.co.za` and verified media hosts. Do not replace existing network allowlists blindly.
