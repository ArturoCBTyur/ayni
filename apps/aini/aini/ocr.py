"""Lectura del comprobante: de la foto a los campos.

Es la unica parte de AIni que mira el archivo y no los metadatos. Hasta aqui el
sistema confiaba en lo que el operador tecleo; con esto puede **contrastarlo
contra lo que el comprobante dice**, que es una diferencia de fondo: una cosa
es validar que un RUC este bien formado y otra comprobar que sea el RUC que
aparece impreso en el papel.

Que detecta, y que no. Detecta transcripciones equivocadas --el digito que se
copio mal, el total que se tecleo de otra linea-- y comprobantes que no
corresponden al gasto declarado. **No detecta un comprobante falsificado**: si
el papel miente, el OCR lee la mentira con toda fidelidad. Para eso esta la
consulta a SUNAT, que esta version no hace.

Sobre la calidad. Medido sobre un comprobante impreso limpio, extrae RUC, serie
y numero aunque la foto este desenfocada, a mitad de tamaño, inclinada siete
grados, oscura o con poco contraste. Sobre papel termico arrugado con brillos
--que es lo que de verdad llega de campo-- no esta medido, y conviene no
afirmar lo que no se probo: por eso, cuando un campo no se puede leer con
confianza, se reporta como no leido en vez de adivinarlo.
"""

from __future__ import annotations

import logging
import os
import re
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime

log = logging.getLogger("aini.ocr")

#: Confianza minima de RapidOCR para tomar un fragmento en serio.
CONFIANZA_MINIMA = 0.70

#: Leer el comprobante cuesta unos 2,5 s por gasto. Se puede apagar en
#: entornos donde ese tiempo importe mas que la verificacion contra el papel.
ACTIVO = os.environ.get("AINI_OCR", "1") not in ("0", "false", "no")

#: Un comprobante no deberia pesar mas que esto. El limite evita que una URL
#: equivocada ponga a descargar algo enorme dentro del analisis.
MAXIMO_BYTES = 15 * 1024 * 1024
SEGUNDOS_DESCARGA = 10

_lector = None


def lector():
    """Carga perezosa del modelo de OCR, que pesa y tarda en inicializar."""
    global _lector
    if _lector is None:
        from rapidocr_onnxruntime import RapidOCR

        _lector = RapidOCR()
    return _lector


@dataclass
class CamposLeidos:
    """Lo que se pudo leer del comprobante. None es "no se pudo", no "cero"."""

    ruc_emisor: str | None = None
    serie: str | None = None
    numero: str | None = None
    fecha_emision: date | None = None
    subtotal: float | None = None
    igv: float | None = None
    total: float | None = None

    #: Texto crudo, para poder auditar que vio el OCR si algo sale raro.
    texto: str = ""
    #: Confianza media de los fragmentos aprovechados.
    confianza: float = 0.0

    @property
    def leyo_algo(self) -> bool:
        return any(
            (self.ruc_emisor, self.serie, self.numero, self.fecha_emision, self.total)
        )


# --------------------------------------------------------------------------
# Extraccion
# --------------------------------------------------------------------------

#: El OCR junta las palabras sin espacios ("RUC:20601030579"), asi que los
#: patrones no pueden apoyarse en separadores.
_RUC = re.compile(r"RUC\D{0,3}(\d{11})", re.IGNORECASE)
_RUC_SUELTO = re.compile(r"\b((?:10|15|17|20)\d{9})\b")
_SERIE_NUMERO = re.compile(r"\b([BFEbfe]\d{3})\D{0,2}(\d{1,8})\b")
_FECHA = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](20\d{2})\b")
_IMPORTE = r"(\d{1,3}(?:[,\s]\d{3})*\.\d{2}|\d+\.\d{2})"


def _a_numero(texto: str) -> float | None:
    try:
        return float(texto.replace(",", "").replace(" ", ""))
    except ValueError:
        return None


