import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { MotionController } from '../components/motion-controller';
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
        {children}
        <MotionController />
        <SpeedInsights />
      </body>
    </html>
  );
}
