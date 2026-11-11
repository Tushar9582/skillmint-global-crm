# SkillMint Global Recruitment CRM — TypeScript Source

A full-stack recruitment CRM starter application for **SkillMint Global**. Built with Next.js App Router, strict TypeScript, PostgreSQL and private S3-compatible object storage. It supports the two interconnected recruitment pipelines: **company/employer leads** and **candidate leads**.

> **Important:** This is working source code, **not a hosted live CRM**. Provision a PostgreSQL database, set environment variables, migrate the schema, seed the initial Admin and then start the app. Run integration/security/acceptance tests with your actual cloud environment before production rollout. This implementation is a substantial CRM foundation, not a claim that every paid integration, OCR feature or pixel-perfect reference mockup is included.

## What is implemented

| Area | Feature |
| --- | --- |
| Authentication | Private email/password login, hashed passwords, 7-day configurable HttpOnly session, admin/employee roles, failed-login throttling, forced password change for new employees |
| Admin | Full organization visibility, employee registration, password resets, bulk assignment of selected leads/records, recruiter performance, audit events, reporting and work handover |
| Employee | Only assigned records, tasks, follow-ups, activity history and daily reports |
| Company leads | Manual lead entry, assign/reassign, source, contact info, stages, priority, next follow-up, convert qualified company lead to client |
| Clients and jobs | Client accounts, job requisitions, openings, skills, compensation, target dates, pipeline statuses |
| Candidates | Manual candidate entry, skills, contact identity, experience, location, expected CTC, candidate pipeline |
| Resume to lead | PDF/DOCX upload, file validation, antivirus hook, text extraction, contact/skill/experience parsing and **automatic candidate lead creation** with a screening follow-up |
| Duplicates | SHA-256 exact-file detection plus normalized email/mobile matching; suspected duplicates queue for **Admin review** (attach existing, create separate with justification, or discard) |
| Recruitment | Candidate-to-job applications, recruitment stages, interview scheduling, feedback, hiring and joining statuses |
| Follow-ups | Due/overdue lists, daily task workflow, logged call/email/meeting outcomes and optional next follow-up task |
| Employee exits | Transactional transfer of company leads, clients, jobs, candidates, applications, interviews, pending follow-ups and pending duplicate reviews; disable departing login and revoke sessions; retain historical attribution |
| Reports | Pipeline summaries, per-employee activity counts, daily reports, date filtering, CSV export, audit history |
| Imports | Admin CSV/XLSX import with 500-row limit, preview/dry run, duplicate skips and import log |
| Notifications | In-app assignment and reassignment messages; overdue tasks visible in dashboards |
| Storage | Private local development file store or **DigitalOcean Spaces / Amazon S3** production storage; authorized resume downloads via short-lived signed links |
| UI | Responsive navy-and-teal admin and employee workspace, forms, tables, filters, detail views, account profile and password change |

## Technology

- Next.js 16, React 19, TypeScript, CSS, Lucide icons
- Node.js 20.9+ (prefer Node.js 22 LTS or newer supported version)
- PostgreSQL 15+ (Docker example uses PostgreSQL 17)
- `pg` with parameterized SQL and explicitly checked organization + owner permissions
- `pdf-parse` and `mammoth` for text-based PDFs/DOCX; file SHA-256 for exact duplicates
- AWS SDK v3 for DigitalOcean Spaces / AWS S3 object storage
- Optional external `clamd` antivirus server (required for production resume uploads)

## Quick start (local development)

Prerequisites: Node.js, npm and a running PostgreSQL server. Docker is optional.

```bash
cd skillmint-crm-ts
npm install
cp .env.example .env
```

On Windows PowerShell, replace the copy command with:

```powershell
Copy-Item .env.example .env
```

1. Edit `.env`. **Set a unique 12+ character `ADMIN_PASSWORD`** and correct `ADMIN_EMAIL`.
2. Start the bundled PostgreSQL Docker container if you are using Docker:

   ```bash
   docker compose up -d postgres
   ```

   If using DigitalOcean Managed PostgreSQL or another database, set `DATABASE_URL` to its connection string instead. Enable TLS as required by your provider.

