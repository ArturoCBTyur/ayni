"""Coteja lo que el operador declaro contra lo que dice el comprobante.

Es lo que el OCR habilita y que antes era imposible. El sistema ya comprobaba
que un RUC estuviera bien formado; ahora puede comprobar que **sea el RUC
impreso en el papel**, que es otra cosa.

Dos principios gobiernan todo lo de aqui:

**Una discrepancia no es un fraude.** Lo mas probable es que el operador se
equivocara al teclear, que es exactamente lo que el sistema deberia ayudar a
corregir. Los mensajes lo tratan asi, y la penalizacion deriva a revision en
vez de bloquear.

**No leer un campo no es una discrepancia.** Un comprobante borroso del que no
se pudo sacar el total no dice que el total este mal: dice que no se pudo
verificar. Se declara como tal y no se penaliza, porque castigar una foto mala
castigaria al operador por su camara y no por su gasto.
"""

from __future__ import annotations

from datetime import date, datetime

from .contrato import Comprobante, MotivoAnalisis
from .ocr import CamposLeidos

#: Tolerancia al comparar importes. El OCR puede confundir un separador y los
#: comprobantes redondean distinto; un centimo no es una discrepancia.
TOLERANCIA_IMPORTE = 0.05


def _a_fecha(valor: str | None) -> date | None:
    if not valor:
        return None
    try:
        return datetime.fromisoformat(valor.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _numero_igual(leido: str | None, declarado: str) -> bool:
    """Compara numeros de comprobante ignorando los ceros a la izquierda.

    "004521" y "4521" son el mismo comprobante: el cero de relleno depende de
    como lo imprime cada emisor, no del documento.
    """
    if leido is None:
        return False
    return leido.lstrip("0") == declarado.lstrip("0")


def evaluar(
    comprobante: Comprobante, leido: CamposLeidos | None
) -> tuple[list[MotivoAnalisis], int]:
    """Motivos del cotejo y cuantos puntos restan en total."""
    motivos: list[MotivoAnalisis] = []
    penalizacion = 0

    def anotar(
        regla: str, resultado: str, mensaje: str, valor: str | float | None = None, pen: int = 0
    ) -> None:
        nonlocal penalizacion
        penalizacion += pen
        motivos.append(
            MotivoAnalisis(
                regla=regla,
                senal="documental",
                resultado=resultado,  # type: ignore[arg-type]
                mensaje=mensaje,
                valor=valor,
                penalizacion=pen,
            )
        )

    if leido is None:
        anotar(
            "ocr.no_disponible",
            "advertencia",
            "No se pudo leer el comprobante; los datos se evaluaron tal como se declararon.",
        )
        return motivos, penalizacion

    if not leido.leyo_algo:
        anotar(
            "ocr.ilegible",
            "advertencia",
            "La foto del comprobante no se pudo leer. Una toma mas nitida permitiria "
            "verificar los datos contra el documento.",
            round(leido.confianza, 2),
        )
        return motivos, penalizacion

    # --- RUC del emisor ---
    if leido.ruc_emisor is None:
        anotar("ocr.ruc_no_leido", "advertencia", "No se pudo leer el RUC del comprobante.")
    elif leido.ruc_emisor != comprobante.ruc_emisor:
        anotar(
            "ocr.ruc_discrepa",
            "falla",
            f"El comprobante dice RUC {leido.ruc_emisor} y se declaro "
            f"{comprobante.ruc_emisor}. Revise cual de los dos es el correcto.",
            leido.ruc_emisor,
            30,
        )
    else:
        anotar(
            "ocr.ruc_coincide",
            "ok",
            "El RUC declarado coincide con el impreso en el comprobante.",
            leido.ruc_emisor,
        )

    # --- Serie y numero ---
    if leido.serie is None or leido.numero is None:
        anotar(
            "ocr.serie_no_leida",
            "advertencia",
            "No se pudo leer la serie y el numero del comprobante.",
        )
    elif leido.serie != comprobante.serie.upper() or not _numero_igual(
        leido.numero, comprobante.numero
    ):
        anotar(
            "ocr.serie_discrepa",
            "falla",
            f"El comprobante es el {leido.serie}-{leido.numero} y se declaro "
            f"{comprobante.serie}-{comprobante.numero}.",
            f"{leido.serie}-{leido.numero}",
            30,
        )
    else:
        anotar(
            "ocr.serie_coincide",
            "ok",
            "La serie y el numero coinciden con el comprobante.",
            f"{leido.serie}-{leido.numero}",
        )

    # --- Total ---
    # Si la linea del total no se leyo pero si el subtotal y el IGV, el total
    # es su suma; el mensaje lo dice para no presentar como leida una cifra
    # calculada.
    if leido.total_deducido:
        origen = "La suma del subtotal y el IGV impresos da"
    elif leido.qr:
        origen = "El codigo QR del comprobante dice"
    else:
        origen = "El comprobante dice"
    if leido.total is None:
        anotar("ocr.total_no_leido", "advertencia", "No se pudo leer el importe total.")
    elif abs(leido.total - comprobante.total) > TOLERANCIA_IMPORTE:
        anotar(
            "ocr.total_discrepa",
            "falla",
            f"{origen} S/ {leido.total:.2f} y se declaro S/ {comprobante.total:.2f}.",
            leido.total,
            35,
        )
    else:
        if leido.total_deducido:
            detalle = " (suma del subtotal y el IGV impresos)"
        elif leido.qr:
            detalle = " (segun su codigo QR)"
        else:
            detalle = ""
        anotar(
            "ocr.total_coincide",
            "ok",
            f"El importe declarado coincide con el comprobante "
            f"(S/ {leido.total:.2f}){detalle}.",
            leido.total,
        )

    # --- Fecha de emision ---
    declarada = _a_fecha(comprobante.fecha_emision)
    if leido.fecha_emision and declarada and leido.fecha_emision != declarada:
        anotar(
            "ocr.fecha_discrepa",
            "advertencia",
            f"El comprobante esta fechado el {leido.fecha_emision.isoformat()} y se "
            f"declaro {declarada.isoformat()}.",
            leido.fecha_emision.isoformat(),
            15,
        )
    elif leido.fecha_emision and declarada:
        anotar("ocr.fecha_coincide", "ok", "La fecha coincide con la del comprobante.")

    return motivos, penalizacion
