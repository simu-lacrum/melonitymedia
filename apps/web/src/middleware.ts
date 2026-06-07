import { NextResponse, type NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────
// Next.js Middleware — Route Protection
//
// Runs on the edge before every page render.
// Checks for melonity_token cookie and redirects accordingly.
// NOTE: We do NOT verify the JWT here (that's the API's job).
// We only check if the cookie EXISTS to avoid unnecessary redirects.
// ─────────────────────────────────────────────────────────────

const PUBLIC_PATHS = [
  '/',
  '/auth/sign-in',
  '/auth/sign-up',
  '/auth/forgot-password',
  '/auth/reset-password',
  // Legacy redirects handled by next.config.ts redirects
  '/auth/login',
  '/auth/register',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('melonity_token')?.value;

  // Allow API routes to pass through (handled by nginx → Express)
  if (pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Public paths are always accessible
  if (PUBLIC_PATHS.includes(pathname)) {
    // If authenticated and on auth pages → dashboard (but NOT from landing)
    if (token && pathname.startsWith('/auth/')) {
      return NextResponse.redirect(new URL('/account/dashboard', request.url));
    }
    return NextResponse.next();
  }

  // If not authenticated and accessing protected route → sign-in
  if (!token) {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match everything except static files, images, and Next.js internals
    '/((?!_next/static|_next/image|favicon\\.svg|favicon\\.ico|logo\\.svg|.*\\.png|.*\\.jpg|.*\\.svg).*)',
  ],
};
