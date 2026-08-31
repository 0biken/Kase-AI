import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import './globals.css';

export const metadata = {
  title: 'Kase | Evidence-led release assurance',
  description: 'A QA audit platform that connects runtime evidence to validated release decisions.',
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#080b0d',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <div id="main-content">{children}</div>
      </body>
    </html>
  );
}
