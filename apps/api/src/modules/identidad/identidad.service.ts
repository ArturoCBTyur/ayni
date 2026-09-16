import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { PrismaService } from '../../comun/prisma/prisma.service';
import type { ConfirmarTotp, Login, Registro } from './esquemas';
import { HashService } from './servicios/hash.service';
import { TokensService, type CargaAcceso, type ParSesion } from './servicios/tokens.service';
import { TotpService } from './servicios/totp.service';

export interface ResultadoLogin extends ParSesion {
  /**
   * El rol exige segundo factor y la cuenta aun no lo configuro. El cliente
   * debe llevar al usuario al enrolamiento: el token entregado no abre
   * ninguna otra ruta.
   */
  mfaPendiente: boolean;
  usuario: { id: string; correo: string; nombres: string; apellidos: string; roles: string[] };
}

@Injectable()
export class IdentidadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly tokens: TokensService,
    private readonly totp: TotpService,
  ) {}

  /**
   * Registro de donante con consentimiento explicito (CU01, RF-DE-01).
   *
   * El consentimiento se guarda en la misma transaccion que la cuenta: no
   * debe poder existir un usuario sin su registro de consentimiento, porque
   * eso es precisamente lo que la Ley 29733 exige poder demostrar.
   */
  async registrar(datos: Registro, contexto: { ip?: string; userAgent?: string }) {
    const yaExiste = await this.prisma.usuario.findUnique({
      where: { correo: datos.correo },
      select: { id: true },
    });
    if (yaExiste) {
      throw new ConflictException(
        'Ya existe una cuenta con ese correo. Puede iniciar sesion o recuperar su contraseña.',
      );
    }

    const hashPassword = await this.hash.generar(datos.clave);
    const rolDonante = await this.prisma.rol.findUniqueOrThrow({ where: { codigo: 'DONANTE' } });

    return this.prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: {
          correo: datos.correo,
          hashPassword,
          nombres: datos.nombres,
          apellidos: datos.apellidos,
          telefono: datos.telefono,
          // En el MVP la cuenta queda activa; la verificacion por correo se
          // conecta cuando el envio de correo este operativo (Fase 8).
          estado: 'ACTIVO',
          roles: { create: { rolId: rolDonante.id } },
          donante: { create: { anonimoPorDefecto: false } },
        },
      });

      const finalidades = [
        ['TRATAMIENTO_DATOS', datos.consentimientos.tratamientoDatos],
        ['COMUNICACIONES', datos.consentimientos.comunicaciones],
        ['USO_IMAGEN', datos.consentimientos.usoImagen],
      ] as const;

      await tx.consentimiento.createMany({
        data: finalidades.map(([finalidad, otorgado]) => ({
          usuarioId: usuario.id,
          finalidad,
          otorgado,
          versionPolitica: datos.versionPolitica,
          ip: contexto.ip,
          userAgent: contexto.userAgent,
        })),
      });

      await tx.bitacoraAuditoria.create({
        data: {
          usuarioId: usuario.id,
          accion: 'REGISTRO_USUARIO',
          entidad: 'usuarios',
          entidadId: usuario.id,
          valorNuevo: {
            correo: usuario.correo,
            consentimientos: Object.fromEntries(finalidades),
          },
          ip: contexto.ip,
          userAgent: contexto.userAgent,
        },
      });

      return { id: usuario.id, correo: usuario.correo, nombres: usuario.nombres };
    });
  }

  /**
   * Inicio de sesion.
   *
   * Credencial incorrecta y cuenta inexistente devuelven el mismo mensaje,
   * para no confirmar que direcciones estan registradas. Y se verifica la
   * contraseña incluso cuando el usuario no existe, contra un hash ficticio,
   * para que el tiempo de respuesta no delate la diferencia.
   */
  async iniciarSesion(datos: Login, contexto: { ip?: string; userAgent?: string }) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { correo: datos.correo },
      include: {
        roles: { include: { rol: true } },
        membresias: { where: { activo: true } },
      },
    });

    const hashComparacion =
      usuario?.hashPassword ?? (await this.hash.generar('contrasena-inexistente'));
    const claveValida = await this.hash.verificar(hashComparacion, datos.clave);

    if (!usuario || !claveValida) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    if (usuario.estado === 'BLOQUEADO') {
      throw new UnauthorizedException(
        'Su cuenta esta bloqueada. Escriba a soporte para recuperarla.',
      );
    }

    const roles = usuario.roles.map((r) => r.rol.codigo);

    // RNF-02: MFA obligatorio para los roles que mueven dinero o aprueban.
    const exigeMfa = TotpService.exigeMfa(roles);
    const mfaPendiente = exigeMfa && !usuario.totpHabilitado;

    if (exigeMfa && !mfaPendiente) {
      if (!usuario.totpSecreto) {
        throw new UnauthorizedException(
          'Su configuracion de verificacion en dos pasos esta incompleta. Contacte a soporte.',
        );
      }
      if (!datos.codigoTotp) {
        throw new UnauthorizedException('Ingrese el codigo de su app de verificacion.');
      }
      if (!this.totp.verificar(datos.codigoTotp, usuario.totpSecreto)) {
        throw new UnauthorizedException(
          'El codigo de verificacion no es valido o ya expiro. Intente con el codigo actual.',
        );
      }
    }

    const carga: CargaAcceso = {
      sub: usuario.id,
      correo: usuario.correo,
      roles,
      ongs: usuario.membresias.map((m) => ({ ongId: m.ongId, cargo: m.cargo })),
      ...(mfaPendiente ? { mfaPendiente: true } : {}),
    };

    const sesion = await this.tokens.emitir(carga, contexto);

    // Un enrolamiento a medias no cuenta como acceso efectivo.
    if (!mfaPendiente) {
      await this.prisma.usuario.update({
        where: { id: usuario.id },
        data: { ultimoAccesoEn: new Date() },
      });
    }

    return {
      ...sesion,
      mfaPendiente,
      usuario: {
        id: usuario.id,
        correo: usuario.correo,
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        roles,
      },
    } satisfies ResultadoLogin;
  }

  /** Genera el secreto y el QR de enrolamiento. Aun no activa el MFA. */
  async iniciarEnrolamientoTotp(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });

    if (usuario.totpHabilitado) {
      throw new ConflictException('La verificacion en dos pasos ya esta activa en su cuenta.');
    }

    const secreto = this.totp.generarSecreto();
    await this.prisma.usuario.update({
      where: { id: usuarioId },
      data: { totpSecreto: secreto },
    });

    return {
      qr: await this.totp.generarQr(usuario.correo, secreto),
      // Para quien no pueda escanear el QR.
      secreto,
      instrucciones:
        'Escanee el codigo con Google Authenticator, Authy o similar, y luego ingrese el ' +
        'codigo de 6 digitos para confirmar.',
    };
  }

  /**
   * Confirma el enrolamiento.
   *
   * El MFA se activa solo despues de que el usuario demuestre que puede
   * generar un codigo valido. Activarlo antes lo dejaria fuera de su propia
   * cuenta si el QR nunca se escaneo bien.
   */
  async confirmarEnrolamientoTotp(usuarioId: string, datos: ConfirmarTotp) {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });

    if (!usuario.totpSecreto) {
      throw new BadRequestException(
        'Primero debe iniciar la configuracion de verificacion en dos pasos.',
      );
    }
    if (!this.totp.verificar(datos.codigoTotp, usuario.totpSecreto)) {
      throw new BadRequestException(
        'El codigo no coincide. Verifique la hora de su dispositivo e intente con el codigo actual.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.usuario.update({
        where: { id: usuarioId },
        data: { totpHabilitado: true },
      }),
      this.prisma.bitacoraAuditoria.create({
        data: {
          usuarioId,
          accion: 'MFA_ACTIVADO',
          entidad: 'usuarios',
          entidadId: usuarioId,
          valorAnterior: { totpHabilitado: false },
          valorNuevo: { totpHabilitado: true },
        },
      }),
    ]);

    return { habilitado: true };
  }

  async perfil(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      include: {
        roles: { include: { rol: true } },
        membresias: { where: { activo: true }, include: { ong: true } },
        donante: true,
        consentimientos: { where: { revocadoEn: null }, orderBy: { otorgadoEn: 'desc' } },
      },
    });

    return {
      id: usuario.id,
      correo: usuario.correo,
      nombres: usuario.nombres,
      apellidos: usuario.apellidos,
      telefono: usuario.telefono,
      totpHabilitado: usuario.totpHabilitado,
      roles: usuario.roles.map((r) => ({ codigo: r.rol.codigo, nombre: r.rol.nombre })),
      ongs: usuario.membresias.map((m) => ({
        id: m.ong.id,
        nombre: m.ong.nombreComercial ?? m.ong.razonSocial,
        cargo: m.cargo,
      })),
      donante: usuario.donante
        ? {
            alias: usuario.donante.alias,
            frecuenciaNotificacion: usuario.donante.frecuenciaNotificacion,
            anonimoPorDefecto: usuario.donante.anonimoPorDefecto,
          }
        : null,
      consentimientos: usuario.consentimientos.map((c) => ({
        finalidad: c.finalidad,
        otorgado: c.otorgado,
        versionPolitica: c.versionPolitica,
        otorgadoEn: c.otorgadoEn,
      })),
    };
  }
}
