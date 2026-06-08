import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** OBS browser sources handle path URLs reliably; rewrite /embed/SECRET → /?controlKey=SECRET */
export function middleware(request: NextRequest) {
  const match = request.nextUrl.pathname.match(/^\/embed\/([^/]+)\/?$/);
  if (!match?.[1]) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/';
  url.searchParams.set('controlKey', decodeURIComponent(match[1]));
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: '/embed/:path*',
};
