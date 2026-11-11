# DealerOS network failure: diagnostic release

## What is established

Production reported `UPSTREAM_NETWORK`, `phase=fetching`, `bytes=0`, `elapsed_ms=790`. In the previous code, `fetch()` had not returned response headers when that phase was logged. The 180-second deadline and decoded 64 MiB size guard had not been reached. A normal HTTP rejection with a response (401/403/429/5xx) would have produced `UPSTREAM_HTTP`, not this generic network code. A connection being dropped by a WAF can still surface as a network error.

The old catch block discarded Node's nested `cause.code`; its `redirect: "error"` could also turn an HTTP redirect into a generic fetch failure. DNS, TLS certificate validation, TCP/reset, address-family connectivity, local/proxy routing, request-header configuration and a refused redirect therefore remain plausible. No particular one is confirmed by a 790 ms failure alone. Postman's successful response proves reachability from Postman's environment, not Netlify; compare Postman's TLS certificate validation and proxy settings without exposing credentials.

**No test against the actual Netlify runtime has been performed from this workspace.** No working live connection or confirmed redirect is claimed. The purpose of this release is to gather that evidence safely after a reviewed deployment. The stock transaction, stable IDs, deletion safeguards and order-1 image selection are unchanged.

## Changes

- Stock failures carry whitelisted `error_name`, `cause_code`, `cause_codes`, `network_class` and `network_classes`, including nested AggregateError causes. Raw errors/messages/stacks, addresses, request/response objects and URLs are not serialized.
- Stock uses `redirect: "manual"` **only to inspect and reject** 3xx responses. It never follows redirects or forwards the bearer token to another target. A redirect produces `UPSTREAM_REDIRECT`, its numeric status, a same-origin boolean and a scheme enum. `Location` itself is never returned or logged.
- An authorized user can click **Test DealerOS connection** on Vehicle Stock. The existing authenticated API queues a separate `dealeros-diagnostic-background` invocation and returns its diagnostic UUID. A 202 response is acceptance, not a connectivity result.
- Both API and background function independently require Supabase Auth and application authorization. Server-only PostgreSQL RPCs rate-limit diagnostics to one every two minutes, tie the claim to the requesting user and prevent repeated background invocations. Only one small private metadata row is retained; stock and customer records are never modified.

The diagnostic runs:

1. Native Node DNS lookup (5-second application wait budget). Logs only IPv4/IPv6 address counts, never actual addresses.
2. At most one direct TCP/TLS handshake per available family, concurrently (5 seconds each), to DealerOS port 443. SNI and certificate hostname verification use `api.dealeros.co.za`; `rejectUnauthorized: true` is mandatory. These probes send **no HTTP authorization or bearer token**. Logs show family, TCP-connected boolean, TLS protocol or safe failure classification.
3. One authenticated native `fetch` **GET to the exact stock endpoint**, with manual redirects and a 60-second deadline for response headers. It cancels the body immediately without calling `text()`, `json()`, `arrayBuffer()` or reading a chunk. There is no full-feed download, parsing or database synchronization. Native fetch may buffer some network bytes before cancellation; `body_consumed=false` means the application did not consume the body, not that the server sent zero bytes. The provider may still generate its normal feed server-side. Avoid repeated runs; the two-minute cooldown is deliberate.

The diagnostic uses a background invocation because this endpoint may take 38+ seconds even to return headers. Completion is normally within about 70 seconds of starting; allow 90 seconds plus any Netlify queue delay. The diagnostic's 60-second limit is separate from stock refresh's existing 180-second budget. DNS lookup itself is a native OS operation and cannot be forcibly cancelled by the JavaScript wait timer; a late resolver result is ignored.

## Exact deployment steps

