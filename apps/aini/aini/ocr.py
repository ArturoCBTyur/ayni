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
import math
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

    #: El total no se leyo de su linea sino que se sumo de subtotal e IGV
    #: impresos. El cotejo lo dice en el mensaje, para que nadie crea que se
    #: leyo una cifra que en realidad se calculo.
    total_deducido: bool = False

    #: Contenido del QR de SUNAT, si se pudo decodificar. Cuando esta, sus
    #: campos mandan sobre los leidos del texto (ver `aplicar_qr`).
    qr: str = ""

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
#: Las boletas de talonario usan serie solo numerica ("001-Nº 0000418"). Se
#: exige el "Nº" entre ambas porque sin el, "261-0675" --un telefono-- tendria
#: la misma forma. Si el OCR lee el "º" como un cero, el numero gana un cero a
#: la izquierda, que el cotejo ya ignora.
_SERIE_NUMERO_TALONARIO = re.compile(r"(?<!\d)(\d{3,4})\s?-\s?N\s?[°º.oO]?\s?(\d{4,8})(?!\d)")
#: Tres formas de imprimir la misma fecha: 14/09/2026, 2026-09-14 y
#: 14-SEP-2026. El espacio opcional tras cada separador es porque el OCR parte
#: la fecha cuando el papel la corta en dos lineas ("2020-10- 12").
#:
#: El OCR tambien la pega a lo que la rodea: "FECHA26/11/202018:45:37". Por
#: eso no se exige corte de palabra antes, y despues se admite una hora. No se
#: relaja mas: "F.I.12/09/2011N°" es la fecha de impresion del talonario, no
#: la de emision, y aceptar cualquier letra detras la tomaria por buena.
_FECHA = re.compile(
    r"(?<!\d)(\d{1,2})[/\-.]\s?(\d{1,2})[/\-.]\s?(20\d{2})(?=\d{1,2}:\d{2}|\b)"
)
_FECHA_ISO = re.compile(r"\b(20\d{2})-\s?(\d{1,2})-\s?(\d{1,2})\b")
_FECHA_TEXTUAL = re.compile(r"\b(\d{1,2})[/\-.\s]?([A-Z]{3})[/\-.\s]?(20\d{2})\b", re.IGNORECASE)
_MESES = {
    "ENE": 1, "FEB": 2, "MAR": 3, "ABR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AGO": 8, "SEP": 9, "SET": 9, "OCT": 10, "NOV": 11, "DIC": 12,
}

#: Punto o coma como separador decimal: "118.00", "99,00", "1,250.00",
#: "1.250,00". Los dos decimales finales deciden cual es cual, asi que el
#: patron exige exactamente dos y que no los siga otro digito.
#:
#: El espacio NO separa miles. Los comprobantes peruanos no lo usan, y en el
#: texto del OCR un espacio entre digitos casi siempre separa dos cosas: la
#: cantidad y el precio ("2 100.00"), o la barra de "S/" leida como 1 ("S1
#: 100.00"). Aceptarlo convertia esos casos en 2100.00 y 1100.00.
_IMPORTE = r"(?<!\d)(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})(?!\d)"

#: "S/", "S/.", y lo que el OCR hace con la barra ("S!", "S /").
_MONEDA = r"(?:S\s?[/!|]\.?)?"

#: Etiquetas del total, de la mas especifica a la mas generica. La ultima es
#: "TOTAL" a secas y por eso es la peligrosa: tambien aparece dentro de
#: "SUBTOTAL", "TOTAL GRATUITO" o "TOTAL IGV", cuyo monto no es el que sale
#: del fondo. Se le exige que no venga pegada a otra palabra y que el monto la
#: siga de inmediato; las otras dos son inequivocas y admiten algo en medio.
_TOTAL_IMPORTE = re.compile(r"IMPORTE\s*TOTAL.{0,20}?" + _IMPORTE, re.IGNORECASE)
_TOTAL_A_PAGAR = re.compile(r"TOTAL\s*A\s*PAGAR.{0,20}?" + _IMPORTE, re.IGNORECASE)
_TOTAL_SOLO = re.compile(
    r"(?<![A-Z\-])TOTAL\s*:?\s*" + _MONEDA + r"\s*" + _IMPORTE, re.IGNORECASE
)

