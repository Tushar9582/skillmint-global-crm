import { Pool } from 'pg';

const requiredTables = [
  'organizations', 'users', 'sessions', 'company_leads', 'clients',
  'jobs', 'candidates', 'resume_versions', 'applications', 'interviews',
  'followups', 'activities', 'assignment_history', 'duplicate_reviews',
] as const;

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is missing. Set it privately in your .env file.');
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 12000,
    idleTimeoutMillis: 1000,
  });

  try {
    const status = await pool.query<{ database: string; role: string }>(
      'SELECT current_database() AS database, current_user AS role',
    );
    console.log(`Connected to PostgreSQL database "${status.rows[0]?.database}" as role "${status.rows[0]?.role}".`);

    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_catalog.pg_tables
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [requiredTables],
    );
    const existing = new Set(tables.rows.map(row => row.tablename));
    const missing = requiredTables.filter(name => !existing.has(name));
    if (missing.length) {
      console.log(`CRM schema is not fully installed. Missing ${missing.length} tables: ${missing.join(', ')}`);
      console.log('On a NEW / EMPTY project, review the schema then run: npm run db:migrate');
    } else {
      console.log(`CRM schema check passed (${requiredTables.length} required core tables present).`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error('Database connection check failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
