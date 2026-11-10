# Super Group Media Card Tool

A responsive React + Vite frontend prototype for a dealership marketing workspace. Uses JavaScript, CSS, Lucide icons and local SVG vehicle illustrations. Desktop is the primary layout, with a mobile navigation drawer and scrollable stock table.

## Setup

Use Node.js 22.12+ (or Node 20.19+) and npm. Development was validated with Node 24.22.1.

```sh
npm ci
npm run dev
```

Configure the two environment variables below in an ignored `.env.local` file for local development, then open the address printed by Vite. Unauthenticated visitors see the login screen. Sign in with an account manually created in Supabase. There is no public sign-up or password reset. The top-bar sign-out button calls Supabase Auth and returns to login.

```sh
npm run build
npm run preview
```

The production output is `dist/`. `netlify.toml` configures `npm run build`, publishes `dist`, and rewrites routes to `index.html`. Connect this repository and select the feature branch to deploy a review build on Netlify. Deployment has not been performed by this change.

## Supabase and Netlify environment variables

Set these in Netlify **Site configuration → Environment variables**, with build access and the appropriate production/preview contexts:

- `VITE_SUPABASE_URL`: your project's HTTPS Supabase URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: your project's browser-safe publishable key (`sb_publishable_…`).

Use the same names in an ignored `.env.local` for local development. No project values are committed. Vite embeds these public settings at build time; trigger a fresh Netlify deploy after changing them. Missing or invalid settings leave sign-in disabled and never mount dashboard pages. Secret keys and legacy service-role keys are not accepted. Never put Supabase secret/service-role keys in any `VITE_` variable.

Create users manually through Supabase Auth. This app only uses email/password sign-in. Session restoration is verified with Supabase Auth before dashboard content mounts; checking and failed requests fail closed. The SDK persists authentication tokens in browser storage and refreshes sessions. Passwords are cleared after sign-in attempts and are not saved by application code. Sign-out attempts to revoke sessions and clears the local session; failures display safe guidance.

Client-side route protection is not sufficient to secure backend data. Future database tables must use Row Level Security (RLS), and future server-side messaging functions must independently authorize every request. This change grants no dealership-level roles or data permissions.

## Review the prototype

1. Review the overview cards and choose a mock dealership. Changing dealership clears the vehicle selection; all dealerships deliberately use the same sample inventory.
2. Open **Vehicle stock**. Search by make/model, select individual vehicles or all six, and use **Preview selection**. **Refresh stock** displays a demo confirmation; it makes no network request.
3. Open **Client upload**. Use only invented sample `.xlsx` or `.xls` files. The interface checks the filename extension but never reads file contents or retains the filename. It does not parse, validate or upload spreadsheets. Selection feedback is held in memory and can be cleared.
4. Open **Campaign preview** to review selected vehicles and dealership. Sending is disabled.
5. Open **Campaign history** for static sample activity. No messages have been sent.
6. Resize to mobile width and use the navigation menu. Reloading resets all transient selections.

## Files

- `src/main.jsx`: dashboard state, mock fixtures, reusable components, views and navigation.
- `src/Auth.jsx`: authentication gate, session verification, loading, sign-in and sign-out.
- `src/supabase.js`: environment-based browser client with fail-closed configuration checks.
- `playwright.config.js` / `tests/auth.spec.js`: isolated browser tests with mocked Auth responses.
- `src/styles.css`: desktop dashboard, responsive layout, focus treatments and reduced-motion support.
- `public/vehicle.svg`: local representative vehicle illustration, used for all sample vehicles.
- `index.html`: Vite entry point and metadata.
- `package.json` / `package-lock.json`: scripts and locked dependencies.
- `netlify.toml`: build and SPA fallback configuration.

## Scope and data handling

All dealerships, inventory, prices and campaign history remain mock data. Only Supabase Auth is connected; no database tables, stock-feed API, PostX or message delivery are used. Authentication sessions use browser storage through the Supabase SDK. No real client data should be selected. No external image or font requests are needed.

Navigation is intentionally in-memory; reload returns to Overview. The Netlify fallback supports serving the app for arbitrary paths, but this prototype does not map URL paths to individual screens.

## Validation

```sh
npm ci
npm run build
# First-time browser setup on a development machine:
npx playwright install chromium
npm test
# Or use an existing Chromium installation:
CHROMIUM_PATH=/usr/bin/chromium npm test
```

The browser tests start isolated Vite servers with invented test settings and intercept Auth requests; they do not contact a real Supabase project or create real accounts. Tests cover login gating, successful login, verified restoration, loading state, bad credentials, invalid sessions, network failure, missing configuration, cross-tab sign-out, logout, and the mock stock/preview workflow. Netlify SPA rewrites remain configured in `netlify.toml`; nested paths also load the login gate.

`npm ci`, `npm run build`, and eight Chromium browser tests passed during implementation. Live project sign-in has not been tested because the required Supabase settings are not present in this environment. After configuring Netlify, verify a manually provisioned account can sign in, survive reload, and sign out; check unauthenticated deep links stay on login.

## Branch review

Changes are on `feat/supabase-auth`, based on the existing frontend foundation. Run `git diff feat/frontend-foundation...feat/supabase-auth` to review the authentication changes. Nothing is merged automatically.
