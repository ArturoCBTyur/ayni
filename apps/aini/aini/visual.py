"""Señal visual: calidad y novedad de la evidencia fotografica.

Nada de esto es aprendizaje automatico, y es deliberado. Son mediciones sobre
el archivo —nitidez, resolucion, coherencia de la fecha EXIF— y la distancia de
Hamming contra el historico, que calcula el backend porque es quien tiene la
base. Un modelo no mejoraria ninguna: son magnitudes exactas, y someterlas a
una prediccion las volveria menos precisas y menos explicables.

El reconocimiento de escena —"¿esta foto muestra lo que el concepto dice?"— si
necesitaria vision por computadora, y no esta en esta version. La señal mide
que la evidencia sea utilizable y nueva, no que retrate lo que afirma.
"""

from __future__ import annotations

from datetime import date, datetime

from .contrato import Declarado, Evidencia, MotivoAnalisis

#: Por debajo de esto la foto esta movida o desenfocada. La varianza del
#: laplaciano la calcula el backend al recibir el archivo.
NITIDEZ_MINIMA = 100.0
RESOLUCION_MINIMA = 640 * 480

#: Distancia de Hamming por debajo de la cual dos huellas perceptuales
#: corresponden a la misma imagen, aunque el archivo sea distinto.
HAMMING_MISMA_IMAGEN = 5


def _a_fecha(valor: str | None) -> date | None:
    if not valor:
        return None
    try:
        return datetime.fromisoformat(valor.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def evaluar(
    declarado: Declarado, evidencias: list[Evidencia]
) -> tuple[float, list[MotivoAnalisis], bool]:
    """Puntaje visual, sus motivos, y si hubo un bloqueo duro.

    El bloqueo duro es la evidencia reciclada: no es una penalizacion que se
    suma a otras, es una condicion que por si sola manda el gasto al nivel mas
    bajo. Reutilizar una foto no admite grados.
    """
    motivos: list[MotivoAnalisis] = []
    penalizacion = 0.0
    bloqueo = False

    def anotar(
        regla: str, resultado: str, mensaje: str, valor: str | float | None = None, pen: float = 0
    ) -> None:
        nonlocal penalizacion
        penalizacion += pen
        motivos.append(
            MotivoAnalisis(
                regla=regla,
                senal="visual",
                resultado=resultado,  # type: ignore[arg-type]
                mensaje=mensaje,
                valor=valor,
                penalizacion=pen,
            )
        )

    if not evidencias:
        anotar("vis.sin_evidencia", "falla", "El gasto no tiene ninguna evidencia visual.", None, 100)
        return 0.0, motivos, True

    f_gasto = _a_fecha(declarado.fecha_gasto)

    for i, ev in enumerate(evidencias):
        etiqueta = f"la evidencia {i + 1}" if len(evidencias) > 1 else "la evidencia"

        # --- Reutilizacion: el bloqueo duro ---
        distancia = ev.distancia_minima_historico
        if distancia is not None and distancia <= HAMMING_MISMA_IMAGEN:
            bloqueo = True
            anotar(
                "vis.evidencia_reciclada",
                "falla",
                f"{etiqueta.capitalize()} coincide con una imagen ya presentada en otro gasto, "
                "aunque se haya recortado o vuelto a guardar.",
                distancia,
                60,
            )
        elif distancia is not None:
            anotar(
                "vis.evidencia_nueva",
                "ok",
                f"{etiqueta.capitalize()} no se parece a ninguna presentada antes.",
                distancia,
            )

        # --- Nitidez ---
        if ev.nitidez is None:
            anotar(
                "vis.nitidez_desconocida",
                "advertencia",
                f"No se pudo medir la nitidez de {etiqueta}.",
            )
        elif ev.nitidez < NITIDEZ_MINIMA:
            anotar(
                "vis.borrosa",
                "advertencia",
                f"{etiqueta.capitalize()} esta borrosa; cuesta leer lo que muestra.",
                round(ev.nitidez, 1),
                15,
            )
        else:
            anotar("vis.nitidez", "ok", f"{etiqueta.capitalize()} tiene nitidez suficiente.", round(ev.nitidez, 1))

        # --- Resolucion ---
        if ev.ancho and ev.alto:
            pixeles = ev.ancho * ev.alto
            if pixeles < RESOLUCION_MINIMA:
                anotar(
                    "vis.resolucion_baja",
                    "advertencia",
                    f"{etiqueta.capitalize()} tiene resolucion baja ({ev.ancho}x{ev.alto}).",
                    f"{ev.ancho}x{ev.alto}",
                    10,
                )

        # --- Fecha EXIF ---
        f_exif = _a_fecha(ev.exif_capturado_en)
        if f_exif and f_gasto:
            dias = abs((f_exif - f_gasto).days)
            if dias > 15:
                anotar(
                    "vis.exif_desfasada",
                    "advertencia",
                    f"{etiqueta.capitalize()} se tomo {dias} dias antes o despues de la fecha del gasto.",
                    dias,
                    12,
                )
            else:
                anotar(
                    "vis.exif",
                    "ok",
                    f"La fecha de captura de {etiqueta} es coherente con la del gasto.",
                )

        # --- Privacidad: RNF-06 ---
        if ev.contiene_personas and not ev.anonimizada:
            anotar(
                "vis.personas_sin_anonimizar",
                "falla",
                f"En {etiqueta} aparecen personas y todavia no fue anonimizada. No puede "
                "mostrarse al donante en ese estado.",
                None,
                20,
            )

    return max(0.0, 100.0 - penalizacion), motivos, bloqueo
