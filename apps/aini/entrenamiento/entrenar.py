"""Entrena el detector de anomalias.

    python -m entrenamiento.entrenar              # historial sintetico
    python -m entrenamiento.entrenar --real       # tambien los gastos de la base

**La limitacion, dicha donde no se puede ignorar.** Isolation Forest aprende
que es normal a partir de ejemplos normales, y hoy la base del proyecto tiene
cuatro gastos. Con cuatro muestras un modelo no aprende nada: memoriza. Por eso
el conjunto de entrenamiento se genera aqui, con una distribucion construida a
mano a partir de lo que una ONG animalista pequeña registra de verdad.

Eso significa que **el modelo sabe reconocer lo que esta distribucion considera
raro, no lo que esta ONG considera raro**. Son cosas distintas, y la diferencia
importa: si manana la organizacion empieza a operar con montos mayores, el
modelo seguira midiendo contra una referencia inventada hasta que se reentrene
con datos reales. Con `--real` los gastos existentes se suman al conjunto, que
es el camino para que esa brecha se cierre sola con el uso.

No es un atajo ni un defecto oculto: es la practica estandar para arrancar un
detector sin historial, y queda declarado en la ficha del modelo que se guarda
junto a el.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aini.anomalia import CARACTERISTICAS, RUTA_MODELO  # noqa: E402

SEMILLA = 2026

#: Perfiles tipicos de gasto de una ONG animalista pequeña, en soles. Son los
#: ordenes de magnitud reales del dominio: alimento se compra seguido y barato,
#: una cirugia es cara y esporadica.
PERFILES = [
    # (media, desviacion, proporcion del conjunto)
    (85.0, 30.0, 0.35),    # alimento, insumos corrientes
    (150.0, 55.0, 0.30),   # consultas, medicamentos
    (320.0, 110.0, 0.20),  # procedimientos, esterilizaciones
    (700.0, 220.0, 0.15),  # cirugias, obra menor, compras grandes
]


def generar_normales(n: int, rng: np.random.Generator) -> np.ndarray:
    """Gastos que una organizacion registra en su operacion corriente."""
    filas = []
    pesos = np.array([p[2] for p in PERFILES])
    pesos = pesos / pesos.sum()

    for _ in range(n):
        media, desviacion, _ = PERFILES[rng.choice(len(PERFILES), p=pesos)]
        monto = max(10.0, rng.normal(media, desviacion))

        filas.append(
            {
                "monto": monto,
                # En operacion normal el monto ronda la media de su categoria.
                "z_categoria": rng.normal(0.0, 0.7),
                # La mayoria de compras son a proveedores ya conocidos.
                "proveedor_nuevo": float(rng.random() < 0.18),
                "gastos_recientes": float(rng.poisson(1.1)),
                # Rara vez un solo gasto consume el fondo entero.
                "fraccion_saldo": float(np.clip(rng.beta(2, 7), 0.01, 1.0)),
                # El comprobante se emite el dia del gasto o pocos dias antes.
                "dias_emision_a_gasto": float(max(0, rng.poisson(1.2))),
                # Se captura el mismo dia, o al dia siguiente si no habia red.
                "dias_gasto_a_captura": float(max(0, rng.poisson(0.4))),
            }
        )

    return np.array([[f[c] for c in CARACTERISTICAS] for f in filas], dtype=float)


def cargar_reales() -> np.ndarray | None:
    """Gastos reales de la base, si hay con que conectarse.

    Se leen por psycopg solo si esta instalado y hay DATABASE_URL. No es un
    requisito: el objetivo es que el entrenamiento funcione en una maquina
    limpia, y que sumar datos reales sea una mejora opcional.
    """
    url = os.environ.get("DATABASE_URL")
    if not url:
        return None

    try:
        import psycopg
    except ImportError:
        print("  (psycopg no esta instalado; se omiten los gastos reales)")
        return None

    consulta = """
        SELECT g.monto_declarado::float8                                   AS monto,
               COALESCE(f.saldo_retenido, 0)::float8                       AS saldo,
               (SELECT COUNT(*) FROM comprobantes c2
                  JOIN gastos g2 ON g2.id = c2.gasto_id
                 WHERE g2.ong_id = g.ong_id
                   AND c2.ruc_emisor = c.ruc_emisor
                   AND g2.creado_en < g.creado_en)                         AS veces_proveedor,
               GREATEST(0, DATE_PART('day', g.fecha_gasto - c.fecha_emision)) AS dias_emision,
               GREATEST(0, DATE_PART('day', COALESCE(g.capturado_en, g.fecha_gasto) - g.fecha_gasto)) AS dias_captura
          FROM gastos g
          JOIN fondos f       ON f.id = g.fondo_id
          LEFT JOIN comprobantes c ON c.gasto_id = g.id
         WHERE g.estado = 'APROBADO'
    """

    try:
        with psycopg.connect(url) as conexion, conexion.cursor() as cursor:
            cursor.execute(consulta)
            filas = cursor.fetchall()
    except Exception as error:  # noqa: BLE001
        print(f"  (no se pudo leer la base: {error})")
        return None

    if not filas:
        return None

    montos = [f[0] for f in filas]
    media = float(np.mean(montos))
    desviacion = float(np.std(montos)) or 1.0

    datos = []
    for monto, saldo, veces, dias_emision, dias_captura in filas:
        datos.append(
            {
                "monto": float(monto),
                "z_categoria": (float(monto) - media) / desviacion,
                "proveedor_nuevo": 0.0 if veces else 1.0,
                "gastos_recientes": 0.0,
                "fraccion_saldo": float(min(monto / saldo, 2.0)) if saldo > 0 else 1.0,
                "dias_emision_a_gasto": float(dias_emision or 0),
                "dias_gasto_a_captura": float(dias_captura or 0),
            }
        )

    return np.array([[d[c] for c in CARACTERISTICAS] for d in datos], dtype=float)


def main() -> int:
    parser = argparse.ArgumentParser(description="Entrena el detector de anomalias de AIni.")
    parser.add_argument("--n", type=int, default=600, help="gastos sinteticos (por defecto 600)")
    parser.add_argument("--real", action="store_true", help="sumar los gastos aprobados de la base")
    args = parser.parse_args()

    rng = np.random.default_rng(SEMILLA)

    print(f"Generando {args.n} gastos sinteticos...")
    X = generar_normales(args.n, rng)
    sinteticos = len(X)
    reales = 0

    if args.real:
        print("Leyendo gastos aprobados de la base...")
        datos_reales = cargar_reales()
        if datos_reales is not None and len(datos_reales):
            reales = len(datos_reales)
            X = np.vstack([X, datos_reales])
            print(f"  {reales} gastos reales incorporados")
        else:
            print("  sin gastos reales utilizables")

    # contamination al 4 %: se asume que el conjunto de entrenamiento es casi
    # todo normal. Subirlo haria que el modelo marcara operacion corriente.
    pipeline = Pipeline(
        [
            ("escala", StandardScaler()),
            (
                "bosque",
                IsolationForest(
                    n_estimators=200,
                    contamination=0.04,
                    random_state=SEMILLA,
                    n_jobs=-1,
                ),
            ),
        ]
    )

    print(f"Entrenando Isolation Forest sobre {len(X)} muestras y {len(CARACTERISTICAS)} caracteristicas...")
    pipeline.fit(X)

    puntajes = pipeline.score_samples(X)
    print(f"  score_samples: min={puntajes.min():.3f} media={puntajes.mean():.3f} max={puntajes.max():.3f}")

    RUTA_MODELO.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "pipeline": pipeline,
            "entrenado_con": int(len(X)),
            "caracteristicas": list(CARACTERISTICAS),
        },
        RUTA_MODELO,
    )

    # Ficha del modelo, junto al modelo. Que un artefacto entrenado viaje sin
    # decir con que se entreno es como un comprobante sin emisor.
    ficha = {
        "generadoEn": datetime.now(timezone.utc).isoformat(),
        "algoritmo": "IsolationForest",
        "caracteristicas": list(CARACTERISTICAS),
        "muestras": {"sinteticas": sinteticos, "reales": reales, "total": int(len(X))},
        "semilla": SEMILLA,
        "contaminacion": 0.04,
        "advertencia": (
            "El conjunto es mayoritariamente sintetico. El modelo reconoce lo que esta "
            "distribucion considera raro, no lo que esta organizacion considera raro. "
            "Reentrenar con --real a medida que se acumulen gastos aprobados."
        ),
    }
    (RUTA_MODELO.parent / "anomalia.ficha.json").write_text(
        json.dumps(ficha, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"\nModelo guardado en {RUTA_MODELO}")
    print(f"Ficha en {RUTA_MODELO.parent / 'anomalia.ficha.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
