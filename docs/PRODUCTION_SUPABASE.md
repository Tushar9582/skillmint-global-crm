# SkillMint CRM — Production Supabase Setup

**Actual Supabase database:** `nozhoxwloatjibejxker` (`ap-northeast-1`).
Use an encrypted PostgreSQL **transaction-pooler URI** (port `6543`) copied in full
from Supabase → Connect → Direct → Transaction pooler. Do not replace only its port:
the pooler hostname and username differ from the direct URL.

## Work completed in the Supabase project
- CRM PostgreSQL tables and CRM configuration migrations applied.
- Public CRM tables have RLS enabled and no grants for `anon`/`authenticated`;
  the Next.js server uses the PostgreSQL connection through privileged SQL.
- Private Supabase Storage bucket `skillmint-resumes` created (PDF/DOCX, 10 MB).
- Authenticated resume-builder drafts table `resume_builder_drafts` created.
- The existing app's users/passwords/sessions are stored in PostgreSQL. This
  implementation does **not** use Supabase Auth. Do not enable a parallel Supabase
  Auth login without an intentional migration.

## Netlify steps required (not automatically performed)
1. In Netlify **Environment variables**, set the values from
   `.env.production.example`. These are examples, **not** usable secrets.
2. Set `DATABASE_URL` to the full Supabase transaction-pooler URI, with its
   real percent-encoded password and `sslmode=require`. Keep it encrypted.
3. Set all `DEMO_*` flags to `false` (or remove them), then redeploy. The
   app's demo mode deliberately ignores database-backed APIs.
4. Set `APP_ORIGIN` to the **exact** HTTPS site origin, including any custom domain.
5. In Supabase **Storage → S3 Configuration**, generate a server-only S3 access
   key pair and copy the exact S3 endpoint/region from that page. Put them in
   `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` and set
   `STORAGE_DRIVER=supabase`. **Do not use the publishable key as S3 credentials.**
6. Configure a reachable `clamd` service and set `CLAMAV_HOST`/`CLAMAV_PORT`.
   Production uploads fail closed without it; never disable scanning to hide errors.
7. **Seed a strong Admin password before turning on live traffic.** Local CLI
   has `npm run db:seed`, reading a private local `.env`. Set
   `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` (12+ chars),
   `ORG_NAME=SkillMint Global`. Never share the password in a chat or Git.
   The seed command is idempotent and does not overwrite existing users.
   You can use the Supabase **Session pooler** for this local seed operation.
8. Test Admin login, employee permissions, lead and candidate persistence,
   interviews, assignments, follow-ups and resume upload/download on two browsers.
   Confirm real rows in Supabase after refreshing and that unauthorized employees
   cannot access other users' data.
9. Confirm the 3-day trial / SaaS subscription billing and JD matching
   separately. These features are **not made production-ready** merely by
   connecting PostgreSQL; verify implementation and payments independently.
10. Configure backups, error monitoring, audit retention, spam/rate limits,
    malware scanning, secure cookies, DNS/HTTPS, and real recovery tests.

## Important
- **Never enable real Supabase data while the public no-login demo bypass is on.**
  Turn off all demo flags and create a real Admin first.
- Existing browser-local demo data **is not automatically copied** into Supabase.
- `NEXT_PUBLIC_*` is not appropriate for database passwords or S3 secrets.
- `DATABASE_URL` alone stores rows in Postgres, not resume file contents. Resume
  files require the private Supabase S3-compatible bucket, access keys and scanner.
- Production AI resume drafts now use the `/api/v1/resume-drafts` API; demo drafts
  intentionally remain browser-local. Cloud drafts are private to their owner.
- **Netlify credentials / deploy control are not available in this integration**.
  Code/schema changes cannot truthfully be called a verified live deployment.
