"""Orquesta las tres señales y arma el ResultadoAnalisis.

La ponderacion y los umbrales NO se deciden aqui: vienen en cada peticion,
dentro de `regla`. Es lo que exige la RN-06 —el nivel se calcula con la regla
vigente al momento, y queda registrado cual fue—, y lo que permite que el
administrador cambie un umbral sin tocar ni desplegar el modelo.
"""

from __future__ import annotations

import time

from . import anomalia, documental, visual
from .contrato import (
    AlertaAnalisis,
    DatosExtraidos,
    EntradaAnalisis,
    Explicacion,
    MotivoAnalisis,
    NivelConfianza,
    ResultadoAnalisis,
)

VERSION = "aini-0.1-sklearn"


def _resumen(nivel: NivelConfianza, motivos: list[MotivoAnalisis]) -> str:
    """Una frase, la que ve la ONG en la aplicacion.

    Se construye nombrando el problema principal, no describiendo el puntaje.
    "Confianza media (72/100)" no le dice a nadie que corregir; "el digito
    verificador del RUC no coincide" si.
    """
    fallas = [m for m in motivos if m.resultado == "falla"]
    advertencias = [m for m in motivos if m.resultado == "advertencia"]

    if nivel == "ALTO" and not fallas:
        return "El gasto tiene respaldo documental y visual consistente."

    if fallas:
        principal = fallas[0].mensaje
        if len(fallas) > 1:
            return f"{principal} Hay {len(fallas) - 1} observacion(es) mas."
        return principal

    if advertencias:
        principal = advertencias[0].mensaje
        if len(advertencias) > 1:
            return f"{principal} Hay {len(advertencias) - 1} observacion(es) mas."
        return principal

    return "El gasto requiere revision."


def _alertas(motivos: list[MotivoAnalisis], bloqueo_visual: bool) -> list[AlertaAnalisis]:
    alertas: list[AlertaAnalisis] = []

    if bloqueo_visual:
        alertas.append(
            AlertaAnalisis(
                tipo="EVIDENCIA_REUTILIZADA",
                severidad="ALTA",
                titulo="La evidencia ya se habia presentado",
                descripcion=(
                    "La imagen coincide con una presentada en otro gasto. El archivo es "
                    "distinto, pero la imagen es la misma."
                ),
            )
        )

    for motivo in motivos:
        if motivo.regla == "doc.ruc_modulo11" and motivo.resultado == "falla":
            alertas.append(
                AlertaAnalisis(
                    tipo="COMPROBANTE_INVALIDO",
                    severidad="MEDIA",
                    titulo="El RUC del emisor no es valido",
                    descripcion=motivo.mensaje,
                )
            )
        elif motivo.regla == "nlp.coherencia_categoria" and motivo.resultado == "falla":
            alertas.append(
                AlertaAnalisis(
                    tipo="CATEGORIA_INCOHERENTE",
                    severidad="MEDIA",
                    titulo="El gasto no corresponde a la categoria del fondo",
                    descripcion=motivo.mensaje,
                )
            )
        elif motivo.regla == "ml.isolation_forest" and motivo.resultado == "falla":
            alertas.append(
                AlertaAnalisis(
                    tipo="PERFIL_ANOMALO",
                    severidad="MEDIA",
                    titulo="El perfil del gasto se aparta de lo habitual",
                    descripcion=motivo.mensaje,
                )
            )
        elif motivo.regla == "vis.personas_sin_anonimizar":
            alertas.append(
                AlertaAnalisis(
                    tipo="PRIVACIDAD",
                    severidad="ALTA",
                    titulo="Evidencia con personas sin anonimizar",
                    descripcion=motivo.mensaje,
                )
            )

    return alertas


def analizar(entrada: EntradaAnalisis, detector: anomalia.DetectorAnomalias) -> ResultadoAnalisis:
    inicio = time.perf_counter()

    score_doc, motivos_doc = documental.evaluar(entrada.declarado, entrada.comprobante)
    score_vis, motivos_vis, bloqueo = visual.evaluar(entrada.declarado, entrada.evidencias)
    score_ano, motivos_ano = anomalia.evaluar(
        entrada.declarado, entrada.contexto, entrada.comprobante.fecha_emision, detector
    )

    motivos = [*motivos_doc, *motivos_vis, *motivos_ano]
    regla = entrada.regla

    final = (
        score_doc * regla.peso_documental
        + score_vis * regla.peso_visual
        + score_ano * regla.peso_anomalia
    )

    # Bloqueo duro: una evidencia reutilizada no se compensa con un comprobante
    # impecable. El puntaje ponderado no debe poder rescatarla.
    if bloqueo:
        final = 0.0
        nivel: NivelConfianza = "BAJO"
    elif final >= regla.umbral_alto:
        nivel = "ALTO"
    elif final >= regla.umbral_medio:
        nivel = "MEDIO"
    else:
        nivel = "BAJO"

    # Saldo insuficiente: tambien bloqueo duro. No se puede ejecutar lo que no
    # se ha recaudado, y eso no es cuestion de confianza sino de contabilidad.
    if entrada.declarado.monto_declarado > entrada.contexto.saldo_retenido:
        nivel = "BAJO"
        motivos.append(
            MotivoAnalisis(
                regla="ano.saldo_insuficiente",
                senal="anomalia",
                resultado="falla",
                mensaje=(
                    f"El fondo tiene S/ {entrada.contexto.saldo_retenido:.2f} retenidos y el "
                    f"gasto declara S/ {entrada.declarado.monto_declarado:.2f}."
                ),
                valor=round(entrada.contexto.saldo_retenido, 2),
                penalizacion=0,
            )
        )

    return ResultadoAnalisis(
        score_documental=round(score_doc, 2),
        score_visual=round(score_vis, 2),
        score_anomalia=round(score_ano, 2),
        score_final=round(final, 2),
        nivel=nivel,
        datos_extraidos=DatosExtraidos(
            # "declarado" y no "ocr": esta version no lee el comprobante, lo
            # captura el operador. Declararlo asi es lo que permite que el dia
            # que haya OCR se sepa cuales analisis lo tuvieron y cuales no.
            fuente="declarado",
            tipo=entrada.comprobante.tipo,
            ruc_emisor=entrada.comprobante.ruc_emisor,
            serie=entrada.comprobante.serie,
            numero=entrada.comprobante.numero,
            fecha_emision=entrada.comprobante.fecha_emision,
            subtotal=entrada.comprobante.subtotal,
            igv=entrada.comprobante.igv,
            total=entrada.comprobante.total,
        ),
        explicacion=Explicacion(motivos=motivos, resumen=_resumen(nivel, motivos)),
        alertas=_alertas(motivos, bloqueo),
        narrativa_borrador=None,
        version_modelo=VERSION,
        duracion_ms=int((time.perf_counter() - inicio) * 1000),
    )
