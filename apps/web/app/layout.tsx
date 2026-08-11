import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { MotionController } from '../components/motion-controller';
import './globals.css';
import '../theme/index.css';

export const metadata: Metadata = {
  title: 'Controle Financeiro Lívio',
  description: 'Controle financeiro claro, seguro e integrado para sua operação.',
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
      </body>
    </html>
  );
}
