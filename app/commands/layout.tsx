import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Elroy — Chat Commands',
  description: 'Full list of Elroy Twitch bot commands — games, trivia, chips, and mod tools.',
};

export default function CommandsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {children}
    </div>
  );
}
