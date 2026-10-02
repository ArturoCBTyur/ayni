"""Contrato de datos de AIni.

Espejo en Pydantic del contrato de la seccion 7.4 del Entregable 2, que del
lado del backend vive en `apps/api/src/modules/verificacion/contrato/`.

Los dos archivos describen la misma cosa en dos lenguajes, y ese es el precio
de tener el motor en otro proceso. Para que la copia no se desincronice en
silencio, el servicio valida la entrada contra este esquema y responde 422 si
llega un campo inesperado: es preferible que falle en el borde, visible, a que
el motor analice con un dato que no era el que creia.

El backend envia JSON en camelCase, asi que los alias lo reproducen tal cual.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def _camel(nombre: str) -> str:
    primera, *resto = nombre.split("_")
    return primera + "".join(p.capitalize() for p in resto)


class _Base(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True, extra="forbid")


NivelConfianza = Literal["ALTO", "MEDIO", "BAJO"]
FuenteDatos = Literal["declarado", "ocr"]
Senal = Literal["documental", "visual", "anomalia"]
Resultado = Literal["ok", "advertencia", "falla"]
Severidad = Literal["ALTA", "MEDIA", "BAJA"]


# --------------------------------------------------------------------------
# Entrada
# --------------------------------------------------------------------------


class Declarado(_Base):
    fondo_id: str
    categoria_gasto: str
    monto_declarado: float
    concepto: str
    proveedor_nombre: str
    proveedor_ruc: str | None = None
    fecha_gasto: str
    capturado_en: str | None = None


class Comprobante(_Base):
    tipo: str
    ruc_emisor: str
    serie: str
    numero: str
    fecha_emision: str
    subtotal: float
    igv: float
    total: float
    moneda: str
    hash_sha256: str
    archivo_url: str


class Evidencia(_Base):
    id: str
    tipo: str
    hash_sha256: str
    hash_perceptual: str | None = None
    nitidez: float | None = None
    ancho: int | None = None
    alto: int | None = None
    exif_capturado_en: str | None = None
    #: La calcula el backend, que es quien tiene el historico completo.
    distancia_minima_historico: int | None = None
    contiene_personas: bool
    anonimizada: bool
    archivo_url: str


class Contexto(_Base):
    saldo_retenido: float
    media_historica_categoria: float | None = None
    desviacion_historica_categoria: float | None = None
    proveedor_conocido: bool
    gastos_recientes_misma_categoria: int


class ReglaUmbrales(_Base):
    id: str
    umbral_alto: float
    umbral_medio: float
    peso_documental: float
    peso_visual: float
    peso_anomalia: float


class EntradaAnalisis(_Base):
    gasto_id: str
    declarado: Declarado
    comprobante: Comprobante
    evidencias: list[Evidencia]
    contexto: Contexto
    regla: ReglaUmbrales


# --------------------------------------------------------------------------
# Salida
# --------------------------------------------------------------------------


class MotivoAnalisis(_Base):
    #: Identificador estable de la regla, p. ej. "doc.ruc_modulo11".
    regla: str
    senal: Senal
    resultado: Resultado
    #: Redactado para que lo entienda la ONG, no solo quien programa.
    mensaje: str
    valor: str | float | None = None
    penalizacion: float = 0


class AlertaAnalisis(_Base):
    tipo: str
    severidad: Severidad
    titulo: str
    descripcion: str


class DatosExtraidos(_Base):
    fuente: FuenteDatos
    tipo: str
    ruc_emisor: str
    serie: str
    numero: str
    fecha_emision: str
    subtotal: float
    igv: float
    total: float


class Explicacion(_Base):
    motivos: list[MotivoAnalisis]
    #: Resumen en una frase, el que ve la ONG en la aplicacion.
    resumen: str


class ResultadoAnalisis(_Base):
    score_documental: float
    score_visual: float
    score_anomalia: float
    score_final: float
    nivel: NivelConfianza
    datos_extraidos: DatosExtraidos
    explicacion: Explicacion
    alertas: list[AlertaAnalisis] = Field(default_factory=list)
    narrativa_borrador: str | None = None
    version_modelo: str
    duracion_ms: int
