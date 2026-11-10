# Super Group Media Card Tool

Internal React/Vite dealership workspace with Supabase email/password authentication, DealerOS stock synchronization, customer spreadsheet validation and a server-side PostX media-carousel queue. The existing blue/white dashboard, navigation and authentication are retained. There is no public signup, password reset or dealership-specific role system.

**Live sending is disabled by default. Do not enable it without explicit owner approval and completion of the verification checklist in [the deployment runbook](docs/DEPLOYMENT.md).** No real WhatsApp messages were sent during development.

## Development

Use Node.js 22.12+ and npm (validated with Node 24).

```sh
npm ci
npm run dev
npm run build
npm run preview
```

Vite alone serves the frontend; the integration API requires Netlify Functions. Use a Netlify CLI installation with `netlify dev` and the configured project environment to run both locally. Do not use production customer information for local tests. Netlify deployment retains `npm run build`, `dist`, and the SPA fallback in `netlify.toml`.

For authentication configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in an ignored `.env.local` file. Only public Supabase settings belong in Vite variables. Missing/invalid settings fail closed. The SDK persists authentication tokens in browser storage, restores and verifies sessions, and signs out across tabs. Passwords are cleared after attempts.

Backend operations additionally require the server settings and database migrations in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). A valid session alone is insufficient: the two approved users must be explicitly added to `authorized_users`. All protected backend actions verify the bearer token with Supabase Auth and check this allowlist. Database RLS denies access to other users; browsers cannot read queued recipient names/numbers or write integration tables/RPCs.

## Workflow

1. Refresh stock. The full DealerOS feed is validated and staged before an atomic UPSERT and removal of absent vehicles. Empty, malformed, duplicate-ID, paginated, known-incomplete or >20% shrinking feeds are rejected without changing stock. Jobs use an exclusive leased lock. Only `listingImages` entries with numeric `order === 1` are retained; supported image fields are `url` or `image_url`.
2. In Dealership Settings, manually map a discovered DealerOS ID to a seeded PostX group. Names produce suggestions only, including ambiguous matches. Verify mapping, approved template, card count and exact case-sensitive variable mappings. All 57 supplied group mappings start inactive and unverified. No global template is assumed.
3. Select the dealership and stock cards in sending order. Missing primary images cannot be selected. Required card count is enforced. Changing dealerships clears selections.
4. Upload `.xlsx` or `.csv` (first sheet, first row as headers), at most 5 MiB and 10,000 customer rows. Map distinct name and phone columns, validate and review. Names are required; ZA local numbers normalize to +27, explicit international prefixes are supported, duplicate normalized numbers are removed and invalid rows are reported. Keep phone columns as text to preserve leading zeroes and + signs. Only the first 10 validated recipients are displayed, with masked numbers. Duplicate counts and first 50 invalid row reasons are shown.
5. Preview the ordered WhatsApp carousel, group, template, audience and expected batch count. The preview displays validation warnings. Real template copy/presentation is controlled by the approved PostX template.
6. After explicit sending approval and endpoint-limit verification, enter a campaign name, affirm recipient consent, and type the final confirmation phrase to queue. Fresh DealerOS images and stock are checked at queue time and again before each worker attempt.
7. The scheduled worker handles one bounded batch per invocation, independently of the browser. History polls every 15 seconds, showing submitted outcomes, errors, compact vehicle snapshots and correlation references. Accepted means accepted for processing, **not delivered**. Unknown outcomes are never automatically retried.

## Template mappings

Settings store JSON with `recipient` and `card` objects. Keys are the exact, case-sensitive approved template variable names. Values select source fields or `literal:your fixed value`. For example (illustrative only):

```json
{
  "recipient": { "client_interest": "literal:Suzuki" },
  "card": { "car_type": "car_type", "year": "year", "mileage": "mileage" }
}
```

Card sources: `car_type`, `year`, `mileage`, `retail_price`, `make`, `model`, `derivative`, `stock_number`. Recipient sources: `name`, `dealership_name`. Empty objects are allowed for templates with no variables; operators must verify the exact approved schema in PostX.

## Tests

```sh
npm run test:unit
npx playwright install chromium
npm run test:browser
# Or with an existing system Chromium:
CHROMIUM_PATH=/usr/bin/chromium npm test
```

Unit/database tests use invented fixtures, mocked requests and embedded PostgreSQL (PGlite). They execute both SQL migrations and exercise stock safeguards, UPSERT/removal, RLS, leases, durable batches, fingerprint/idempotency protection, interrupted attempts, private PII cleanup, historical snapshots, parsing, numbers, mappings, payloads, batching, image security and PostX outcome correlation. Browser tests mock both Auth and the backend; they test login/session restrictions, stock selection, CSV/XLSX processing, settings and disabled sending. Test data does not describe real customers.

Live DealerOS/PostX calls, a live Supabase migration and an actual Netlify deployment are **not** claimed as validated. Required credentials are absent from this workspace. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for remaining checks and operational limitations.

## Implementation map

- `src/Auth.jsx`, `src/supabase.js`: existing session gate and Auth client.
- `src/main.jsx`, `src/styles.css`: dashboard shell, real data/empty states, stock and history.
- `src/CustomerUpload.jsx`, `src/DealershipSettings.jsx`, `src/CampaignPreview.jsx`: lazy-loaded workflows.
- `src/api.js`: authenticated requests to Netlify Functions.
- `shared/domain.js`: shared stock, recipient, template, payload and result validation.
- `netlify/functions/api.js`: authorized reads/settings, stock refresh, preview and durable campaign queueing.
- `netlify/functions/campaign-worker.js`: one scheduled batch per minute; no browser dependency.
- `netlify/functions/lib/`: server-only credentials, API access and image validation.
- `supabase/migrations/`: schema/RLS/RPCs and seeded dealership group mappings.
- `tests/`: automated domain/database/security and browser tests with invented CSV/XLSX fixtures.

Client-side protection does not secure backend data by itself. Maintain RLS on every future table and independent server authorization on every messaging/data operation. No service-role or DealerOS/PostX credential may appear in frontend code, a `VITE_` variable, a commit, or a log.
