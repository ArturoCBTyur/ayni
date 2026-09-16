import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';

import type { Configuracion } from '../../../config/configuracion';

/**
 * Segundo factor por TOTP (RFC 6238).
 *
 * RNF-02 lo exige para ONG, auditor y administrador: son los roles que mueven
 * dinero, aprueban gastos o cambian umbrales. Al donante no se le impone,
 * porque friccion innecesaria en el registro reduce la participacion, que es
 * justo lo que el proyecto busca aumentar.
 */
@Injectable()
export class TotpService {
  constructor(private readonly config: ConfigService<Configuracion, true>) {
    // Se acepta un paso de desfase (30 s antes y despues) para tolerar
    // relojes ligeramente desajustados sin ampliar la ventana de ataque.
    authenticator.options = { window: 1 };
  }

  /** Roles a los que la plataforma exige segundo factor. */
  static readonly ROLES_CON_MFA = ['ONG_ADMIN', 'ONG_OPERADOR', 'AUDITOR', 'ADMIN'] as const;

  static exigeMfa(roles: readonly string[]): boolean {
    return roles.some((r) => (TotpService.ROLES_CON_MFA as readonly string[]).includes(r));
  }

  generarSecreto(): string {
    return authenticator.generateSecret();
  }

  /** URI otpauth:// para la app de autenticacion. */
  construirUri(correo: string, secreto: string): string {
    return authenticator.keyuri(
      correo,
      this.config.get('TOTP_EMISOR', { infer: true }),
      secreto,
    );
  }

  /** QR en data URL, para mostrarlo en el enrolamiento. */
  async generarQr(correo: string, secreto: string): Promise<string> {
    return toDataURL(this.construirUri(correo, secreto), { width: 240, margin: 1 });
  }

  verificar(codigo: string, secreto: string): boolean {
    try {
      return authenticator.verify({ token: codigo, secret: secreto });
    } catch {
      return false;
    }
  }
}
