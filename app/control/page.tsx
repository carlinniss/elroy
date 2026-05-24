'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ControlPanel } from './ControlPanel';

function ControlPageInner() {
  const searchParams = useSearchParams();
  const initialSecret = searchParams.get('key')?.trim() || undefined;
  return <ControlPanel initialSecret={initialSecret} />;
}

export default function ControlPage() {
  return (
    <Suspense fallback={null}>
      <ControlPageInner />
    </Suspense>
  );
}
