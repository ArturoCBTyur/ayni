"""Evaluacion del lector de comprobantes y del cotejo.

Dos bancos con la misma medicion:

- **Sintetico**: boletas dibujadas aqui mismo, con el formato de las peruanas,
  y degradadas o variadas a proposito. Se generan en cada corrida en vez de
  versionar imagenes, igual que `pruebas/test_ocr.py`. Incluye a proposito
  formatos que el lector todavia no reconoce (etiqueta "SUBTOTAL", serie
  "FA01", fecha "14-SEP-2026"): la linea base tiene que mostrar donde falla,
  no solo donde acierta.

- **Campo**: fotos reales anotadas a mano en `campo.jsonl`. Las imagenes viven
  en `campo/`, que NO se versiona: una boleta trae el nombre y a veces el DNI
  del cliente (Ley N.o 29733). Si una imagen falta o su hash no coincide con la
  anotacion, el caso se omite y se dice.

**Lo sintetico es mas facil que lo real**, y conviene no olvidarlo al leer las
cifras: son boletas nitidas degradadas por filtros, no papel termico arrugado.
La cifra que vale para produccion es la del banco de campo.

Cada campo se clasifica en tres resultados y no en dos, porque no cuestan lo
mismo: **no leido** no penaliza a nadie; **incorrecto** produce una
discrepancia falsa y una alerta que la ONG lee.
"""

from __future__ import annotations

import hashlib
import io
import json
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from aini import cotejo, ocr
from aini.contrato import Comprobante

CARPETA = Path(__file__).resolve().parent
RUTA_CAMPO = CARPETA / "campo.jsonl"
CARPETA_CAMPO = CARPETA / "campo"

CAMPOS = ("ruc_emisor", "serie", "numero", "fecha_emision", "subtotal", "igv", "total")

#: Cuanto se altera el total en el escenario "el operador tecleo otro monto".
#: Es el caso del guion: S/ 27 que el papel no respalda.
ALTERACION_TOTAL = 27.0


@dataclass
class Verdad:
    """Lo que dice el papel, anotado por una persona.

    None es "no esta impreso": una boleta de talonario no desglosa el IGV y un
    ticket puede no traer serie. Si el lector no lo lee, cuenta como no leido;
    si lee algo, como incorrecto, porque lo invento.
    """

    tipo: str = "BOLETA"
    ruc_emisor: str = "20601030579"
    serie: str | None = "B001"
    numero: str | None = "004521"
    fecha_emision: date = date(2026, 9, 14)
    subtotal: float | None = 100.0
    igv: float | None = 18.0
    total: float = 118.0


@dataclass
class Caso:
    id: str
    condiciones: list[str]
    verdad: Verdad
    #: Bytes de la imagen; se generan o se leen del disco.
    imagen: Callable[[], bytes]
    origen: str = "sintetico"


# --------------------------------------------------------------------------
# Banco sintetico
# --------------------------------------------------------------------------


