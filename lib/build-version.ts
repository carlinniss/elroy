/** Git commit baked in at build time (Vercel) or "dev" locally. */
export function getBuildId(): string {
  return (
    process.env.NEXT_PUBLIC_BUILD_ID?.trim()
    || process.env.VERCEL_GIT_COMMIT_SHA?.trim()
    || 'dev'
  );
}

export function getBuildLabel(buildId = getBuildId()): string {
  if (buildId === 'dev') return 'dev';
  return buildId.slice(0, 7);
}
