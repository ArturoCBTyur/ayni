"""Boletas y evidencias de ejemplo para subir desde la aplicacion.

    python ejemplos.py                      genera los dos juegos con fecha de hoy
    python ejemplos.py --fecha 2026-10-09   con la fecha del dia de la clase
    python ejemplos.py --verificar          ademas pasa cada caso por el motor

Escribe dos carpetas en el Escritorio, cada una con sus imagenes y una GUIA.txt
con lo que hay que teclear:

    boletas-ayni-ensayo   para practicar antes; numeros 0062xx
    boletas-ayni-clase    para exponer; numeros 0061xx, despues de las tres
                          de `python probar.py archivos`

Los dos juegos no comparten ni un numero de comprobante ni una evidencia. Asi,
lo que se gaste ensayando no bloquea nada en clase: la base rechaza un
comprobante con la misma serie y numero, y una evidencia que se parezca a otra
ya presentada, aunque se haya recortado.

La fecha impresa importa. El lector compara la fecha del papel con la que se
teclea, y la aplicacion propone la de hoy: una boleta impresa ayer resta
puntos sin que nadie sepa por que. Hay que generarlas el mismo dia en que se
suben.

--verificar no toca la base: dibuja cada boleta, se la sirve al motor de AIni
en local y muestra lo que lee y el nivel que daria. Sirve para saber de
antemano que va a pasar. El contexto (historico, saldo, proveedor conocido) es
el de por defecto, asi que el puntaje en la aplicacion puede variar unos
puntos; lo que lee el lector, no.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))

from probar import _dibujar_evidencia  # noqa: E402

VERDE = "\033[32m"
AMBAR = "\033[33m"
ROJO = "\033[31m"
GRIS = "\033[90m"
FIN = "\033[0m"

SERIE = "B001"


def ruc_valido(base: str) -> str:
    """Completa diez digitos con el verificador de modulo 11 de SUNAT."""
    pesos = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
    resto = 11 - sum(int(d) * p for d, p in zip(base, pesos)) % 11
    return base + str({10: 0, 11: 1}.get(resto, resto))


@dataclass(frozen=True)
class Emisor:
    nombre: str
    direccion: str
    ruc: str


SAN_ROQUE = Emisor("CLINICA VETERINARIA SAN ROQUE S.A.C.", "Av. Alameda 456 - Amarilis, Huanuco", "20601030579")
AMARILIS = Emisor("VETERINARIA AMARILIS E.I.R.L.", "Jr. Dos de Mayo 1120 - Huanuco", ruc_valido("2060945871"))
INMOBILIARIA = Emisor("INMOBILIARIA LOS ANDES S.A.C.", "Jr. Huallayco 310 - Huanuco", ruc_valido("2048731266"))
DISTRIBUIDORA = Emisor("DISTRIBUIDORA MASCOTAS HUANUCO S.A.C.", "Av. Universitaria 802 - Pillco Marca", ruc_valido("2060318842"))
RESTAURANTE = Emisor("RESTAURANTE EL BUEN SABOR E.I.R.L.", "Jr. General Prado 645 - Huanuco", ruc_valido("2057390124"))

VETERINARIA = "Atencion veterinaria"
ALIMENTOS = "Alimentos para rescate animal"
CATEGORIA = {VETERINARIA: "ATENCION_VETERINARIA", ALIMENTOS: "ALIMENTOS"}


@dataclass
class Caso:
    archivo: str
    emisor: Emisor
    numero: str
    total: float
    item: str
    fondo: str
    concepto: str
    que_pasa: str
    escribe_libro: bool
    #: Lo que se teclea cuando difiere de lo impreso.
    monto: float | None = None
    ruc_tecleado: str | None = None
    numero_tecleado: str | None = None
    dias_antes: int = 0
    rechazo: bool = False
    evidencia: str = ""
    extra: list[str] = field(default_factory=list)


def casos(juego: str) -> list[Caso]:
    """Los mismos casos en los dos juegos, con numeros y montos distintos."""
    c = juego == "clase"
    n = (lambda k: f"0061{k:02d}") if c else (lambda k: f"0062{k:02d}")
    lista = [
        Caso(
            "4-alquiler-de-oficina.jpg", INMOBILIARIA, n(4), 95.00, "Alquiler de oficina - octubre",
            VETERINARIA, "alquiler de oficina administrativa",
            "MEDIO. El papel esta perfecto; AIni ve que un alquiler no es atencion veterinaria.",
            escribe_libro=False,
        ),
        Caso(
            "5-ruc-equivocado.jpg", AMARILIS, n(5), 64.00, "Consulta y curacion",
            VETERINARIA, "consulta veterinaria y curacion de una gata herida",
            "MEDIO. Se teclea el RUC de San Roque, que es valido; el papel dice otro. Solo el lector lo ve.",
            escribe_libro=False, ruc_tecleado=SAN_ROQUE.ruc,
        ),
        Caso(
            "6-numero-transpuesto.jpg", SAN_ROQUE, n(6), 52.00, "Radiografia",
            VETERINARIA, "radiografia y atencion de un perro con fractura",
            "MEDIO. Se teclea el numero con dos digitos cambiados de lugar.",
            escribe_libro=False, numero_tecleado=n(6)[:-2] + n(6)[-1] + n(6)[-2],
        ),
        Caso(
            "7-boleta-vieja.jpg", SAN_ROQUE, n(7), 46.00, "Curacion de herida",
            VETERINARIA, "consulta veterinaria y curacion de una gata herida",
            "Advertencia de fecha: el papel es de hace 75 dias y se teclea la de hoy. "
            "Una boleta vieja presentada como nueva.",
            escribe_libro=False, dias_antes=75,
        ),
        Caso(
            "8-almuerzo-del-equipo.jpg", RESTAURANTE, n(8), 60.00, "Menu ejecutivo x 6",
            ALIMENTOS, "almuerzo del equipo de rescate",
            "MEDIO. Es comida, pero de personas: el fondo es para alimentar animales.",
            escribe_libro=False,
        ),
        Caso(
            "9-alimento-balanceado.jpg", DISTRIBUIDORA, n(9), 85.00 if c else 80.00, "Alimento balanceado 15 kg",
            ALIMENTOS, "alimento balanceado para perros rescatados",
            "ALTO, se aprueba solo y se aplica a las donaciones del fondo de alimentos.",
            escribe_libro=True,
        ),
        Caso(
            "10-boleta-para-foto-reciclada.jpg", SAN_ROQUE, n(10), 70.00, "Consulta veterinaria",
            VETERINARIA, "consulta veterinaria y curacion de una gata herida",
            "RECHAZADO al adjuntar la evidencia: es la foto del caso 1 recortada y vuelta a guardar.",
            escribe_libro=False, rechazo=True, evidencia="evidencia-1-recortada.jpg",
        ),
        Caso(
            "11-boleta-de-350.jpg", SAN_ROQUE, n(11), 350.00, "Cirugia mayor",
            VETERINARIA, "cirugia veterinaria de un perro atropellado",
            "RECHAZADO al registrar: el fondo no tiene S/ 350 retenidos. No se gasta lo que no entro.",
            escribe_libro=False, rechazo=True,
        ),
    ]
    if not c:
        # El ensayo trae tambien los tres casos del guion, con sus propios
        # numeros, para practicar el acto principal sin gastar los de clase.
        lista = [
            Caso(
                "1-boleta-de-72.jpg", SAN_ROQUE, n(1), 72.00, "Consulta veterinaria",
                VETERINARIA, "cirugia veterinaria de un perro atropellado",
                "ALTO, se aprueba solo. Escribe en el libro y gasta S/ 72 del fondo.",
                escribe_libro=True,
            ),
            Caso(
                "2-boleta-de-30-pero-declare-90.jpg", SAN_ROQUE, n(2), 30.00, "Atencion veterinaria",
                VETERINARIA, "cirugia veterinaria de un perro atropellado",
                "MEDIO. El papel dice S/ 30 y se declara S/ 90: el acto principal.",
                escribe_libro=False, monto=90.00,
            ),
            Caso(
                "3-boleta-ilegible.jpg", SAN_ROQUE, n(3), 30.00, "Atencion veterinaria",
                VETERINARIA, "cirugia veterinaria de un perro atropellado",
                "MEDIO. El lector no pudo leer: NO resta puntos, pero sin verificar el papel "
                "no se aprueba solo y pasa a revision.",
                escribe_libro=False,
            ),
        ] + lista
    return lista


def _dibujar(ruta: Path, caso: Caso, fecha: date) -> None:
    """Una boleta de venta con el formato habitual en el Peru."""
    from PIL import Image, ImageDraw, ImageFont

    def fuente(tam: int, negrita: bool):
        for nombre in (("arialbd.ttf" if negrita else "arial.ttf"), "DejaVuSans.ttf"):
            try:
                return ImageFont.truetype(nombre, tam)
            except OSError:
                continue
        return ImageFont.load_default()

    total = caso.total
    subtotal = round(total / 1.18, 2)
    e = caso.emisor
    lineas = [
        (e.nombre, 23 if len(e.nombre) > 34 else 25, True),
        (e.direccion, 17, False),
        (f"RUC: {e.ruc}", 25, True),
        ("", 8, False),
        ("BOLETA DE VENTA ELECTRONICA", 21, True),
        (f"{SERIE}-{caso.numero}", 26, True),
        ("", 8, False),
        (f"Fecha de emision: {fecha:%d/%m/%Y}", 18, False),
        ("Cliente: ASOCIACION HUELLAS DEL ANDE", 18, False),
        ("", 12, False),
        ("Descripcion                    Importe", 17, False),
        (f"{caso.item[:30]:<30} {subtotal:.2f}", 17, False),
        ("", 12, False),
        (f"OP. GRAVADA:        S/   {subtotal:.2f}", 19, False),
        (f"IGV (18%):          S/    {total - subtotal:.2f}", 19, False),
        (f"IMPORTE TOTAL:      S/   {total:.2f}", 24, True),
    ]
    img = Image.new("RGB", (620, 760), "white")
    dibujo = ImageDraw.Draw(img)
    y = 30
    for texto, tam, negrita in lineas:
        if texto:
            dibujo.text((38, y), texto, fill=(17, 17, 17), font=fuente(tam, negrita))
        y += tam + 13
    img.save(ruta, quality=92)


def _recortar(origen: Path, destino: Path) -> None:
    """La misma foto, recortada un poco y vuelta a guardar: otro SHA-256, casi el mismo dHash."""
    from PIL import Image

    img = Image.open(origen)
    ancho, alto = img.size
    # Un 1.5 % de recorte ya puso una de las fotos a distancia 6, por encima
    # del umbral de 5: el reciclaje que se quiere ensenar pasaba. Recorte
    # minimo y cambio de tamaño, que es lo que hace quien reenvia una foto.
    m = int(ancho * 0.005)
    recortada = img.crop((m, m, ancho - m, alto - m))
    recortada.resize((int(recortada.width * 0.9), int(recortada.height * 0.9))).save(destino, quality=80)


def generar(juego: str, carpeta: Path, hoy: date, semilla_base: int) -> list[tuple[Caso, Path, date]]:
    from PIL import Image, ImageFilter

    carpeta.mkdir(parents=True, exist_ok=True)
    hechos: list[tuple[Caso, Path, date]] = []
    lista = casos(juego)

    for i, caso in enumerate(lista, start=1):
        fecha = hoy - timedelta(days=caso.dias_antes)
        ruta = carpeta / caso.archivo
        _dibujar(ruta, caso, fecha)
        if "ilegible" in caso.archivo:
            Image.open(ruta).filter(ImageFilter.GaussianBlur(7)).save(ruta, quality=70)
        if not caso.evidencia:
            caso.evidencia = f"evidencia-{caso.archivo.split('-')[0]}.jpg"
            _dibujar_evidencia(carpeta / caso.evidencia, semilla=semilla_base + i * 151)
        hechos.append((caso, ruta, fecha))

    # La foto reciclada sale de la evidencia del caso 1 de cada juego: en clase
    # es la de `probar.py archivos`, que vive en la otra carpeta.
    origen = carpeta / "evidencia-1.jpg" if juego == "ensayo" else carpeta.parent / "boletas-ayni" / "evidencia-1.jpg"
    if origen.exists():
        _recortar(origen, carpeta / "evidencia-1-recortada.jpg")
    else:
        print(f"  {AMBAR}Falta {origen}: corra antes `python probar.py archivos`.{FIN}")

    _escribir_guia(juego, carpeta, hechos)
    return hechos


def _escribir_guia(juego: str, carpeta: Path, hechos: list[tuple[Caso, Path, date]]) -> None:
    lineas = [
        f"AYNI - BOLETAS DE {'CLASE' if juego == 'clase' else 'ENSAYO'}",
        "",
        "Se entra como ong.operador@demo.pe > Gastos > Registrar gasto.",
        "Proveedor: el nombre que dice la boleta. Tipo: Boleta. Serie: B001.",
        "Fecha de emision: la que propone la app (hoy), salvo que se indique otra cosa.",
        "",
    ]
    if juego == "clase":
        lineas += [
            "Los casos 1, 2 y 3 son los de la carpeta boletas-ayni (el guion).",
            "Despues de esos, en cualquier orden:",
            "",
        ]
    else:
        lineas += [
            "Este juego es para practicar. Los numeros (0062xx) y las evidencias no se",
            "repiten en el juego de clase, asi que ensayar no bloquea nada en la expo.",
            "Lo que si se gasta es saldo: los casos marcados ESCRIBE EN EL LIBRO aprueban",
            "solos y consumen dinero retenido. Si quiere dejar la base como antes, pida",
            "restaurar el respaldo despues de ensayar.",
            "",
        ]
    for caso, ruta, fecha in hechos:
        monto = caso.monto if caso.monto is not None else caso.total
        lineas += [
            "-" * 72,
            ruta.name,
            f"  Fondo       {caso.fondo}",
            f"  Monto       {monto:.2f}" + (f"   (el papel dice {caso.total:.2f})" if caso.monto else ""),
            f"  Concepto    {caso.concepto}",
            f"  Proveedor   {caso.emisor.nombre.title()}",
            f"  RUC         {caso.ruc_tecleado or caso.emisor.ruc}"
            + (f"   (el papel dice {caso.emisor.ruc})" if caso.ruc_tecleado else ""),
            f"  Numero      {caso.numero_tecleado or caso.numero}"
            + (f"   (el papel dice {caso.numero})" if caso.numero_tecleado else ""),
            f"  Fecha       la de hoy" + (f"   (el papel dice {fecha:%d/%m/%Y})" if caso.dias_antes else ""),
            f"  Evidencia   {caso.evidencia}",
            f"  Que pasa    {caso.que_pasa}",
            f"  {'ESCRIBE EN EL LIBRO: no se puede deshacer' if caso.escribe_libro else 'No escribe en el libro'}",
        ]
    lineas += [
        "-" * 72,
        "",
        "Sin archivo nuevo: volver a subir una boleta ya registrada (por ejemplo la 1)",
        "con su mismo numero. La base la rechaza por duplicada y no escribe nada.",
    ]
    (carpeta / "GUIA.txt").write_text("\n".join(lineas) + "\n", encoding="utf-8")


def verificar(hechos: list[tuple[Caso, Path, date]], hoy: date) -> None:
    """Pasa cada boleta por el motor de AIni, sin base de datos."""
    import functools
    import http.server
    import threading

    from aini import anomalia, motor
    from aini.contrato import (
        Comprobante,
        Contexto,
        Declarado,
        EntradaAnalisis,
        Evidencia,
        ReglaUmbrales,
    )

    detector = anomalia.DetectorAnomalias.cargar()
    carpeta = hechos[0][1].parent

    class Silencioso(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args: object) -> None:
            pass

    servidor = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(Silencioso, directory=str(carpeta))
    )
    puerto = servidor.server_address[1]
    threading.Thread(target=servidor.serve_forever, daemon=True).start()

    try:
        for caso, ruta, _fecha in hechos:
            if caso.rechazo:
                print(f"  {GRIS}{ruta.name:40} lo rechaza la API antes del motor{FIN}")
                continue
            monto = caso.monto if caso.monto is not None else caso.total
            hoy_iso = hoy.isoformat()
            entrada = EntradaAnalisis(
                gastoId="ejemplo",
                declarado=Declarado(
                    fondoId="f1",
                    categoriaGasto=CATEGORIA[caso.fondo],
                    montoDeclarado=monto,
                    concepto=caso.concepto,
                    proveedorNombre=caso.emisor.nombre.title(),
                    proveedorRuc=None,
                    fechaGasto=hoy_iso,
                    capturadoEn=hoy_iso,
                ),
                comprobante=Comprobante(
                    tipo="BOLETA",
                    rucEmisor=caso.ruc_tecleado or caso.emisor.ruc,
                    serie=SERIE,
                    numero=caso.numero_tecleado or caso.numero,
                    fechaEmision=hoy_iso,
                    subtotal=round(monto / 1.18, 2),
                    igv=round(monto - monto / 1.18, 2),
                    total=monto,
                    moneda="PEN",
                    hashSha256="a" * 64,
                    archivoUrl=f"http://127.0.0.1:{puerto}/{ruta.name}",
                ),
                evidencias=[
                    Evidencia(
                        id="e1", tipo="FOTO", hashSha256="b" * 64, hashPerceptual="f0f0f0f0",
                        nitidez=180.0, ancho=1200, alto=900, exifCapturadoEn=hoy_iso,
                        distanciaMinimaHistorico=24, contienePersonas=False, anonimizada=True,
                        archivoUrl="/y",
                    )
                ],
                contexto=Contexto(
                    saldoRetenido=500.0, mediaHistoricaCategoria=130.0, desviacionHistoricaCategoria=40.0,
                    proveedorConocido=True, gastosRecientesMismaCategoria=1,
                ),
                regla=ReglaUmbrales(
                    id="r1", umbralAlto=90, umbralMedio=60,
                    pesoDocumental=0.45, pesoVisual=0.25, pesoAnomalia=0.30,
                ),
            )
            r = motor.analizar(entrada, detector)
            color = {"ALTO": VERDE, "MEDIO": AMBAR, "BAJO": ROJO}.get(r.nivel, "")
            print(f"  {ruta.name:40} {color}{r.nivel:5}{FIN} {r.score_final:6}  {GRIS}{r.explicacion.resumen}{FIN}")
    finally:
        servidor.shutdown()
        servidor.server_close()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--fecha", default=date.today().isoformat(), help="fecha impresa (por defecto, hoy)")
    p.add_argument("--escritorio", default=str(Path.home() / "Desktop"), metavar="CARPETA")
    p.add_argument("--verificar", action="store_true", help="pasar cada caso por el motor, sin base")
    args = p.parse_args()

    hoy = date.fromisoformat(args.fecha)
    raiz = Path(args.escritorio).expanduser().resolve()

    for juego, semilla in (("ensayo", 9100), ("clase", 8100)):
        carpeta = raiz / f"boletas-ayni-{juego}"
        print(f"\n  {VERDE}{carpeta}{FIN}  {GRIS}(fecha impresa {hoy:%d/%m/%Y}){FIN}")
        hechos = generar(juego, carpeta, hoy, semilla)
        if args.verificar:
            verificar(hechos, hoy)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
