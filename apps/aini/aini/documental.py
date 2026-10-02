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
    "SERVICIOS": "servicio honorario asesoria mantenimiento profesional",
    "ADMINISTRATIVO": "oficina alquiler luz agua electricidad papeleria tramite recibo",
}

#: Umbrales de la señal, derivados de medir 25 conceptos reales contra su propia
#: categoria y contra las otras siete (175 pares ajenos):
#:
#:   propios   mediana 0.691   p5 0.397
#:   ajenos    mediana 0.405   p95 0.595
#:
#: **Las clases se solapan**, asi que ningun umbral las separa limpio. La curva
#: medida en 0.52 rechaza el 8 % de los conceptos correctos y acepta el 15 % de
#: los equivocados; subirlo a 0.58 baja los aceptados al 6 % pero manda a
#: revision humana el 28 % de los gastos legitimos.
#:
#: Se eligio 0.52 por la asimetria del costo: rechazar un gasto correcto cuesta
#: una revision humana, que es barata y que el sistema ya contempla; aceptar uno
#: mal categorizado deja salir dinero del fondo equivocado sin que nadie lo vea.
#: Aun asi, una de cada siete categorizaciones erroneas pasa, y por eso esta
#: señal resta 30 puntos en vez de bloquear: deriva a una persona, no decide.
UMBRAL_COHERENCIA = 0.52
UMBRAL_COHERENCIA_DUDOSA = 0.62


def _vector_de_contenido(texto: str) -> np.ndarray | None:
    """Vector promedio de las palabras con carga semantica.

    NO se usa `Doc.similarity` de spaCy, que promedia el documento entero.
    Medido sobre los conceptos reales de este proyecto, esa medida se invierte:
    "atencion veterinaria" contra "alquiler de oficina" puntuaba 0.791 y contra
    su propia categoria 0.617, porque las preposiciones y los articulos pesan
    tanto como los sustantivos y terminan dominando el promedio.

    Filtrando a sustantivos, verbos, adjetivos y nombres propios con vector
    propio, el orden se corrige y las tres situaciones quedan bien separadas.
    """
    doc = nlp()(texto.lower())
    vectores = [
        token.vector
        for token in doc
        if token.pos_ in ("NOUN", "VERB", "ADJ", "PROPN")
        and not token.is_stop
        and token.has_vector
        and token.vector_norm > 0
    ]
    if not vectores:
        return None

    promedio = np.mean(vectores, axis=0)
    norma = float(np.linalg.norm(promedio))
    return promedio / norma if norma > 0 else None


def coherencia_concepto_categoria(concepto: str, categoria: str) -> float | None:
    """Similitud coseno entre el concepto y la descripcion de su categoria.

    Devuelve None cuando no se puede medir: categoria desconocida, o un
    concepto sin ninguna palabra de contenido reconocible. No se inventa un
    valor neutro, porque un 0.5 fabricado se confundiria con una medicion.
    """
    descripcion = DESCRIPCION_CATEGORIA.get(categoria.upper())
    if descripcion is None:
        return None

    v_concepto = _vector_de_contenido(concepto)
    v_categoria = _vector_de_contenido(descripcion)
    if v_concepto is None or v_categoria is None:
        return None

    return float(np.dot(v_concepto, v_categoria))


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
