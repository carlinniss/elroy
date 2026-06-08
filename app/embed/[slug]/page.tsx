import { BongOverlay } from '@/app/bong-overlay';

type Props = {
  params: Promise<{ slug: string }>;
};

/** OBS overlay — secret in path (same as /control/slug). Server passes slug on first paint. */
export default async function EmbedOverlayPage({ params }: Props) {
  const { slug } = await params;
  const secret = decodeURIComponent(slug).trim();
  return <BongOverlay initialControlSecret={secret} />;
}