#: Tasas de IGV con las que un subtotal y su IGV se reconocen como pareja: la
#: general, la de restaurantes y hoteles MYPE (Ley N.o 31556) y la exoneracion.
TASAS_IGV = (0.18, 0.105, 0.0)

#: Conceptos que hacen que el total no sea subtotal + IGV. Si aparecen, el
#: total no se deduce: sumar daria una cifra equivocada con aspecto de leida.
_OTROS_CONCEPTOS = re.compile(
    r"ICBPER|EXONERAD|INAFECT|DESCUENTO|REDONDEO|PERCEPCI|ANTICIPO|\bISC\b|PROPINA",
    re.IGNORECASE,
)


def _a_numero(texto: str) -> float | None:
    """'1,250.00', '1.250,00' y '99,00' a float.

    El ultimo separador es el decimal --el patron garantiza que lo siguen dos
    digitos--, y todo lo anterior a el son separadores de miles.
    """
    entero, decimales = texto[:-3], texto[-2:]
    entero = re.sub(r"\D", "", entero)
    try:
        return float(f"{entero or '0'}.{decimales}")
    except ValueError:
        return None


def _fecha(texto: str) -> date | None:
    """La primera fecha valida del texto, en cualquiera de los tres formatos.

    Se toma la primera por posicion y no por formato: en una boleta la fecha
    de emision va arriba, y una fecha posterior suele ser de vencimiento.
    """
    candidatas = []
    for patron, orden in ((_FECHA, "dma"), (_FECHA_ISO, "amd"), (_FECHA_TEXTUAL, "dMa")):
        for encontrado in patron.finditer(texto):
            partes = dict(zip(orden, encontrado.groups()))
            mes = _MESES.get(partes["M"].upper()) if "M" in partes else int(partes["m"])
            if mes is None:
                continue
            try:
                valor = date(int(partes["a"]), mes, int(partes["d"]))
            except ValueError:
                # 32/13/2026 y compania: se descarta en vez de corregir a ciegas.
                continue
            candidatas.append((encontrado.start(), valor))
    return min(candidatas)[1] if candidatas else None


def _total(texto: str) -> float | None:
    for patron in (_TOTAL_IMPORTE, _TOTAL_A_PAGAR, _TOTAL_SOLO):
        encontrado = patron.search(texto)
        if encontrado:
            return _a_numero(encontrado.group(1))
    return None


def _es_igv_de(igv: float, subtotal: float) -> bool:
    """Si este IGV corresponde a este subtotal con alguna tasa vigente.

    La tolerancia cubre el redondeo por linea, que en una boleta de muchos
    items acumula algunos centimos.
    """
    margen = max(0.05, subtotal * 0.002)
    return any(abs(igv - subtotal * tasa) <= margen for tasa in TASAS_IGV)


def _cuadrar(campos: CamposLeidos) -> None:
    """Contrasta subtotal, IGV y total entre si.

    Dos cosas, y las dos aplican el mismo principio: un campo dudoso se
    reporta como no leido, no como leido.

    - Si el subtotal y el IGV no forman pareja con ninguna tasa, al menos uno
      se tomo de otra linea --pasa cuando la foto esta inclinada y el OCR
      desordena los renglones--. No se sabe cual, asi que se descartan ambos.

    - Si el total no se pudo leer pero subtotal e IGV si y forman pareja, el
      total es su suma. Solo se deduce cuando el texto no menciona conceptos
      que la romperian (bolsas, exonerados, descuentos).
    """
    if campos.subtotal is None or campos.igv is None:
        return
    if not _es_igv_de(campos.igv, campos.subtotal):
        campos.subtotal = None
        campos.igv = None
        return
    if campos.total is None and not _OTROS_CONCEPTOS.search(campos.texto):
        campos.total = round(campos.subtotal + campos.igv, 2)
        campos.total_deducido = True


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

    coincidencia = _SERIE_NUMERO.search(texto) or _SERIE_NUMERO_TALONARIO.search(texto)
    if coincidencia:
        campos.serie = coincidencia.group(1).upper()
        # El numero se imprime con ceros a la izquierda y el sistema lo guarda
        # igual; se conserva tal cual para poder compararlo.
        campos.numero = coincidencia.group(2)

    campos.fecha_emision = _fecha(texto)

    campos.total = _total(texto)
    campos.igv = _importe_tras(("IGV", "I\\.G\\.V"), texto)
    campos.subtotal = _importe_tras(
        ("OP\\.?\\s*GRAVADA", "GRAVADA", "SUB[\\s\\-]*TOTAL", "VALOR\\s*VENTA"), texto
    )
    _cuadrar(campos)

    return campos


