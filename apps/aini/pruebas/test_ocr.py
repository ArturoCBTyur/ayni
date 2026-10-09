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

import math
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aini import cotejo, motor, ocr  # noqa: E402
from aini.contrato import Comprobante  # noqa: E402
from pruebas import documentos  # noqa: E402


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
    qr: str | None = None,
) -> str:
    """Dibuja una boleta de venta con el formato habitual en el Peru.

    Con `qr`, le pega debajo un codigo QR con ese contenido, como el que
    SUNAT exige en los comprobantes electronicos.
    """
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

    img = Image.new("RGB", (620, 760 if qr is None else 800), "white")
    dibujo = ImageDraw.Draw(img)
    y = 30
    for texto, tam, negrita in lineas:
        if texto:
            dibujo.text((40, y), texto, fill="black", font=_fuente(tam, negrita))
        y += tam + 12

    if qr is not None:
        import cv2

        modulos = cv2.QRCodeEncoder.create().encode(qr)
        codigo = Image.fromarray(modulos).resize(
            (modulos.shape[1] * 5, modulos.shape[0] * 5), Image.NEAREST
        )
        img.paste(codigo.convert("RGB"), (40, y + 10))

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


class TestOrdenDeLectura:
    """Los fragmentos se leen por lineas del papel, no por altura en la foto.

    Con cajas fabricadas y no con una imagen: el orden en que RapidOCR
    devuelve los fragmentos cambia con la fuente y la plataforma (en Linux,
    con DejaVuSans, una boleta inclinada -7 grados leia el total como 18.00),
    y esta prueba tiene que fallar igual en cualquier maquina.
    """

    @staticmethod
    def _caja(x: float, y: float, ancho: float, grados: float, alto: float = 26) -> list:
        """Rectangulo de texto con esquina superior izquierda en (x, y), girado."""
        a = math.radians(grados)
        dx, dy = math.cos(a), math.sin(a)
        esquinas = [(0, 0), (ancho, 0), (ancho, alto), (0, alto)]
        return [[x + u * dx - v * dy, y + u * dy + v * dx] for u, v in esquinas]

    def _foto(self, grados: float) -> list:
        """El pie de una boleta, girado, en el orden en que lo devuelve el OCR."""
        # Los montos a la derecha, donde los imprime una boleta: a esa distancia,
        # 7 grados bastan para que un monto quede a la altura de otra linea.
        lineas = [
            [("OP.GRAVADA:", 0, 150), ("S/100.00", 330, 120)],
            [("IGV(18%):", 0, 120), ("S/18.00", 330, 110)],
            [("IMPORTE TOTAL:", 0, 200), ("S/118.00", 330, 140)],
        ]
        a = math.radians(grados)
        resultado = []
        for fila, linea in enumerate(lineas):
            for texto, x, ancho in linea:
                y = 400 + fila * 34
                # Se gira la posicion de la caja alrededor del origen, como gira
                # el papel entero.
                gx, gy = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
                resultado.append([self._caja(gx, gy, ancho, grados), texto, 0.95])
        # RapidOCR ordena por la altura de la esquina superior izquierda.
        return sorted(resultado, key=lambda r: (r[0][0][1], r[0][0][0]))

    @pytest.mark.parametrize("grados", [-7, 0, 7])
    def test_cada_monto_queda_junto_a_su_etiqueta(self, grados):
        texto = " ".join(t for t, _ in ocr.orden_de_lectura(self._foto(grados)))
        assert texto == (
            "OP.GRAVADA: S/100.00 IGV(18%): S/18.00 IMPORTE TOTAL: S/118.00"
        )

    def test_la_foto_inclinada_se_lee_completa(self):
        campos = ocr.extraer(" ".join(t for t, _ in ocr.orden_de_lectura(self._foto(7))))
        assert (campos.subtotal, campos.igv, campos.total) == (100.0, 18.0, 118.0)

    def test_sin_fragmentos_no_hay_nada_que_ordenar(self):
        assert ocr.orden_de_lectura([]) == []


