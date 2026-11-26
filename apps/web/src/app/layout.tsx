import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
// tokens.css is the single source for brand values; globals.css consumes it.
import '../styles/tokens.css';
import './globals.css';

// Brand type pairing (see /brand): Inter for product and marketing copy,
// JetBrains Mono reserved for evidence, identifiers, and commands.
const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata = {
  title: 'Kase | Know what ships. Prove why.',
  description: 'Evidence-led release assurance. Kase connects observed failures to source evidence, so every release decision is defensible.',
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#080b0d',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <div id="main-content">{children}</div>
      </body>
    </html>
  );
}
