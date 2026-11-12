# Supabase database setup for SkillMint CRM

The CRM **already uses PostgreSQL via Node's `pg` library** and its own
`users`/`sessions` authentication tables. No Supabase JavaScript client or
Supabase Auth migration is needed to connect its existing backend.
**This is a setup guide, not evidence that a deployment is connected.**

## Before changing anything

- Use an isolated test/staging deployment first. The public Netlify demo currently uses browser-local simulated data; it is **not** a shared database.
- Take a backup before running SQL on any existing database. Check existing tables first.
- Never commit a populated `.env`, database password, connection URL or Supabase secret/service-role key.
- This setup changes the PostgreSQL database only. **Resume file storage remains a separate requirement:** current drivers are local development, DigitalOcean Spaces and AWS S3. Supabase Storage is not implemented in the current app.
- The existing app uses its own role-checked Next.js server APIs. Connecting Postgres does **not** automatically enable Supabase Auth or RLS; review API authorization and database privileges before collecting real candidate data.

## 1. Get connection URLs

1. Open your Supabase project → **Connect**.
2. Copy **Session pooler** (port `5432`) for the one-time migration/seed run if direct IPv6 connections are unavailable.
3. Copy **Transaction pooler** (port `6543`) for serverless Netlify runtime.
4. Use exactly the host and username Supabase displays. Pooler usernames usually include the project reference, e.g. `postgres.PROJECT_REF`.
5. Replace the password placeholder with your database password. URL-encode special characters in a password. Add `sslmode=require` according to Supabase's secure connection guidance.

**Do not post either full connection URL in chat or a repository.**

Official guide: https://supabase.com/docs/guides/database/connecting-to-postgres

## 2. Set up your local migration environment

In the repository's root, copy `.env.example` to `.env` and fill it privately:

```dotenv
# Session pooler or direct connection copied from Supabase Connect:
DATABASE_URL=postgresql://USER:REDACTED@POOLER_HOST:5432/postgres?sslmode=require
APP_ORIGIN=http://localhost:3000
DEMO_MODE=false
DEMO_DATA_ISOLATED=false
DEMO_PUBLIC_PREVIEW=false
ORG_NAME=SkillMint Global
ADMIN_NAME=SkillMint Admin
ADMIN_EMAIL=admin@skillmintglobal.com
ADMIN_PASSWORD=SET_YOUR_OWN_UNIQUE_12_PLUS_CHAR_PASSWORD
```

On PowerShell:

```powershell
Copy-Item .env.example .env
npm ci
npm run db:check
```

`db:check` confirms database connectivity and which main tables exist.
Use Supabase SQL Editor to inspect `public` tables before first migration:

```sql
SELECT tablename FROM pg_catalog.pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

**On a newly created, empty CRM database only**, run:

```powershell
npm run db:migrate
npm run db:check
npm run db:seed
```

The migration command runs `db/schema.sql` plus the SQL files in
`db/migrations/`. Review all SQL in advance. It is not a schema-diff tool and
does not track which migration versions have already been applied. Do not run
it blindly on an existing production database.

`db:seed` creates the initial Admin if the organization/email is new;
it does not reset an existing Admin password. Keep `ADMIN_PASSWORD` private.

## 3. Configure a **separate production deployment** on Netlify

In **Site configuration → Environment variables**, set the following as
server-side site variables for the intended production deployment:

| Key | Value |
| --- | --- |
| `DATABASE_URL` | Transaction pooler connection URL copied from Supabase Connect (port 6543) |
| `APP_ORIGIN` | Exact HTTPS site origin, e.g. `https://crm.example.com` |
| `DEMO_MODE` | `false` |
| `DEMO_DATA_ISOLATED` | `false` |
| `DEMO_PUBLIC_PREVIEW` | `false` |
| `STORAGE_DRIVER` | `spaces` or `s3` with corresponding private-bucket settings, before live resume uploads |
| `CLAMAV_HOST` | Reachable, privately configured antivirus scanner before live resume uploads |

Remove any unwanted `NETLIFY_DATABASE_URL` to avoid ambiguity. Don't set
passwords or database URLs under `NEXT_PUBLIC_*`.

**Do not turn the existing public no-login demo into a production database site**:
that demo currently bypasses login by design. Use a new site / protected
staging environment first and test real Admin/employee login, organization
scope, resume privacy and logout, then choose a production URL.

The current `next.config.ts` enables browser-only demo mode only when all
required demo flags are true **and** no database URL is configured. With
`DEMO_MODE=true`, database-backed APIs deliberately fail closed even if
`DATABASE_URL` is present. Disable demo mode explicitly before testing live
database requests.

## 4. Check production behavior

- Log in with the **seeded Admin** and a strong unique password.
- Create a test company lead and candidate; refresh on another browser/session.
- Confirm records appear in Supabase **Table Editor** and are correctly scoped.
- Create an employee; verify they see only assigned records through the API,
  including by changing record IDs directly.
- Test assigned leads, follow-ups, candidate stages and employee handover.
- Test backup/restore and private resume upload/download only once S3/Spaces
  storage and antivirus are configured.
- Existing browser-local demo records are **not imported** into Supabase automatically.

## Troubleshooting

- **`403 Invalid origin`**: match `APP_ORIGIN` to the public HTTPS origin.
- **`503 Isolated demo...`**: demo flags are still enabled or conflicted.
- **`500 Unable to sign in`**: check server logs, connectivity and schema.
- **Connection timeout**: use Supabase's correct pooler endpoint and port.
- **No tables**: review and run the migration on a new database.
- **No admin user**: run the one-time seed with strong credentials.
- **Resume upload fails**: Postgres does not store the file itself; configure
  a private object-store driver and the required antivirus service.

## Operations

Supabase Free does **not** include automatic daily database backups. Use
regular manual, off-site exports or upgrade to a plan with scheduled backups:
https://supabase.com/docs/guides/platform/backups

Plan a review of app-level authorization, database role privileges and RLS
before exposing this multi-user recruitment system to real candidate data.
