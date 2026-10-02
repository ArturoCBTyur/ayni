"""Banco de pruebas de AIni: tirarle casos a mano y ver que contesta.

    python probar.py                              modo interactivo
    python probar.py concepto "compra de croquetas" ALIMENTOS
    python probar.py gasto --monto 480 --proveedor-nuevo --gastos-recientes 5
    python probar.py limites                      donde el modelo se equivoca

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
            serie="B001",
            numero="000123",
            fechaEmision=args.fecha,
            subtotal=round(args.monto / 1.18, 2),
            igv=round(args.monto - args.monto / 1.18, 2),
            total=args.monto,
            moneda="PEN",
            hashSha256="a" * 64,
            archivoUrl="/x",
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
# limites: donde el modelo se equivoca
# --------------------------------------------------------------------------

#: Casos dificiles a proposito, con lo que una persona diria que es correcto.
#: Los que el modelo resuelve mal NO son un error del banco de pruebas: son la
#: respuesta honesta a "¿que tan bueno es tu modelo?".
CASOS_DIFICILES: list[tuple[str, str, bool, str]] = [
    # (concepto, categoria, deberia_corresponder, por_que_es_dificil)
    ("compra de croquetas y alimento seco", "ALIMENTOS", True, "sinonimo coloquial"),
    ("gastos de movilidad del personal", "TRANSPORTE", True, "lenguaje administrativo"),
    ("honorarios del veterinario de turno", "SERVICIOS", True, "cae entre dos categorias"),
    ("honorarios del veterinario de turno", "ATENCION_VETERINARIA", True, "la otra lectura"),
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

    sub.add_parser("limites", help="bateria de casos dificiles y donde falla")

    args = parser.parse_args()

    if args.comando == "concepto":
        probar_concepto(args.texto, args.categoria)
    elif args.comando == "gasto":
        probar_gasto(args)
    elif args.comando == "limites":
        probar_limites()
    else:
        interactivo()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
