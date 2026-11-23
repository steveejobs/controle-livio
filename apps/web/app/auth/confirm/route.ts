import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { authenticationDestination } from '../../../lib/auth-redirect';

async function recordConfirmedAccess(accessToken: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return;
  try {
    await fetch(`${apiUrl}/auth/access`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      cache: 'no-store',
    });
  } catch {
    // Login must finish even during a temporary API outage.
  }
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const code = request.nextUrl.searchParams.get('code');
  const next = authenticationDestination(
    request.nextUrl.searchParams.get('next'),
    request.nextUrl.origin,
  );
  if (next) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : tokenHash && type
        ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
        : { data: { session: null }, error: new Error('Missing authentication code') };
    if (!error) {
      if (type !== 'recovery' && data.session?.access_token) {
        await recordConfirmedAccess(data.session.access_token);
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
  }
  return NextResponse.redirect(new URL('/?authError=invalid-link', request.url));
}
