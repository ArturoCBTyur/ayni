"""Orquesta las tres señales y arma el ResultadoAnalisis.

La ponderacion y los umbrales NO se deciden aqui: vienen en cada peticion,
dentro de `regla`. Es lo que exige la RN-06 —el nivel se calcula con la regla
vigente al momento, y queda registrado cual fue—, y lo que permite que el
administrador cambie un umbral sin tocar ni desplegar el modelo.
"""

from __future__ import annotations

import time

from . import anomalia, cotejo, documental, narrativa, ocr, visual
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


#: Discrepancias del cotejo que merecen alerta, y como se nombra cada campo en
#: la descripcion. El total va con severidad ALTA y los demas MEDIA: el importe
#: es lo que sale del fondo, mientras que una serie equivocada apunta a otro
#: documento sin mover dinero por si sola.
_DISCREPANCIAS = {
    "ocr.total_discrepa": ("el importe", "ALTA"),
    "ocr.ruc_discrepa": ("el RUC del emisor", "MEDIA"),
    "ocr.serie_discrepa": ("la serie y el numero", "MEDIA"),
}


#: Reglas que solo se anotan si se leyo un campo del papel y se comparo con lo
#: declarado, coincida o no. Basta una para decir que el comprobante se
#: verifico contra el documento.
_COTEJADOS = {"ocr.total_coincide", "ocr.total_discrepa", "ocr.ruc_coincide", "ocr.ruc_discrepa"}

SIN_COTEJO = (
    "No se pudo verificar el comprobante contra el papel, asi que el gasto pasa a "
    "revision en vez de aprobarse solo. Una foto mas nitida del comprobante permite "
    "verificarlo."
)


def _verificado_contra_el_papel(motivos: list[MotivoAnalisis]) -> bool:
    return any(m.regla in _COTEJADOS for m in motivos)


def _alerta_de_cotejo(motivos: list[MotivoAnalisis]) -> AlertaAnalisis | None:
    """Una sola alerta para todo lo que no coincide con el documento.

    Se agrupa a proposito. Una boleta tecleada de prisa puede discrepar en tres
    campos a la vez, y tres alertas en la bandeja se leerian como tres
    problemas cuando son uno: lo que se escribio no es lo que dice el papel.

    El titulo no acusa. La causa mas probable de una discrepancia es un error
    al teclear, y la ONG lee estas alertas: llamarla fraude por un digito
    cambiado seria injusto y, en un sistema que publica puntajes de confianza,
    tambien caro. Se nombra el hecho y se pide revisar.
    """
    encontradas = [m for m in motivos if m.regla in _DISCREPANCIAS and m.resultado == "falla"]
    if not encontradas:
        return None

    campos = [_DISCREPANCIAS[m.regla][0] for m in encontradas]
    severidad = "ALTA" if any(_DISCREPANCIAS[m.regla][1] == "ALTA" for m in encontradas) else "MEDIA"

    # Enumeracion con dos puntos y comas, no con "y" final: uno de los campos
    # se llama "la serie y el numero", y encadenarlo salia "la serie y el
    # numero y el importe", que se lee como tres campos en vez de dos.
    return AlertaAnalisis(
        tipo="DECLARACION_NO_COINCIDE",
        severidad=severidad,  # type: ignore[arg-type]
        titulo=f"Lo declarado no coincide con el documento en: {', '.join(campos)}",
        descripcion=" ".join(m.mensaje for m in encontradas),
    )


def _alertas(motivos: list[MotivoAnalisis], bloqueo_visual: bool) -> list[AlertaAnalisis]:
    alertas: list[AlertaAnalisis] = []

    # El orden importa mas de lo que parece: el backend persiste solo la
    # primera alerta de la lista, asi que la primera tiene que ser la causa, no
    # la primera que se calculo. El bloqueo duro va antes que todo lo demas.
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

    # Despues del bloqueo y antes del resto: que lo declarado no coincida con
    # el documento pesa mas que cualquier senal calculada sobre lo declarado,
    # porque las otras razonan sobre el dato y esta lo contradice.
    cotejo_fallido = _alerta_de_cotejo(motivos)
    if cotejo_fallido is not None:
        alertas.append(cotejo_fallido)

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


