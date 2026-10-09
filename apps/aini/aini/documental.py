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
from datetime import date, datetime, timedelta

import numpy as np
import spacy
from spacy.language import Language
from spacy.tokens import Token

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
UMBRAL_COHERENCIA = 0.50
UMBRAL_COHERENCIA_DUDOSA = 0.60


def _palabras_con_carga(texto: str) -> list[Token]:
    """Sustantivos, verbos, adjetivos y nombres propios con vector propio.

    Se filtra porque las palabras funcionales no aportan significado y si
    arrastran el resultado. Medido sobre los conceptos de este proyecto, usar
    `Doc.similarity` de spaCy --que promedia el documento entero-- invertia el
    orden: "atencion veterinaria" contra "alquiler de oficina" puntuaba 0.791 y
    contra su propia categoria 0.617.
    """
    return [
        token
        for token in nlp()(texto.lower())
        if token.pos_ in ("NOUN", "VERB", "ADJ", "PROPN")
        and not token.is_stop
        and token.has_vector
        and token.vector_norm > 0
    ]


#: Cuantas coincidencias se promedian. Ver `_similitud`.
MEJORES_COINCIDENCIAS = 3


def _similitud(concepto: list[Token], categoria: list[Token]) -> float:
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
    mejores = [
        max(
            float(
                np.dot(
                    token.vector / token.vector_norm,
                    otro.vector / otro.vector_norm,
                )
            )
            for otro in categoria
        )
        for token in concepto
    ]
    mejores.sort(reverse=True)
    return float(np.mean(mejores[:MEJORES_COINCIDENCIAS]))


# Lo que este esquema todavia no resuelve, medido y no supuesto:
#
# Cuando el concepto tiene MENOS de MEJORES_COINCIDENCIAS palabras utiles, se
# promedian las que haya, y entonces una palabra debil si pesa. Medido:
#
#   "vacunacion antirrabica de doce gatos"              0.721  corresponde
#   "vacunacion antirrabica de doce gatos del albergue" 0.573  parcial
#
# La primera aporta dos palabras con vector ("vacunacion" y "gatos";
# "antirrabica" no esta en el vocabulario del modelo y queda fuera). La segunda
# suma "albergue", que calza con la categoria a 0.28 y arrastra la media de dos
# terminos a tres.
#
# Importa porque los operadores escriben el lugar casi siempre: "del albergue",
# "de la clinica", "en Huanuco". El sesgo va en la direccion segura --cae a
# "parcial", que advierte, no a "no corresponde", que penaliza-- y por eso no
# se toco antes de la entrega. Pero esta aqui, y el arreglo no es subir el
# umbral: es dejar de contar como palabra de contenido el complemento de lugar,
# o exigir un minimo de coincidencias antes de promediar.
#
# Y la causa de fondo, que es peor y mas facil de olvidar: **el vocabulario de
# `es_core_news_md` no cubre la terminologia del dominio.** Es un modelo de
# proposito general entrenado sobre texto periodistico, y los terminos que una
# ONG veterinaria usa a diario no estan en el. Medido:
#
#   "desparasitacion"  sin vector
#   "antirrabica"      sin vector
#
# Cuando la palabra que define el gasto es la que falta, quedan solo las
# genericas y el resultado puede invertirse por completo:
#
#   "desparasitacion de ocho perros rescatados"       0.418  NO CORRESPONDE
#   "cirugia veterinaria de un perro atropellado"     0.899  corresponde
#
# El primero es un gasto veterinario legitimo y el modelo lo rechaza, porque de
# sus cuatro palabras solo "perros" y "rescatados" tienen vector y ninguna de
# las dos dice que sea atencion veterinaria.
#
# Esto no se arregla con umbrales. Se arregla con vectores del dominio: o se
# entrena un modelo sobre texto veterinario, o se amplia la descripcion de cada
# categoria con los sinonimos que el equipo usa de verdad --que es mas barato,
# pero cuidado, porque esta medido que las descripciones mas largas empeoran la
# separacion-- o se mantiene un diccionario de terminos del dominio. Es la
# limitacion mas relevante que le queda a esta señal.


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
