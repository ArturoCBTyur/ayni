"""Borrador del parrafo de verificacion que lee el donante (RF-CO-01).

No es un modelo generativo, a proposito (ADR-0005). Se arma por reglas a
partir de los motivos que salieron **ok**: cada frase existe porque una
comprobacion concreta la respalda, y si la comprobacion no paso, la frase no
se escribe. Asi el borrador no puede afirmar nada que el analisis no haya
visto.

Solo cuenta *como* se verifico el gasto. El saludo y el monto de cada donante
los pone la plantilla del backend, porque AIni analiza antes de la aprobacion
y todavia no sabe quien financia el gasto ni con cuanto.

El backend no confia en este texto: lo vuelve a revisar (lenguaje y cifras)
antes de usarlo, y si no pasa, usa la plantilla sola.
"""

from __future__ import annotations

from .contrato import EntradaAnalisis, MotivoAnalisis

_TIPOS = {
    "BOLETA": "boleta",
    "FACTURA": "factura",
    "RECIBO_HONORARIOS": "recibo por honorarios",
    "NOTA_VENTA": "nota de venta",
}

#: Comprobaciones aritmeticas y de formato, en el orden en que se leen.
_COMPROBACIONES = (
    ("doc.ruc_modulo11", "el RUC del emisor es válido"),
    ("doc.igv_18", "el IGV cuadra con el subtotal"),
    ("doc.fechas", "las fechas del comprobante son coherentes"),
)


def _enumerar(partes: list[str]) -> str:
    if len(partes) == 1:
        return partes[0]
    return f"{', '.join(partes[:-1])} y {partes[-1]}"


def _frase(partes: list[str], prefijo: str = "") -> str:
    texto = f"{prefijo}{_enumerar(partes)}."
    return texto[0].upper() + texto[1:]


def redactar_borrador(
    entrada: EntradaAnalisis, motivos: list[MotivoAnalisis], bloqueo: bool
) -> str | None:
    """El parrafo, o None si no hay nada verificado que contar.

    Un gasto bloqueado no lleva borrador: no se va a aprobar, y si un auditor
    lo rescatara, que el donante lea la plantilla generica es lo prudente.
    """
    if bloqueo:
        return None

    ok = {m.regla for m in motivos if m.resultado == "ok"}
    # Una regla puede anotarse varias veces (una por evidencia). Basta con que
    # una no haya salido bien para no afirmar nada sobre ella.
    no_ok = {m.regla for m in motivos if m.resultado != "ok"}
    paso = lambda regla: regla in ok and regla not in no_ok  # noqa: E731

    c = entrada.comprobante
    documento = (
        f"la {_TIPOS.get(c.tipo, 'comprobante')} {c.serie}-{c.numero} "
        f"de {entrada.declarado.proveedor_nombre}"
    )

    # --- Lo que se leyo del papel ---
    cotejados = [
        etiqueta
        for regla, etiqueta in (
            ("ocr.ruc_coincide", "el RUC"),
            ("ocr.serie_coincide", "el número de documento"),
            ("ocr.fecha_coincide", "la fecha"),
            ("ocr.total_coincide", f"el total de S/ {c.total:.2f}"),
        )
        if paso(regla)
    ]

    # --- Lo que se comprobo sobre el documento ---
    comprobado = [texto for regla, texto in _COMPROBACIONES if paso(regla)]

    # --- Lo que se comprobo sobre el gasto ---
    gasto: list[str] = []
    if paso("nlp.coherencia_categoria"):
        gasto.append("el concepto corresponde al destino del fondo")
    if entrada.evidencias and paso("vis.evidencia_nueva"):
        gasto.append(
            "la foto de la evidencia no se había presentado en ningún gasto anterior"
            if len(entrada.evidencias) == 1
            else "ninguna de las fotos de evidencia se había presentado en otro gasto"
        )
    if paso("ano.monto"):
        gasto.append("el monto está dentro de lo habitual para este tipo de gasto")

    if not (cotejados or comprobado or gasto):
        return None

    frases: list[str] = []
    if cotejados:
        verbo = "coincide" if len(cotejados) == 1 else "coinciden"
        frases.append(
            _frase([f"{documento} se leyó automáticamente: {_enumerar(cotejados)} {verbo} con lo declarado"])
        )
    else:
        frases.append(_frase([f"el gasto se respaldó con {documento}"]))

    if comprobado:
        frases.append(_frase(comprobado))
    if gasto:
        frases.append(_frase(gasto, "además, " if comprobado else ""))

    return " ".join(frases)
