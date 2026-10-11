# Cashfo API

The NestJS backend behind the Cashfo end-user app and its admin panel: one API, one database, one identity table.

## Stack

NestJS 12 (Express 5) · Prisma 7 on PostgreSQL · better-auth 1.7 with Better Auth Infra · class-validator · Vitest · oxlint. ESM throughout (`"type": "module"`, `.js` relative imports).

## Getting started

```bash
npm install
cp .env.example .env        # database URL, secrets -- every variable is explained there
npx prisma migrate deploy   # or `prisma migrate dev` while changing the schema
npm run seed                # admin and end-user test accounts, password ChangeMe123!
npm run start:dev           # http://localhost:5000
```

| Script | What it does |
|---|---|
| `npm run start:dev` | Watch mode |
| `npm run build` / `npm run start:prod` | Compile to `dist/` / run it |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | oxlint |
| `npm run seed` | Idempotent seed (`prisma/seed.ts`) |

## Authentication

### One identity, two sides

Everyone who signs in is a `User` row. `role` decides the side: `USER` is the end-user app; `SUPER_ADMIN`, `SUPPORT_ADMIN`, `FINANCE_ADMIN` and `CONTENT_ADMIN` are the admin team (`src/common/roles.ts`). Admin-side code reads admins with `ADMIN_USER_WHERE` and customer listings with `END_USER_WHERE`, so neither population leaks into the other's screens or counts.

### better-auth

`src/auth/better-auth.ts` configures the app's single better-auth instance:

- **Passwords** live on the user's `credential` `AuthAccount` row, bcrypt-hashed (`src/auth/password.ts`). `CredentialsService` is the only app code that checks or sets one.
- **Sessions** are `AuthSession` rows, one per signed-in device. A hook refuses to create one for any account that isn't `ACTIVE`.
- **Google** sign-in runs when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set. It creates an account only when the caller asks (`requestSignUp`), and links to an existing account only when that account's email is verified -- admin accounts are, as they're vouched for by the super admin who creates them.
- **Better Auth Infra** (`dash()`) is on when `BETTER_AUTH_API_KEY` is set. The dashboard reaches the API at `<BETTER_AUTH_URL>/api/auth/dash/*`, so it connects to a deployed instance only.

Only better-auth's public endpoints are served over HTTP -- Google sign-in and its callback, `get-session`, `sign-out`, `ok`/`error` and the dashboard (`src/auth/auth-routes.ts`). Everything else under `/api/auth` belongs to the app's own controllers.

### App tokens

The frontends keep using an access/refresh JWT pair; each token carries `sid`, the better-auth session it belongs to (`SessionTokensService`).

| | Admin | End user |
|---|---|---|
| Sign in | `POST /admin/auth/login` | `POST /api/auth/login`, `/register`, `/reset-password` |
| Google | `POST /admin/auth/session/exchange` | `POST /api/auth/session/exchange` |
| Refresh / logout | `POST /admin/auth/refresh`, `/logout` | `POST /api/auth/refresh`, `/logout` |
| Guard | `AdminAuthGuard` (+ `RolesGuard`) | `UserAuthGuard` |

Sign-in goes through better-auth (so its hooks and the dashboard see it), then the app records the login and issues the pair. The guards and `refresh` accept a token only while its session is alive, so logout, revoking a device, a suspension or a password reset cut access on the very next request. Admin and end-user tokens are signed with different secrets and never cross over.

The Google exchange is how a browser session becomes app tokens: Google returns to `<BETTER_AUTH_URL>/api/auth/callback/google`, better-auth sets its session cookie, and the frontend forwards that cookie to the matching exchange endpoint.

### Client address

`TRUST_PROXY` tells Express which proxies to believe (`src/common/trust-proxy.ts`); `req.ip` is then the real client for the login throttle, login history and audit log, and better-auth is handed the same address.

## Database

Migrations live in `prisma/migrations`; production applies them with `npx prisma migrate deploy`. The better-auth migrations, in order, fold `AdminUser` into `User`, lowercase account emails, add the better-auth tables, move password hashes onto credential accounts and sign out devices from before sessions existed. The first two stop instead of guessing if two accounts share an email (or differ only by case); after deploying, everyone signs in once more.

The development seed (`npm run seed`) adds demo admins and end users that share one known password. Production never runs it: `dist/scripts/bootstrap.js` creates one real super admin and the reference data (plans, default chart of accounts, translations, feature flags, notification templates) and nothing else.

## Deploying

`main` is the live site, `smartly.softech.agency`. Every pull request runs CI (`.github/workflows/ci.yml`); a merge to `main` publishes `ghcr.io/arifur999/cashfo_backend`, and the VPS pulls it within two minutes, rolling back if the release doesn't come up healthy. Setup, operations and rollback: [deploy/README.md](deploy/README.md).
