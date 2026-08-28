import type { ReactNode } from 'react';

export const metadata = {
  title: 'Kase',
  description: 'AI-powered QA audit platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
