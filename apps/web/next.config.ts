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
      { source: '/account/profiles', destination: '/account/accounts', permanent: true },
      { source: '/admin/runtime', destination: '/account/admin', permanent: true },
      { source: '/admin/users', destination: '/account/admin', permanent: true },
    ];
  },
};

export default nextConfig;
