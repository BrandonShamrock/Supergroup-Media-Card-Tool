# Super Group Media Card Tool

A responsive React + Vite frontend prototype for a dealership marketing workspace. Uses JavaScript, CSS, Lucide icons and local SVG vehicle illustrations. Desktop is the primary layout, with a mobile navigation drawer and scrollable stock table.

## Setup

Use Node.js 22.12+ (or Node 20.19+) and npm. Development was validated with Node 24.22.1.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. The overview opens by default. Use the exit icon beside the demo user to open the visual login page, then **Explore demo workspace** to return. Login fields are disabled to prevent collection of real credentials; this is not authentication and provides no access protection.

```sh
npm run build
npm run preview
```

The production output is `dist/`. `netlify.toml` configures `npm run build`, publishes `dist`, and rewrites routes to `index.html`. Connect this repository and select the feature branch to deploy a review build on Netlify. No environment variables or API credentials are needed. Deployment has not been performed by this change.

## Review the prototype

1. Review the overview cards and choose a mock dealership. Changing dealership clears the vehicle selection; all dealerships deliberately use the same sample inventory.
2. Open **Vehicle stock**. Search by make/model, select individual vehicles or all six, and use **Preview selection**. **Refresh stock** displays a demo confirmation; it makes no network request.
3. Open **Client upload**. Use only invented sample `.xlsx` or `.xls` files. The interface checks the filename extension but never reads file contents or retains the filename. It does not parse, validate or upload spreadsheets. Selection feedback is held in memory and can be cleared.
4. Open **Campaign preview** to review selected vehicles and dealership. Sending is disabled.
5. Open **Campaign history** for static sample activity. No messages have been sent.
6. Resize to mobile width and use the navigation menu. Reloading resets all transient selections.

## Files

- `src/main.jsx`: application state, mock fixtures, reusable brand/button/heading components, page views and navigation.
- `src/styles.css`: desktop dashboard, responsive layout, focus treatments and reduced-motion support.
- `public/vehicle.svg`: local representative vehicle illustration, used for all sample vehicles.
- `index.html`: Vite entry point and metadata.
- `package.json` / `package-lock.json`: scripts and locked dependencies.
- `netlify.toml`: build and SPA fallback configuration.

## Scope and data handling

All dealerships, inventory, prices and campaign history are mock data. There is no Supabase, stock-feed API, PostX, authentication service or message delivery. No credentials, client data, cookies or browser storage are used. No real client data should be selected. No external image or font requests are needed.

Navigation is intentionally in-memory; reload returns to Overview. The Netlify fallback supports serving the app for arbitrary paths, but this prototype does not map URL paths to individual screens.

## Validation

- `npm run build`: passed with Vite production assets generated.
- Chromium browser smoke checks: overview rendering; six stock rows; selection and preview; disabled sending; sample file feedback; empty local/session storage; history; disabled login fields; refresh feedback; dealership selection reset; empty search results; 390px mobile navigation and no horizontal page overflow.
- No browser runtime errors observed. Desktop and mobile screenshots inspected during development.

There is no existing automated test suite in the initial repository. Backend integration, real spreadsheet parsing, authentication and message delivery are outside this prototype’s scope.

## Branch review

The implementation is on `feat/frontend-foundation`, separate from `main`. Inspect with:

```sh
git diff main --stat
git diff main
```

Run the commands above to review locally. Nothing has been merged into `main`.