# --------------------------------------------------------------------------
# Codigo QR
# --------------------------------------------------------------------------

#: Lo que SUNAT exige imprimir en el QR de un comprobante electronico:
#: RUC | tipo | serie | numero | IGV | total | fecha | tipo doc. | nro. doc. | ...
#: Los tipos son 01 factura, 03 boleta, 07 nota de credito y 08 nota de debito.
_QR_TIPOS = {"01", "03", "07", "08"}


def _imagen_cv(imagen: bytes | str):
    """La imagen como matriz de OpenCV, o None.

    Se lee con `imdecode` tambien desde disco porque `cv2.imread` no abre
    rutas con tildes en Windows.
    """
    import cv2
    import numpy as np

    datos = np.fromfile(imagen, np.uint8) if isinstance(imagen, str) else np.frombuffer(imagen, np.uint8)
    return cv2.imdecode(datos, cv2.IMREAD_COLOR)


def decodificar_qr(imagen: bytes | str) -> str | None:
    """El texto del QR del comprobante, o None si no hay o no se pudo leer.

    OpenCV ya viene con RapidOCR, asi que no es una dependencia nueva. Se
    prueban dos detectores porque fallan en fotos distintas: el clasico y el
    basado en ArUco, que tolera mejor la perspectiva.
    """
    try:
        import cv2

        matriz = _imagen_cv(imagen)
        if matriz is None:
            return None
        for detector in (cv2.QRCodeDetector, cv2.QRCodeDetectorAruco):
            texto, _, _ = detector().detectAndDecode(matriz)
            if texto:
                return texto
    except Exception as error:  # noqa: BLE001
        log.info("No se pudo buscar el QR del comprobante: %s", error)
    return None


def _importe_qr(texto: str) -> float | None:
    try:
        return float(texto.replace(",", ""))
    except ValueError:
        return None


def aplicar_qr(campos: CamposLeidos, qr: str) -> None:
    """Sobrescribe con lo que dice el QR, si tiene el formato de SUNAT.

    El QR manda sobre el texto porque no es una lectura sino un dato: lo
    escribio el sistema de facturacion del emisor, y decodificarlo no admite
    confundir un 1 con un 7. Tambien lo hace mas dificil de engañar: retocar
    el total impreso en la foto no cambia el del QR.

    Un QR con otro formato --muchos emisores ponen solo un enlace-- se ignora
    y se sigue con lo leido del texto.
    """
    partes = [p.strip() for p in qr.split("|")]
    if len(partes) < 7:
        return
    ruc, tipo, serie, numero, igv, total, fecha = partes[:7]
    if not (
        re.fullmatch(r"\d{11}", ruc)
        and tipo in _QR_TIPOS
        and re.fullmatch(r"[A-Za-z0-9]{4}", serie)
        and re.fullmatch(r"\d{1,8}", numero)
    ):
        return

    campos.qr = qr
    campos.ruc_emisor = ruc
    campos.serie = serie.upper()
    campos.numero = numero
    campos.fecha_emision = _fecha(fecha) or campos.fecha_emision

    igv_qr = _importe_qr(igv)
    total_qr = _importe_qr(total)
    if igv_qr is not None:
        campos.igv = igv_qr
        # El subtotal no viaja en el QR: se conserva el del texto solo si
        # forma pareja con el IGV verdadero.
        if campos.subtotal is not None and not _es_igv_de(igv_qr, campos.subtotal):
            campos.subtotal = None
    if total_qr is not None:
        campos.total = total_qr
        campos.total_deducido = False


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


