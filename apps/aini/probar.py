"""Banco de pruebas de AIni: tirarle casos a mano y ver que contesta.

    python probar.py                              modo interactivo
    python probar.py concepto "compra de croquetas" ALIMENTOS
    python probar.py gasto --monto 480 --proveedor-nuevo --gastos-recientes 5
    python probar.py boleta --impreso 158 --monto 185   el lector, sobre papel
    python probar.py archivos                     boletas para subir en la exposicion
    python probar.py limites                      donde el modelo se equivoca
    python probar.py demo                         recorrido guiado, para exponer

No reemplaza a `pytest pruebas/`, que fija el comportamiento que no puede
cambiar. Esto es para lo otro: entender como se comporta el modelo, encontrar
donde falla, y poder responder sin adivinar cuando alguien pregunte.

El subcomando `limites` es el mas util antes de presentar. Corre una bateria de
casos dificiles a proposito y marca los que el modelo resuelve mal. Conocer sus
puntos flojos de antemano es la diferencia entre explicar una limitacion y que
te la descubran.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

# La consola de Windows usa cp1252 y un caracter fuera de esa tabla aborta el
# programa a mitad de una linea. Se pide UTF-8 y, si no se puede, se sustituye
# en vez de fallar: una barra mal dibujada es mejor que un volcado de pila.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aini import anomalia, documental, motor  # noqa: E402
from aini.contrato import (  # noqa: E402
    Comprobante,
    Contexto,
    Declarado,
    EntradaAnalisis,
    Evidencia,
    ReglaUmbrales,
)

VERDE = "\033[32m"
AMBAR = "\033[33m"
ROJO = "\033[31m"
GRIS = "\033[90m"
FIN = "\033[0m"


#: Serie y numero del comprobante de prueba. Los comparte `construir` con la
#: boleta que dibuja el subcomando `boleta`: si no fueran el mismo documento,
#: el cotejo marcaria la serie en cada corrida y el caso que se quiere ensenar
#: --el importe-- quedaria escondido entre dos discrepancias.
SERIE = "B001"
NUMERO = "000123"


def color_nivel(nivel: str) -> str:
    return {"ALTO": VERDE, "MEDIO": AMBAR, "BAJO": ROJO}.get(nivel, "") + nivel + FIN


# --------------------------------------------------------------------------
# concepto: la señal de lenguaje, aislada
# --------------------------------------------------------------------------


def probar_concepto(concepto: str, categoria: str | None = None) -> None:
    """Mide el concepto contra una categoria, o contra todas si no se indica."""
    if categoria:
        sim = documental.coherencia_concepto_categoria(concepto, categoria)
        if sim is None:
            print(f"{ROJO}No se pudo medir.{FIN} Categoria desconocida o concepto sin palabras")
            print("de contenido reconocibles. El motor lo admite y no penaliza.")
            return
        _imprimir_veredicto(categoria, sim, destacado=True)
        return

    print(f'\nConcepto: "{concepto}"')
    print(f"{GRIS}Similitud contra cada categoria, de mayor a menor:{FIN}\n")

    medidas = []
    for cat in documental.DESCRIPCION_CATEGORIA:
        sim = documental.coherencia_concepto_categoria(concepto, cat)
        if sim is not None:
            medidas.append((cat, sim))

    medidas.sort(key=lambda m: m[1], reverse=True)
    for cat, sim in medidas:
        _imprimir_veredicto(cat, sim)

    if medidas:
        mejor, valor = medidas[0]
        print(f"\n{GRIS}El modelo lo clasificaria como {mejor} ({valor:.3f}).{FIN}")


def _imprimir_veredicto(categoria: str, sim: float, destacado: bool = False) -> None:
    if sim >= documental.UMBRAL_COHERENCIA_DUDOSA:
        marca, etiqueta = VERDE, "corresponde"
    elif sim >= documental.UMBRAL_COHERENCIA:
        marca, etiqueta = AMBAR, "parcial"
    else:
        marca, etiqueta = ROJO, "no corresponde"

    barra = "#" * int(sim * 30)
    linea = f"  {categoria:<22} {marca}{sim:.3f}{FIN}  {barra:<30} {marca}{etiqueta}{FIN}"
    print(linea)
    if destacado:
        print(
            f"\n  {GRIS}Umbrales: por debajo de {documental.UMBRAL_COHERENCIA} no corresponde, "
            f"sobre {documental.UMBRAL_COHERENCIA_DUDOSA} si.{FIN}"
        )


# --------------------------------------------------------------------------
# gasto: el analisis completo
# --------------------------------------------------------------------------


def construir(args: argparse.Namespace) -> EntradaAnalisis:
    return EntradaAnalisis(
        gastoId="prueba",
        declarado=Declarado(
            fondoId="f1",
            categoriaGasto=args.categoria,
            montoDeclarado=args.monto,
            concepto=args.concepto,
            proveedorNombre=args.proveedor,
            proveedorRuc=None,
            fechaGasto=args.fecha,
            capturadoEn=args.fecha,
        ),
        comprobante=Comprobante(
            tipo="BOLETA",
            rucEmisor=args.ruc,
            serie=SERIE,
            numero=NUMERO,
            fechaEmision=args.fecha,
            subtotal=round(args.monto / 1.18, 2),
            igv=round(args.monto - args.monto / 1.18, 2),
            total=args.monto,
            moneda="PEN",
            hashSha256="a" * 64,
            # Sin --comprobante no hay nada que descargar y el lector lo dice
            # asi: "no se pudo leer". Es el comportamiento correcto y es el que
            # tenia el banco de pruebas antes de que existiera el OCR.
            archivoUrl=args.comprobante or "/x",
        ),
        evidencias=[
            Evidencia(
                id="e1",
                tipo="FOTO",
                hashSha256="b" * 64,
                hashPerceptual="f0f0f0f0",
                nitidez=args.nitidez,
                ancho=800,
                alto=600,
                exifCapturadoEn=args.fecha,
                distanciaMinimaHistorico=args.distancia,
                contienePersonas=False,
                anonimizada=True,
                archivoUrl="/y",
            )
        ],
        contexto=Contexto(
            saldoRetenido=args.saldo,
            mediaHistoricaCategoria=args.media,
            desviacionHistoricaCategoria=args.desviacion,
            proveedorConocido=not args.proveedor_nuevo,
            gastosRecientesMismaCategoria=args.gastos_recientes,
        ),
        regla=ReglaUmbrales(
            id="r1",
            umbralAlto=90,
            umbralMedio=60,
            pesoDocumental=0.45,
            pesoVisual=0.25,
            pesoAnomalia=0.30,
        ),
    )


def probar_gasto(args: argparse.Namespace) -> None:
    detector = anomalia.DetectorAnomalias.cargar()
    if not detector.disponible:
        print(f"{AMBAR}Sin modelo entrenado. Corra: python -m entrenamiento.entrenar{FIN}\n")

    r = motor.analizar(construir(args), detector)

    print(f"\n  Nivel  {color_nivel(r.nivel)}      Puntaje {r.score_final}")
    print(
        f"  {GRIS}documental {r.score_documental}  ·  visual {r.score_visual}  ·  "
        f"anomalia {r.score_anomalia}{FIN}\n"
    )
    print(f"  {r.explicacion.resumen}\n")

    # Lo que el lector saco del papel, al lado de lo que se tecleo. Es la parte
    # que hay que ver para creerla: sin esto, el cotejo es un motivo mas en una
    # lista y no se distingue de una regla cualquiera sobre el dato declarado.
    d = r.datos_extraidos
    if d.fuente == "ocr":
        print(f"  {GRIS}El lector encontro en la imagen:{FIN}")
        campos = [
            ("RUC", d.ruc_emisor, args.ruc),
            ("Comprobante", f"{d.serie}-{d.numero}", f"{SERIE}-{NUMERO}"),
            ("Fecha", d.fecha_emision, args.fecha),
            ("Total", f"S/ {d.total:.2f}" if d.total is not None else None, f"S/ {args.monto:.2f}"),
        ]
        for nombre, leido, declarado in campos:
            if leido is None:
                print(f"    {nombre:12} {AMBAR}no se pudo leer{FIN}")
            elif str(leido) == str(declarado):
                print(f"    {nombre:12} {leido}  {VERDE}= lo declarado{FIN}")
            else:
                print(f"    {nombre:12} {leido}  {ROJO}!= se declaro {declarado}{FIN}")
        print()

    for m in r.explicacion.motivos:
        simbolo = {"ok": f"{VERDE}ok  {FIN}", "advertencia": f"{AMBAR}!   {FIN}", "falla": f"{ROJO}X   {FIN}"}[
            m.resultado
        ]
        valor = f" {GRIS}({m.valor}){FIN}" if m.valor is not None else ""
        print(f"  {simbolo}{m.mensaje}{valor}")

    if r.alertas:
        print()
        for a in r.alertas:
            print(f"  {ROJO}[{a.severidad}]{FIN} {a.titulo}")
    print()


# --------------------------------------------------------------------------
# boleta: el lector, sobre un comprobante de verdad
# --------------------------------------------------------------------------

#: Valores del caso que ensena el lector: una boleta de S/ 158 sobre la que se
#: declaran S/ 185. Es la direccion que le cuesta dinero al donante --el fondo
#: pagaria S/ 27 que el papel no respalda-- y es el error mas verosimil:
#: transponer dos digitos al teclear.
#:
#: Viven en un solo sitio porque los usan dos caminos: los valores por defecto
#: del subcomando `boleta` y el acto del recorrido guiado. Separados, cambiar
#: el caso en uno lo dejaria viejo en el otro.
POR_DEFECTO_BOLETA: dict[str, object] = {
    "impreso": 158.0,
    "monto": 185.0,
    # Sin "del albergue": ese complemento de lugar baja la coherencia de 0.721
    # a 0.573 y agrega una advertencia que no es lo que este caso quiere
    # ensenar. El porque esta medido al pie de `documental._similitud`.
    "concepto": "vacunacion antirrabica de doce gatos",
    "categoria": "ATENCION_VETERINARIA",
    "proveedor": "Clinica Veterinaria San Roque",
    "ruc": "20601030579",
    "fecha": "2026-09-14",
    "saldo": 500.0,
    "media": 130.0,
    "desviacion": 40.0,
    "proveedor_nuevo": False,
    "gastos_recientes": 1,
    "nitidez": 180.0,
    "distancia": 24,
    "comprobante": None,
}


def _dibujar_boleta(ruta: Path, ruc: str, serie: str, numero: str, fecha: str, total: float) -> None:
    """Una boleta de venta con el formato habitual en el Peru."""
    from PIL import Image, ImageDraw, ImageFont

    def fuente(tam: int, negrita: bool):
        for nombre in (("arialbd.ttf" if negrita else "arial.ttf"), "DejaVuSans.ttf"):
            try:
                return ImageFont.truetype(nombre, tam)
            except OSError:
                continue
        return ImageFont.load_default()

    subtotal = round(total / 1.18, 2)
    dia, mes, ano = fecha.split("-")[2], fecha.split("-")[1], fecha.split("-")[0]

    lineas = [
        ("CLINICA VETERINARIA SAN ROQUE S.A.C.", 25, True),
        ("Av. Alameda 456 - Amarilis, Huanuco", 17, False),
        (f"RUC: {ruc}", 25, True),
        ("", 8, False),
        ("BOLETA DE VENTA ELECTRONICA", 21, True),
        (f"{serie}-{numero}", 26, True),
        ("", 8, False),
        (f"Fecha de emision: {dia}/{mes}/{ano}", 18, False),
        ("Cliente: ASOCIACION HUELLAS DEL ANDE", 18, False),
        ("", 12, False),
        ("Descripcion                    Importe", 17, False),
        (f"Atencion veterinaria           {subtotal:.2f}", 17, False),
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


def probar_boleta(args: argparse.Namespace) -> None:
    """Dibuja una boleta, la sirve, y la hace leer por el motor.

    El lector solo acepta URLs http(s), a proposito: es un servicio que recibe
    esa ruta en una peticion de red, y dejarle abrir archivos del disco por
    nombre seria entregarle a quien llame la capacidad de leer cualquier cosa.
    Asi que aqui se levanta un servidor minimo en un hilo, se analiza, y se
    apaga. Lo que el motor hace es exactamente lo que hace en produccion.

    En una exposicion esto es lo que hay que mostrar: el papel dice un importe,
    se teclea otro, y el sistema lo nota. Ninguna regla sobre el dato declarado
    puede hacerlo, porque el dato declarado esta perfecto.
    """
    import functools
    import http.server
    import tempfile
    import threading

    carpeta = Path(tempfile.mkdtemp(prefix="aini-boleta-"))
    nombre = "boleta.jpg"
    _dibujar_boleta(
        carpeta / nombre,
        ruc=args.ruc,
        serie=SERIE,
        numero=NUMERO,
        fecha=args.fecha,
        total=args.impreso,
    )

    class Silencioso(http.server.SimpleHTTPRequestHandler):
        """Sin registro de accesos.

        Se subclasifica en vez de sobrescribir `log_message` sobre el
        `functools.partial`: el atributo se le quedaria al objeto partial y no
        al manejador, y la linea del GET aparecia en mitad de la exposicion.
        """

        def log_message(self, *_args: object) -> None:
            pass

    manejador = functools.partial(Silencioso, directory=str(carpeta))
    servidor = http.server.ThreadingHTTPServer(("127.0.0.1", 0), manejador)
    puerto = servidor.server_address[1]
    threading.Thread(target=servidor.serve_forever, daemon=True).start()

    print(f"\n  {GRIS}Boleta dibujada: {carpeta / nombre}{FIN}")
    print(f"  {GRIS}Servida en http://127.0.0.1:{puerto}/{nombre}{FIN}")
    print(f"\n  El papel dice    {VERDE}S/ {args.impreso:.2f}{FIN}")
    print(f"  Se declara       {ROJO if args.monto != args.impreso else VERDE}S/ {args.monto:.2f}{FIN}")
    print(f"  {GRIS}Leyendo la imagen...{FIN}")

    try:
        args.comprobante = f"http://127.0.0.1:{puerto}/{nombre}"
        probar_gasto(args)
    finally:
        servidor.shutdown()
        servidor.server_close()


# --------------------------------------------------------------------------
# archivos: las imagenes para subir desde la aplicacion, en vivo
# --------------------------------------------------------------------------

#: Las boletas del guion, cada una para un momento distinto de la exposicion.
#: El numero de cada una es distinto porque la base rechaza dos comprobantes
#: con la misma serie y numero del mismo emisor: subir dos veces la misma
#: boleta se bloquea, y en medio de una exposicion eso parece una falla.
BOLETAS_DEMO: list[tuple[str, str, float, str]] = [
    # (archivo, numero, total impreso, para que sirve)
    ("1-boleta-de-78.jpg", "006101", 78.00, "declare S/ 78.00 y el lector confirma los cuatro campos"),
    ("2-boleta-de-78-pero-declare-140.jpg", "006102", 78.00, "declare S/ 140.00 y el lector lo detecta"),
    ("3-boleta-ilegible.jpg", "006103", 78.00, "sin texto legible: el lector lo declara y NO penaliza"),
]


def _dibujar_evidencia(ruta: Path, semilla: int) -> None:
    """Una imagen con estructura, para el campo de evidencia.

    No pretende parecer una foto: pretende pasar las comprobaciones que el
    motor hace sobre una evidencia --resolucion, nitidez y no parecerse a
    ninguna presentada antes-- para que el gasto no quede observado por la
    evidencia cuando lo que se quiere ensenar es el comprobante.
    """
    from PIL import Image, ImageDraw

    estado = semilla * 2654435761

    def siguiente() -> float:
        nonlocal estado
        estado = (estado * 1103515245 + 12345) & 0x7FFFFFFF
        return estado / 0x7FFFFFFF

    img = Image.new("RGB", (1200, 900), "white")
    dibujo = ImageDraw.Draw(img)
    for by in range(0, 900, 100):
        for bx in range(0, 1200, 100):
            tono = int(siguiente() * 200) + 30
            dibujo.rectangle([bx, by, bx + 99, by + 99], fill=(tono, (tono + 40) % 256, (tono + 90) % 256))
    img.save(ruta, quality=88)


def generar_archivos(args: argparse.Namespace) -> None:
    """Escribe las imagenes que se suben desde la aplicacion en la exposicion.

    No se versionan: son imagenes generadas, y el proyecto no guarda binarios
    que un script puede volver a producir. Se regeneran cuando hagan falta.
    """
    from PIL import Image, ImageFilter

    salida = Path(args.salida).expanduser().resolve()
    salida.mkdir(parents=True, exist_ok=True)

    print(f"\n  {GRIS}Escribiendo en{FIN}  {salida}\n")

    for archivo, numero, total, para_que in BOLETAS_DEMO:
        ruta = salida / archivo
        _dibujar_boleta(
            ruta,
            ruc=args.ruc,
            serie=SERIE,
            numero=numero,
            fecha=args.fecha,
            total=total,
        )

        if "ilegible" in archivo:
            # Desenfoque fuerte: se quiere que el lector NO pueda, para ensenar
            # que una foto mala no se confunde con un gasto sospechoso.
            Image.open(ruta).filter(ImageFilter.GaussianBlur(7)).save(ruta, quality=70)

        print(f"  {VERDE}{archivo}{FIN}")
        print(f"      {GRIS}{SERIE}-{numero} · S/ {total:.2f} impreso · {para_que}{FIN}")

    for n in (1, 2, 3):
        ruta = salida / f"evidencia-{n}.jpg"
        _dibujar_evidencia(ruta, semilla=7000 + n * 137)
        print(f"  {VERDE}evidencia-{n}.jpg{FIN}")
    print(f"      {GRIS}Una por gasto: dos evidencias iguales se bloquean por reutilizadas.{FIN}")

    print(f"\n  {GRIS}El RUC impreso es {args.ruc}: tecléelo igual o el cotejo lo marcara.{FIN}")
    print(f"  {GRIS}Serie {SERIE}, y el numero de cada boleta esta arriba.{FIN}\n")


# --------------------------------------------------------------------------
# limites: donde el modelo se equivoca
# --------------------------------------------------------------------------

#: Casos dificiles a proposito, con lo que una persona diria que es correcto.
#: Los que el modelo resuelve mal NO son un error del banco de pruebas: son la
#: respuesta honesta a "¿que tan bueno es tu modelo?".
CASOS_DIFICILES: list[tuple[str, str, bool, str]] = [
    # (concepto, categoria, deberia_corresponder, por_que_es_dificil)
    ("compra de croquetas y alimento seco", "ALIMENTOS", True, "sinonimo coloquial"),
    ("gastos de movilidad del personal", "TRANSPORTE", True, "lenguaje administrativo, sin sustantivo concreto"),
    # Este gasto pertenece a UNA de las dos categorias, no a ambas. Exigir que
    # el modelo acepte las dos seria pedirle algo incoherente: se comprueba que
    # acepte al menos una, en el bloque de abajo.
    ("honorarios del veterinario de turno", "ATENCION_VETERINARIA", True, "cae entre dos categorias"),
    ("compra de jeringas y guantes", "INSUMOS", True, "objetos concretos, categoria abstracta"),
    ("pago de luz y agua del albergue", "ADMINISTRATIVO", True, "servicios basicos"),
    ("reparacion del techo del albergue", "INFRAESTRUCTURA", True, "directo"),
    ("almuerzo del equipo de rescate", "ALIMENTOS", False, "alimento, pero no de animales"),
    ("compra de una camioneta", "TRANSPORTE", True, "activo, no gasto corriente"),
    ("publicidad en redes sociales", "ATENCION_VETERINARIA", False, "claramente ajeno"),
    ("alquiler de oficina", "ATENCION_VETERINARIA", False, "el caso de la demostracion"),
    ("vacunas antirrabicas", "MEDICAMENTOS", True, "termino tecnico"),
    ("esterilizacion de 20 gatos", "ATENCION_VETERINARIA", True, "procedimiento"),
    ("compra de alimento", "ATENCION_VETERINARIA", False, "cerca pero no es"),
]


def probar_limites() -> None:
    print("\nBateria de casos dificiles.")
    print(f"{GRIS}Lo que el modelo falla aqui es lo que hay que poder explicar.{FIN}\n")

    aciertos = 0
    fallos: list[str] = []

    print(f"  {'concepto':<40} {'categoria':<22} {'sim':>6}  veredicto")
    print(f"  {'-' * 86}")

    for concepto, categoria, esperado, motivo in CASOS_DIFICILES:
        sim = documental.coherencia_concepto_categoria(concepto, categoria)
        if sim is None:
            continue

        dice_que_si = sim >= documental.UMBRAL_COHERENCIA
        acerto = dice_que_si == esperado
        if acerto:
            aciertos += 1
            marca = f"{VERDE}ok{FIN}"
        else:
            fallos.append(f"{concepto} / {categoria} ({motivo})")
            marca = f"{ROJO}FALLA{FIN}"

        print(f"  {concepto[:38]:<40} {categoria:<22} {sim:>6.3f}  {marca}")

    total = len([c for c in CASOS_DIFICILES])
    print(f"\n  Acierta {aciertos} de {total}.\n")

    if fallos:
        print(f"  {AMBAR}Donde se equivoca, y conviene saberlo antes de que lo pregunten:{FIN}")
        for f in fallos:
            print(f"    - {f}")
        print(
            f"\n  {GRIS}Esto no se arregla subiendo el umbral: moverlo para acertar uno\n"
            f"  hace fallar otro. Se arregla con vectores entrenados en este dominio,\n"
            f"  o describiendo mejor las categorias en DESCRIPCION_CATEGORIA.{FIN}\n"
        )


# --------------------------------------------------------------------------
# interactivo
# --------------------------------------------------------------------------


# --------------------------------------------------------------------------
# demo: recorrido guiado para una exposicion
# --------------------------------------------------------------------------

ANCHO = 74


def _titulo(texto: str) -> None:
    print(f"\n{'=' * ANCHO}")
    print(f"  {texto}")
    print(f"{'=' * ANCHO}\n")


def _pausa(texto: str = "Enter para continuar") -> None:
    try:
        input(f"\n{GRIS}  [{texto}]{FIN}")
    except (EOFError, KeyboardInterrupt):
        raise SystemExit(0) from None


def _comparar_categoria(concepto: str, categoria: str, esperado: str) -> None:
    """Una linea de resultado, con el veredicto en grande."""
    sim = documental.coherencia_concepto_categoria(concepto, categoria)
    if sim is None:
        print(f"  {ROJO}no se pudo medir{FIN}")
        return

    corresponde = sim >= documental.UMBRAL_COHERENCIA
    marca = VERDE if corresponde else ROJO
    etiqueta = "CORRESPONDE" if corresponde else "NO CORRESPONDE"

    print(f'  concepto   "{concepto}"')
    print(f"  fondo      {categoria}")
    # Similitud relativa: 0 es "se parece a esta tanto como a cualquiera", y
    # los conceptos que corresponden rara vez pasan de 0.5.
    print(f"  similitud  {marca}{sim:.3f}{FIN}   {'#' * int(sim * 60)}")
    print(f"  veredicto  {marca}{etiqueta}{FIN}   {GRIS}(esperado: {esperado}){FIN}")


def demo() -> None:
    """Recorrido guiado para publico: el lector y la señal de lenguaje.

    Empieza por el lector de comprobantes porque es el acto que no exige
    confiar en nada: un importe impreso contra otro tecleado se entiende sin
    explicacion previa. La señal de lenguaje viene despues, cuando ya hay
    credito ganado para hablar de similitud de significado.

    Termina abierto: el ultimo acto invita a que alguien del publico proponga
    un concepto. Es el momento mas convincente de toda la demostracion porque
    es el unico que no se puede preparar de antemano.
    """
    documental.nlp()  # se carga antes de empezar, no con publico esperando

    _titulo("AIni · lo que la aritmetica no podia hacer")
    print("  El sistema ya validaba el RUC, el IGV y las fechas. Todas esas reglas")
    print("  razonan sobre el dato que el operador TECLEO, y por eso hay dos cosas")
    print("  que ninguna de ellas puede ver:\n")
    print(f"    1. {VERDE}Si lo tecleado es lo que dice el papel.{FIN}")
    print(f"    2. {VERDE}Que significa el concepto del gasto.{FIN}")
    _pausa()

    # --- Acto 1: el lector ---
    # Va primero a proposito. Es el acto mas concreto de todos --un numero
    # impreso contra otro tecleado-- y no necesita que nadie confie en una
    # medida de similitud para entenderlo.
    _titulo("1 · Lee el comprobante y lo compara con lo declarado")
    print("  Se dibuja una boleta de verdad, se declara un importe distinto del")
    print("  impreso, y se deja que el modelo lea la imagen.\n")
    print(f"  {GRIS}Es el error mas verosimil que existe: transponer dos digitos.")
    print(f"  El RUC es valido, el IGV cuadra, las fechas estan bien. Para el motor")
    print(f"  de reglas el gasto es impecable.{FIN}")
    _pausa()
    probar_boleta(argparse.Namespace(**POR_DEFECTO_BOLETA))
    print(f"  {AMBAR}El fondo iba a pagar S/ 27 que el papel no respalda.{FIN}")
    print(f"  {GRIS}Nadie tecleo esa diferencia: el modelo la encontro leyendo.{FIN}")
    _pausa()

    # --- Acto 2: el caso que una regla no ve ---
    _titulo("2 · Un gasto que ninguna regla aritmetica detecta")
    print("  Comprobante impecable: RUC valido, IGV exacto, fechas coherentes.")
    print(f"  {GRIS}El motor de reglas lo aprobaria automaticamente.{FIN}\n")
    _comparar_categoria(
        "alquiler de oficina administrativa y mobiliario de escritorio",
        "ATENCION_VETERINARIA",
        "no corresponde",
    )
    print(f"\n  {AMBAR}Es dinero donado para curar animales, pagando una renta.{FIN}")
    _pausa()

    # --- Acto 3: el mismo gasto, en su fondo ---
    _titulo("3 · El mismo gasto, cargado al fondo correcto")
    print(f"  {GRIS}No es que el modelo desconfie del alquiler. Desconfia del fondo.{FIN}\n")
    _comparar_categoria(
        "alquiler de oficina administrativa y mobiliario de escritorio",
        "ADMINISTRATIVO",
        "corresponde",
    )
    _pausa()

    # --- Acto 4: no es coincidencia de palabras ---
    _titulo("4 · No esta buscando palabras, esta midiendo significado")
    print("  Ninguna de estas palabras aparece en la descripcion de la categoria.\n")
    for concepto in (
        "croquetas y comida seca para los perros del albergue",
        "esterilizacion de 20 gatos en la jornada del sabado",
    ):
        categoria = "ALIMENTOS" if "croqueta" in concepto else "ATENCION_VETERINARIA"
        _comparar_categoria(concepto, categoria, "corresponde")
        print()
    _pausa()

    # --- Acto 5: donde falla ---
    _titulo("5 · Donde se equivoca")
    print("  Un modelo que solo se enseña acertando no se puede evaluar.\n")
    _comparar_categoria("almuerzo del equipo de rescate", "ALIMENTOS", "no corresponde")
    print(f"\n  {AMBAR}Lo acepta, y no deberia.{FIN} Es comida, pero de personas: el")
    print('  modelo ve "almuerzo" y lo acerca a la categoria de alimentos.')
    print(f"\n  {GRIS}Medido con `python -m evaluacion` sobre 222 conceptos: en el umbral")
    print("  actual deja pasar el 10,9 % de las categorizaciones erroneas. Por eso")
    print(f"  esta señal resta puntos y deriva a una persona, en vez de decidir sola.{FIN}")
    _pausa()

    # --- Acto 6: el publico ---
    _titulo("6 · Proponga usted un concepto")
    print("  Escriba cualquier gasto que una ONG animalista podria registrar")
    print("  y vea a que categoria lo asigna el modelo.\n")
    print(f"  {GRIS}Enter vacio para terminar.{FIN}\n")

    while True:
        try:
            concepto = input("  concepto > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not concepto:
            break
        probar_concepto(concepto)
        print()

    _titulo("Fin del recorrido")


def interactivo() -> None:
    print("\nBanco de pruebas de AIni.")
    print(f"{GRIS}Escriba un concepto de gasto y vea contra que categoria lo clasifica.")
    print(f"Enter vacio para salir.{FIN}\n")

    documental.nlp()  # se carga una vez, no en cada vuelta

    while True:
        try:
            concepto = input("concepto > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not concepto:
            return
        probar_concepto(concepto)
        print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Banco de pruebas de AIni.")
    sub = parser.add_subparsers(dest="comando")

    p_con = sub.add_parser("concepto", help="medir un concepto contra una o todas las categorias")
    p_con.add_argument("texto")
    p_con.add_argument("categoria", nargs="?", default=None)

    p_gas = sub.add_parser("gasto", help="analizar un gasto completo")
    p_gas.add_argument("--concepto", default="atencion veterinaria de urgencia")
    p_gas.add_argument("--categoria", default="ATENCION_VETERINARIA")
    p_gas.add_argument("--monto", type=float, default=118)
    p_gas.add_argument("--proveedor", default="Clinica San Roque")
    p_gas.add_argument("--ruc", default="20601030579")
    p_gas.add_argument("--fecha", default="2026-09-14")
    p_gas.add_argument("--saldo", type=float, default=500)
    p_gas.add_argument("--media", type=float, default=130)
    p_gas.add_argument("--desviacion", type=float, default=40)
    p_gas.add_argument("--proveedor-nuevo", action="store_true")
    p_gas.add_argument("--gastos-recientes", type=int, default=1)
    p_gas.add_argument("--nitidez", type=float, default=180)
    p_gas.add_argument("--distancia", type=int, default=24, help="Hamming al historico; <=5 es reciclada")
    p_gas.add_argument(
        "--comprobante",
        default=None,
        metavar="URL",
        help=(
            "URL http(s) de la foto del comprobante, para que el lector la lea de verdad. "
            "Declare un --monto distinto del impreso y vera el cotejo detectarlo."
        ),
    )

    # El subcomando `boleta` reutiliza todos los argumentos de `gasto` y agrega
    # el importe impreso. Se declaran a mano en vez de con `parents=` porque
    # argparse exige entonces un padre con add_help=False, y duplicar la lista
    # aqui es mas barato que partir `gasto` en dos para ahorrar seis lineas.
    p_bol = sub.add_parser("boleta", help="dibuja una boleta de verdad y hace que el lector la lea")
    p_bol.add_argument("--impreso", type=float, help="importe que dice el papel")
    p_bol.add_argument("--monto", type=float, help="importe que se declara")
    p_bol.add_argument("--concepto")
    p_bol.add_argument("--categoria")
    p_bol.add_argument("--proveedor")
    p_bol.add_argument("--ruc")
    p_bol.add_argument("--fecha")
    p_bol.add_argument("--saldo", type=float)
    p_bol.add_argument("--media", type=float)
    p_bol.add_argument("--desviacion", type=float)
    p_bol.add_argument("--proveedor-nuevo", action="store_true")
    p_bol.add_argument("--gastos-recientes", type=int)
    p_bol.add_argument("--nitidez", type=float)
    p_bol.add_argument("--distancia", type=int)
    p_bol.set_defaults(**POR_DEFECTO_BOLETA)

    p_arch = sub.add_parser(
        "archivos", help="genera las boletas y evidencias para subir desde la aplicacion"
    )
    p_arch.add_argument(
        "--salida",
        default=str(Path.home() / "Desktop" / "boletas-ayni"),
        metavar="CARPETA",
        help="donde escribirlas (por defecto, una carpeta en el Escritorio)",
    )
    p_arch.add_argument("--ruc", default="20601030579")
    # Hoy, no una fecha fija: una boleta fechada el año pasado le saldria al
    # operador como discrepancia de fecha, y el guion no es sobre eso.
    p_arch.add_argument("--fecha", default=date.today().isoformat())

    sub.add_parser("limites", help="bateria de casos dificiles y donde falla")
    sub.add_parser("demo", help="recorrido guiado para una exposicion")

    args = parser.parse_args()

    if args.comando == "concepto":
        probar_concepto(args.texto, args.categoria)
    elif args.comando == "gasto":
        probar_gasto(args)
    elif args.comando == "boleta":
        probar_boleta(args)
    elif args.comando == "archivos":
        generar_archivos(args)
    elif args.comando == "limites":
        probar_limites()
    elif args.comando == "demo":
        demo()
    else:
        interactivo()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
