import { NextResponse, type NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────
// Next.js Middleware — Route Protection
//
// Runs on the edge before every page render.
// Checks for melonity_token cookie and redirects accordingly.
// NOTE: We do NOT verify the JWT here (that's the API's job).
// We only check if the cookie EXISTS to avoid unnecessary redirects.
// ─────────────────────────────────────────────────────────────

const PUBLIC_PATHS = ['/auth/login', '/auth/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('melonity_token')?.value;

  // Allow API routes to pass through (handled by Express via rewrite)
  if (pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // If not authenticated and accessing protected route → login
  if (!token && !PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  // If authenticated and accessing auth pages → dashboard
  if (token && PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL('/account/dashboard', request.url));
  }

  // Root redirect
  if (pathname === '/') {
    return NextResponse.redirect(
      new URL(token ? '/account/dashboard' : '/auth/login', request.url),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match everything except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