def orden_de_lectura(resultado: list) -> list[tuple[str, float]]:
    """Los fragmentos del OCR en el orden en que se leen en el papel.

    RapidOCR los devuelve ordenados por la altura de su caja, y en una foto
    inclinada eso desordena las lineas: el monto queda por debajo de su
    etiqueta y sale despues de la etiqueta siguiente ("OP.GRAVADA: IGV(18%):
    S/100.00 S/18.00"). Como los importes se buscan tras su etiqueta, el
    lector tomaba el monto de otra linea.

    Se endereza con la inclinacion que tienen las propias cajas --la mediana
    del angulo del borde superior de las cajas anchas, que son las que la miden
    bien--, se agrupan en lineas los fragmentos cuyo centro
    enderezado esta a menos de media altura de linea, y cada linea se lee de
    izquierda a derecha.
    """
    if not resultado:
        return []

    cajas = []
    for caja, texto, confianza in resultado:
        (x0, y0), (x1, y1), _, (x3, y3) = caja[0], caja[1], caja[2], caja[3]
        ancho = math.hypot(x1 - x0, y1 - y0)
        alto = math.hypot(x3 - x0, y3 - y0)
        cx = sum(p[0] for p in caja) / 4
        cy = sum(p[1] for p in caja) / 4
        cajas.append((math.atan2(y1 - y0, x1 - x0), ancho, alto, cx, cy, texto, float(confianza)))

    # Una caja de un solo caracter ("1") sale casi recta aunque la foto este
    # inclinada; solo las anchas dicen el angulo.
    anchas = sorted(c for c in cajas if c[1] >= 3 * c[2]) or sorted(cajas)
    angulo = anchas[len(anchas) // 2][0]
    seno, coseno = math.sin(angulo), math.cos(angulo)
    alto_linea = sorted(c[2] for c in cajas)[len(cajas) // 2]

    enderezadas = sorted(
        (
            -cx * seno + cy * coseno,
            cx * coseno + cy * seno,
            texto,
            confianza,
        )
        for _, _, _, cx, cy, texto, confianza in cajas
    )

    lineas: list[list[tuple[float, float, str, float]]] = []
    for fragmento in enderezadas:
        if lineas:
            linea = lineas[-1]
            media = sum(f[0] for f in linea) / len(linea)
            if fragmento[0] - media < alto_linea / 2:
                linea.append(fragmento)
                continue
        lineas.append([fragmento])

    return [
        (texto, confianza)
        for linea in lineas
        for _, _, texto, confianza in sorted(linea, key=lambda f: f[1])
    ]


def leer(imagen: bytes | str) -> CamposLeidos | None:
    """Corre el OCR sobre una imagen, extrae los campos y los completa con el QR.

    Devuelve None si el OCR no pudo procesar el archivo. Que falle no puede
    tumbar el analisis: el gasto se sigue evaluando con lo declarado, y el
    motivo lo dice.
    """
    try:
        resultado, _ = lector()(imagen)
    except Exception as error:  # noqa: BLE001
        log.warning("El OCR no pudo procesar la imagen: %s", error)
        return None

    fragmentos = [
        (t, c) for t, c in orden_de_lectura(resultado or []) if c >= CONFIANZA_MINIMA
    ]
    if fragmentos:
        campos = extraer(" ".join(t for t, _ in fragmentos))
        campos.confianza = sum(c for _, c in fragmentos) / len(fragmentos)
    else:
        campos = CamposLeidos(texto="", confianza=0.0)

    # Aunque el texto no se haya podido leer: un QR nitido en una foto por lo
    # demas ilegible sigue diciendo que comprobante es.
    qr = decodificar_qr(imagen)
    if qr:
        aplicar_qr(campos, qr)
    return campos
