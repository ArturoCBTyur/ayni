"""Reconocimiento de escena: ¿la evidencia muestra algo que tenga que ver con el gasto?

Es la unica parte de la señal visual con aprendizaje automatico. Nitidez,
resolucion, EXIF y huella perceptual miden que la foto sea **utilizable y
nueva**; ninguna mira que retrata. Una foto nitida, nueva y tomada el dia del
gasto pasa todas esas comprobaciones aunque sea de un almuerzo.

**Modelo.** CLIP ViT-B/32 (OpenAI, licencia MIT) exportado a ONNX. Corre en el
mismo onnxruntime que ya trae el lector de comprobantes, sin dependencia nueva
y sin que la foto salga del servidor: unos 90 ms por imagen en CPU.

**Como se usa.** CLIP proyecta imagenes y frases al mismo espacio. Cada escena
de `ESCENAS` se describe con varias frases; la foto reparte su probabilidad
entre todas las frases y la de una escena es la suma de las suyas. Las frases
estan en ingles porque el modelo se entreno en ingles, y son **fijas**: no se
le pasa el concepto que escribio el operador. Dos consecuencias, las dos
buscadas:

- En produccion solo se carga la mitad visual del modelo. Los vectores de las
  frases se calculan una vez (`python -m entrenamiento.escena`) y se versionan
  junto a su ficha, igual que el detector de anomalias.
- Lo que se compara es la foto contra un catalogo cerrado y medido
  (`python -m evaluacion --solo escena`), no contra texto libre que nadie
  evaluo.

**Que decide y que no.** Solo penaliza cuando la foto muestra, con claridad,
algo ajeno a cualquier gasto de la organizacion: una oficina, un restaurante,
un paisaje, una captura de pantalla. Que la foto sea de otra categoria del
propio rescate (alimento en un gasto de transporte) se anota sin restar: es
frecuente fotografiar al animal y no la compra, y castigarlo seria castigar la
costumbre. Y no poder decidir no es una discrepancia, igual que en el lector.
"""

from __future__ import annotations

import io
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

log = logging.getLogger("aini.escena")

ACTIVO = os.environ.get("AINI_ESCENA", "1") not in ("0", "false", "no")

DIRECTORIO = Path(__file__).resolve().parent.parent / "modelos"
RUTA_VISION = DIRECTORIO / "escena" / "vision_model.onnx"
RUTA_TEXTOS = DIRECTORIO / "escena.textos.npz"
RUTA_FICHA = DIRECTORIO / "escena.ficha.json"

#: De donde sale el modelo. Lo usa `entrenamiento.escena --descargar`.
REPOSITORIO = "Xenova/clip-vit-base-patch32"

LADO = 224
_MEDIA = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
_DESVIO = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

#: Temperatura con la que CLIP se entreno: convierte similitudes en
#: probabilidades. No es un parametro a ajustar.
ESCALA = 100.0


@dataclass(frozen=True)
class Escena:
    #: Como se nombra en un mensaje: "La evidencia parece mostrar ___".
    nombre: str
    #: Categorias de gasto que esta escena respalda. Vacio con `ajena=False`
    #: es una escena neutra: no respalda ni contradice.
    categorias: frozenset[str]
    frases: tuple[str, ...]
    ajena: bool = False


def _e(nombre: str, categorias: str, *frases: str, ajena: bool = False) -> Escena:
    return Escena(nombre, frozenset(categorias.split()), frases, ajena)