def _importe_tras(etiquetas: tuple[str, ...], texto: str) -> float | None:
    """Primer importe que aparece despues de alguna de estas etiquetas.

    Se busca por etiqueta y no por posicion porque el orden de las lineas
    cambia entre formatos de comprobante, pero la palabra "TOTAL" siempre
    precede a su monto.
    """
    for etiqueta in etiquetas:
        # Separador no codicioso y acotado, en vez de "solo caracteres no
        # numericos": entre la etiqueta y su monto suele haber digitos que no
        # son el monto, como en "IGV (18%): S/ 18.00". Exigir que no los
        # hubiera hacia que el IGV no se leyera nunca.
        patron = re.compile(etiqueta + r".{0,20}?" + _IMPORTE, re.IGNORECASE)
        encontrado = patron.search(texto)
        if encontrado:
            return _a_numero(encontrado.group(1))
    return None


def extraer(texto: str) -> CamposLeidos:
    """Campos del comprobante a partir del texto que devolvio el OCR."""
    campos = CamposLeidos(texto=texto)

    coincidencia = _RUC.search(texto) or _RUC_SUELTO.search(texto)
    if coincidencia:
        campos.ruc_emisor = coincidencia.group(1)

    coincidencia = _SERIE_NUMERO.search(texto)
    if coincidencia:
        campos.serie = coincidencia.group(1).upper()
        # El numero se imprime con ceros a la izquierda y el sistema lo guarda
        # igual; se conserva tal cual para poder compararlo.
        campos.numero = coincidencia.group(2)

    coincidencia = _FECHA.search(texto)
    if coincidencia:
        dia, mes, anio = (int(g) for g in coincidencia.groups())
        try:
            campos.fecha_emision = date(anio, mes, dia)
        except ValueError:
            # 32/13/2026 y companía: se descarta en vez de corregir a ciegas.
            pass

    campos.total = _importe_tras(("IMPORTE\\s*TOTAL", "TOTAL\\s*A\\s*PAGAR", "TOTAL"), texto)
    campos.igv = _importe_tras(("IGV", "I\\.G\\.V"), texto)
    campos.subtotal = _importe_tras(
        ("OP\\.?\\s*GRAVADA", "SUB\\s*TOTAL", "SUBTOTAL", "VALOR\\s*VENTA"), texto
    )

    return campos


def descargar(url: str) -> bytes | None:
    """Trae el archivo del comprobante desde su URL firmada.

    Devuelve None ante cualquier problema --URL relativa, servidor caido,
    archivo enorme-- porque ninguno de esos casos justifica detener el
    analisis: el gasto se evalua igual con lo declarado y el motivo lo dice.
    """
    if not url.lower().startswith(("http://", "https://")):
        log.info("archivoUrl no es absoluta, no se puede descargar: %s", url[:80])
        return None

    try:
        with urllib.request.urlopen(url, timeout=SEGUNDOS_DESCARGA) as respuesta:  # noqa: S310
            datos = respuesta.read(MAXIMO_BYTES + 1)
    except Exception as error:  # noqa: BLE001
        log.warning("No se pudo descargar el comprobante: %s", error)
        return None

    if len(datos) > MAXIMO_BYTES:
        log.warning("El comprobante supera %d bytes; no se lee.", MAXIMO_BYTES)
        return None
    return datos


def leer_desde(url: str) -> CamposLeidos | None:
    """Descarga y lee, o None si cualquiera de los dos pasos falla."""
    if not ACTIVO:
        return None
    datos = descargar(url)
    return leer(datos) if datos else None


def leer(imagen: bytes | str) -> CamposLeidos | None:
    """Corre el OCR sobre una imagen y extrae los campos.

    Devuelve None si el OCR no pudo procesar el archivo. Que falle no puede
    tumbar el analisis: el gasto se sigue evaluando con lo declarado, y el
    motivo lo dice.
    """
    try:
        resultado, _ = lector()(imagen)
    except Exception as error:  # noqa: BLE001
        log.warning("El OCR no pudo procesar la imagen: %s", error)
        return None

    if not resultado:
        return CamposLeidos(texto="", confianza=0.0)

    fragmentos = [(t, float(c)) for _, t, c in resultado if float(c) >= CONFIANZA_MINIMA]
    if not fragmentos:
        return CamposLeidos(texto="", confianza=0.0)

    texto = " ".join(t for t, _ in fragmentos)
    campos = extraer(texto)
    campos.confianza = sum(c for _, c in fragmentos) / len(fragmentos)
    return campos
