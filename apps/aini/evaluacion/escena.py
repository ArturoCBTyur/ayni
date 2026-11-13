"""Banco de escenas: fotos etiquetadas para medir el reconocimiento de escena.

    python -m evaluacion.escena --descargar     trae las fotos del manifiesto
    python -m evaluacion --solo escena          mide

`escena.jsonl` es el manifiesto, y es lo que se versiona: una linea por foto
con su etiqueta, de donde salio, su autor, su licencia y su hash. Las fotos
viven en `evaluacion/escena/`, fuera de git, y se pueden volver a traer.

Cada linea dice dos cosas de la foto, las dos puestas por una persona mirando
la imagen y **no** por el nombre de la busqueda que la encontro:

- `ajena`: si no muestra nada que una organizacion de rescate animal
  presentaria como evidencia de un gasto.
- `categorias`: de que categorias de gasto seria evidencia legitima. Vacio en
  una foto no ajena es un animal sin contexto: no contradice ningun gasto y no
  respalda ninguno en particular.

`conjunto` separa las fotos con las que se ajustaron las frases y los umbrales
(`ajuste`) de las que se apartaron antes de ajustar nada (`control`). La cifra
que vale es la del control: sobre el ajuste, el catalogo ya vio las respuestas.

Las fotos son de Wikimedia Commons, con licencia libre. **No son evidencias de
esta organizacion**: estan mejor encuadradas e iluminadas que una foto tomada
con prisa en Huanuco. Miden si el catalogo distingue escenas, no cuanto
acertara en produccion. Para eso hacen falta evidencias reales, que se suman
igual que en el banco de campo: una linea con `origen: "campo"`, sin `url`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aini import escena  # noqa: E402

RUTA_MANIFIESTO = Path(__file__).resolve().parent / "escena.jsonl"
DIRECTORIO = Path(__file__).resolve().parent / "escena"

#: Wikimedia pide identificarse y no ir rapido. Nombre generico, sin datos de
#: quien corre el script.
AGENTE = {"User-Agent": "banco-evaluacion-escena/0.1 (script academico)"}
PAUSA = 2.0


@dataclass
class Foto:
    archivo: str
    ajena: bool
    categorias: list[str]
    conjunto: str
    sha256: str
    url: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def ruta(self) -> Path:
        return DIRECTORIO / self.archivo


def manifiesto() -> list[Foto]:
    fotos = []
    for linea in RUTA_MANIFIESTO.read_text(encoding="utf-8").splitlines():
        if not linea.strip():
            continue
        d = json.loads(linea)
        fotos.append(
            Foto(
                archivo=d.pop("archivo"),
                ajena=d.pop("ajena"),
                categorias=d.pop("categorias"),
                conjunto=d.pop("conjunto"),
                sha256=d.pop("sha256"),
                url=d.pop("url", ""),
                extra=d,
            )
        )
    return fotos


def _sha256(ruta: Path) -> str:
    return hashlib.sha256(ruta.read_bytes()).hexdigest()


def cargar() -> tuple[list[Foto], list[str]]:
    """Las fotos presentes y con el hash del manifiesto, y las omitidas."""
    presentes, omitidas = [], []
    if not RUTA_MANIFIESTO.exists():
        return presentes, omitidas
    for foto in manifiesto():
        if not foto.ruta.exists():
            omitidas.append(f"{foto.archivo}: falta el archivo")
        elif _sha256(foto.ruta) != foto.sha256:
            omitidas.append(f"{foto.archivo}: el hash no coincide con el manifiesto")
        else:
            presentes.append(foto)
    return presentes, omitidas


# --------------------------------------------------------------------------
# Medicion
# --------------------------------------------------------------------------


def _tasa(aciertos: int, total: int) -> float | None:
    return round(aciertos / total, 4) if total else None


def _resumir(casos: list[tuple[Foto, escena.Lectura]]) -> dict:
    ajenas = [(f, l) for f, l in casos if f.ajena]
    relacionadas = [(f, l) for f, l in casos if not f.ajena]
    con_categoria = [(f, l) for f, l in relacionadas if f.categorias]

    return {
        "n": {
            "fotos": len(casos),
            "ajenas": len(ajenas),
            "relacionadas": len(relacionadas),
        },
        # Lo que la señal existe para ver.
        "detectaAjenas": _tasa(
            sum(l.ajena >= escena.UMBRAL_AJENA for _, l in ajenas), len(ajenas)
        ),
        # Lo que mas cuesta: una foto legitima que recibe la advertencia y
        # saca al gasto de la aprobacion automatica.
        "acusaRelacionadas": _tasa(
            sum(l.ajena >= escena.UMBRAL_AJENA for _, l in relacionadas), len(relacionadas)
        ),
        # Informativo: no resta puntos, pero es lo que el mensaje afirma.
        "reconoceCategoria": _tasa(
            sum(
                any(l.propia(c) >= escena.UMBRAL_PROPIA for c in f.categorias)
                for f, l in con_categoria
            ),
            len(con_categoria),
        ),
    }


def evaluar(fotos: list[Foto]) -> tuple[dict, list[dict]]:
    """Metricas por conjunto y el detalle foto por foto."""
    casos: list[tuple[Foto, escena.Lectura]] = []
    tiempos = []
    for foto in fotos:
        inicio = time.perf_counter()
        lectura = escena.mirar(foto.ruta)
        tiempos.append(time.perf_counter() - inicio)
        if lectura is not None:
            casos.append((foto, lectura))

    metricas: dict = {"n": {}}
    for conjunto in sorted({f.conjunto for f, _ in casos}):
        resumen = _resumir([c for c in casos if c[0].conjunto == conjunto])
        # `n` va arriba porque es lo que `--comparar` mira para saber si el
        # banco cambio de tamaño.
        metricas["n"][conjunto] = resumen.pop("n")
        metricas[conjunto] = resumen
    # La primera foto paga la carga del modelo: la mediana no la ve.
    metricas["segundosPorFoto"] = round(statistics.median(tiempos), 3) if tiempos else None

    detalle = []
    for foto, lectura in casos:
        acusada = lectura.ajena >= escena.UMBRAL_AJENA
        reconocida = any(lectura.propia(c) >= escena.UMBRAL_PROPIA for c in foto.categorias)
        if foto.ajena:
            falla = None if acusada else "ajena que pasa"
        elif acusada:
            falla = "relacionada que se acusa"
        elif foto.categorias and not reconocida:
            falla = "categoria no reconocida"
        else:
            falla = None
        detalle.append(
            {
                "archivo": foto.archivo,
                "conjunto": foto.conjunto,
                "falla": falla,
                "principal": lectura.principal,
                "ajena": round(lectura.ajena, 3),
            }
        )
    return metricas, detalle


# --------------------------------------------------------------------------
# Descarga
# --------------------------------------------------------------------------


def _pedir(url: str) -> bytes:
    espera = 5.0
    for _ in range(6):
        try:
            peticion = urllib.request.Request(url, headers=AGENTE)
            with urllib.request.urlopen(peticion, timeout=40) as respuesta:  # noqa: S310
                return respuesta.read()
        except urllib.error.HTTPError as error:
            if error.code != 429:
                raise
            time.sleep(espera)
            espera *= 2
    raise RuntimeError("el servidor sigue pidiendo esperar (429)")


def descargar() -> int:
    DIRECTORIO.mkdir(exist_ok=True)
    fallas = 0
    for foto in manifiesto():
        if foto.ruta.exists() and _sha256(foto.ruta) == foto.sha256:
            continue
        if not foto.url:
            print(f"  sin url   {foto.archivo} (foto de campo: se copia a mano)")
            continue
        try:
            datos = _pedir(foto.url)
        except Exception as error:  # noqa: BLE001
            print(f"  fallo     {foto.archivo}: {error}")
            fallas += 1
            continue
        if hashlib.sha256(datos).hexdigest() != foto.sha256:
            # Commons regenera las miniaturas de vez en cuando. La foto es la
            # misma pero el archivo no, y medir con otro archivo no es medir
            # lo mismo: se avisa en vez de aceptarlo en silencio.
            print(f"  distinta  {foto.archivo}: el archivo cambio en el origen")
            fallas += 1
            continue
        foto.ruta.write_bytes(datos)
        print(f"  bajada    {foto.archivo}", flush=True)
        time.sleep(PAUSA)
    return 1 if fallas else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Banco de escenas de AIni.")
    parser.add_argument("--descargar", action="store_true")
    if parser.parse_args().descargar:
        raise SystemExit(descargar())
    presentes, omitidas = cargar()
    print(f"{len(presentes)} fotos presentes, {len(omitidas)} omitidas")
