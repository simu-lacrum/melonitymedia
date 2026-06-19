import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output for Docker deployment
  output: 'standalone',
  poweredByHeader: false,
  images: {
    remotePatterns: [],
    maximumRedirects: 0,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
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