#: Texto que RapidOCR devolvio sobre una boleta termica real (banco de campo,
#: c001), sin el nombre del cliente. Tiene todo lo que hacia fallar al lector:
#: coma decimal, fecha AAAA-MM-DD partida en dos lineas, "SUB-TOTALES", un
#: "TOTAL GRATUITO" antes del total y la linea "TOTAL A PAGAR" ilegible.
TEXTO_TERMICA = (
    "SuperPet RUC:20600467124 BOLETA ELECTRONICA B001-227727 "
    "FECHA DE CREACION:2020-10- 12 NUMERO DEL PEDIDO:S0235216 "
    "QTY DESCRIPCION P.U. TOTAL 10.0 [AP000045][Perro]- S/9,90S/99,00 "
    "Canbo Enlatado 11.64oz 2.0 [AP00o045] [Perro]- S/9,90 S/0,00 "
    "SUB-TOTALES S/83,90 TOTAL GRATUITO S/16.78 TOTALIGV S/15,10 "
    "TOTALAPAGAR 006675 TIPO DEMONEDA:SOLES"
)


class TestFormatos:
    """Lo que cambia de un emisor a otro y el lector tiene que reconocer igual."""

    def test_boleta_termica_real(self):
        campos = ocr.extraer(TEXTO_TERMICA)
        assert campos.ruc_emisor == "20600467124"
        assert (campos.serie, campos.numero) == ("B001", "227727")
        assert campos.fecha_emision.isoformat() == "2020-10-12"
        assert campos.subtotal == 83.90
        assert campos.igv == 15.10
        assert campos.total == 99.00

    def test_total_gratuito_no_se_toma_por_el_total(self):
        """Era el error grave: leia 16.78 y abria una discrepancia falsa."""
        campos = ocr.extraer(TEXTO_TERMICA)
        assert campos.total != 16.78

    def test_la_barra_de_soles_leida_como_uno_no_se_pega_al_monto(self):
        """Texto real del OCR en Linux sobre la boleta inclinada: "S/" salio
        como "S1", y con el espacio como separador de miles se leia 1100.00."""
        campos = ocr.extraer(
            "OP.GRAVADA: S1 100.00 IGV(18%): 18.00 IMPORTE TOTAL: S/118.00"
        )
        assert (campos.subtotal, campos.igv, campos.total) == (100.0, 18.0, 118.0)

    def test_el_total_con_la_barra_leida_como_uno(self):
        assert ocr.extraer("IMPORTE TOTAL: S1 118.00").total == 118.0

    def test_subtotal_no_se_toma_por_el_total(self):
        campos = ocr.extraer("SUBTOTAL: S/100.00 IGV (18%): S/ 18.00 TOTAL: S/118.00")
        assert campos.total == 118.0
        assert not campos.total_deducido

    @pytest.mark.parametrize(
        "impreso,valor",
        [("118.00", 118.0), ("99,00", 99.0), ("1,250.00", 1250.0), ("1.250,00", 1250.0)],
    )
    def test_punto_o_coma_decimal(self, impreso, valor):
        assert ocr.extraer(f"IMPORTE TOTAL: S/ {impreso}").total == valor

    @pytest.mark.parametrize("impresa", ["14/09/2026", "2026-09-14", "14-SEP-2026", "14-SET-2026"])
    def test_formatos_de_fecha(self, impresa):
        assert ocr.extraer(f"Fecha: {impresa}").fecha_emision.isoformat() == "2026-09-14"

    def test_fecha_pegada_a_la_etiqueta_y_a_la_hora(self):
        campos = ocr.extraer("FECHA26/11/202018:45:37")
        assert campos.fecha_emision.isoformat() == "2020-11-26"

    def test_la_fecha_de_impresion_del_talonario_no_es_la_de_emision(self):
        """Pie de imprenta de una boleta de talonario: si se tomara, cada
        boleta manuscrita daria una advertencia de fecha falsa."""
        campos = ocr.extraer("Serie:0001 del0301al0800 F.I.12/09/2011N°Aut.8532629023")
        assert campos.fecha_emision is None

    def test_gravada_sin_op(self):
        campos = ocr.extraer("GRAVADA: S/229,49 IGV18% S/41,31 DESCUENTO: TOTAL: S/270,80")
        assert campos.subtotal == 229.49
        assert campos.total == 270.80

    def test_serie_numerica_de_talonario(self):
        campos = ocr.extraer("R.U.C.10072486892 BOLETA DEVENTA 001-N0000418")
        assert (campos.serie, campos.numero) == ("001", "0000418")

    def test_un_telefono_no_es_una_serie(self):
        campos = ocr.extraer("Telf.:(01)261-0675 Cel.:954-135912")
        assert campos.serie is None

    def test_el_total_ilegible_se_deduce_de_subtotal_e_igv(self):
        campos = ocr.extraer("OP. GRAVADA S/ 100.00 IGV S/ 18.00 IMPORTE TOTAL S/ ###")
        assert campos.total == 118.0
        assert campos.total_deducido

    def test_no_se_deduce_si_hay_otros_conceptos(self):
        """Con bolsas cobradas el total no es subtotal + IGV: se deja sin leer."""
        campos = ocr.extraer("OP. GRAVADA S/ 100.00 IGV S/ 18.00 ICBPER S/ 0.50")
        assert campos.total is None

    def test_subtotal_e_igv_que_no_cuadran_se_descartan(self):
        """Foto inclinada: el OCR desordeno los renglones y cada monto quedo
        junto a la etiqueta de otro. Mejor no leido que mal leido."""
        campos = ocr.extraer("OP.GRAVADA: S! 18.00 IGV (18%): S/118.00 IMPORTETOTAL:")
        assert campos.subtotal is None
        assert campos.igv is None
        assert campos.total is None


