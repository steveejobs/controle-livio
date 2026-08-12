import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApiEnvironment } from '@livio/shared';

@Injectable()
export class SupabaseAdminService {
  private readonly client: SupabaseClient;
  private readonly redirectTo: string;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    const redirect = new URL(config.get('SUPABASE_AUTH_REDIRECT_URL', { infer: true }));
    if (!redirect.searchParams.has('next')) redirect.searchParams.set('next', '/reset-password');
    this.redirectTo = redirect.toString();
    this.client = createClient(
      config.get('SUPABASE_URL', { infer: true }),
      config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

  async invite(email: string, fullName: string) {
    const { data, error } = await this.client.auth.admin.inviteUserByEmail(email, {
      redirectTo: this.redirectTo,
      data: { full_name: fullName },
    });
    if (error || !data.user) {
      throw new ServiceUnavailableException('Não foi possível criar o convite no Supabase Auth');
    }
    return data.user;
  }

  async removeUser(userId: string): Promise<void> {
    await this.client.auth.admin.deleteUser(userId, true);
  }
}
