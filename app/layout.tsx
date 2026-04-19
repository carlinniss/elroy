import React from 'react'; // Ensure React is imported

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head />
      <body style={{ 
        margin: 0, 
        padding: 0, 
        overflow: 'hidden', 
        backgroundColor: 'transparent' 
      }}>
        {children}
      </body>
    </html>
  );
}