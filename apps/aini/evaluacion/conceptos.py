"""Evaluacion de la coherencia concepto / categoria sobre el banco etiquetado.

Lee `conceptos.csv` y mide la señal tal como corre en produccion, llamando a
`documental.coherencia_concepto_categoria`. No copia su logica: si la copiara,
mediria otra cosa que la que decide los gastos.

Dos clases de pares:

- **Propios**: cada concepto contra su categoria. Lo que importa es cuantos
  rechaza (cae bajo `UMBRAL_COHERENCIA` y resta puntos a un gasto legitimo).
- **Ajenos**: cada concepto contra las demas categorias, mas los pares que el
  banco marca explicitamente con `corresponde=no`. Lo que importa es cuantos
  acepta (no llegan a "falla", asi que el desvio pasa sin penalizacion). Un
  par contra una categoria que AIni no sabe medir **cuenta como aceptado**,
  porque eso es lo que pasa en produccion: "no se pudo evaluar" no resta.

Se excluyen como ajenas las categorias de `alternativas` --un gasto de
esterilizacion cargado al fondo veterinario no es un desvio-- y la categoria
OTROS, a la que por definicion puede ir casi cualquier cosa.
"""

from __future__ import annotations

import csv
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from aini import documental

RUTA_BANCO = Path(__file__).resolve().parent / "conceptos.csv"
RUTA_ESQUEMA = Path(__file__).resolve().parents[2] / "api" / "prisma" / "schema.prisma"

#: Categoria comodin: no se usa como destino de un par ajeno.
COMODIN = "OTROS"


@dataclass
class Concepto:
    concepto: str
    categoria: str
    corresponde: bool
    alternativas: frozenset[str]
    origen: str


def cargar(ruta: Path = RUTA_BANCO) -> list[Concepto]:
    with ruta.open(encoding="utf-8", newline="") as archivo:
        return [
            Concepto(
                concepto=fila["concepto"].strip(),
                categoria=fila["categoria"].strip().upper(),
                corresponde=fila["corresponde"].strip().lower() == "si",
                alternativas=frozenset(a for a in fila["alternativas"].upper().split("|") if a),
                origen=fila["origen"].strip(),
            )
            for fila in csv.DictReader(archivo)
        ]


def categorias_del_backend() -> list[str] | None:
    """Las categorias que el backend envia de verdad, leidas del esquema.

    Se leen del esquema de Prisma en vez de copiarlas, para que la evaluacion
    note sola cuando el backend y AIni dejan de hablar de lo mismo.
    """
    if not RUTA_ESQUEMA.exists():
        return None
    texto = RUTA_ESQUEMA.read_text(encoding="utf-8")
    bloque = re.search(r"enum\s+CategoriaGasto\s*\{([^}]*)\}", texto)
    if not bloque:
        return None
    return re.findall(r"^\s*([A-Z_]+)\s*$", bloque.group(1), re.MULTILINE)


def _palabras_sin_vector(texto: str) -> list[str]:
    """Palabras de contenido que el modelo de lenguaje no conoce en ninguna forma.

    Son las que `documental` descarta en silencio, y cuando la que falta es la
    que define el gasto, la similitud se calcula con lo que sobra. Se pregunta
    a `documental._vector`, que prueba la palabra con y sin tilde: si no, una
    palabra que el motor si usa apareceria aqui como desconocida.
    """
    return [
        token.text
        for token in documental.nlp()(documental._con_terminos_del_dominio(texto))
        if token.pos_ in ("NOUN", "VERB", "ADJ", "PROPN")
        and not token.is_stop
        and not token.is_digit
        and documental._vector(token.text) is None
    ]


def _fraccion(parte: int, total: int) -> float | None:
    return round(parte / total, 4) if total else None


def _percentil(valores: list[float], p: float) -> float | None:
    return round(float(np.percentile(valores, p)), 3) if valores else None


