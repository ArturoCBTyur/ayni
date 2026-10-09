"""Comprobantes en PDF fabricados para las pruebas.

Se generan en el momento, igual que las boletas en imagen de `test_ocr.py`,
para no versionar binarios. Se escriben a mano --el formato PDF es texto-- en
vez de con una biblioteca, para no sumar una dependencia que solo usarian las
pruebas.
"""

from __future__ import annotations

import io

#: La boleta estandar de las pruebas, como la escribiria un sistema de
#: facturacion: (x, y desde arriba, texto), en puntos.
BOLETA = [
    (20, 30, "CLINICA VETERINARIA SAN ROQUE S.A.C."),
    (20, 46, "RUC: 20601030579"),
    (20, 70, "BOLETA DE VENTA ELECTRONICA"),
    (20, 86, "B001-004521"),
    (20, 110, "Fecha de emision: 14/09/2026"),
    (20, 126, "Cliente: HUELLAS DEL ANDE"),
    (20, 160, "Consulta veterinaria"),
    (220, 160, "100.00"),
    (20, 190, "OP. GRAVADA:"),
    (200, 190, "S/ 100.00"),
    (20, 206, "IGV (18%):"),
    (200, 206, "S/ 18.00"),
    (20, 222, "IMPORTE TOTAL:"),
    (200, 222, "S/ 118.00"),
]


def _cadena(texto: str) -> str:
    return texto.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def pdf(
    trozos: list[tuple[float, float, str]] | None = None,
    qr: str | None = None,
    ancho: int = 300,
    alto: int = 420,
) -> bytes:
    """Un PDF de una pagina con texto real dentro, como el de un emisor.

    Los trozos se escriben en el orden dado, que no tiene por que ser el de
    lectura. Con `qr`, se dibuja debajo un codigo QR con ese contenido.
    """
    trozos = BOLETA if trozos is None else trozos
    instrucciones = ["BT /F1 10 Tf"]
    for x, y, texto in trozos:
        instrucciones.append(f"1 0 0 1 {x} {alto - y} Tm ({_cadena(texto)}) Tj")
    instrucciones.append("ET")

    recursos = "/Font << /F1 4 0 R >>"
    objetos_extra: list[bytes] = []
    if qr is not None:
        import cv2

        modulos = cv2.QRCodeEncoder.create().encode(qr)
        lado_pt = 110
        instrucciones.append(f"q {lado_pt} 0 0 {lado_pt} 20 30 cm /Im1 Do Q")
        recursos += " /XObject << /Im1 6 0 R >>"
        pixeles = modulos.tobytes()
        objetos_extra.append(
            (
                f"<< /Type /XObject /Subtype /Image /Width {modulos.shape[1]} "
                f"/Height {modulos.shape[0]} /ColorSpace /DeviceGray /BitsPerComponent 8 "
                f"/Interpolate false /Length {len(pixeles)} >>\nstream\n"
            ).encode()
            + pixeles
            + b"\nendstream"
        )

    contenido = "\n".join(instrucciones).encode("latin-1")
    objetos = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {ancho} {alto}] "
            f"/Resources << {recursos} >> /Contents 5 0 R >>"
        ).encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(contenido)} >>\nstream\n".encode() + contenido + b"\nendstream",
        *objetos_extra,
    ]

    salida = b"%PDF-1.4\n"
    posiciones = []
    for numero, objeto in enumerate(objetos, 1):
        posiciones.append(len(salida))
        salida += f"{numero} 0 obj\n".encode() + objeto + b"\nendobj\n"
    xref = len(salida)
    salida += f"xref\n0 {len(objetos) + 1}\n0000000000 65535 f \n".encode()
    for posicion in posiciones:
        salida += f"{posicion:010d} 00000 n \n".encode()
    salida += (
        f"trailer\n<< /Size {len(objetos) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref}\n%%EOF\n"
    ).encode()
    return salida


def pdf_escaneado(imagen) -> bytes:
    """Una imagen metida en un PDF, sin texto: lo que produce un escaner."""
    salida = io.BytesIO()
    imagen.convert("RGB").save(salida, format="PDF", resolution=150)
    return salida.getvalue()