def _datos_extraidos(entrada: EntradaAnalisis, leido: "ocr.CamposLeidos | None") -> DatosExtraidos:
    """Los campos del comprobante, diciendo de donde salio cada uno.

    Cuando el OCR leyo el documento, se reportan **sus** valores y no los
    declarados, aunque difieran. Es el punto entero de haberlo leido: si se
    devolvieran los declarados, el campo `fuente` diria "ocr" sobre datos que
    nadie verifico contra el papel, que es peor que no leerlo.

    La discrepancia no se pierde: viaja como motivo, con los dos valores.
    """
    c = entrada.comprobante

    if leido is None or not leido.leyo_algo:
        return DatosExtraidos(
            fuente="declarado",
            tipo=c.tipo,
            ruc_emisor=c.ruc_emisor,
            serie=c.serie,
            numero=c.numero,
            fecha_emision=c.fecha_emision,
            subtotal=c.subtotal,
            igv=c.igv,
            total=c.total,
        )

    # Campo a campo: lo leido si se pudo leer, lo declarado si no. Mezclar es
    # correcto porque cada valor viaja junto a su motivo de cotejo.
    return DatosExtraidos(
        fuente="ocr",
        tipo=c.tipo,
        ruc_emisor=leido.ruc_emisor or c.ruc_emisor,
        serie=leido.serie or c.serie,
        numero=leido.numero or c.numero,
        fecha_emision=(
            leido.fecha_emision.isoformat() if leido.fecha_emision else c.fecha_emision
        ),
        subtotal=leido.subtotal if leido.subtotal is not None else c.subtotal,
        igv=leido.igv if leido.igv is not None else c.igv,
        total=leido.total if leido.total is not None else c.total,
    )


def analizar(entrada: EntradaAnalisis, detector: anomalia.DetectorAnomalias) -> ResultadoAnalisis:
    inicio = time.perf_counter()

    # Se lee el comprobante antes que nada: lo que diga el papel cambia como se
    # evalua lo declarado, no al reves.
    leido = ocr.leer_desde(entrada.comprobante.archivo_url)
    motivos_cotejo, penalizacion_cotejo = cotejo.evaluar(entrada.comprobante, leido)

    score_doc, motivos_doc = documental.evaluar(entrada.declarado, entrada.comprobante)
    score_doc = max(0.0, score_doc - penalizacion_cotejo)
    motivos_doc = [*motivos_doc, *motivos_cotejo]
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

    # ALTO aprueba el gasto sin que lo mire nadie, y eso exige haber comprobado
    # el comprobante contra el papel. Sin esa lectura, todo lo demas razona
    # sobre lo que el operador tecleo: un gasto se aprobaba solo con 90 puntos
    # aunque el lector no hubiera podido leer nada, porque no leer no resta.
    #
    # Sigue sin restar: el puntaje no se toca, porque una foto mala no dice que
    # el gasto este mal. Lo que cambia es quien decide: pasa a una persona en
    # vez de aprobarse solo. Con el lector apagado (AINI_OCR=0) ningun gasto
    # llega a ALTO, que es lo coherente: nadie verifico el papel.
    sin_cotejo = nivel == "ALTO" and not _verificado_contra_el_papel(motivos_cotejo)
    if sin_cotejo:
        nivel = "MEDIO"
        motivos.append(
            MotivoAnalisis(
                regla="ocr.sin_cotejo",
                senal="documental",
                resultado="advertencia",
                mensaje=SIN_COTEJO,
                penalizacion=0,
            )
        )

    return ResultadoAnalisis(
        score_documental=round(score_doc, 2),
        score_visual=round(score_vis, 2),
        score_anomalia=round(score_ano, 2),
        score_final=round(final, 2),
        nivel=nivel,
        datos_extraidos=_datos_extraidos(entrada, leido),
        explicacion=Explicacion(
            motivos=motivos, resumen=SIN_COTEJO if sin_cotejo else _resumen(nivel, motivos)
        ),
        alertas=_alertas(motivos, bloqueo),
        narrativa_borrador=narrativa.redactar_borrador(entrada, motivos, bloqueo),
        version_modelo=VERSION,
        duracion_ms=int((time.perf_counter() - inicio) * 1000),
    )
