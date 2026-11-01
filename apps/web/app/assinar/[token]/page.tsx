import type { Metadata } from 'next';
import { SigningExperience } from '../../../features/documents/signing-experience';

export const metadata: Metadata = {
  title: 'Assinatura de documento · Lívio',
  robots: { index: false, follow: false },
};

export default async function SigningPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SigningExperience token={token} />;
}
