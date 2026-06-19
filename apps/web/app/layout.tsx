import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { DataSourceProvider } from '@/lib/data-source-context';
import { LangProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'evidata — Ask Data',
  description: 'Trusted, evidence-backed answers over controlled Data Sources.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full overflow-hidden overscroll-none" suppressHydrationWarning>
      <body className="h-full overflow-hidden overscroll-none">
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <LangProvider>
            <DataSourceProvider>{children}</DataSourceProvider>
          </LangProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