#: QR de la boleta estandar, en el formato de SUNAT.
QR_ESTANDAR = "20601030579|03|B001|004521|18.00|118.00|2026-09-14|6|20609876540|"


class TestQR:
    """El QR no se lee: se decodifica. Lo que dice es lo que emitio el sistema
    de facturacion, sin la incertidumbre del OCR."""

    def test_toma_los_campos_del_formato_sunat(self):
        campos = ocr.CamposLeidos()
        # El documento del cliente es ficticio: el QR real trae el DNI de quien
        # compro, y un dato personal no se versiona (Ley N.o 29733).
        ocr.aplicar_qr(campos, "20600598768|03|B004|00001269|0|123|2026-10-08|1|00000000|")
        assert campos.ruc_emisor == "20600598768"
        assert (campos.serie, campos.numero) == ("B004", "00001269")
        assert campos.fecha_emision.isoformat() == "2026-10-08"
        assert campos.igv == 0.0
        assert campos.total == 123.0

    def test_un_qr_que_solo_es_un_enlace_se_ignora(self):
        campos = ocr.extraer(TEXTO_TERMICA)
        ocr.aplicar_qr(campos, "https://odoo.pse.pe/20600467124")
        assert campos.qr == ""
        assert campos.total == 99.0

    def test_manda_sobre_un_total_calculado(self):
        campos = ocr.extraer(TEXTO_TERMICA)
        assert campos.total_deducido
        ocr.aplicar_qr(campos, "20600467124|03|B001|227727|15.10|99.00|2020-10-12|1|00000000|")
        assert campos.total == 99.0
        assert not campos.total_deducido

    def test_descarta_el_subtotal_que_no_cuadra_con_su_igv(self):
        campos = ocr.extraer("OP. GRAVADA S/ 100.00 IMPORTE TOTAL S/ 118.00")
        ocr.aplicar_qr(campos, "20601030579|03|B001|004521|36.00|236.00|2026-09-14|1|0|")
        assert campos.subtotal is None

    def test_se_decodifica_de_la_imagen(self, tmp_path):
        leido = ocr.leer(boleta(tmp_path / "con_qr.jpg", qr=QR_ESTANDAR))
        assert leido.qr == QR_ESTANDAR
        assert leido.total == 118.0

    def test_un_total_retocado_en_la_foto_no_engana_al_qr(self, tmp_path):
        """Alguien cambia el total impreso a 185 y lo declara: el QR conserva
        el original y el cotejo lo ve."""
        ruta = boleta(tmp_path / "retocada.jpg", subtotal=156.78, igv=28.22, total=185.0, qr=QR_ESTANDAR)
        leido = ocr.leer(ruta)
        assert leido.total == 118.0

        motivos, _ = cotejo.evaluar(comprobante(total=185.0), leido)
        discrepa = next(m for m in motivos if m.regla == "ocr.total_discrepa")
        assert "QR" in discrepa.mensaje

    def test_sin_qr_no_cambia_nada(self, leida):
        assert leida.qr == ""
        assert leida.total == 118.0

    def test_un_qr_nitido_en_una_foto_por_lo_demas_ilegible(self, tmp_path):
        import cv2

        modulos = cv2.QRCodeEncoder.create().encode(QR_ESTANDAR)
        img = Image.new("RGB", (400, 400), "white")
        lado = modulos.shape[0] * 6
        img.paste(Image.fromarray(modulos).resize((lado, lado), Image.NEAREST).convert("RGB"), (80, 80))
        ruta = tmp_path / "solo_qr.png"
        img.save(ruta)

        leido = ocr.leer(str(ruta))
        assert leido.leyo_algo
        assert leido.total == 118.0


