import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', 'pdf-parse', 'mammoth', 'bcryptjs'],
  // Avoid a known spawnSync/EPERM issue in sandboxed build environments.
  experimental: { useTypeScriptCli: false },
  async redirects() {
    return [{ source: '/resume-upload', destination: '/candidates?mode=resume', permanent: false }];
  },
  env: {
    NEXT_PUBLIC_DEV_DEMO_MODE: process.env.NODE_ENV === 'development' && process.env.DEV_DEMO_MODE === 'true' ? 'true' : 'false',
    NEXT_PUBLIC_DEMO_MODE: process.env.NODE_ENV === 'production' && process.env.DEMO_MODE === 'true'
      && process.env.DEMO_DATA_ISOLATED === 'true' && !process.env.DATABASE_URL && !process.env.NETLIFY_DATABASE_URL ? 'true' : 'false',
  },
};

export default nextConfig;
