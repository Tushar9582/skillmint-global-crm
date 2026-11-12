import type { PoolConfig } from 'pg';

/**
 * Supply Supabase's public CA certificate to Node's TLS verifier in serverless
 * environments where the local machine's NODE_EXTRA_CA_CERTS path is unavailable.
 * Never disable TLS peer/hostname verification for CRM candidate data.
 *
 * Netlify: SUPABASE_CA_CERT_BASE64 = base64 of Supabase's downloaded prod-ca-2021.crt.
 */
export function postgresConnectionOptions(): Pick<PoolConfig, 'connectionString' | 'ssl'> {
  const connectionString = process.env.DATABASE_URL;
  const certificateBase64 = process.env.SUPABASE_CA_CERT_BASE64?.trim();

  if (!certificateBase64) return { connectionString };
  if (!connectionString) throw new Error('DATABASE_URL is required for a verified Supabase database connection');

  const pem = Buffer.from(certificateBase64, 'base64').toString('utf8').trim();
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(pem)) {
    throw new Error('SUPABASE_CA_CERT_BASE64 is not a valid PEM certificate');
  }

  let databaseUri: URL;
  try {
    databaseUri = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URI');
  }
  if (!['postgresql:', 'postgres:'].includes(databaseUri.protocol) || !databaseUri.hostname) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol and include a hostname');
  }

  // node-postgres parses sslmode/sslrootcert from the URI and can overwrite
  // an explicit ssl object. Remove those URI options only when supplying a
  // verified Node TLS configuration ourselves.
  for (const option of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    databaseUri.searchParams.delete(option);
  }

  return {
    connectionString: databaseUri.toString(),
    ssl: {
      ca: pem,
      rejectUnauthorized: true,
      servername: databaseUri.hostname,
    },
  };
}