1. Review the feature branch. No merge or deployment is performed by the implementation task.
2. Apply `supabase/migrations/202611110002_dealeros_connectivity.sql` in the Supabase SQL editor or migration CLI, **after all previous migrations**, including `202611110001_background_stock_refresh.sql`. Do this before deploying the updated app. No original migration should be re-run.
3. In Netlify Functions environment settings, keep existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `STOCK_API_BEARER_TOKEN`. The stock credential must be the token only, without an extra `Bearer ` prefix, quotes, newline or copied authorization-header label. Do not paste it into code, chat, curl examples or logs. No new secret is required.
4. Keep **`POSTX_LIVE_SENDING_ENABLED=false`** in every deployed context. No PostX worker, payload, process or setting is changed by this release. Do not enable sending to test connectivity.
5. Keep the previously configured safe background origin: Netlify's runtime `DEPLOY_URL`, or Functions-scoped `STOCK_BACKGROUND_ORIGIN` for the reviewed HTTPS `*.netlify.app` deployment. Do not point a preview at production. Existing deploy protection must permit authorized same-deployment background dispatch. No additional diagnostic environment variable is required.
6. Deploy the frontend/API/functions together through the normal reviewed Netlify process. Verify **`dealeros-diagnostic-background`** is identified as a Background Function. Keep the existing `stock-refresh-background`. No function timeout, DNS ordering, address-family override, proxy setting or CA trust setting is added or changed automatically.
7. Sign in with an authorized account, open **Vehicle stock**, and click **Test DealerOS connection** with no stock refresh running. Copy the displayed diagnostic UUID. Wait up to 90 seconds, then inspect the logs below. Do not treat the queued notice as a successful diagnostic.
8. Run **Refresh Stock** once if needed to correlate the real fetch error. Its logs now include safe Node cause classifications. Wait at least two minutes before another diagnostic. Make corrective networking/certificate changes only after interpreting actual runtime results.

Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`, skip certificate checks, blindly force IPv4, follow arbitrary redirects, expose tokens in a browser, or replace existing network allowlists as a diagnostic workaround. If the diagnostic detects the unsafe TLS environment flag, it stops before sending credentials and logs `RUNTIME_TLS_UNSAFE`.

## Logs to inspect after deployment

### 1. `api`

Find `component=dealeros-connectivity`, `event=dispatch`, and the displayed `diagnostic_id`:

- `BACKGROUND_ACCEPTED`: Netlify returned 202. This does not prove the worker authenticated or reached DealerOS.
- `DISPATCH_UNCONFIRMED`: timeout/non-202; inspect function classification, deploy protection and background origin. Do not assume the probe ran.

### 2. `dealeros-diagnostic-background`

Filter `component=dealeros-connectivity` and that `diagnostic_id`. Look for:

- `event=started`, `phase=runtime`: Node version, DNS ordering/automatic family-selection settings, proxy-variable **presence booleans**, environment-proxy enablement flag, custom CA presence and unsafe TLS flag. No proxy addresses, credentials, CA paths or full `NODE_OPTIONS` are logged. Presence is configuration evidence, not proof a proxy was used; a process-wide dispatcher/instrumentation may affect the actual route.
- `event=result`, `phase=dns`: success/counts, or `network_class` and `cause_code` such as `ENOTFOUND`/`EAI_AGAIN`.
- `phase=tcp_tls`, `family=4` / `family=6`: `tcp_connected`, TLS protocol on success, or codes such as `ENETUNREACH`, `EADDRNOTAVAIL`, `ECONNRESET`, `CERT_HAS_EXPIRED`, `ERR_TLS_CERT_ALTNAME_INVALID`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ETIMEDOUT`. A missing family is `event=skipped`, `code=NO_ADDRESS`, not a failed connection attempt.
- `phase=http`: numeric `http_status`, `network_class=HTTP_OK`, `HTTP_REJECTION` or `REDIRECT`; otherwise safe fetch causes including `UND_ERR_CONNECT_TIMEOUT`. Redirect results include only `redirect_same_origin` and `redirect_scheme`, never Location. A 200/header success proves reachability only, not complete feed validity.
- `event=completed`: probes finished; **not** an overall assertion of healthy networking. Examine each result.
- `DIAGNOSTIC_AUTH_OR_START_FAILURE` or `DIAGNOSTIC_NOT_CLAIMED`: the probe did not execute. Check authorization, migration, cooldown/duplicate invocation and deployment configuration first. Background responses are accepted before worker authorization, so UI acceptance is insufficient.

