import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { soles } from '../../comun/dinero';
import { Publico } from '../identidad/decoradores';
import { InformesCierreService, type Verificacion } from './informes-cierre.service';

function escapar(texto: string | number): string {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * RF-IN-05 · Verificacion publica del informe de cierre.
 *
 * Es lo que abre el QR del PDF, desde cualquier telefono y sin cuenta: por
 * eso es HTML hecho en el servidor y no una pantalla de la aplicacion. No
 * muestra nada que el informe no muestre ya, y lo que agrega es lo que
 * recalcula en el momento.
 */
@ApiTags('publico')
@Controller('publico/informes')
export class PublicoController {
  constructor(private readonly informes: InformesCierreService) {}

  @Publico()
  @Get(':id')
  @ApiOperation({ summary: 'RF-IN-05 · Verificar un informe de cierre (HTML, o formato=json)' })
  async verificar(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('formato') formato: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const v = await this.informes.verificar(id);
    if (formato === 'json') return v;

    const { contenido } = await this.informes.contenido(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return pagina(v, {
      recaudado: contenido.resumen.recaudadoBruto,
      ejecutado: contenido.resumen.liberados,
      devuelto: contenido.resumen.devuelto,
      trasladado: contenido.resumen.trasladado,
    });
  }

  @Publico()
  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'RF-CF-12 · El informe de cierre en PDF, con su QR' })
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Disposition', `attachment; filename="informe-cierre-${id}.pdf"`);
    return new StreamableFile(await this.informes.pdf(id));
  }
}

function pagina(
  v: Verificacion,
  cifras: { recaudado: string; ejecutado: string; devuelto: string; trasladado: string },
): string {
  const marca = (ok: boolean) => (ok ? '✔' : '✘');
  const fila = (ok: boolean, texto: string) =>
    `<li class="${ok ? 'ok' : 'mal'}"><span>${marca(ok)}</span> ${escapar(texto)}</li>`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verificación del informe de cierre · Ayni</title>
<style>
body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;color:#1c1b1f}
h1{font-size:1.4rem}.c{padding:.9rem 1rem;border-radius:8px;font-weight:600}
.si{background:#e7f5ec;color:#1b6b3a}.no{background:#fdecea;color:#a3221a}
ul{list-style:none;padding:0}li{margin:.5rem 0}li.ok span{color:#1b6b3a}li.mal span{color:#a3221a}
code{word-break:break-all;font-size:.8rem}table{border-collapse:collapse;width:100%}
td{padding:.25rem 0}td:last-child{text-align:right}
</style></head><body>
<h1>Informe de cierre: ${escapar(v.fondo)}</h1>
<p>${escapar(v.ong)}</p>
<p class="c ${v.sostiene ? 'si' : 'no'}">${escapar(v.conclusion)}</p>
<ul>
${fila(v.hashCoincide, 'El hash del informe coincide con su contenido, recalculado ahora.')}
${fila(v.cadena.integra, `La cadena de hashes del fondo está íntegra (${v.cadena.movimientos} movimientos), recalculada ahora por la base.`)}
${fila(v.ultimoMovimiento.coincide, `El último movimiento que vio el informe (${v.ultimoMovimiento.secuencia ?? 'ninguno'}) sigue en el libro con el mismo hash.`)}
${fila(v.movimientosPosteriores === 0, `Movimientos posteriores al cierre: ${v.movimientosPosteriores}.`)}
</ul>
<table>
<tr><td>Recaudado</td><td>S/ ${escapar(soles(cifras.recaudado))}</td></tr>
<tr><td>Ejecutado contra gasto verificado</td><td>S/ ${escapar(soles(cifras.ejecutado))}</td></tr>
<tr><td>Devuelto a sus donantes</td><td>S/ ${escapar(soles(cifras.devuelto))}</td></tr>
<tr><td>Trasladado a otras causas</td><td>S/ ${escapar(soles(cifras.trasladado))}</td></tr>
</table>
<p>Hash del informe:<br><code>${escapar(v.informe.hash)}</code></p>
<p>Es el SHA-256 del contenido del informe, que esta misma dirección entrega con <code>?formato=json</code>. Cualquiera puede recalcularlo.</p>
</body></html>`;
}
