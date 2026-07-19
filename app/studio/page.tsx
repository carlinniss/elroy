'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { StudioListener } from './StudioListener';

function StudioPageInner() {
  const searchParams = useSearchParams();
  const initialSecret = searchParams.get('key')?.trim() || undefined;
  return <StudioListener initialSecret={initialSecret} />;
}

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioPageInner />
    </Suspense>
  );
}