### 3. `stock-refresh-background`

For the stock job UUID, inspect `event=failed`, `phase`, elapsed time and the new cause fields:

- `UPSTREAM_DNS`, `UPSTREAM_TLS`, `UPSTREAM_TCP`, `UPSTREAM_TIMEOUT` classify recognized single-category failures.
- `UPSTREAM_NETWORK` remains for unknown or mixed errors; `cause_codes` and `network_classes` retain distinct safe AggregateError causes (for example IPv6 unreachable plus IPv4 connect timeout).
- `UPSTREAM_REDIRECT` confirms a 3xx response that was **not followed**.
- `UPSTREAM_HTTP` records an actual HTTP rejection. A 401 suggests credential validation; 403/429 could be token policy, WAF, rate limiting or proxy rejection. HTTP status alone does not prove DealerOS blocks Netlify.
- `network_class=REQUEST_CONFIG` with `ERR_INVALID_CHAR` or invalid-header codes points to local request/header configuration. Never inspect raw Error.message in logs because it can embed an authorization value.

## Interpretation and safe next action

| Evidence | Likely area to investigate, not a confirmed fix |
|---|---|
| DNS fails in runtime | Netlify runtime resolver/egress or DealerOS DNS; correlate time and retry only after a meaningful change |
| IPv4 TLS succeeds, IPv6 fails | Address-family availability. Compare native fetch AggregateError causes and Node automatic selection; do not assume IPv6 failure alone broke fetch |
| TCP connects but TLS fails | Full certificate chain, validity, hostname/SNI and supported TLS versions; have DealerOS correct the server chain or review an authorized trust configuration |
| Direct TLS succeeds but native fetch fails | HTTP-layer connection handling, runtime proxy/dispatcher, family fallback or upstream connection policy; compare cause codes and configured proxy flags |
| HTTP GET is 3xx | Confirm the canonical URL with DealerOS through a secure channel; do not automatically forward credentials to Location |
| HTTP GET is 401/403/429 | Verify token scope/format, rate/WAF policies and whether DealerOS sees the request. Ask DealerOS to correlate UTC timestamp, Netlify region/egress and endpoint in their logs; do not transmit the token |
| HTTP GET returns 200 after ~38 seconds | Runtime reachability established for that run. Inspect subsequent stock parsing/download if refresh still fails |
| TCP reset before HTTP | Could be peer/middlebox/proxy/WAF reset. It does not by itself identify who reset the connection |

Direct TLS probes deliberately do not use an HTTP proxy. Native fetch retains the runtime's existing behavior. Therefore a direct probe failure and HTTP success can be consistent with a proxy-based route; neither probe silently changes routing or global DNS settings. Differences between Postman and Netlify require runtime evidence, not guesses.

## Validation boundaries

Tests mock DNS, sockets, fetch, auth and SQL calls. They verify error-code redaction/aggregation, redirect rejection, body cancellation without consumption, strict TLS/SNI, IPv4/IPv6 results, deadlines, unsafe TLS prevention, auth/single-claim/cooldown and no stock-state changes. Embedded PostgreSQL executes the new migration and checks that authenticated browser roles cannot read metadata or invoke privileged RPCs. Browser tests check diagnostic queue feedback. Existing large-feed, synchronization and PostX safety tests remain.

These tests and a successful build do **not** confirm the production network cause. Obtain and interpret the logs from the deployed Netlify diagnostic before changing network or certificate configuration. No Supabase Storage objects or customer data are created.
