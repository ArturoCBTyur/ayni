"""Prepara el reconocimiento de escena.

    python -m entrenamiento.escena --descargar   trae el modelo (una vez, ~600 MB)
    python -m entrenamiento.escena               recalcula los vectores de las frases

Aqui no se entrena nada: CLIP se usa tal como se publico. Lo que este paso
produce son los vectores de las frases de `aini.escena.ESCENAS`, que es lo
unico del modelo de texto que hace falta en produccion. Por eso el servicio
carga solo la mitad visual, y por eso `tokenizers` no esta en
requirements.txt: solo lo necesita quien cambie el catalogo.

    pip install tokenizers

Deja `modelos/escena.textos.npz` y `modelos/escena.ficha.json`, que **si** se
versionan: son pequeños y dicen con que modelo y que frases se calculo lo que
esta corriendo. Los .onnx no se versionan.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aini import escena  # noqa: E402

DIRECTORIO = escena.RUTA_VISION.parent
ARCHIVOS = {
    "vision_model.onnx": "onnx/vision_model.onnx",
    "text_model.onnx": "onnx/text_model.onnx",
    "tokenizer.json": "tokenizer.json",
}

#: CLIP lee como mucho 77 tokens, y rellena con el de fin de texto.
CONTEXTO = 77
FIN_DE_TEXTO = 49407


def _sha256(ruta: Path) -> str:
    resumen = hashlib.sha256()
    with ruta.open("rb") as archivo:
        for bloque in iter(lambda: archivo.read(1 << 20), b""):
            resumen.update(bloque)
    return resumen.hexdigest()


def descargar() -> None:
    DIRECTORIO.mkdir(parents=True, exist_ok=True)
    for nombre, ruta_remota in ARCHIVOS.items():
        destino = DIRECTORIO / nombre
        if destino.exists():
            print(f"  ya esta  {nombre}")
            continue
        url = f"https://huggingface.co/{escena.REPOSITORIO}/resolve/main/{ruta_remota}"
        print(f"  bajando  {nombre} …", flush=True)
        parcial = destino.with_suffix(destino.suffix + ".parcial")
        urllib.request.urlretrieve(url, parcial)  # noqa: S310
        parcial.replace(destino)


def vectores_de_texto() -> tuple[np.ndarray, np.ndarray]:
    """Un vector unitario por frase, y la posicion en ESCENAS de su escena."""
    import onnxruntime as ort
    from tokenizers import Tokenizer

    tokenizador = Tokenizer.from_file(str(DIRECTORIO / "tokenizer.json"))
    sesion = ort.InferenceSession(
        str(DIRECTORIO / "text_model.onnx"), providers=["CPUExecutionProvider"]
    )

    def uno(frase: str) -> np.ndarray:
        ids = tokenizador.encode(frase).ids[:CONTEXTO]
        ids = ids + [FIN_DE_TEXTO] * (CONTEXTO - len(ids))
        v = sesion.run(None, {"input_ids": np.array([ids], dtype=np.int64)})[0][0]
        return v / np.linalg.norm(v)

    vectores, escena_de_frase = [], []
    for posicion, e in enumerate(escena.ESCENAS.values()):
        for frase in e.frases:
            vectores.append(uno(frase))
            escena_de_frase.append(posicion)
    return np.array(vectores, dtype=np.float32), np.array(escena_de_frase, dtype=np.int64)


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepara el reconocimiento de escena de AIni.")
    parser.add_argument("--descargar", action="store_true", help="traer el modelo si falta")
    args = parser.parse_args()

    if args.descargar:
        descargar()

    faltan = [n for n in ARCHIVOS if not (DIRECTORIO / n).exists()]
    if faltan:
        print(f"Faltan {', '.join(faltan)} en {DIRECTORIO}. Ejecute con --descargar.")
        return 1

    vectores, escena_de_frase = vectores_de_texto()
    np.savez(
        escena.RUTA_TEXTOS,
        escenas=np.array(list(escena.ESCENAS)),
        vectores=vectores,
        escenaDeFrase=escena_de_frase,
    )

    ficha = {
        "generadoEn": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "modelo": "CLIP ViT-B/32 (OpenAI), exportado a ONNX",
        "repositorio": escena.REPOSITORIO,
        "licencia": "MIT",
        "visionSha256": _sha256(DIRECTORIO / "vision_model.onnx"),
        "textoSha256": _sha256(DIRECTORIO / "text_model.onnx"),
        "escenas": {
            clave: {
                "categorias": sorted(e.categorias),
                "ajena": e.ajena,
                "frases": list(e.frases),
            }
            for clave, e in escena.ESCENAS.items()
        },
        "advertencia": (
            "El modelo no se entreno con fotos de esta organizacion ni del Peru. Reconoce "
            "escenas genericas; lo que acierta sobre evidencias reales lo dice el banco de "
            "evaluacion, no esta ficha."
        ),
    }
    escena.RUTA_FICHA.write_text(
        json.dumps(ficha, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"{len(escena.ESCENAS)} escenas, {len(vectores)} frases -> {escena.RUTA_TEXTOS.name}, {escena.RUTA_FICHA.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
