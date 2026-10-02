"""Señal de anomalia: Isolation Forest sobre el perfil del gasto.

Por que un modelo y no mas reglas. El motor determinista ya compara el monto
contra la media de su categoria (±2σ) y marca el proveedor nuevo. Eso funciona
para una señal a la vez, pero no ve **combinaciones**: un monto apenas alto no
es sospechoso, un proveedor nuevo tampoco, y tres gastos en la semana tampoco;
los tres juntos, en un gasto que ademas consume casi todo el saldo retenido, si
lo son. Isolation Forest aisla justamente ese tipo de punto raro en el espacio
completo de caracteristicas, sin que nadie tenga que escribir la combinacion.

Por que no supervisado. No hay etiquetas de fraude: nadie marco "este gasto era
falso". Lo que si hay es un conjunto de gastos que se consideran normales, y
ese es exactamente el escenario de la deteccion de anomalias.

**La explicabilidad no la da el modelo.** Isolation Forest devuelve un numero y
nada mas, y un numero sin motivo viola el RNF-09, que es una exigencia central
de este proyecto. Por eso el puntaje del modelo se acompaña siempre de los
motivos derivados de las caracteristicas que estan fuera de rango: el modelo
decide cuanto, las reglas de lectura explican por que.
"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .contrato import Contexto, Declarado, MotivoAnalisis

RUTA_MODELO = Path(__file__).resolve().parent.parent / "modelos" / "anomalia.joblib"

#: Extremos de `score_samples` para mapear a 0-100. NO son valores elegidos a
#: ojo: se midieron sobre el modelo entrenado, con 400 gastos normales nuevos y
#: una bateria de perfiles anomalos.
#:
#:   gastos normales      p5 -0.552   mediana -0.443   p95 -0.389
#:   monto muy atipico       -0.605
#:   consume todo el saldo   -0.607
#:   los cuatro a la vez     -0.774   <- el caso que justifica el modelo
#:
#: El ultimo numero es el argumento entero de usar Isolation Forest: ninguna
#: señal suelta baja de -0.61, y las cuatro juntas llegan a -0.77. Esa brecha
#: es la que una regla por señal no puede ver.
SCORE_ANOMALO = -0.80
SCORE_NORMAL = -0.37

#: Orden fijo de las caracteristicas. Es contrato con el modelo entrenado:
#: cambiarlo sin reentrenar produciria predicciones silenciosamente erroneas.
CARACTERISTICAS = (
    "monto",
    "z_categoria",
    "proveedor_nuevo",
    "gastos_recientes",
    "fraccion_saldo",
    "dias_emision_a_gasto",
    "dias_gasto_a_captura",
)


def _a_fecha(valor: str | None) -> date | None:
    if not valor:
        return None
    try:
        return datetime.fromisoformat(valor.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def extraer_caracteristicas(
    declarado: Declarado, contexto: Contexto, fecha_emision: str
) -> dict[str, float]:
    """Traduce el gasto al vector numerico que el modelo entiende."""
    monto = float(declarado.monto_declarado)

    # Cuantas desviaciones por encima de lo habitual en su categoria. Sin
    # historial se asume 0: no es que sea tipico, es que no hay con que
    # compararlo, y el motivo lo dice aparte.
    media = contexto.media_historica_categoria
    desviacion = contexto.desviacion_historica_categoria
    if media is not None and desviacion is not None and desviacion > 0:
        z = (monto - media) / desviacion
    else:
        z = 0.0

    saldo = float(contexto.saldo_retenido)
    fraccion = monto / saldo if saldo > 0 else 1.0

    f_emision = _a_fecha(fecha_emision)
    f_gasto = _a_fecha(declarado.fecha_gasto)
    f_captura = _a_fecha(declarado.capturado_en)

    dias_emision = (f_gasto - f_emision).days if f_emision and f_gasto else 0
    dias_captura = (f_captura - f_gasto).days if f_captura and f_gasto else 0

    return {
        "monto": monto,
        "z_categoria": float(z),
        "proveedor_nuevo": 0.0 if contexto.proveedor_conocido else 1.0,
        "gastos_recientes": float(contexto.gastos_recientes_misma_categoria),
        "fraccion_saldo": float(min(fraccion, 2.0)),
        "dias_emision_a_gasto": float(dias_emision),
        "dias_gasto_a_captura": float(dias_captura),
    }


def como_vector(rasgos: dict[str, float]) -> np.ndarray:
    return np.array([[rasgos[c] for c in CARACTERISTICAS]], dtype=float)


class DetectorAnomalias:
    """Envoltorio del modelo entrenado, con su traduccion a motivos."""

    def __init__(self, pipeline: Pipeline | None = None, entrenado_con: int = 0) -> None:
        self.pipeline = pipeline
        self.entrenado_con = entrenado_con

    @classmethod
    def cargar(cls) -> "DetectorAnomalias":
        """Carga el modelo del disco; si no existe, queda sin modelo.

        Que falte el archivo no puede tumbar el servicio: la señal de anomalia
        se degrada a las reglas de lectura, que siguen siendo utiles, y el
        motivo lo declara. Un servicio caido seria peor que uno que explica
        con menos informacion.
        """
        if not RUTA_MODELO.exists():
            return cls()

        import joblib

        datos = joblib.load(RUTA_MODELO)
        return cls(datos["pipeline"], datos.get("entrenado_con", 0))

    @property
    def disponible(self) -> bool:
        return self.pipeline is not None

    def puntuar(self, rasgos: dict[str, float]) -> float | None:
        """Puntaje de normalidad de 0 a 100. None si no hay modelo.

        `score_samples` devuelve valores negativos donde mas negativo es mas
        anomalo. Se mapea a 0-100 con un rango calibrado sobre el conjunto de
        entrenamiento, acotado a los extremos.
        """
        if self.pipeline is None:
            return None

        bruto = float(self.pipeline.score_samples(como_vector(rasgos))[0])
        normalizado = (bruto - SCORE_ANOMALO) / (SCORE_NORMAL - SCORE_ANOMALO)
        return float(np.clip(normalizado, 0.0, 1.0) * 100.0)


# --------------------------------------------------------------------------
# Lectura humana de las caracteristicas
# --------------------------------------------------------------------------


def evaluar(
    declarado: Declarado,
    contexto: Contexto,
    fecha_emision: str,
    detector: DetectorAnomalias,
) -> tuple[float, list[MotivoAnalisis]]:
    """Puntaje de la señal de anomalia, con los motivos que lo explican."""
    rasgos = extraer_caracteristicas(declarado, contexto, fecha_emision)
    motivos: list[MotivoAnalisis] = []

    def anotar(
        regla: str, resultado: str, mensaje: str, valor: str | float | None = None, pen: float = 0
    ) -> None:
        motivos.append(
            MotivoAnalisis(
                regla=regla,
                senal="anomalia",
                resultado=resultado,  # type: ignore[arg-type]
                mensaje=mensaje,
                valor=valor,
                penalizacion=pen,
            )
        )

    # --- Lo que el modelo no explica, lo explican estas lecturas ---

    if contexto.media_historica_categoria is None:
        anotar(
            "ano.sin_historial",
            "advertencia",
            "Aun no hay suficiente historial en esta categoria para comparar el monto.",
        )
    elif rasgos["z_categoria"] >= 2:
        anotar(
            "ano.monto_atipico",
            "falla",
            f"El monto esta {rasgos['z_categoria']:.1f} desviaciones por encima de lo habitual "
            f"en esta categoria (promedio S/ {contexto.media_historica_categoria:.2f}).",
            round(rasgos["z_categoria"], 2),
        )
    elif rasgos["z_categoria"] >= 1:
        anotar(
            "ano.monto_alto",
            "advertencia",
            "El monto esta por encima de lo habitual en esta categoria, dentro de lo razonable.",
            round(rasgos["z_categoria"], 2),
        )
    else:
        anotar("ano.monto", "ok", "El monto es coherente con el historial de la categoria.")

    if rasgos["proveedor_nuevo"]:
        anotar(
            "ano.proveedor_nuevo",
            "advertencia",
            f'"{declarado.proveedor_nombre}" no habia emitido comprobantes a esta '
            "organizacion antes.",
            declarado.proveedor_nombre,
        )
    else:
        anotar("ano.proveedor", "ok", "El proveedor ya tiene historial con la organizacion.")

    if rasgos["gastos_recientes"] >= 3:
        anotar(
            "ano.fraccionamiento",
            "advertencia",
            f"Es el gasto numero {int(rasgos['gastos_recientes']) + 1} de esta categoria en "
            "pocos dias. Conviene revisar que no sea un gasto mayor dividido en partes.",
            int(rasgos["gastos_recientes"]),
        )

    if rasgos["fraccion_saldo"] >= 0.9:
        anotar(
            "ano.consume_el_saldo",
            "advertencia",
            f"Este gasto consume el {rasgos['fraccion_saldo'] * 100:.0f} % del saldo retenido "
            "del fondo.",
            round(rasgos["fraccion_saldo"], 2),
        )

    if rasgos["dias_emision_a_gasto"] > 30:
        anotar(
            "ano.comprobante_antiguo",
            "advertencia",
            f"El comprobante se emitio {int(rasgos['dias_emision_a_gasto'])} dias antes de la "
            "fecha declarada del gasto.",
            int(rasgos["dias_emision_a_gasto"]),
        )

    # --- El puntaje: lo da el modelo si esta; si no, las lecturas ---

    puntaje_modelo = detector.puntuar(rasgos)

    if puntaje_modelo is None:
        anotar(
            "ml.isolation_forest",
            "advertencia",
            "El modelo de anomalias no esta disponible; la evaluacion usa solo las reglas "
            "de lectura.",
        )
        descuento = sum(
            {"falla": 30.0, "advertencia": 12.0}.get(m.resultado, 0.0) for m in motivos
        )
        return max(0.0, 100.0 - descuento), motivos

    if puntaje_modelo < 40:
        anotar(
            "ml.isolation_forest",
            "falla",
            "El perfil completo del gasto —monto, proveedor, frecuencia y plazos en "
            "conjunto— se aparta de lo que la organizacion suele registrar.",
            round(puntaje_modelo, 1),
        )
    elif puntaje_modelo < 65:
        anotar(
            "ml.isolation_forest",
            "advertencia",
            "El perfil del gasto se aparta algo de lo habitual en esta organizacion.",
            round(puntaje_modelo, 1),
        )
    else:
        anotar(
            "ml.isolation_forest",
            "ok",
            "El perfil del gasto es consistente con lo que la organizacion suele registrar.",
            round(puntaje_modelo, 1),
        )

    return puntaje_modelo, motivos