class TestPDF:
    """El comprobante que llega por correo es un PDF, no una foto.

    Hasta esta version el backend lo aceptaba pero AIni no podia leerlo, y como
    sin cotejo nada se aprueba solo, todo gasto con PDF terminaba en revision.
    """

    def test_el_texto_se_extrae_sin_ocr(self):
        leido = ocr.leer(documentos.pdf())
        assert leido.ruc_emisor == "20601030579"
        assert (leido.serie, leido.numero) == ("B001", "004521")
        assert leido.fecha_emision.isoformat() == "2026-09-14"
        assert (leido.subtotal, leido.igv, leido.total) == (100.0, 18.0, 118.0)
        # Es el texto del documento, no una lectura: no hay incertidumbre.
        assert leido.confianza == 1.0

    def test_se_lee_en_el_orden_del_papel_y_no_en_el_de_escritura(self):
        """El emisor escribio todas las etiquetas y despues todos los montos.
        Leido tal cual, cada monto quedaba lejos de su etiqueta."""
        leido = ocr.leer(
            documentos.pdf(
                [
                    (20, 40, "RUC: 20600598768"),
                    (20, 60, "OP. GRAVADA:"),
                    (20, 75, "IGV (18%):"),
                    (20, 90, "IMPORTE TOTAL:"),
                    (200, 60, "S/ 100.00"),
                    (200, 75, "S/ 18.00"),
                    (200, 90, "S/ 118.00"),
                ]
            )
        )
        assert (leido.subtotal, leido.igv, leido.total) == (100.0, 18.0, 118.0)

    def test_el_qr_se_busca_en_la_pagina(self):
        leido = ocr.leer(documentos.pdf(qr=QR_ESTANDAR))
        assert leido.qr == QR_ESTANDAR

    def test_un_pdf_retocado_no_engana_al_qr(self):
        """Editar el texto de un PDF es mas facil que retocar una foto. El QR es
        una imagen dentro del documento y conserva el total original."""
        retocada = [
            (x, y, texto.replace("118.00", "185.00")) for x, y, texto in documentos.BOLETA
        ]
        leido = ocr.leer(documentos.pdf(retocada, qr=QR_ESTANDAR))
        assert leido.total == 118.0

    def test_un_pdf_escaneado_se_lee_como_foto(self, tmp_path):
        imagen = Image.open(boleta(tmp_path / "escaneo.jpg"))
        leido = ocr.leer(documentos.pdf_escaneado(imagen))
        assert leido.ruc_emisor == "20601030579"
        assert leido.total == 118.0

    def test_se_reconoce_por_el_contenido_y_no_por_el_nombre(self, tmp_path):
        ruta = tmp_path / "comprobante.jpg"
        ruta.write_bytes(documentos.pdf())
        assert ocr.leer(str(ruta)).total == 118.0

    def test_un_pdf_danado_no_tumba_el_analisis(self):
        assert ocr.leer(b"%PDF-1.4 esto no es un PDF") is None

    def test_cotejo_con_un_pdf(self):
        motivos, penalizacion = cotejo.evaluar(comprobante(), ocr.leer(documentos.pdf()))
        assert penalizacion == 0
        assert "ocr.total_coincide" in reglas(motivos)


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

    def test_un_total_deducido_lo_dice(self):
        """Una cifra calculada no se presenta como leida."""
        leido = ocr.extraer("RUC:20601030579 B001-004521 OP. GRAVADA S/ 100.00 IGV S/ 18.00")
        motivos, _ = cotejo.evaluar(comprobante(total=150.0), leido)
        discrepa = next(m for m in motivos if m.regla == "ocr.total_discrepa")
        assert "suma del subtotal y el IGV" in discrepa.mensaje

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

    @pytest.mark.parametrize("grados", [-7, 7])
    def test_inclinada(self, limpia, tmp_path, grados):
        """Hacia los dos lados: girada +7 grados, el monto de cada linea quedaba
        por debajo de su etiqueta y se leia el de otra."""
        r = self._leer(
            limpia,
            tmp_path / "x.jpg",
            lambda i: i.rotate(grados, expand=True, fillcolor="white"),
        )
        assert r.total == 118.0
        assert r.igv == 18.0

    def test_oscura(self, limpia, tmp_path):
        from PIL import ImageEnhance

        r = self._leer(limpia, tmp_path / "x.jpg", lambda i: ImageEnhance.Brightness(i).enhance(0.45))
        assert r.total == 118.0

    def test_con_contraste_bajo(self, limpia, tmp_path):
        from PIL import ImageEnhance

        r = self._leer(limpia, tmp_path / "x.jpg", lambda i: ImageEnhance.Contrast(i).enhance(0.35))
        assert r.total == 118.0
