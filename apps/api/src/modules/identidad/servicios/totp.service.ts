import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';

import { CifradoService } from '../../../comun/cifrado/cifrado.service';
import { contextoTotp, ErrorCifrado } from '../../../comun/cifrado/sobre';
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
  private readonly logger = new Logger(TotpService.name);

  constructor(
    private readonly config: ConfigService<Configuracion, true>,
    private readonly cifrado: CifradoService,
  ) {
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

  /**
   * El secreto como se guarda en `usuarios.totp_secreto` (RNF-01).
   *
   * Cifrado y atado a la cuenta. Quien lea la tabla no puede generar codigos,
   * y quien pueda escribirla no puede copiar el secreto de su propia cuenta
   * sobre la de un administrador: el sobre solo abre en la fila de origen.
   */
  sellarSecreto(usuarioId: string, secreto: string): string {
    return this.cifrado.sellarTexto(secreto, contextoTotp(usuarioId));
  }

  /**
   * Verifica un codigo contra el secreto tal como esta guardado.
   *
   * Devuelve `null`, distinto de `false`, si el secreto guardado no abre: no
   * es que el codigo este mal, es que la cuenta no tiene un segundo factor
   * utilizable, y quien la atiende necesita saber cual de las dos cosas paso.
   */
  verificarGuardado(codigo: string, guardado: string, usuarioId: string): boolean | null {
    let secreto: string;
    try {
      secreto = this.cifrado.abrirTexto(guardado, contextoTotp(usuarioId));
    } catch (error) {
      if (!(error instanceof ErrorCifrado)) throw error;
      this.logger.error(`El secreto TOTP de ${usuarioId} no abre (${error.motivo}).`);
      return null;
    }
    return this.verificar(codigo, secreto);
  }
}
