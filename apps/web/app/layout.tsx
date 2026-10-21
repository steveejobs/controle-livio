import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import Script from 'next/script';
import { MotionController } from '../components/motion-controller';
import { PwaRuntime } from '../components/pwa-runtime';
import './globals.css';
import '../theme/index.css';

export const metadata: Metadata = {
  title: 'Controle Financeiro Lívio',
  description: 'Controle financeiro claro, seguro e integrado para sua operação.',
  applicationName: 'Controle Financeiro Lívio',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Lívio',
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#173f38',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <Script src="/pwa-install.js" strategy="beforeInteractive" />
        {children}
        <PwaRuntime />
        <MotionController />
        <SpeedInsights />
      </body>
    </html>
  );
}
