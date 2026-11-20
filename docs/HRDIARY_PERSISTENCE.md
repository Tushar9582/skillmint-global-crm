# HrDiary production persistence checks

Production uses the configured PostgreSQL database for all real company records. Sign-out revokes sessions only. Never point a real workspace at demo browser storage.

Admin diagnostic (authenticated): /api/v1/persistence-status. It verifies tenant-scoped database reads and a read-only object-storage request; antivirus configuration is reported, not connectivity. It does not expose credentials.

Netlify: keep existing DATABASE_URL and CA certificate, APP_ORIGIN, DEMO_MODE=false and all public demo flags false. For uploaded resumes use STORAGE_DRIVER=supabase, STORAGE_BUCKET=skillmint-resumes, STORAGE_REGION=ap-northeast-1, STORAGE_ENDPOINT=https://nozhoxwloatjibejxker.storage.supabase.co/storage/v1/s3, private S3 access/secret keys, and reachable private CLAMAV_HOST / CLAMAV_PORT. Do not commit secrets or disable malware scanning.

Netlify buffered binary uploads are limited to approximately 4.5 MB. This deployment limits resume uploads to 4 MiB including a margin for multipart metadata. Larger file support needs a separate secure upload pipeline.

Acceptance: create a candidate and company lead with synthetic details, confirm save, reload, sign out, sign in as the same admin in a fresh browser, confirm the same IDs in both browsers and Supabase. Check another company cannot read them. Check employee assignment, follow-up, resume upload and download. Archive only the test records. Verify deployed commit and runtime logs.

Backup: schedule encrypted off-site database exports and separately back up private resume objects. Verify restore in an isolated environment. Free-tier automatic downloadable backups are not assumed. Production deployment requires a tested recovery plan and SMTP/OAuth configuration for public onboarding.