#: El catalogo. Las categorias son las del backend (`enum CategoriaGasto`).
#: Cambiar una frase cambia los vectores: hay que volver a correr
#: `python -m entrenamiento.escena` y `python -m evaluacion --solo escena`.
ESCENAS: dict[str, Escena] = {
    "veterinaria": _e(
        "una atencion veterinaria",
        "ATENCION_VETERINARIA ESTERILIZACION MEDICAMENTOS INSUMOS",
        "a veterinarian examining a dog",
        "a veterinarian examining a cat on a table",
        "an animal being treated at a veterinary clinic",
        "a dog receiving a vaccine injection",
    ),
    "cirugia": _e(
        "una cirugia veterinaria",
        "ESTERILIZACION ATENCION_VETERINARIA INSUMOS",
        "veterinary surgeons operating on an animal",
        "a dog under anesthesia on a surgery table",
        "a cat being spayed in an operating room",
    ),
    "alimento": _e(
        "alimento para animales",
        "ALIMENTOS",
        "bags of dog food",
        "a bowl of pet food kibble",
        "dogs eating from bowls",
        "sacks of animal feed",
    ),
    "medicamento": _e(
        "medicamentos",
        "MEDICAMENTOS ATENCION_VETERINARIA INSUMOS ESTERILIZACION",
        "medicine bottles and pills",
        "vials of veterinary medicine and vaccines",
        "boxes of medication on a table",
    ),
    "insumos": _e(
        "insumos o materiales",
        "INSUMOS MEDICAMENTOS ATENCION_VETERINARIA ESTERILIZACION",
        "syringes and medical supplies",
        "a package of surgical gloves",
        "a roll of gauze bandage",
        "dog leashes and collars",
        "a pet carrier crate",
        "boxes of supplies",
    ),
    "transporte": _e(
        "un vehiculo o un traslado",
        "TRANSPORTE",
        "a car or pickup truck on the road",
        "a dog inside a car",
        "animals in crates loaded in a van",
        "a motorcycle taxi",
        "a gas station fuel pump",
        "people loading or unloading a truck",
    ),
    "albergue": _e(
        "un albergue de animales",
        "INFRAESTRUCTURA",
        "dog kennels in an animal shelter",
        "dogs in cages at a shelter",
        "a dog house in a yard",
    ),
    "obra": _e(
        "una obra o materiales de construccion",
        "INFRAESTRUCTURA",
        "a construction site",
        "workers repairing a roof",
        "building materials: bricks, cement and roof tiles",
    ),
    "animal": _e(
        "un animal",
        "",
        "a photo of a dog",
        "a photo of a cat",
        "a stray dog on the street",
        "rescued puppies",
    ),
    "rescate": _e(
        "una labor de rescate",
        "",
        "a rescue worker carrying an animal",
        "volunteers helping animals",
    ),
    "oficina": _e(
        "una oficina",
        "",
        "an office with desks and computers",
        "a person working at a laptop",
        "a meeting in a conference room",
        ajena=True,
    ),
    "comida": _e(
        "una comida o un restaurante",
        "",
        "people eating at a restaurant",
        "a plate of food for people",
        "drinks on a bar table",
        "the dining room of a restaurant",
        "tables and chairs on a terrace",
        ajena=True,
    ),
    "paisaje": _e(
        "un paisaje",
        "",
        "a landscape with mountains",
        "a beach",
        "a city skyline",
        "a scenic tourist view",
        "a sunset over the sea",
        ajena=True,
    ),
    "personas": _e(
        "un grupo de personas",
        "",
        "a group of people posing for a photo",
        "a selfie",
        "people at a party",
        "a crowd of people at an event",
        "an old black and white group portrait",
        ajena=True,
    ),
    "pantalla": _e(
        "una captura de pantalla o un grafico",
        "",
        "a screenshot of a computer screen",
        "a chart or diagram",
        "an abstract pattern of colored squares",
        ajena=True,
    ),
    "documento": _e(
        "un documento o un comprobante",
        "",
        "a photo of a paper receipt",
        "a printed invoice document",
        "a handwritten letter on paper",
        ajena=True,
    ),
}

#: Probabilidad conjunta de las escenas ajenas a partir de la cual se advierte.
#: Sobre el conjunto de ajuste el resultado es el mismo entre 0,50 y 0,70
#: (ninguna foto relacionada acusada); desde 0,80 empiezan a pasar ajenas. Se
#: toma el extremo prudente del tramo estable. Ver evaluacion/README.md.
UMBRAL_AJENA = 0.70

#: Probabilidad conjunta de las escenas que respaldan la categoria a partir de
#: la cual se dice que la foto corresponde.
UMBRAL_PROPIA = 0.50


@dataclass
class Lectura:
    """Lo que el modelo vio en una foto."""

    #: Probabilidad de cada escena del catalogo; suman 1.
    probabilidades: dict[str, float]

    @property
    def principal(self) -> str:
        return max(self.probabilidades, key=self.probabilidades.__getitem__)

    @property
    def ajena(self) -> float:
        return sum(p for e, p in self.probabilidades.items() if ESCENAS[e].ajena)

    def propia(self, categoria: str) -> float:
        return sum(
            p for e, p in self.probabilidades.items() if categoria in ESCENAS[e].categorias
        )

    @property
    def escena_ajena_principal(self) -> str:
        ajenas = {e: p for e, p in self.probabilidades.items() if ESCENAS[e].ajena}
        return max(ajenas, key=ajenas.__getitem__)


# --------------------------------------------------------------------------
# Modelo
# --------------------------------------------------------------------------

_sesion = None
#: Vector de cada frase y a que escena (por posicion en ESCENAS) pertenece.
_textos: tuple[np.ndarray, np.ndarray] | None = None
_intentado = False


