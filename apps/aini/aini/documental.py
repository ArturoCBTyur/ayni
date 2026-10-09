"""Señal documental: coherencia del comprobante y del concepto declarado.

Dos partes bien distintas, y conviene no confundirlas:

- Las comprobaciones **deterministas** (digito verificador del RUC, aritmetica
  del IGV, fechas) no son IA y no pretenden serlo. Estan aqui porque la señal
  documental las necesita, y porque una regla que se puede verificar con
  aritmetica no debe delegarse a un modelo: seria menos exacta y menos
  explicable.

- La comprobacion de **coherencia semantica** si es procesamiento de lenguaje:
  ¿el concepto que la ONG escribio corresponde a la categoria del fondo del que
  esta sacando el dinero? Un gasto de "alquiler de oficina" cargado al fondo de
  "atencion veterinaria" es exactamente el desvio que el proyecto existe para
  detectar, y ninguna regla aritmetica lo ve.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timedelta

import numpy as np
import spacy
from spacy.language import Language

from .contrato import Comprobante, Declarado, MotivoAnalisis

MODELO_SPACY = "es_core_news_md"

_nlp: Language | None = None


def nlp() -> Language:
    """Carga perezosa: el modelo pesa y solo hace falta una vez por proceso."""
    global _nlp
    if _nlp is None:
        _nlp = spacy.load(MODELO_SPACY)
    return _nlp


# --------------------------------------------------------------------------
# Coherencia semantica concepto / categoria
# --------------------------------------------------------------------------

#: Descripcion de cada categoria. Se compara el concepto declarado contra estas
#: frases y no contra el codigo de la categoria: "ATENCION_VETERINARIA" no tiene
#: vector, "atencion veterinaria clinica consulta" si.
#:
#: **Pocas palabras y concretas.** Suena al reves, pero esta medido: alargar las
#: descripciones empeora la separacion, porque el vector es el promedio de sus
#: palabras y cada termino generico acerca el centroide al de las demas
#: categorias. Con descripciones largas, el peor concepto propio puntuaba por
#: DEBAJO del mejor concepto ajeno (separacion -0.032); con estas, por encima
#: (+0.027).
DESCRIPCION_CATEGORIA: dict[str, str] = {
    "ALIMENTOS": "alimento balanceado croqueta comida concentrado racion",
    "ATENCION_VETERINARIA": (
        "atencion veterinaria clinica consulta cirugia esterilizacion vacunacion animal"
    ),
    "MEDICAMENTOS": "medicamento farmaco antibiotico antiparasitario dosis medicina",
    "INSUMOS": "insumo jeringa guante gasa collar correa jaula material descartable",
    "TRANSPORTE": "transporte traslado combustible pasaje flete vehiculo",
    "INFRAESTRUCTURA": "construccion reparacion obra techo pared albergue instalacion",
    # Sin esta entrada, todo gasto de un fondo de esterilizacion --categoria que
    # el backend si envia-- recibia "no se pudo evaluar" y pasaba sin restar.
    # Medido con `python -m evaluacion`: los desvios aceptados bajan de 23,0 %
    # a 10,7 % y la cobertura sube de 77 % a 89 %. "castración" lleva tilde
    # porque sin ella no tiene vector. Se solapa con ATENCION_VETERINARIA, que
    # tambien nombra la esterilizacion: un concepto de una suele pasar en la
    # otra, y el banco lo admite como alternativa.
    #
    # Medido y pendiente: para el modelo la tilde cambia la palabra.
    # "esterilización" y "esterilizacion" se parecen 0,30, y "esterilización"
    # e "instalacion" 0,72, asi que un concepto escrito con tilde puede calzar
    # mejor con INFRAESTRUCTURA. Escribir la descripcion con tildes no mejora
    # el conjunto; el arreglo es normalizarlas en todas las categorias.
    "ESTERILIZACION": "esterilizacion castración quirurgico anestesia hembra macho",
    "SERVICIOS": "servicio honorario asesoria mantenimiento profesional",
    "ADMINISTRATIVO": "oficina alquiler luz agua electricidad papeleria tramite recibo",
}

#: Umbrales de la señal, derivados de medir 25 conceptos reales contra su
#: propia categoria y contra las otras siete (175 pares ajenos):
#:
#:   propios   mediana 0.70   p5 0.46
#:   ajenos    mediana 0.40   p95 0.54
#:
#: **Las clases se solapan**, asi que ningun umbral las separa limpio. En 0.50
#: la señal rechaza cerca del 15 % de los conceptos correctos y acepta cerca
#: del 13 % de los equivocados; subirlo mejora poco lo segundo y empeora mucho
#: lo primero.
#:
#: Se acepta ese 13 % a sabiendas, y por eso esta señal **resta 30 puntos en
#: vez de bloquear**: su trabajo es derivar a una persona, no decidir. Un
#: bloqueo con una de cada ocho equivocaciones seria inaceptable; una derivacion
#: a revision con esa tasa es util.
#:
#: Sobre el banco de `evaluacion/` (180 conceptos, 1070 pares ajenos) las
#: cifras son peores que las de arriba: rechaza el 31 % de los correctos. Al
#: hacer las palabras indiferentes a la tilde (`_vector`) todas las similitudes
#: suben un poco, y el umbral subio de 0.50 a 0.51 para no aceptar mas desvios:
#:
#:                     rechaza correctos   acepta equivocados
#:   antes, en 0.50          33,1 %              10,6 %
#:   despues, en 0.50        29,4 %              13,1 %
#:   despues, en 0.51        30,6 %              11,6 %
#:   despues, en 0.52        38,1 %               9,3 %
#:
#: El salto entre 0.51 y 0.52 dice que el banco aun es chico para afinar mas.
UMBRAL_COHERENCIA = 0.51
UMBRAL_COHERENCIA_DUDOSA = 0.61


#: La misma vocal con tilde. Una palabra en español lleva a lo sumo una.
_CON_TILDE = {"a": "á", "e": "é", "i": "í", "o": "ó", "u": "ú"}
#: La marca de la ñ descompuesta: la unica que `_sin_tilde` conserva.
_VIRGULILLA = unicodedata.lookup("COMBINING TILDE")


def _sin_tilde(palabra: str) -> str:
    """Quita las tildes y conserva la ñ: "campaña" y "campana" son otras palabras."""
    descompuesta = unicodedata.normalize("NFD", palabra)
    sin_marcas = "".join(
        c for c in descompuesta if unicodedata.category(c) != "Mn" or c == _VIRGULILLA
    )
    return unicodedata.normalize("NFC", sin_marcas)


def _vector(palabra: str) -> np.ndarray | None:
    """Vector unitario de la palabra, igual si se escribio con tilde o sin ella.

    Para el modelo, la tilde cambia la palabra. es_core_news_md guarda 500 000
    palabras sobre 20 000 vectores, y a una forma poco usada le toca el vector
    de alguna vecina: "vacunacion" comparte el de "vacunación", pero
    "esterilizacion" se parece 0,30 a "esterilización" y "castracion" no tiene
    vector. Medido sobre el banco de evaluacion, 21 de 85 conceptos escritos con
    tilde cambiaban de veredicto con solo quitarselas: el mismo gasto se
    aprobaba o iba a revision segun la ortografia del operador.

    Se promedian los vectores de todas las formas de la palabra --sin tilde y
    con la tilde en cada vocal-- que el modelo conoce. El resultado depende
    solo de la palabra sin tildes, asi que no puede cambiar con ellas. Se probo
    tambien llevar cada palabra a su unica forma con tilde: separaba un poco
    peor y aun dejaba 2 conceptos que cambiaban.
    """
    base = _sin_tilde(palabra)
    formas = {palabra, base} | {
        base[:i] + _CON_TILDE[c] + base[i + 1 :] for i, c in enumerate(base) if c in _CON_TILDE
    }
    vocabulario = nlp().vocab
    vectores = []
    for forma in sorted(formas):
        if vocabulario.has_vector(forma):
            v = vocabulario.get_vector(forma)
            norma = float(np.linalg.norm(v))
            if norma > 0:
                vectores.append(v / norma)
    if not vectores:
        return None
    promedio = np.mean(vectores, axis=0)
    return promedio / float(np.linalg.norm(promedio))


#: Terminos del dominio que `es_core_news_md` no conoce en ninguna forma, o que
#: conoce con otro sentido ("revolution" y "advocate" son palabras inglesas;
#: "pro plan" se partiria en "pro" y "plan"), llevados a una palabra que si
#: conoce y que esta en la descripcion de su categoria.
#:
#: Las claves van sin tilde y en minusculas; se reconocen con tilde o sin ella.
#: Salen de terminos que una ONG veterinaria usa a diario, no de los conceptos
#: del banco de evaluacion: el banco tiene 21 conceptos de control escritos
#: antes de este diccionario, para medirlo sobre casos que no lo motivaron.
#:
#: Un termino nuevo se agrega aqui cuando `python -m evaluacion --detalle` lo
#: lista entre las palabras sin vector y se sabe que significa.
TERMINOS_DEL_DOMINIO: dict[str, str] = {
    # Antiparasitarios: genericos y marcas.
    "garrapaticida": "antiparasitario",
    "pulguicida": "antiparasitario",
    "endoparasiticida": "antiparasitario",
    "ectoparasiticida": "antiparasitario",
    "nexgard": "antiparasitario",
    "bravecto": "antiparasitario",
    "simparica": "antiparasitario",
    "frontline": "antiparasitario",
    "revolution": "antiparasitario",
    "advocate": "antiparasitario",
    "milbemax": "antiparasitario",
    "drontal": "antiparasitario",
    # Otros medicamentos y vacunas.
    "enrofloxacino": "antibiotico",
    "carprofeno": "antiinflamatorio",
    "tolfedine": "antiinflamatorio",
    "xilacina": "sedante",
    "canigen": "vacuna",
    "nobivac": "vacuna",
    # Marcas de alimento.
    "whiskas": "alimento",
    "ricocan": "alimento",
    "mimaskot": "alimento",
    "supercan": "alimento",
    "nutrapet": "alimento",
    "dog chow": "alimento",
    "cat chow": "alimento",
    "pro plan": "alimento",
    "royal canin": "alimento",
    # Procedimientos y diagnosticos.
    "ovariohisterectomia": "esterilizacion",
    "ovh": "esterilizacion",
    "otohematoma": "hematoma",
    "demodicosis": "sarna",
    "venoclisis": "suero",
    # Regionalismos.
    "gasfitero": "fontanero",
    "gatario": "albergue",
}

#: Para cada vocal, la clase que acepta la misma vocal con tilde.
_VOCAL_O_TILDE = {v: f"[{v}{t}]" for v, t in _CON_TILDE.items()}


def _patron_termino(termino: str) -> str:
    """Patron que reconoce el termino con tilde o sin ella, y con un espacio
    cualquiera entre sus palabras."""
    partes = []
    for c in termino:
        if c == " ":
            partes.append(r"\s+")
        else:
            partes.append(_VOCAL_O_TILDE.get(c, re.escape(c)))
    return "".join(partes)


#: Los terminos de varias palabras primero, para que "dog chow" gane a "chow".
_TERMINOS = re.compile(
    r"\b("
    + "|".join(
        _patron_termino(t) for t in sorted(TERMINOS_DEL_DOMINIO, key=len, reverse=True)
    )
    + r")\b"
)


def _con_terminos_del_dominio(texto: str) -> str:
    """El texto en minusculas, con cada termino del dominio cambiado por la
    palabra conocida que le corresponde."""
    return _TERMINOS.sub(
        lambda m: TERMINOS_DEL_DOMINIO[_sin_tilde(" ".join(m.group(0).split()))],
        texto.lower(),
    )


def _palabras_con_carga(texto: str) -> list[np.ndarray]:
    """Vectores de los sustantivos, verbos, adjetivos y nombres propios.

    Se filtra porque las palabras funcionales no aportan significado y si
    arrastran el resultado. Medido sobre los conceptos de este proyecto, usar
    `Doc.similarity` de spaCy --que promedia el documento entero-- invertia el
    orden: "atencion veterinaria" contra "alquiler de oficina" puntuaba 0.791 y
    contra su propia categoria 0.617.
    """
    vectores = (
        _vector(token.text)
        for token in nlp()(_con_terminos_del_dominio(texto))
        if token.pos_ in ("NOUN", "VERB", "ADJ", "PROPN") and not token.is_stop
    )
    return [v for v in vectores if v is not None]


#: Cuantas coincidencias se promedian. Ver `_similitud`.
MEJORES_COINCIDENCIAS = 3


def _similitud(concepto: list[np.ndarray], categoria: list[np.ndarray]) -> float:
    """Media de las mejores coincidencias palabra a palabra.

    NO se promedian los vectores en un centroide por cada lado, que es lo
    primero que uno intenta. El centroide se diluye con el relleno: medido,
    "esterilizacion de 20 gatos" puntuaba 0.592 contra su categoria y la misma
    frase con "en la jornada del sabado" caia a 0.439, por debajo del umbral.
    Tres palabras sin carga tumbaban un gasto legitimo.

    Emparejando cada palabra del concepto con la que mejor le calce en la
    categoria, y promediando solo las mejores, el relleno deja de pesar: una
    palabra que no se parece a nada simplemente no entra en el promedio. La
    misma frase sube a 0.609.

    Comparadas a igual tasa de falsas alarmas sobre 25 conceptos reales y 175
    pares ajenos, esta medida acepta la mitad de categorizaciones erroneas que
    el centroide (16.6 % contra 33.1 % cuando ambas rechazan el 8 % de los
    conceptos correctos).
    """
    mejores = [max(float(np.dot(palabra, otra)) for otra in categoria) for palabra in concepto]
    mejores.sort(reverse=True)
    return float(np.mean(mejores[:MEJORES_COINCIDENCIAS]))


# Lo que este esquema todavia no resuelve, medido y no supuesto:
#
# Cuando el concepto tiene MENOS de MEJORES_COINCIDENCIAS palabras utiles, se
# promedian las que haya, y entonces una palabra debil si pesa: el complemento
# de lugar ("del albergue", "en Huanuco") puede arrastrar la media. El sesgo va
# en la direccion segura --cae a "parcial", que advierte, no a "no
# corresponde", que penaliza--, y el arreglo no es subir el umbral sino dejar
# de contar el lugar como palabra de contenido o exigir un minimo de
# coincidencias antes de promediar.
#
# Antes de `_vector` esto pasaba mucho mas, y parte de lo que parecia falta de
# vocabulario era la tilde: "desparasitacion" y "antirrabica" no tenian vector
# escritas sin ella, y "desparasitacion de ocho perros rescatados" se
# rechazaba (0.418). Con tilde o sin ella, hoy corresponde (0.627).
#
# El vocabulario del dominio que el modelo no conoce lo cubre
# TERMINOS_DEL_DOMINIO. Con el, de las palabras de contenido del banco solo
# quedan sin vector nombres de lugar ("pillco", "huallaga"), que no dicen nada
# de la categoria. Cuando aparezca un termino nuevo, `python -m evaluacion
# --detalle` lo lista.
#
# Lo que el diccionario deja al descubierto, medido: el termino se traduce bien
# pero el promedio de las MEJORES_COINCIDENCIAS lo diluye con palabras que
# estan en conceptos de todas las categorias. "bravecto para 6 perros del
# albergue" queda en 0.468 aunque "antiparasitario" calza 1.0 con su
# categoria, porque "perros" (0.25) y "albergue" (0.15) entran en el promedio.
# El arreglo no es el diccionario sino como se combinan las palabras: pesar
# menos las que no distinguen categorias, o decidir comparando contra las demas
# categorias en vez de contra un umbral fijo.

def coherencia_concepto_categoria(concepto: str, categoria: str) -> float | None:
    """Similitud coseno entre el concepto y la descripcion de su categoria.

    Devuelve None cuando no se puede medir: categoria desconocida, o un
    concepto sin ninguna palabra de contenido reconocible. No se inventa un
    valor neutro, porque un 0.5 fabricado se confundiria con una medicion.
    """
    descripcion = DESCRIPCION_CATEGORIA.get(categoria.upper())
    if descripcion is None:
        return None

    palabras_concepto = _palabras_con_carga(concepto)
    palabras_categoria = _palabras_con_carga(descripcion)
    if not palabras_concepto or not palabras_categoria:
        return None

    return _similitud(palabras_concepto, palabras_categoria)


# --------------------------------------------------------------------------
# Comprobaciones deterministas
# --------------------------------------------------------------------------

_FACTORES_RUC = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
_PREFIJOS_RUC = {"10", "15", "17", "20"}


def ruc_valido(ruc: str) -> tuple[bool, str]:
    """Digito verificador del RUC por modulo 11, el algoritmo de SUNAT."""
    limpio = re.sub(r"\D", "", ruc or "")
    if len(limpio) != 11:
        return False, "El RUC debe tener 11 digitos."
    if limpio[:2] not in _PREFIJOS_RUC:
        return False, f"El RUC no empieza con un prefijo valido ({limpio[:2]})."

    suma = sum(int(d) * f for d, f in zip(limpio[:10], _FACTORES_RUC))
    resto = suma % 11
    esperado = (11 - resto) % 10

    if esperado != int(limpio[10]):
        return False, "El digito verificador del RUC no coincide."
    return True, "El RUC del emisor es valido."


def _a_fecha(valor: str | None) -> date | None:
    if not valor:
        return None
    try:
        return datetime.fromisoformat(valor.replace("Z", "+00:00")).date()
    except ValueError:
        return None


IGV_PERU = 0.18
TOLERANCIA_CENTIMOS = 0.05

#: Un dia de margen al comparar contra "hoy".
#:
#: El backend guarda las marcas de tiempo en UTC y Peru esta en UTC-5, asi que
#: un comprobante emitido a las 20:00 hora peruana llega con fecha del dia
#: siguiente. Sin este margen, **todo gasto registrado despues de las 19:00 se
#: marcaria como fecha futura**: un falso positivo diario, justo en el horario
#: en que un operador de campo cierra su jornada y sube lo del dia.
#:
#: Un dia no debilita la comprobacion: lo que se busca detectar es un
#: comprobante fechado semanas adelante, no uno que cruzo la medianoche en otro
#: huso.
TOLERANCIA_HUSO = timedelta(days=1)


def evaluar(
    declarado: Declarado, comprobante: Comprobante
) -> tuple[float, list[MotivoAnalisis]]:
    """Puntaje documental de 0 a 100 y el motivo de cada descuento."""
    motivos: list[MotivoAnalisis] = []
    penalizacion_total = 0.0

    def anotar(
        regla: str,
        resultado: str,
        mensaje: str,
        penalizacion: float = 0,
        valor: str | float | None = None,
    ) -> None:
        nonlocal penalizacion_total
        penalizacion_total += penalizacion
        motivos.append(
            MotivoAnalisis(
                regla=regla,
                senal="documental",
                resultado=resultado,  # type: ignore[arg-type]
                mensaje=mensaje,
                valor=valor,
                penalizacion=penalizacion,
            )
        )

    # --- RUC del emisor ---
    valido, mensaje = ruc_valido(comprobante.ruc_emisor)
    anotar(
        "doc.ruc_modulo11",
        "ok" if valido else "falla",
        mensaje if valido else f"{mensaje} Revise que este bien copiado del comprobante.",
        0 if valido else 35,
        comprobante.ruc_emisor,
    )

    # --- Aritmetica del IGV ---
    esperado = round(comprobante.subtotal * IGV_PERU, 2)
    diferencia = abs(comprobante.igv - esperado)
    suma = round(comprobante.subtotal + comprobante.igv, 2)
    descuadre_total = abs(suma - comprobante.total)

    if descuadre_total > TOLERANCIA_CENTIMOS:
        anotar(
            "doc.suma_total",
            "falla",
            f"Subtotal mas IGV da S/ {suma:.2f}, pero el comprobante declara "
            f"S/ {comprobante.total:.2f}.",
            25,
            round(descuadre_total, 2),
        )
    elif diferencia > TOLERANCIA_CENTIMOS:
        anotar(
            "doc.igv_18",
            "advertencia",
            f"El IGV declarado (S/ {comprobante.igv:.2f}) no es el 18 % del subtotal "
            f"(seria S/ {esperado:.2f}). Puede ser una operacion exonerada.",
            10,
            round(diferencia, 2),
        )
    else:
        anotar("doc.igv_18", "ok", "La aritmetica del comprobante es correcta.")

    # --- Fechas ---
    f_emision = _a_fecha(comprobante.fecha_emision)
    f_gasto = _a_fecha(declarado.fecha_gasto)

    if f_emision and f_gasto:
        if f_emision > f_gasto:
            anotar(
                "doc.fecha_emision_posterior",
                "falla",
                "El comprobante se emitio despues de la fecha del gasto.",
                20,
                f_emision.isoformat(),
            )
        elif f_emision > date.today() + TOLERANCIA_HUSO:
            anotar(
                "doc.fecha_futura",
                "falla",
                "El comprobante tiene fecha futura.",
                30,
                f_emision.isoformat(),
            )
        else:
            anotar("doc.fechas", "ok", "Las fechas del comprobante son coherentes.")

    # --- Coherencia semantica: aqui es donde entra el modelo de lenguaje ---
    similitud = coherencia_concepto_categoria(declarado.concepto, declarado.categoria_gasto)

    if similitud is None:
        # No se puede medir. Se dice, y no se penaliza: inventar certeza es
        # peor que admitir que falta informacion.
        anotar(
            "nlp.coherencia_categoria",
            "advertencia",
            "No se pudo evaluar si el concepto corresponde a la categoria del fondo.",
            0,
        )
    elif similitud < UMBRAL_COHERENCIA:
        anotar(
            "nlp.coherencia_categoria",
            "falla",
            f'El concepto "{declarado.concepto}" no parece corresponder a un gasto de '
            f"la categoria del fondo. Verifique que el gasto se este cargando al fondo correcto.",
            30,
            round(similitud, 3),
        )
    elif similitud < UMBRAL_COHERENCIA_DUDOSA:
        anotar(
            "nlp.coherencia_categoria",
            "advertencia",
            "El concepto se relaciona solo parcialmente con la categoria del fondo.",
            12,
            round(similitud, 3),
        )
    else:
        anotar(
            "nlp.coherencia_categoria",
            "ok",
            "El concepto declarado corresponde a la categoria del fondo.",
            0,
            round(similitud, 3),
        )

    return max(0.0, 100.0 - penalizacion_total), motivos
