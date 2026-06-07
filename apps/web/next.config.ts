import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output for Docker deployment
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async redirects() {
    return [
      { source: '/auth/login', destination: '/auth/sign-in', permanent: true },
      { source: '/auth/register', destination: '/auth/sign-up', permanent: true },
    ];
  },
};

export default nextConfig;
