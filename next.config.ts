import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
