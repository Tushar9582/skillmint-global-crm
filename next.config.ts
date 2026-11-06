import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', 'pdf-parse', 'mammoth', 'bcryptjs'],
  // Avoid a known spawnSync/EPERM issue in sandboxed build environments.
  experimental: { useTypeScriptCli: false },
  async redirects() {
    return [{ source: '/resume-upload', destination: '/candidates?mode=resume', permanent: false }];
  },
  env: {
    // Deliberately expose this only for local development. Production builds can
    // never enable the browser demo layer, even when the variable is set.
    NEXT_PUBLIC_DEV_DEMO_MODE: process.env.NODE_ENV === 'development' && process.env.DEV_DEMO_MODE === 'true' ? 'true' : 'false',
    NEXT_PUBLIC_DEMO_ADMIN_EMAIL: process.env.NODE_ENV === 'development' && process.env.DEV_DEMO_MODE === 'true' ? (process.env.DEMO_ADMIN_EMAIL || '') : '',
    NEXT_PUBLIC_DEMO_ADMIN_PASSWORD: process.env.NODE_ENV === 'development' && process.env.DEV_DEMO_MODE === 'true' ? (process.env.DEMO_ADMIN_PASSWORD || '') : '',
  },
};

export default nextConfig;
