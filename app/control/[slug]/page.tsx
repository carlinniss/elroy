'use client';

import { useParams } from 'next/navigation';
import { ControlPanel } from '../ControlPanel';

export default function ControlSlugPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params.slug === 'string' ? decodeURIComponent(params.slug) : '';
  return <ControlPanel initialSecret={slug} />;
}
