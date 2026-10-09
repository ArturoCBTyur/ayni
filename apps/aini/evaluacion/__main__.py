"""Evaluacion de AIni contra bancos etiquetados.

    python -m evaluacion                      todo lo disponible, y lo imprime
    python -m evaluacion --solo conceptos     solo el banco de conceptos (rapido)
    python -m evaluacion --solo ocr           solo los comprobantes
    python -m evaluacion --detalle            ademas, los casos que fallan
    python -m evaluacion --guardar            escribe linea_base.json
    python -m evaluacion --comparar           falla si algo empeoro

No reemplaza a `pytest pruebas/`. Las pruebas fijan comportamiento que no
puede cambiar; esto mide **cuanto acierta**, que es lo que cada mejora tiene
que mover en la direccion correcta. Sin esta cifra, "el OCR mejoro" es una
impresion.

Codigos de salida de --comparar:
    0  nada empeoro
    1  alguna metrica empeoro mas alla de la tolerancia
    2  el banco cambio de tamaño: la comparacion no seria justa. Regenerar la
       linea base con --guardar en el mismo commit que amplia el banco.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from aini import anomalia, documental, motor, ocr  # noqa: E402
from evaluacion import comprobantes, conceptos  # noqa: E402

RUTA_LINEA_BASE = Path(__file__).resolve().parent / "linea_base.json"

#: Margen antes de dar algo por empeorado. Un punto porcentual evita fallar
#: por un caso que cambia de lado por redondeo, sin dejar pasar una regresion.
TOLERANCIA = 0.01

#: Que metricas se comparan y en que direccion es mejor. Las que no estan
#: aqui (tiempos, percentiles) se guardan para contexto pero no deciden.
MAYOR_ES_MEJOR = {
    "cobertura",
    "aciertaCategoriaTop1",
    "detectaMontoAlterado",
    "correcto",
}
MENOR_ES_MEJOR = {
    "rechazaCorrectos",
    "aceptaEquivocados",
    "pasaSinAdvertirEquivocados",
    "discrepanciasFalsas",
    "incorrecto",
}

GRIS, VERDE, AMBAR, ROJO, FIN = "\033[90m", "\033[32m", "\033[33m", "\033[31m", "\033[0m"


# --------------------------------------------------------------------------
# Identidad de lo que se midio
# --------------------------------------------------------------------------


def _sha_corto(datos: bytes) -> str:
    return hashlib.sha256(datos).hexdigest()[:12]


def _version(paquete: str) -> str | None:
    try:
        return metadata.version(paquete)
    except metadata.PackageNotFoundError:
        return None


def identidad() -> dict:
    """Con que se midio. La RN-06 pide saber que evaluo cada gasto; la linea
    base tiene que poder decir lo mismo de si misma."""
    modelo = anomalia.RUTA_MODELO
    return {
        "versionMotor": motor.VERSION,
        "modeloAnomaliaSha256": _sha_corto(modelo.read_bytes()) if modelo.exists() else None,
        "descripcionesCategoriaSha256": _sha_corto(
            json.dumps(documental.DESCRIPCION_CATEGORIA, sort_keys=True).encode()
        ),
        "umbrales": {
            "coherencia": documental.UMBRAL_COHERENCIA,
            "coherenciaDudosa": documental.UMBRAL_COHERENCIA_DUDOSA,
            "confianzaOcr": ocr.CONFIANZA_MINIMA,
        },
        "modeloLenguaje": f"{documental.MODELO_SPACY}@{documental.nlp().meta.get('version')}",
        "paquetes": {
            p: _version(p) for p in ("spacy", "rapidocr-onnxruntime", "onnxruntime", "scikit-learn")
        },
        "plataforma": f"{platform.system()} / Python {platform.python_version()}",
    }


# --------------------------------------------------------------------------
# Impresion
# --------------------------------------------------------------------------


def _pct(valor: float | None) -> str:
    return "   —  " if valor is None else f"{valor * 100:5.1f} %"


def imprimir_conceptos(m: dict, detalle: dict, ver_detalle: bool) -> None:
    n = m["n"]
    print(
        f"\nCoherencia concepto / categoria  "
        f"{GRIS}({n['conceptos']} conceptos, {m['paresAjenosMedidos'] + m['paresAjenosNoMedibles']} "
        f"pares ajenos, {m['paresAjenosNoMedibles']} sin medir){FIN}"
    )
    print(f"  cobertura (se pudo medir)       {_pct(m['cobertura'])}")
    if m["noMediblesPorCategoria"]:
        print(f"    {AMBAR}sin medir:{FIN} " + ", ".join(
            f"{c} {k}" for c, k in m["noMediblesPorCategoria"].items()
        ))
    print(f"  rechaza correctos               {_pct(m['rechazaCorrectos'])}")
    print(f"  advierte correctos              {_pct(m['advierteCorrectos'])}")
    print(f"  acepta equivocados              {_pct(m['aceptaEquivocados'])}")
    print(f"  pasa sin advertir equivocados   {_pct(m['pasaSinAdvertirEquivocados'])}")
    print(f"  acierta la categoria (top-1)    {_pct(m['aciertaCategoriaTop1'])}")
    s = m["similitud"]
    print(
        f"  {GRIS}similitud: propios mediana {s['propiosMediana']} p5 {s['propiosP5']} · "
        f"ajenos mediana {s['ajenosMediana']} p95 {s['ajenosP95']}{FIN}"
    )

    cat = m["categorias"]
    if cat["delBackendSinDescripcion"]:
        print(
            f"  {ROJO}categorias del backend que AIni no sabe medir:{FIN} "
            + ", ".join(cat["delBackendSinDescripcion"])
        )
    if cat["descritasQueElBackendNoUsa"]:
        print(
            f"  {AMBAR}descritas en AIni pero que el backend no envia:{FIN} "
            + ", ".join(cat["descritasQueElBackendNoUsa"])
        )

    palabras = [p for p, _ in detalle["sinVector"]]
    print(f"  palabras sin vector ({len(palabras)}): {GRIS}{', '.join(palabras[:15])}"
          f"{' …' if len(palabras) > 15 else ''}{FIN}")
    huecas = {c: p for c, p in detalle["descripcionesSinVector"].items() if p}
    if huecas:
        print(f"  {AMBAR}palabras de las descripciones sin vector:{FIN} "
              + "; ".join(f"{c}: {', '.join(p)}" for c, p in huecas.items()))

    if ver_detalle:
        print(f"\n  {ROJO}Correctos rechazados{FIN}")
        for concepto, categoria, sim in detalle["rechazados"]:
            print(f"    {sim:.3f}  {concepto}  {GRIS}[{categoria}]{FIN}")
        print(f"\n  {ROJO}Equivocados aceptados{FIN} {GRIS}(los 25 mas parecidos){FIN}")
        for concepto, categoria, sim in detalle["aceptados"][:25]:
            valor = "  —  " if sim is None else f"{sim:.3f}"
            print(f"    {valor}  {concepto}  {GRIS}-> {categoria}{FIN}")


def imprimir_ocr(titulo: str, m: dict, resultados, ver_detalle: bool) -> None:
    print(f"\n{titulo}  {GRIS}({m['n']} comprobantes){FIN}")
    print(f"  {'campo':<16} {'correcto':>9} {'no leido':>9} {'INCORRECTO':>11}")
    for nombre, c in m["campos"].items():
        color = ROJO if (c["incorrecto"] or 0) > 0 else ""
        print(
            f"  {nombre:<16} {_pct(c['correcto']):>9} {_pct(c['no_leido']):>9} "
            f"{color}{_pct(c['incorrecto']):>11}{FIN if color else ''}"
        )
    print(f"  discrepancias falsas            {_pct(m['discrepanciasFalsas'])}"
          f"  {GRIS}(tecleo bien y el cotejo dijo que no){FIN}")
    print(f"  detecta monto alterado (+S/ {comprobantes.ALTERACION_TOTAL:.0f})  "
          f"{_pct(m['detectaMontoAlterado'])}")
    print(f"  {GRIS}total correcto por condicion: " + ", ".join(
        f"{c} {_pct(v).strip()}" for c, v in m["totalCorrectoPorCondicion"].items()
    ) + FIN)
    print(f"  {GRIS}segundos por comprobante: p50 {m['segundos']['p50']} · p95 {m['segundos']['p95']}{FIN}")

    if ver_detalle:
        print()
        for r in resultados:
            malos = {k: v for k, v in r.campos.items() if v != "correcto"}
            if not malos and not r.discrepancia_falsa and r.detecta_monto_alterado:
                continue
            partes = [f"{k}={v}" for k, v in malos.items()]
            if r.discrepancia_falsa:
                partes.append(f"{ROJO}discrepancia falsa: {', '.join(r.discrepancia_falsa)}{FIN}")
            if not r.detecta_monto_alterado:
                partes.append("no detecta el monto alterado")
            print(f"    {r.caso.id:<34} {'; '.join(partes)}")


# --------------------------------------------------------------------------
# Comparacion
# --------------------------------------------------------------------------


def _hojas(d: dict, prefijo: str = ""):
    """Recorre el diccionario y devuelve (ruta, clave_final, valor) numericos."""
    for clave, valor in d.items():
        ruta = f"{prefijo}.{clave}" if prefijo else clave
        if isinstance(valor, dict):
            yield from _hojas(valor, ruta)
        elif isinstance(valor, (int, float)) and not isinstance(valor, bool):
            yield ruta, clave, valor


def comparar(actual: dict, base: dict) -> int:
    peor = 0
    for seccion, metricas in actual.items():
        if seccion not in base:
            print(f"\n{AMBAR}{seccion}: no hay linea base; nada que comparar.{FIN}")
            continue
        anterior = base[seccion]
        if metricas.get("n") != anterior.get("n"):
            print(
                f"\n{AMBAR}{seccion}: el banco cambio ({anterior.get('n')} -> {metricas.get('n')}). "
                f"Regenere la linea base con --guardar en el mismo commit.{FIN}"
            )
            peor = max(peor, 2)
            continue

        valores_base = {ruta: v for ruta, _, v in _hojas(anterior)}
        empeoradas, mejoradas = [], []
        for ruta, clave, valor in _hojas(metricas):
            previo = valores_base.get(ruta)
            if previo is None:
                continue
            if clave in MAYOR_ES_MEJOR:
                delta = valor - previo
            elif clave in MENOR_ES_MEJOR:
                delta = previo - valor
            else:
                continue
            if delta < -TOLERANCIA:
                empeoradas.append((ruta, previo, valor))
            elif delta > TOLERANCIA:
                mejoradas.append((ruta, previo, valor))

        print(f"\n{seccion}: ", end="")
        if not empeoradas and not mejoradas:
            print(f"{VERDE}igual que la linea base{FIN}")
        else:
            print()
        for ruta, previo, valor in mejoradas:
            print(f"  {VERDE}mejora{FIN}  {ruta}: {_pct(previo).strip()} -> {_pct(valor).strip()}")
        for ruta, previo, valor in empeoradas:
            print(f"  {ROJO}EMPEORA{FIN} {ruta}: {_pct(previo).strip()} -> {_pct(valor).strip()}")
        if empeoradas:
            peor = max(peor, 1)
    return peor


# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Evalua AIni contra bancos etiquetados.")
    parser.add_argument("--solo", choices=("conceptos", "ocr"))
    parser.add_argument("--detalle", action="store_true", help="listar los casos que fallan")
    parser.add_argument("--guardar", action="store_true", help="escribir linea_base.json")
    parser.add_argument("--comparar", action="store_true", help="comparar contra linea_base.json")
    args = parser.parse_args()

    print(f"{GRIS}Cargando modelo de lenguaje…{FIN}")
    ident = identidad()
    print(f"{GRIS}{ident['versionMotor']} · {ident['modeloLenguaje']} · {ident['plataforma']}{FIN}")

    actual: dict[str, dict] = {}

    if args.solo in (None, "conceptos"):
        banco = conceptos.cargar()
        metricas, detalle = conceptos.evaluar(banco)
        actual["conceptos"] = metricas
        imprimir_conceptos(metricas, detalle, args.detalle)

    if args.solo in (None, "ocr"):
        if not ocr.ACTIVO:
            print(f"\n{AMBAR}El lector esta apagado (AINI_OCR=0); se omiten los comprobantes.{FIN}")
        else:
            print(f"\n{GRIS}Leyendo comprobantes (unos segundos cada uno)…{FIN}")
            sinteticos = [comprobantes.medir(c) for c in comprobantes.banco_sintetico()]
            actual["ocrSintetico"] = comprobantes.resumir(sinteticos)
            imprimir_ocr("Lector · banco sintetico", actual["ocrSintetico"], sinteticos, args.detalle)

            campo, omitidos = comprobantes.banco_campo()
            if campo:
                reales = [comprobantes.medir(c) for c in campo]
                actual["ocrCampo"] = comprobantes.resumir(reales)
                imprimir_ocr("Lector · banco de campo", actual["ocrCampo"], reales, args.detalle)
            else:
                print(f"\n{GRIS}Banco de campo vacio: aun no hay fotos reales en evaluacion/campo/.{FIN}")
            for o in omitidos:
                print(f"  {AMBAR}omitido{FIN} {o}")

    codigo = 0
    if args.comparar:
        if not RUTA_LINEA_BASE.exists():
            print(f"\n{ROJO}No existe {RUTA_LINEA_BASE.name}. Genere una con --guardar.{FIN}")
            return 2
        base = json.loads(RUTA_LINEA_BASE.read_text(encoding="utf-8"))
        if base.get("identidad", {}).get("plataforma", "").split(" /")[0] != platform.system():
            print(
                f"\n{GRIS}La linea base se midio en otra plataforma; las cifras del lector pueden "
                f"variar por las fuentes y por onnxruntime.{FIN}"
            )
        codigo = comparar(actual, base.get("metricas", {}))

    if args.guardar:
        # Se conservan las secciones que no se midieron en esta corrida: guardar
        # solo conceptos no debe borrar la linea base del lector.
        previa = (
            json.loads(RUTA_LINEA_BASE.read_text(encoding="utf-8"))
            if RUTA_LINEA_BASE.exists()
            else {}
        )
        contenido = {
            "generadaEn": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "identidad": ident,
            "metricas": {**previa.get("metricas", {}), **actual},
        }
        RUTA_LINEA_BASE.write_text(
            json.dumps(contenido, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"\n{VERDE}Linea base guardada en {RUTA_LINEA_BASE}{FIN}")

    return codigo


if __name__ == "__main__":
    raise SystemExit(main())
