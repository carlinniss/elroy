import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
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
