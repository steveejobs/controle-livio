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

  async invite(email: string, fullName: string, delivery: 'LINK' | 'EMAIL' = 'LINK') {
    if (delivery === 'LINK') {
      const { data, error } = await this.client.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo: this.redirectTo, data: { full_name: fullName } },
      });
      if (error || !data.user || !data.properties.hashed_token)
        throw new ServiceUnavailableException(
          'Não foi possível criar o link de convite. Confira o e-mail e se já existe um acesso.',
        );
      const url = new URL(this.redirectTo);
      url.searchParams.set('token_hash', data.properties.hashed_token);
      url.searchParams.set('type', 'invite');
      return { user: data.user, invitationUrl: url.toString() };
    }
    const { data, error } = await this.client.auth.admin.inviteUserByEmail(email, {
      redirectTo: this.redirectTo,
      data: { full_name: fullName },
    });
    if (error || !data.user) {
      throw new ServiceUnavailableException('Não foi possível criar o convite no Supabase Auth');
    }
    return { user: data.user };
  }

  async recoveryLink(email: string): Promise<string> {
    const { data, error } = await this.client.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: this.redirectTo },
    });
    if (error || !data.properties.hashed_token)
      throw new ServiceUnavailableException(
        'Não foi possível gerar o link de redefinição de senha',
      );
    const url = new URL(this.redirectTo);
    url.searchParams.set('token_hash', data.properties.hashed_token);
    url.searchParams.set('type', 'recovery');
    return url.toString();
  }

  async removeUser(userId: string): Promise<void> {
    await this.client.auth.admin.deleteUser(userId, true);
  }
}
