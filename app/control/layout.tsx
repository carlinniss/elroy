import React from 'react';

export default function ControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #0f0a1a 0%, #1a1030 45%, #120820 100%)',
      color: '#f5f0ff',
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    }}
    >
      {children}
    </div>
  );
}
