'use client';

import { useParams } from 'next/navigation';
import { BongOverlay } from '@/app/bong-overlay';

/** OBS browser source — secret in URL path (same pattern as /control/slug). */
export default function EmbedOverlayPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params.slug === 'string' ? decodeURIComponent(params.slug) : '';
  return <BongOverlay initialControlSecret={slug} />;
}