def _cargar() -> bool:
    """Carga perezosa. False si falta el modelo o sus vectores: la señal se
    degrada, no tumba la verificacion (mismo criterio que el detector)."""
    global _sesion, _textos, _intentado
    if _sesion is not None:
        return True
    if _intentado:
        return False
    _intentado = True

    if not RUTA_VISION.exists() or not RUTA_TEXTOS.exists():
        log.warning(
            "Sin modelo de escena (%s). La evidencia no se reconoce. Ejecute: "
            "python -m entrenamiento.escena --descargar",
            RUTA_VISION if not RUTA_VISION.exists() else RUTA_TEXTOS,
        )
        return False

    datos = np.load(RUTA_TEXTOS)
    escenas = [str(e) for e in datos["escenas"]]
    if escenas != list(ESCENAS):
        log.warning(
            "Los vectores de %s no corresponden al catalogo de escenas. Ejecute: "
            "python -m entrenamiento.escena",
            RUTA_TEXTOS.name,
        )
        return False

    try:
        import onnxruntime as ort

        opciones = ort.SessionOptions()
        opciones.log_severity_level = 3
        _sesion = ort.InferenceSession(
            str(RUTA_VISION), opciones, providers=["CPUExecutionProvider"]
        )
    except Exception as error:  # noqa: BLE001
        log.warning("No se pudo cargar el modelo de escena: %s", error)
        return False

    _textos = (datos["vectores"].astype(np.float32), datos["escenaDeFrase"].astype(np.int64))
    return True


def disponible() -> bool:
    return ACTIVO and _cargar()


def ficha() -> dict | None:
    if not RUTA_FICHA.exists():
        return None
    return json.loads(RUTA_FICHA.read_text(encoding="utf-8"))


def preparar(imagen: bytes | str | Path) -> np.ndarray | None:
    """La imagen como la espera CLIP: lado menor a 224, recorte central,
    normalizada. None si el archivo no es una imagen que Pillow abra."""
    from PIL import Image, ImageOps

    try:
        origen = io.BytesIO(imagen) if isinstance(imagen, bytes) else imagen
        with Image.open(origen) as im:
            # Sin esto, una foto de celular en vertical entra acostada.
            im = ImageOps.exif_transpose(im).convert("RGB")
            ancho, alto = im.size
            factor = LADO / min(ancho, alto)
            im = im.resize(
                (max(LADO, round(ancho * factor)), max(LADO, round(alto * factor))),
                Image.BICUBIC,
            )
            ancho, alto = im.size
            izq, arr = (ancho - LADO) // 2, (alto - LADO) // 2
            im = im.crop((izq, arr, izq + LADO, arr + LADO))
            pixeles = np.asarray(im, dtype=np.float32) / 255.0
    except Exception as error:  # noqa: BLE001
        log.info("La evidencia no se pudo abrir como imagen: %s", error)
        return None
    return ((pixeles - _MEDIA) / _DESVIO).transpose(2, 0, 1)[None]


def vector(imagen: bytes | str | Path) -> np.ndarray | None:
    """Vector unitario de la imagen, o None si no hay modelo o no es imagen."""
    if not disponible():
        return None
    entrada = preparar(imagen)
    if entrada is None:
        return None
    salida = _sesion.run(None, {"pixel_values": entrada})[0][0]
    return salida / np.linalg.norm(salida)


def clasificar(
    vector_imagen: np.ndarray, textos: tuple[np.ndarray, np.ndarray] | None = None
) -> Lectura:
    """Reparte la foto entre las escenas del catalogo.

    La probabilidad se reparte entre **frases** y la de cada escena es la suma
    de las suyas. Promediar antes los vectores de una escena se midio y es
    peor: una escena que junta cosas distintas ("caniles" y "una obra") queda
    representada por un punto intermedio que no describe ninguna y que atrae
    cualquier exterior con una estructura. Sobre las ajenas del conjunto de
    ajuste, con el promedio pasaban 6 de 21 y con la suma 4.
    """
    vectores, escena_de_frase = textos if textos is not None else _textos  # type: ignore[misc]
    logits = ESCALA * (vectores @ vector_imagen)
    p = np.exp(logits - logits.max())
    p /= p.sum()
    por_escena = np.bincount(escena_de_frase, weights=p, minlength=len(ESCENAS))
    return Lectura({e: float(v) for e, v in zip(ESCENAS, por_escena)})


def mirar(imagen: bytes | str | Path) -> Lectura | None:
    v = vector(imagen)
    return None if v is None else clasificar(v)


def mirar_desde(url: str) -> Lectura | None:
    """Descarga la evidencia y la mira; None si cualquier paso falla."""
    if not disponible():
        return None
    from . import ocr

    datos = ocr.descargar(url)
    return mirar(datos) if datos else None
