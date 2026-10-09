"""Servicio AIni.

Expone el motor de analisis por HTTP para que el backend lo consuma igual que
consumiria cualquier proveedor externo: una peticion POST con el contrato de
la seccion 7.4 y una respuesta JSON validada.

Que el servicio sea propio y no de un tercero cambia dos cosas y ninguna es la
arquitectura: no hay clave que custodiar ni cuota que agotar, y los datos de
los beneficiarios no salen de la infraestructura del proyecto. Para un sistema
que trata datos sensibles bajo la Ley N.o 29733, eso ultimo no es un detalle.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, status

from . import anomalia, documental, motor, ocr
from .contrato import EntradaAnalisis, ResultadoAnalisis

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s %(message)s")
log = logging.getLogger("aini")

#: Token compartido con el backend. Si esta definido, se exige en cada
#: peticion. El servicio escucha en la red interna, pero una API sin
#: autenticacion es una invitacion abierta a analizar gastos ajenos.
TOKEN = os.environ.get("AINI_TOKEN", "")

_estado: dict[str, object] = {}


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    """Carga el modelo y spaCy al arrancar, no en la primera peticion.

    Cargar spaCy toma segundos. Hacerlo perezosamente dejaria que la primera
    verificacion del dia pareciera lentisima y, peor, que el fallo por un
    modelo ausente apareciera a mitad de un analisis en vez de al arrancar.
    """
    log.info("Cargando modelo de lenguaje %s...", documental.MODELO_SPACY)
    documental.nlp()

    detector = anomalia.DetectorAnomalias.cargar()
    _estado["detector"] = detector

    if detector.disponible:
        log.info("Detector de anomalias cargado (entrenado con %d gastos)", detector.entrenado_con)
    else:
        log.warning(
            "No hay modelo de anomalias en %s. La señal se degrada a las reglas de "
            "lectura. Ejecute: python -m entrenamiento.entrenar",
            anomalia.RUTA_MODELO,
        )

    log.info("AIni lista: %s", motor.VERSION)
    yield
    _estado.clear()


app = FastAPI(
    title="AIni",
    description=(
        "Motor de verificacion de gastos de Ayni. Analiza comprobante, evidencia y "
        "perfil del gasto, y devuelve puntaje, nivel y explicacion legible."
    ),
    version=motor.VERSION,
    lifespan=ciclo_de_vida,
)


def _exigir_token(autorizacion: str | None) -> None:
    if not TOKEN:
        return
    esperado = f"Bearer {TOKEN}"
    if autorizacion != esperado:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credencial invalida.")


@app.get("/salud")
def salud() -> dict[str, object]:
    detector: anomalia.DetectorAnomalias = _estado.get("detector")  # type: ignore[assignment]
    return {
        "estado": "ok",
        "servicio": "AIni",
        "versionModelo": motor.VERSION,
        "modeloLenguaje": documental.MODELO_SPACY,
        "detectorAnomalias": {
            "disponible": bool(detector and detector.disponible),
            "entrenadoCon": detector.entrenado_con if detector else 0,
        },
        # Se reporta porque el lector se puede apagar con AINI_OCR=0, y apagado
        # no falla: devuelve "no se pudo leer" como si la foto fuera mala. Sin
        # esto, la unica forma de notar que esta apagado seria ver que ningun
        # gasto llega a cotejarse nunca.
        "lectorComprobantes": {
            "activo": ocr.ACTIVO,
            "confianzaMinima": ocr.CONFIANZA_MINIMA,
            # Sin pypdfium2 los PDF no fallan: se reportan como no leidos.
            "leePdf": _lee_pdf(),
        },
    }


def _lee_pdf() -> bool:
    try:
        import pypdfium2  # noqa: F401
    except ImportError:
        return False
    return True


@app.post("/analizar", response_model=ResultadoAnalisis, response_model_by_alias=True)
def analizar(
    entrada: EntradaAnalisis,
    authorization: str | None = Header(default=None),
) -> ResultadoAnalisis:
    _exigir_token(authorization)

    detector: anomalia.DetectorAnomalias = _estado.get("detector")  # type: ignore[assignment]
    if detector is None:
        detector = anomalia.DetectorAnomalias()

    resultado = motor.analizar(entrada, detector)

    log.info(
        "gasto=%s nivel=%s score=%.1f (doc=%.1f vis=%.1f ano=%.1f) %dms",
        entrada.gasto_id,
        resultado.nivel,
        resultado.score_final,
        resultado.score_documental,
        resultado.score_visual,
        resultado.score_anomalia,
        resultado.duracion_ms,
    )
    return resultado
