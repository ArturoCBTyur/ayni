import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { Configuracion } from '../../../config/configuracion';
import type {
  EventoWebhook,
  OrdenCobro,
  PasarelaPago,
  ResultadoCobro,
} from '../puertos/pasarela-pago.port';

/**
 * Pasarela simulada para el MVP.
 *
 * No es un stub que devuelve true: reproduce lo que hace una pasarela real y
 * que el sistema tiene que saber manejar. Cobra una comision con la misma
 * forma que las del mercado peruano (porcentaje mas monto fijo), decide el
 * resultado segun el token, y **entrega el resultado por webhook firmado**
 * en lugar de confirmarlo en la respuesta del cobro.
 *
 * Eso ultimo es lo que importa: obliga a que el flujo real ejercite
 * verificacion de firma, idempotencia y confirmacion asincrona desde el
 * primer dia. Si la confirmacion llegara en la respuesta HTTP, cambiar a
 * Culqi despues significaria reescribir el flujo entero.
 *
 * Convencion de tokens para la demo y las pruebas:
 *   tok_ok_*        cobro aprobado
 *   tok_rechazo_*   cobro rechazado por fondos insuficientes
 *   tok_robada_*    cobro rechazado por tarjeta reportada
 */
@Injectable()
export class FakeGateway implements PasarelaPago {
  readonly nombre = 'fake';

  private readonly logger = new Logger(FakeGateway.name);

  constructor(private readonly config: ConfigService<Configuracion, true>) {}

  cobrar(orden: OrdenCobro): Promise<ResultadoCobro> {
    const referenciaExterna = `fk_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const comision = this.calcularComision(orden.monto);
    const rechazo = this.motivoDeRechazo(orden.tokenTarjeta);

    const resultado: ResultadoCobro = {
      referenciaExterna,
      // Siempre PENDIENTE: la confirmacion llega por webhook, como en las
      // pasarelas reales.
      estado: 'PENDIENTE',
      comision,
      montoNeto: redondear(orden.monto - comision),
      metodo: 'tarjeta',
      ultimos4: orden.tokenTarjeta.slice(-4).padStart(4, '0'),
      marca: orden.tokenTarjeta.includes('amex') ? 'Amex' : 'Visa',
      motivoRechazo: rechazo ?? undefined,
    };

    void this.entregarWebhook({
      eventoId: `evt_${randomUUID()}`,
      tipo: rechazo ? 'cargo.rechazado' : 'cargo.aprobado',
      referenciaExterna,
      referenciaInterna: orden.referenciaInterna,
      monto: orden.monto,
      comision,
      metodo: resultado.metodo,
      ultimos4: resultado.ultimos4,
      marca: resultado.marca,
      motivoRechazo: rechazo ?? undefined,
      creadoEn: new Date().toISOString(),
    });

    // La entrega del webhook no se espera a proposito: en una pasarela real
    // el cobro responde de inmediato y la confirmacion llega despues.
    return Promise.resolve(resultado);
  }

  /**
   * Reembolso simulado: aceptado al instante. Una pasarela real lo procesa
   * en dias; por eso el cierre de causa guarda la referencia y la fecha del
   * reembolso aparte del asiento, y reintenta los que no llegaron.
   */
  reembolsar(referenciaExterna: string, monto: number): Promise<{ referencia: string }> {
    if (monto <= 0) return Promise.reject(new Error('Un reembolso necesita un monto positivo.'));
    this.logger.log(`Reembolso simulado de S/ ${monto.toFixed(2)} sobre ${referenciaExterna}.`);
    return Promise.resolve({ referencia: `rf_${randomUUID().replace(/-/g, '').slice(0, 20)}` });
  }

  /**
   * Comision con la forma de las pasarelas peruanas: un porcentaje del monto
   * mas un cargo fijo por transaccion. Se redondea a dos decimales porque el
   * libro trabaja en soles con centimos exactos.
   */
  private calcularComision(monto: number): number {
    const porcentaje = this.config.get('PASARELA_COMISION_PORCENTAJE', { infer: true });
    const fija = this.config.get('PASARELA_COMISION_FIJA', { infer: true });
    return redondear((monto * porcentaje) / 100 + fija);
  }

  private motivoDeRechazo(token: string): string | null {
    if (token.startsWith('tok_rechazo')) return 'Fondos insuficientes en la tarjeta.';
    if (token.startsWith('tok_robada')) return 'La tarjeta fue reportada por su titular.';
    return null;
  }

  /**
   * Entrega el webhook al backend, firmado igual que lo haria la pasarela.
   *
   * Si no hay URL configurada no entrega nada: en las pruebas no hay un
   * servidor HTTP escuchando y el handler se invoca directamente.
   */
  private async entregarWebhook(evento: EventoWebhook): Promise<void> {
    const url = this.config.get('PASARELA_WEBHOOK_URL', { infer: true });
    if (!url) return;

    // Un retraso breve imita la asincronia real y deja que la respuesta del
    // cobro llegue al cliente antes que la confirmacion.
    await new Promise((resolver) => setTimeout(resolver, 300));

    const cuerpo = JSON.stringify(evento);

    try {
      const respuesta = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pasarela-firma': this.firmar(cuerpo),
        },
        body: cuerpo,
      });

      if (!respuesta.ok) {
        this.logger.warn(
          `El backend rechazo el webhook ${evento.eventoId}: HTTP ${respuesta.status}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo entregar el webhook ${evento.eventoId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  firmar(cuerpoCrudo: string): string {
    return createHmac('sha256', this.config.get('PASARELA_WEBHOOK_SECRET', { infer: true }))
      .update(cuerpoCrudo)
      .digest('hex');
  }

  verificarFirma(cuerpoCrudo: string, firma: string | undefined): boolean {
    if (!firma) return false;

    const esperada = Buffer.from(this.firmar(cuerpoCrudo), 'utf8');
    const recibida = Buffer.from(firma, 'utf8');

    // Comparacion en tiempo constante: comparar con === filtra informacion
    // sobre cuantos caracteres iniciales acerto quien lo intenta.
    if (esperada.length !== recibida.length) return false;
    return timingSafeEqual(esperada, recibida);
  }

  cancelarSuscripcion(referenciaExterna: string): Promise<void> {
    this.logger.log(`Suscripcion ${referenciaExterna} cancelada en la pasarela simulada.`);
    return Promise.resolve();
  }
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