3. Create tables, then create the first Admin:

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000/login` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

`db:seed` is idempotent for the same organization/email and does **not** overwrite an existing Admin password. User accounts cannot self-register; Admin creates employees inside **Employee Management**.

### Starting the first lead

**Company lead (manual)**: Login → Company Leads → **New Company Lead** → enter employer name, contact, source and follow-up → choose owner → Save. After qualification, use **Convert to Client** and create a Job Requisition.

**Candidate lead (manual)**: Login → Candidates → **New Candidate** → fill candidate contact details, experience, skills and owner → Save. Email/phone identity conflicts return a duplicate warning.

**Candidate lead (resume)**: Login → **Resume Upload** → choose `.pdf` or `.docx` → choose recruiter if Admin → **Upload Resume & Create Candidate Lead**. The backend validates and scans the file, extracts readable text, detects duplicates and (if unique) creates the candidate, stores the resume privately and schedules the first screening follow-up. Correct missing fields in Candidate Management.

### How duplicates work

1. Exact same resume bytes? The upload stops with an **exact duplicate** warning; no second candidate is silently created.
2. Email or normalized phone already present? An **Admin Duplicate Review** is created, and the new resume waits for a decision.
3. Admin can attach it as a version of the existing candidate, create a separate candidate with an explanation, or discard the upload.
4. Scanned/image-only PDFs and uncommon layouts may extract little text. They are flagged **Needs Review** and require manual correction. OCR is **not** included.

## Main pages

| URL | Main purpose |
| --- | --- |
| `/login` | Admin / employee sign in |
| `/dashboard` | Role-aware KPI dashboard and work queue |
| `/company-leads` | Employer leads and pipeline |
| `/candidates` | Lead bank: manual candidate entry and saved resume upload |
| `/ai-resume-builder` | Resume editor, saved browser drafts, candidate import, live A4 preview and PDF printing |
| `/applications` | Candidate-job matching and recruitment stages |
| `/interviews` | Interview planning and outcomes |
| `/followups` | Follow-up center and completion logging |
| `/employees` | Admin recruiter registration, lead management, progress and 360° history |
| `/duplicate-reviews` | Admin duplicate candidate resume decisions |

Legacy routes for linked client/job setup, activity history and existing account workflows remain available for compatibility but are hidden from the streamlined sidebar. A new application links to job requirement setup, and that setup links to client account creation.

### AI Resume Builder configuration

The sidebar's **AI Resume Builder** works without an external key for manual creation, candidate-field import, factual offline starter summaries, multiple browser-local drafts, live preview, and browser **Print → Save as PDF**. Offline templates are clearly distinguished from real AI rewriting. These drafts are **not** yet synchronized to Supabase/PostgreSQL or attached automatically to the candidate's uploaded resume versions; they live in that user's current browser and may be lost when browser data is cleared.

For authenticated, database-backed CRM users, set the following **server-only** environment variables on the production deployment:

- `OPENAI_API_KEY=<your private API key>`
- `OPENAI_RESUME_MODEL=gpt-4o-mini` (or another model supporting Responses structured outputs)

The **Improve with AI** button sends the entered professional summary, work experience, skills, and optional job description to the configured provider, then shows a reviewable draft. It never auto-applies changes. Users must check facts before distributing a resume. Do not configure paid AI access on the public demo site: it intentionally disables authenticated database-backed POST routes, including this AI endpoint. Provision provider billing, privacy notices, and production gateway rate limiting before enabling live usage.

## Temporary Netlify Demo / Staging Login

Use a **separate Netlify site** and branch for this temporary demo. The weak temporary password is accepted only when the app is in production mode, `DEMO_MODE=true`, `DEMO_DATA_ISOLATED=true`, both `DATABASE_URL` and `NETLIFY_DATABASE_URL` are absent, and the server-only credentials and session secret are valid. If any condition fails, demo login is unavailable and database-backed APIs fail closed. Do not copy these settings to the production CRM site.

Set these variables in the staging site's Netlify environment (not in `NEXT_PUBLIC_*`):

- `DEMO_MODE=true`
- `DEMO_DATA_ISOLATED=true`
- `DEMO_ADMIN_EMAIL=skillmint@gmail.com`
- `DEMO_ADMIN_PASSWORD_HASH=<bcrypt hash of the temporary password>`
- `DEMO_SESSION_SECRET=<random secret of at least 32 characters>`
- Leave `DATABASE_URL` and `NETLIFY_DATABASE_URL` unset on this site.

Generate the password hash locally with `npm run demo:hash-password`; enter the temporary password at the hidden prompt and copy only the resulting bcrypt hash into Netlify. Generate a session secret with a secure random generator (at least 32 random bytes). Redeploy after setting or changing environment variables. Demo sessions are signed, HttpOnly, Secure, SameSite=Lax cookies and expire after eight hours. Login failures are rate-limited per IP and email/IP pair.

The demo site stores simulated records only in browser storage. Its `/api/v1/*` database APIs are disabled, and the standard database-backed login path is never used while `DEMO_MODE` is requested. Resume parsing remains available locally in memory. Logout clears the demo session. Disable the demo by removing `DEMO_MODE` and redeploying, then delete the temporary site and revoke its session secret/hash.

## Cloud deployment (DigitalOcean)

DigitalOcean is a supported choice for 10–30 employees. A typical production topology is:

```text
Employees / Admin  -->  HTTPS reverse proxy  -->  Next.js Node server
                                               |--> Managed PostgreSQL (private DB)
                                               |--> Private DigitalOcean Space (resumes)
                                               |--> clamd antivirus service
```

Suggested deployment steps:

1. Create a **Managed PostgreSQL** database and an application user with only the required DB permissions. Restrict DB access to trusted network sources. Configure `DATABASE_URL` for TLS.
2. Create a **private** DigitalOcean Space; avoid public-read ACLs. Set `STORAGE_DRIVER=spaces`, bucket, region, endpoint and separate access credentials in the hosting environment.
3. Deploy the Node.js app to an appropriately sized App Platform service or a Droplet behind HTTPS. Run `npm ci`, `npm run build`, `npm run start` with production environment settings. Ensure proxy/domain matches `APP_ORIGIN`, e.g. `https://crm.skillmintglobal.com`.
4. Run database migrations and seed the Admin as a controlled, one-time operational step. **Do not leave the initial seed password in shared build logs or Git.**
5. Configure and network-restrict a `clamd` antivirus service. Set `CLAMAV_HOST` and `CLAMAV_PORT`. **In production, resume uploads intentionally fail if the scanner is not available**.
6. Configure managed DB backups and restoration tests, private Space lifecycle/versioning as appropriate, uptime monitoring, alerts and regular security updates. **Backups are an infrastructure responsibility; this code does not automatically provision them.**

Sample DigitalOcean Spaces environment differences:

```dotenv
APP_ORIGIN=https://crm.example.com
STORAGE_DRIVER=spaces
STORAGE_BUCKET=your-private-space
STORAGE_REGION=blr1
STORAGE_ENDPOINT=https://blr1.digitaloceanspaces.com
STORAGE_ACCESS_KEY=<secret-from-provider>
STORAGE_SECRET_KEY=<secret-from-provider>
CLAMAV_HOST=clamav.internal
CLAMAV_PORT=3310
```

Do not put real credentials inside this README or commit a populated `.env`. Production uploads cannot use `STORAGE_DRIVER=local` because it is intentionally disabled.

### AWS alternative

Use `STORAGE_DRIVER=s3`, your private S3 bucket, the matching AWS region, and IAM permissions limited to the bucket's necessary object actions. The same PostgreSQL schema can run on Amazon RDS PostgreSQL. Do not grant public bucket access. Costs, backups and network configuration are external to this application.

## Privacy and operational caveats

- Candidate resumes contain personally identifiable information. Establish a privacy notice, consent/retention process, deletion workflow and access review before collecting real candidate data. A fully automated retention/deletion system is **not** built here.
- Cloud storage access is mediated by role checks and signed URLs that expire in two minutes. Keep bucket permissions private, use HTTPS and rotate credentials.
- Resume parsing is **rule-based**, not AI/OCR. It may miss or misinterpret fields. Review the candidate before submission to a client.
- The web app requires network access; offline writes/synchronization are **not** included. Email/SMS/WhatsApp reminders, Gmail synchronization, AI matching, MFA, attendance and payroll are **not** included.
- Employee exit transfers current ownership of records and pending tasks but preserves completed work history; this is deliberate for auditability.
- The API enforces organization and assignment checks, but before deployment still perform threat modeling, load tests, DB backup/restore drills, penetration testing, and real-provider integration testing.

## API overview

Routes require a logged-in cookie session unless noted. API data is JSON except upload/import endpoints.

- `POST /api/auth/login` — login (unauthenticated)
- `POST /api/auth/logout` — logout
- `GET/PATCH /api/auth/me` — current identity / change password
- `GET/POST /api/v1/company-leads`, `/candidates`, `/clients`, `/jobs`, `/applications`, `/interviews`, `/followups` — records and manual creation
- `GET/PATCH /api/v1/[resource]/[id]` — record detail and update
- `POST /api/v1/company-leads/[id]/convert` — convert company lead into client
- `POST /api/v1/resumes` — multipart file upload (automatic candidate lead)
- `GET /api/v1/resumes?candidate_id=...` — resume versions; `GET /api/v1/resumes/[id]/download` for controlled access
- `GET/PATCH /api/v1/duplicates` — Admin pending reviews / resolutions
- `POST /api/v1/activities` — log call/email/meeting and optionally schedule next follow-up
- `GET /api/v1/activities` — role-aware activity feed; optional related-record filter
- `POST /api/v1/assignments/bulk` — Admin bulk assign 1–200 selected company/candidate/ATS records with history; matching pending follow-ups transfer too
- `POST /api/v1/followups/[id]/complete` — mark task complete and log outcome
- `GET/POST /api/v1/employees`, `PATCH /api/v1/employees/[id]`, `GET /api/v1/employees/[id]/detail` — Admin employee controls
- `GET/POST /api/v1/handover` — preview and perform atomic employee exit transfer
- `GET /api/v1/dashboard`, `/reports`, `/notifications`, `/audit` — dashboard and visibility
- `GET/POST /api/v1/daily-report` — employee reports
- `POST /api/v1/imports` — Admin CSV/XLSX import and dry run
- `GET /api/v1/export?resource=candidates` — Admin CSV export

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Pure TypeScript/parser/catalog tests are included in `tests/`. Database-backed API integration tests **require a running PostgreSQL instance**, which is not automatically created by these tests. Test all core workflows with your chosen cloud provider before accepting the implementation.

## Source structure

```text
db/schema.sql                   PostgreSQL schema and indexes
scripts/migrate.ts              Schema initialization
scripts/seed-admin.ts           One-time Admin creation
src/app/                        Next.js pages and API routes
src/components/                 Dashboard, tables, forms, resume and staff UI
src/lib/auth.ts                  Role and session security
src/lib/records.ts               Scoped CRUD and duplicate logic
src/lib/resume.ts                PDF/DOCX parsing
src/lib/storage.ts               Local / DigitalOcean Spaces / S3 storage
src/lib/antivirus.ts             clamd antivirus integration
src/lib/catalog.ts               Form definitions and pipeline stages
tests/                           Unit-level checks
```

---

Developed as a configurable starter for SkillMint Global's CRM workflow. Deployment, operational security, server costs and third-party services are separate activities.