def evaluar(banco: list[Concepto]) -> tuple[dict, dict]:
    """Metricas comparables y el detalle de los casos, por separado.

    Las metricas van a la linea base; el detalle solo se imprime, porque una
    lista de conceptos en el JSON haria ruido en cada diff.
    """
    categorias = sorted({c.categoria for c in banco})
    medibles = [c for c in categorias if c in documental.DESCRIPCION_CATEGORIA]

    umbral = documental.UMBRAL_COHERENCIA
    dudoso = documental.UMBRAL_COHERENCIA_DUDOSA

    propios: list[tuple[Concepto, float]] = []
    no_medibles: Counter[str] = Counter()
    ajenos: list[tuple[str, str, float | None]] = []
    top1_aciertos = 0
    top1_total = 0

    positivos = [c for c in banco if c.corresponde]
    for c in positivos:
        sim = documental.coherencia_concepto_categoria(c.concepto, c.categoria)
        if sim is None:
            no_medibles[c.categoria] += 1
        else:
            propios.append((c, sim))

        # Contra las demas categorias, que es lo que pasaria si el gasto se
        # cargara a otro fondo. Tambien contra las que AIni no sabe medir: si
        # se dejaran fuera, un desvio hacia ellas no contaria en ningun lado.
        por_categoria: dict[str, float] = {}
        for otra in categorias:
            s = documental.coherencia_concepto_categoria(c.concepto, otra)
            if s is not None:
                por_categoria[otra] = s
            if otra != c.categoria and otra not in c.alternativas and otra != COMODIN:
                ajenos.append((c.concepto, otra, s))

        # ¿La categoria correcta es la que mas se le parece? Solo se puede
        # preguntar si AIni sabe medir la correcta.
        if c.categoria in medibles and por_categoria:
            top1_total += 1
            mejor = max(por_categoria, key=por_categoria.__getitem__)
            if mejor == c.categoria or mejor in c.alternativas:
                top1_aciertos += 1

    for c in banco:
        if c.corresponde:
            continue
        sim = documental.coherencia_concepto_categoria(c.concepto, c.categoria)
        ajenos.append((c.concepto, c.categoria, sim))

    sims_propios = [s for _, s in propios]
    sims_ajenos = [s for _, _, s in ajenos if s is not None]

    rechazados = [(c.concepto, c.categoria, s) for c, s in propios if s < umbral]

    # Por origen, para medir aparte lo que no motivo un cambio: los conceptos
    # "control-*" se escriben antes del cambio que van a evaluar.
    por_origen: dict[str, list[bool]] = {}
    for c, s in propios:
        por_origen.setdefault(c.origen, []).append(s < umbral)
    advertidos = [(c.concepto, c.categoria, s) for c, s in propios if umbral <= s < dudoso]
    aceptados = [(con, cat, s) for con, cat, s in ajenos if s is None or s >= umbral]
    limpios = [(con, cat, s) for con, cat, s in ajenos if s is not None and s >= dudoso]

    sin_vector: Counter[str] = Counter()
    for c in positivos:
        sin_vector.update(_palabras_sin_vector(c.concepto))

    backend = categorias_del_backend()
    descritas = set(documental.DESCRIPCION_CATEGORIA)

    metricas = {
        "n": {
            "conceptos": len(positivos),
            "paresAjenosExplicitos": sum(1 for c in banco if not c.corresponde),
        },
        # Fraccion de gastos legitimos para los que la señal produce un numero.
        "cobertura": _fraccion(len(propios), len(positivos)),
        "noMediblesPorCategoria": dict(sorted(no_medibles.items())),
        "rechazaCorrectos": _fraccion(len(rechazados), len(propios)),
        "advierteCorrectos": _fraccion(len(advertidos), len(propios)),
        "rechazaCorrectosPorOrigen": {
            origen: _fraccion(sum(v), len(v)) for origen, v in sorted(por_origen.items())
        },
        "aceptaEquivocados": _fraccion(len(aceptados), len(ajenos)),
        "pasaSinAdvertirEquivocados": _fraccion(len(limpios), len(ajenos)),
        "aciertaCategoriaTop1": _fraccion(top1_aciertos, top1_total),
        "similitud": {
            "propiosMediana": _percentil(sims_propios, 50),
            "propiosP5": _percentil(sims_propios, 5),
            "ajenosMediana": _percentil(sims_ajenos, 50),
            "ajenosP95": _percentil(sims_ajenos, 95),
        },
        "paresAjenosMedidos": len(sims_ajenos),
        "paresAjenosNoMedibles": len(ajenos) - len(sims_ajenos),
        "palabrasSinVectorDistintas": len(sin_vector),
        "categorias": {
            "delBackendSinDescripcion": sorted(set(backend) - descritas) if backend else None,
            "descritasQueElBackendNoUsa": sorted(descritas - set(backend)) if backend else None,
        },
    }

    detalle = {
        "rechazados": sorted(rechazados, key=lambda t: t[2]),
        # Los no medibles al final: son muchos y todos iguales.
        "aceptados": sorted(aceptados, key=lambda t: -(t[2] if t[2] is not None else -1)),
        "sinVector": sin_vector.most_common(),
        "descripcionesSinVector": {
            cat: _palabras_sin_vector(desc) for cat, desc in documental.DESCRIPCION_CATEGORIA.items()
        },
    }
    return metricas, detalle
