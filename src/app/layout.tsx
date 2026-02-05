import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { Header } from '@/components/header';

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'Century Cup League',
  description: 'Live stat tracking for the Century Cup fraternity league'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={manrope.className}>
        <Providers>
          <div className="min-h-screen bg-gradient-to-b from-parchment via-sand to-gold-50 text-ink">
            <Header />
            <main className="mx-auto max-w-6xl px-4 pb-12 pt-6">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
