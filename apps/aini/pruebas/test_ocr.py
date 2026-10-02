"""Pruebas del lector de comprobantes y del cotejo contra lo declarado.

Lo valioso aqui no es que el OCR lea --eso lo hace la biblioteca-- sino lo que
el sistema hace con lo leido: que detecte cuando lo tecleado no coincide con el
papel, que no invente cuando no pudo leer, y que una foto mala no se confunda
con un gasto sospechoso.

Las boletas se generan en el momento, con el formato de una boleta peruana
real. Asi las pruebas no dependen de un archivo binario versionado y se puede
variar un campo a la vez para ver que detecta el cotejo.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aini import cotejo, motor, ocr  # noqa: E402
from aini.contrato import Comprobante  # noqa: E402


def _fuente(tam: int, negrita: bool):
    for nombre in (("arialbd.ttf" if negrita else "arial.ttf"), "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(nombre, tam)
        except OSError:
            continue
    return ImageFont.load_default()


def boleta(
    ruta: Path,
    ruc: str = "20601030579",
    serie: str = "B001",
    numero: str = "004521",
    fecha: str = "14/09/2026",
    subtotal: float = 100.0,
    igv: float = 18.0,
    total: float = 118.0,
) -> str:
    """Dibuja una boleta de venta con el formato habitual en el Peru."""
    lineas = [
        ("CLINICA VETERINARIA SAN ROQUE S.A.C.", 26, True),
        ("Av. Alameda 456 - Amarilis, Huanuco", 18, False),
        (f"RUC: {ruc}", 24, True),
        ("", 10, False),
        ("BOLETA DE VENTA ELECTRONICA", 22, True),
        (f"{serie}-{numero}", 26, True),
        ("", 10, False),
        (f"Fecha de emision: {fecha}", 19, False),
        ("Cliente: HUELLAS DEL ANDE", 19, False),
        ("", 14, False),
        ("Descripcion            Cant   Importe", 18, False),
        ("Consulta veterinaria      1     60.00", 18, False),
        ("", 14, False),
        (f"OP. GRAVADA:        S/   {subtotal:.2f}", 20, False),
        (f"IGV (18%):          S/    {igv:.2f}", 20, False),
        (f"IMPORTE TOTAL:      S/   {total:.2f}", 24, True),
    ]

    img = Image.new("RGB", (620, 760), "white")
    dibujo = ImageDraw.Draw(img)
    y = 30
    for texto, tam, negrita in lineas:
        if texto:
            dibujo.text((40, y), texto, fill="black", font=_fuente(tam, negrita))
        y += tam + 12

    img.save(ruta, quality=92)
    return str(ruta)


def comprobante(**cambios) -> Comprobante:
    """Lo que el operador declaro. Por defecto, igual a la boleta."""
    datos = {
        "tipo": "BOLETA",
        "rucEmisor": "20601030579",
        "serie": "B001",
        "numero": "004521",
        "fechaEmision": "2026-09-14",
        "subtotal": 100.0,
        "igv": 18.0,
        "total": 118.0,
        "moneda": "PEN",
        "hashSha256": "a" * 64,
        "archivoUrl": "/x",
    }
    datos.update(cambios)
    return Comprobante(**datos)


def reglas(motivos) -> set[str]:
    return {m.regla for m in motivos}


def falla(motivos, regla: str) -> bool:
    return any(m.regla == regla and m.resultado == "falla" for m in motivos)


@pytest.fixture(scope="module")
def leida(tmp_path_factory) -> ocr.CamposLeidos:
    """Una boleta estandar, leida una sola vez para todo el modulo."""
    ruta = tmp_path_factory.mktemp("boletas") / "estandar.jpg"
    resultado = ocr.leer(boleta(ruta))
    assert resultado is not None
    return resultado


class TestLectura:
    def test_lee_los_campos_de_una_boleta(self, leida):
        assert leida.ruc_emisor == "20601030579"
        assert leida.serie == "B001"
        assert leida.numero == "004521"
        assert leida.fecha_emision.isoformat() == "2026-09-14"
        assert leida.total == 118.0
        assert leida.igv == 18.0
        assert leida.subtotal == 100.0

    def test_una_imagen_ilegible_no_inventa_campos(self, tmp_path):
        """Lo contrario de inventar: decir que no se pudo."""
        ruta = tmp_path / "ruido.jpg"
        Image.new("RGB", (400, 300), "white").save(ruta)

        resultado = ocr.leer(str(ruta))
        assert resultado is not None
        assert not resultado.leyo_algo
        assert resultado.ruc_emisor is None
        assert resultado.total is None

    def test_una_url_que_no_se_puede_descargar_devuelve_none(self):
        assert ocr.leer_desde("comprobantes/relativa.jpg") is None
        assert ocr.leer_desde("http://127.0.0.1:59999/no-existe.jpg") is None

    def test_una_fecha_imposible_se_descarta(self):
        """32/13/2026 no se corrige a ciegas: se deja sin leer."""
        campos = ocr.extraer("RUC:20601030579 B001-004521 32/13/2026 TOTAL: S/118.00")
        assert campos.fecha_emision is None
        # Lo demas si se leyo: un campo malo no invalida el resto.
        assert campos.ruc_emisor == "20601030579"


class TestCotejo:
    """Lo que el OCR habilita: contrastar lo tecleado contra el papel."""

    def test_cuando_todo_coincide_no_penaliza(self, leida):
        motivos, penalizacion = cotejo.evaluar(comprobante(), leida)
        assert penalizacion == 0
        assert "ocr.ruc_coincide" in reglas(motivos)
        assert "ocr.total_coincide" in reglas(motivos)

    def test_detecta_un_ruc_distinto_del_impreso(self, leida):
        # El operador tecleo un RUC valido, pero no el de esta boleta.
        motivos, penalizacion = cotejo.evaluar(comprobante(rucEmisor="20100070970"), leida)
        assert falla(motivos, "ocr.ruc_discrepa")
        assert penalizacion >= 30

    def test_detecta_un_total_distinto_del_impreso(self, leida):
        """El caso que mas importa: el monto es lo que sale del fondo."""
        motivos, penalizacion = cotejo.evaluar(comprobante(total=450.0), leida)
        assert falla(motivos, "ocr.total_discrepa")
        assert penalizacion >= 35

    def test_detecta_otro_comprobante(self, leida):
        motivos, _ = cotejo.evaluar(comprobante(numero="009999"), leida)
        assert falla(motivos, "ocr.serie_discrepa")

    def test_los_ceros_a_la_izquierda_no_son_una_discrepancia(self, leida):
        """"4521" y "004521" son el mismo comprobante."""
        motivos, penalizacion = cotejo.evaluar(comprobante(numero="4521"), leida)
        assert not falla(motivos, "ocr.serie_discrepa")
        assert penalizacion == 0

    def test_un_centimo_de_diferencia_no_es_una_discrepancia(self, leida):
        motivos, penalizacion = cotejo.evaluar(comprobante(total=118.02), leida)
        assert not falla(motivos, "ocr.total_discrepa")
        assert penalizacion == 0

    def test_sin_lectura_se_declara_y_no_se_penaliza(self):
        """Una foto mala no es un gasto sospechoso."""
        motivos, penalizacion = cotejo.evaluar(comprobante(), None)
        assert penalizacion == 0
        assert "ocr.no_disponible" in reglas(motivos)

    def test_una_foto_ilegible_pide_otra_toma_sin_castigar(self):
        motivos, penalizacion = cotejo.evaluar(comprobante(), ocr.CamposLeidos(confianza=0.0))
        assert penalizacion == 0
        assert "ocr.ilegible" in reglas(motivos)
        assert any("nitida" in m.mensaje for m in motivos)


class TestBoletaConDatosDistintos:
    """Se varia la boleta, no lo declarado: el papel manda."""

    def test_una_boleta_de_otro_monto_se_detecta(self, tmp_path):
        ruta = boleta(tmp_path / "otra.jpg", subtotal=250.0, igv=45.0, total=295.0)
        leida = ocr.leer(ruta)

        motivos, penalizacion = cotejo.evaluar(comprobante(), leida)
        assert falla(motivos, "ocr.total_discrepa")
        assert penalizacion >= 35

    def test_una_boleta_de_otro_emisor_se_detecta(self, tmp_path):
        ruta = boleta(tmp_path / "emisor.jpg", ruc="20100070970")
        leida = ocr.leer(ruta)

        motivos, _ = cotejo.evaluar(comprobante(), leida)
        assert falla(motivos, "ocr.ruc_discrepa")


class TestAlertaDeCotejo:
    """Una discrepancia tiene que llegar a la bandeja, no solo al puntaje."""

    def _motivos(self, comprobante_cambios: dict, leida) -> list:
        motivos, _ = cotejo.evaluar(comprobante(**comprobante_cambios), leida)
        return motivos

    def test_cuando_todo_coincide_no_hay_alerta(self, leida):
        assert motor._alerta_de_cotejo(self._motivos({}, leida)) is None

    def test_un_total_distinto_alerta_con_severidad_alta(self, leida):
        """El importe es lo que sale del fondo: es el caso grave."""
        alerta = motor._alerta_de_cotejo(self._motivos({"total": 450.0}, leida))
        assert alerta is not None
        assert alerta.tipo == "DECLARACION_NO_COINCIDE"
        assert alerta.severidad == "ALTA"
        assert "el importe" in alerta.titulo

    def test_un_ruc_distinto_alerta_con_severidad_media(self, leida):
        alerta = motor._alerta_de_cotejo(self._motivos({"rucEmisor": "20100070970"}, leida))
        assert alerta is not None
        assert alerta.severidad == "MEDIA"

    def test_varias_discrepancias_son_una_sola_alerta(self, leida):
        """Tres campos mal tecleados son un error, no tres problemas."""
        motivos = self._motivos({"total": 450.0, "rucEmisor": "20100070970"}, leida)
        alerta = motor._alerta_de_cotejo(motivos)
        assert alerta is not None
        assert "el importe" in alerta.titulo and "el RUC del emisor" in alerta.titulo
        # La severidad la fija el campo mas grave de los que discrepan.
        assert alerta.severidad == "ALTA"

    def test_el_titulo_no_acusa_de_fraude(self, leida):
        """La ONG lee estas alertas y el puntaje de confianza es publico."""
        alerta = motor._alerta_de_cotejo(self._motivos({"total": 450.0}, leida))
        assert alerta is not None
        texto = (alerta.titulo + " " + alerta.descripcion).lower()
        assert not any(p in texto for p in ("fraude", "falso", "enga", "mentir", "robo"))

    def test_una_foto_ilegible_no_genera_alerta(self):
        """No poder leer no es una discrepancia."""
        motivos, _ = cotejo.evaluar(comprobante(), ocr.CamposLeidos(confianza=0.0))
        assert motor._alerta_de_cotejo(motivos) is None


@pytest.fixture(scope="module")
def limpia(tmp_path_factory) -> Path:
    """Una boleta nitida, el punto de partida de cada degradacion."""
    return Path(boleta(tmp_path_factory.mktemp("robustez") / "limpia.jpg"))


class TestRobustez:
    """Que la foto sea mala no deberia impedir leer el comprobante.

    Las boletas se degradan a proposito aqui, en vez de versionar las imagenes
    con las que se midio: una medicion que no se puede repetir no es una
    medicion, es un recuerdo. Si una version de la biblioteca empeora, esto
    falla en vez de dejar el README afirmando algo que dejo de ser cierto.

    Lo que NO prueba, y conviene no confundirlo: papel termico real, arrugado,
    con pliegues y fotografiado de lado. Estas son boletas nitidas degradadas
    por filtros, que es mas facil que lo que llega del campo.
    """

    def _leer(self, origen: Path, destino: Path, transformar) -> ocr.CamposLeidos:
        transformar(Image.open(origen)).save(destino, quality=85)
        resultado = ocr.leer(str(destino))
        assert resultado is not None
        return resultado

    def test_borrosa(self, limpia, tmp_path):
        from PIL import ImageFilter

        r = self._leer(limpia, tmp_path / "x.jpg", lambda i: i.filter(ImageFilter.GaussianBlur(1.2)))
        assert r.total == 118.0
        assert r.ruc_emisor == "20601030579"

    def test_a_la_mitad_de_escala(self, limpia, tmp_path):
        r = self._leer(
            limpia,
            tmp_path / "x.jpg",
            lambda i: i.resize((i.width // 2, i.height // 2), Image.LANCZOS),
        )
        assert r.total == 118.0

    def test_inclinada(self, limpia, tmp_path):
        r = self._leer(
            limpia,
            tmp_path / "x.jpg",
            lambda i: i.rotate(-7, expand=True, fillcolor="white"),
        )
        assert r.total == 118.0

    def test_oscura(self, limpia, tmp_path):
        from PIL import ImageEnhance

        r = self._leer(limpia, tmp_path / "x.jpg", lambda i: ImageEnhance.Brightness(i).enhance(0.45))
        assert r.total == 118.0

    def test_con_contraste_bajo(self, limpia, tmp_path):
        from PIL import ImageEnhance

        r = self._leer(limpia, tmp_path / "x.jpg", lambda i: ImageEnhance.Contrast(i).enhance(0.35))
        assert r.total == 118.0