def _fuente(tam: int, negrita: bool):
    for nombre in (("arialbd.ttf" if negrita else "arial.ttf"), "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(nombre, tam)
        except OSError:
            continue
    return ImageFont.load_default()


@dataclass
class Formato:
    """Lo que cambia de un emisor a otro, aunque el comprobante sea el mismo."""

    titulo: str = "BOLETA DE VENTA ELECTRONICA"
    etiqueta_subtotal: str = "OP. GRAVADA"
    etiqueta_total: str = "IMPORTE TOTAL"
    fecha: str | None = None
    cliente: list[str] = field(default_factory=lambda: ["Cliente: HUELLAS DEL ANDE"])
    miles: bool = False


def _monto(valor: float, miles: bool) -> str:
    return f"{valor:,.2f}" if miles else f"{valor:.2f}"


def dibujar(v: Verdad, f: Formato) -> Image.Image:
    fecha = f.fecha or v.fecha_emision.strftime("%d/%m/%Y")
    lineas = [
        ("CLINICA VETERINARIA SAN ROQUE S.A.C.", 26, True),
        ("Av. Alameda 456 - Amarilis, Huanuco", 18, False),
        (f"RUC: {v.ruc_emisor}", 24, True),
        ("", 10, False),
        (f.titulo, 22, True),
        (f"{v.serie}-{v.numero}", 26, True),
        ("", 10, False),
        (f"Fecha de emision: {fecha}", 19, False),
        *[(texto, 19, False) for texto in f.cliente],
        ("", 14, False),
        ("Descripcion            Cant   Importe", 18, False),
        (f"Consulta veterinaria      1   {_monto(v.subtotal, f.miles)}", 18, False),
        ("", 14, False),
        (f"{f.etiqueta_subtotal}:      S/   {_monto(v.subtotal, f.miles)}", 20, False),
        (f"IGV (18%):          S/    {_monto(v.igv, f.miles)}", 20, False),
        (f"{f.etiqueta_total}:      S/   {_monto(v.total, f.miles)}", 24, True),
    ]
    img = Image.new("RGB", (620, 800), "white")
    dibujo = ImageDraw.Draw(img)
    y = 30
    for texto, tam, negrita in lineas:
        if texto:
            dibujo.text((40, y), texto, fill="black", font=_fuente(tam, negrita))
        y += tam + 12
    return img


def _jpeg(img: Image.Image, calidad: int = 90) -> bytes:
    salida = io.BytesIO()
    img.convert("RGB").save(salida, format="JPEG", quality=calidad)
    return salida.getvalue()


def _escala(factor: float) -> Callable[[Image.Image], Image.Image]:
    return lambda i: i.resize((int(i.width * factor), int(i.height * factor)), Image.LANCZOS)


def _coeficientes_perspectiva(origen, destino) -> list[float]:
    """Coeficientes de `Image.transform` que llevan `destino` a `origen`."""
    matriz = []
    for (x, y), (u, v) in zip(destino, origen):
        matriz.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        matriz.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    b = np.array(origen, dtype=float).reshape(8)
    return list(np.linalg.solve(np.array(matriz, dtype=float), b))


def _perspectiva(i: Image.Image) -> Image.Image:
    """Como una foto tomada de pie, con el celular inclinado hacia la mesa."""
    w, h = i.size
    origen = [(0, 0), (w, 0), (w, h), (0, h)]
    destino = [(w * 0.08, h * 0.04), (w * 0.92, 0), (w, h), (0, h * 0.97)]
    coef = _coeficientes_perspectiva(origen, destino)
    return i.transform(i.size, Image.PERSPECTIVE, coef, Image.BICUBIC, fillcolor="white")


def _ruido(i: Image.Image) -> Image.Image:
    rng = np.random.default_rng(2026)
    datos = np.asarray(i.convert("RGB"), dtype=float)
    datos += rng.normal(0, 18, datos.shape)
    return Image.fromarray(np.clip(datos, 0, 255).astype(np.uint8))


def _sombra(i: Image.Image) -> Image.Image:
    """La sombra de la mano o del celular sobre la mitad del papel."""
    datos = np.asarray(i.convert("RGB"), dtype=float)
    gradiente = np.linspace(0.35, 1.0, datos.shape[1])[None, :, None]
    return Image.fromarray(np.clip(datos * gradiente, 0, 255).astype(np.uint8))


def _sintetico(
    id: str,
    condiciones: list[str],
    verdad: Verdad | None = None,
    formato: Formato | None = None,
    transformar: Callable[[Image.Image], Image.Image] | None = None,
    calidad: int = 90,
) -> Caso:
    v = verdad or Verdad()
    f = formato or Formato()

    def imagen() -> bytes:
        img = dibujar(v, f)
        if transformar:
            img = transformar(img)
        return _jpeg(img, calidad)

    return Caso(id=id, condiciones=condiciones, verdad=v, imagen=imagen)


FACTURA = Formato(
    titulo="FACTURA ELECTRONICA",
    cliente=["Senor(es): ASOCIACION HUELLAS DEL ANDE", "RUC: 20609876540"],
)


def banco_sintetico() -> list[Caso]:
    return [
        _sintetico("s01-limpia", ["limpia"]),
        _sintetico("s02-borrosa", ["borrosa"], transformar=lambda i: i.filter(ImageFilter.GaussianBlur(1.2))),
        _sintetico("s03-mitad", ["baja_resolucion"], transformar=_escala(0.5)),
        _sintetico("s04-tercio", ["baja_resolucion"], transformar=_escala(0.33)),
        _sintetico(
            "s05-inclinada",
            ["inclinada"],
            transformar=lambda i: i.rotate(7, expand=True, fillcolor="white"),
        ),
        _sintetico("s06-perspectiva", ["perspectiva"], transformar=_perspectiva),
        _sintetico(
            "s07-oscura", ["oscura"], transformar=lambda i: ImageEnhance.Brightness(i).enhance(0.45)
        ),
        _sintetico(
            "s08-contraste",
            ["contraste_bajo"],
            transformar=lambda i: ImageEnhance.Contrast(i).enhance(0.35),
        ),
        _sintetico("s09-sombra", ["sombra"], transformar=_sombra),
        _sintetico("s10-ruido", ["ruido", "compresion"], transformar=_ruido, calidad=25),
        _sintetico(
            "s11-subtotal-total",
            ["etiquetas_alternativas"],
            formato=Formato(etiqueta_subtotal="SUBTOTAL", etiqueta_total="TOTAL"),
        ),
        _sintetico(
            "s12-total-a-pagar",
            ["etiquetas_alternativas"],
            formato=Formato(etiqueta_subtotal="SUB TOTAL", etiqueta_total="TOTAL A PAGAR"),
        ),
        _sintetico(
            "s13-factura",
            ["factura"],
            verdad=Verdad(tipo="FACTURA", serie="F001", numero="000187"),
            formato=FACTURA,
        ),
        _sintetico(
            "s14-factura-serie-alfanumerica",
            ["factura", "serie_alfanumerica"],
            verdad=Verdad(tipo="FACTURA", serie="FA01", numero="000187"),
            formato=FACTURA,
        ),
        _sintetico(
            "s15-boleta-portal-sunat",
            ["serie_alfanumerica"],
            verdad=Verdad(serie="EB01", numero="12"),
        ),
        _sintetico("s16-fecha-textual", ["fecha_textual"], formato=Formato(fecha="14-SEP-2026")),
        _sintetico("s17-fecha-iso", ["fecha_iso"], formato=Formato(fecha="2026-09-14")),
        _sintetico(
            "s18-montos-con-miles",
            ["montos_grandes"],
            verdad=Verdad(subtotal=1250.0, igv=225.0, total=1475.0),
            formato=Formato(miles=True),
        ),
    ]


# --------------------------------------------------------------------------
# Banco de campo
# --------------------------------------------------------------------------


def banco_campo() -> tuple[list[Caso], list[str]]:
    """Los casos reales disponibles en esta maquina, y los que se omitieron."""
    if not RUTA_CAMPO.exists():
        return [], []

    casos: list[Caso] = []
    omitidos: list[str] = []
    for numero, linea in enumerate(RUTA_CAMPO.read_text(encoding="utf-8").splitlines(), 1):
        linea = linea.strip()
        if not linea or linea.startswith("#"):
            continue
        a = json.loads(linea)
        ruta = CARPETA_CAMPO / a["archivo"]
        if not ruta.exists():
            omitidos.append(f"{a['id']}: falta {ruta.name}")
            continue
        datos = ruta.read_bytes()
        if hashlib.sha256(datos).hexdigest() != a["sha256"]:
            omitidos.append(f"{a['id']}: el hash no coincide con la anotacion (linea {numero})")
            continue

        verdad = Verdad(
            tipo=a["tipo"],
            ruc_emisor=a["ruc_emisor"],
            serie=a["serie"],
            numero=a["numero"],
            fecha_emision=date.fromisoformat(a["fecha_emision"]),
            subtotal=None if a["subtotal"] is None else float(a["subtotal"]),
            igv=None if a["igv"] is None else float(a["igv"]),
            total=float(a["total"]),
        )
        casos.append(
            Caso(
                id=a["id"],
                condiciones=list(a.get("condiciones", [])),
                verdad=verdad,
                imagen=lambda d=datos: d,
                origen="campo",
            )
        )
    return casos, omitidos


# --------------------------------------------------------------------------
# Medicion
# --------------------------------------------------------------------------


def _resultado_campo(nombre: str, leido: ocr.CamposLeidos | None, v: Verdad) -> str:
    """'correcto', 'no_leido' o 'incorrecto' para un campo."""
    valor = getattr(leido, nombre) if leido else None
    if valor is None:
        return "no_leido"
    esperado = getattr(v, nombre)
    if esperado is None:
        return "incorrecto"
    if nombre == "numero":
        acierta = valor.lstrip("0") == esperado.lstrip("0")
    elif nombre == "serie":
        acierta = valor.upper() == esperado.upper()
    elif isinstance(esperado, float):
        acierta = abs(valor - esperado) < 0.005
    else:
        acierta = valor == esperado
    return "correcto" if acierta else "incorrecto"


def _declarado(v: Verdad, delta_total: float = 0.0) -> Comprobante:
    """Lo que habria tecleado el operador: el papel, salvo `delta_total`."""
    total = round(v.total + delta_total, 2)
    # Sin desglose impreso, el operador lo calcula del total.
    desglosar = delta_total or v.subtotal is None or v.igv is None
    subtotal = round(total / 1.18, 2) if desglosar else v.subtotal
    return Comprobante(
        tipo=v.tipo,
        ruc_emisor=v.ruc_emisor,
        serie=v.serie or "",
        numero=v.numero or "",
        fecha_emision=v.fecha_emision.isoformat(),
        subtotal=subtotal,
        igv=round(total - subtotal, 2) if desglosar else v.igv,
        total=total,
        moneda="PEN",
        hash_sha256="0" * 64,
        archivo_url="/evaluacion",
    )


@dataclass
class ResultadoCaso:
    caso: Caso
    campos: dict[str, str]
    #: El operador tecleo lo mismo que el papel y el cotejo dijo que no.
    discrepancia_falsa: list[str]
    #: El operador tecleo otro total y el cotejo lo vio, sin alertar tambien
    #: cuando tecleo el correcto.
    detecta_monto_alterado: bool
    segundos: float


def medir(caso: Caso) -> ResultadoCaso:
    imagen = caso.imagen()
    inicio = time.perf_counter()
    leido = ocr.leer(imagen)
    segundos = time.perf_counter() - inicio

    campos = {nombre: _resultado_campo(nombre, leido, caso.verdad) for nombre in CAMPOS}

    motivos, _ = cotejo.evaluar(_declarado(caso.verdad), leido)
    falsas = [m.regla for m in motivos if m.resultado == "falla"]

    # Solo cuenta si el cotejo distingue: alerta con el monto alterado y NO con
    # el correcto. Un total mal leido "detecta" cualquier cosa que se teclee,
    # y eso no es deteccion, es ruido.
    motivos_alterado, _ = cotejo.evaluar(_declarado(caso.verdad, ALTERACION_TOTAL), leido)
    detecta = "ocr.total_discrepa" not in falsas and any(
        m.regla == "ocr.total_discrepa" and m.resultado == "falla" for m in motivos_alterado
    )

    return ResultadoCaso(caso, campos, falsas, detecta, segundos)


def _fraccion(parte: int, total: int) -> float | None:
    return round(parte / total, 4) if total else None


def resumir(resultados: list[ResultadoCaso]) -> dict:
    n = len(resultados)
    por_campo = {}
    for nombre in CAMPOS:
        cuenta = Counter(r.campos[nombre] for r in resultados)
        por_campo[nombre] = {
            clase: _fraccion(cuenta[clase], n) for clase in ("correcto", "no_leido", "incorrecto")
        }

    # El total por condicion: es el campo que mueve dinero, y la condicion es
    # lo que dice por donde empezar a mejorar.
    total_por_condicion: dict[str, list[str]] = defaultdict(list)
    for r in resultados:
        for condicion in r.caso.condiciones:
            total_por_condicion[condicion].append(r.campos["total"])

    tiempos = [r.segundos for r in resultados]
    return {
        "n": n,
        "campos": por_campo,
        "discrepanciasFalsas": _fraccion(sum(1 for r in resultados if r.discrepancia_falsa), n),
        "detectaMontoAlterado": _fraccion(sum(1 for r in resultados if r.detecta_monto_alterado), n),
        "totalCorrectoPorCondicion": {
            c: _fraccion(v.count("correcto"), len(v)) for c, v in sorted(total_por_condicion.items())
        },
        # Informativo: depende de la maquina, no se compara.
        "segundos": {
            "p50": round(float(np.percentile(tiempos, 50)), 2) if tiempos else None,
            "p95": round(float(np.percentile(tiempos, 95)), 2) if tiempos else None,
        },
    }
