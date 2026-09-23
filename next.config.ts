import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (Vercel deploys work the same with it on).
  output: 'standalone',
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || process.env.ELROY_BUILD_ID || 'dev',
  },
  outputFileTracingIncludes: {
    '/api/sfx/[id]': ['./public/sounds/elroy/**/*'],
  },
  async headers() {
    return [
      {
        source: '/sounds/elroy/:path*',
        headers: [{ key: 'Content-Disposition', value: 'inline' }],
      },
    ];
  },
};

export default nextConfig;
