"""Pruebas del motor de AIni.

Lo que se fija aqui es el comportamiento que el proyecto promete, no los
numeros exactos que da el modelo: un umbral puede moverse al reentrenar, pero
que un gasto cargado al fondo equivocado se detecte, o que una evidencia
reutilizada no se rescate con un comprobante impecable, no puede moverse.

    pytest pruebas/
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aini import anomalia, documental, motor, narrativa, ocr  # noqa: E402
from aini.contrato import (  # noqa: E402
    Comprobante,
    Contexto,
    Declarado,
    EntradaAnalisis,
    Evidencia,
    MotivoAnalisis,
    ReglaUmbrales,
)


@pytest.fixture(scope="session")
def detector() -> anomalia.DetectorAnomalias:
    return anomalia.DetectorAnomalias.cargar()


@pytest.fixture
def papel_coincide(monkeypatch):
    """El lector leyo el comprobante y dice lo mismo que lo declarado.

    Sin esto, `entrada()` apunta a un archivo que no se puede descargar y el
    lector no lee nada: un gasto asi ya no sale ALTO, porque nadie verifico el
    papel.
    """
    leido = ocr.CamposLeidos(
        ruc_emisor="20601030579",
        serie="B001",
        numero="004521",
        fecha_emision=date(2026, 9, 14),
        subtotal=100.0,
        igv=18.0,
        total=118.0,
        texto="(simulado)",
        confianza=0.95,
    )
    monkeypatch.setattr(ocr, "leer_desde", lambda url: leido)


def entrada(**cambios) -> EntradaAnalisis:
    """Gasto coherente y bien documentado. Cada prueba rompe una cosa."""
    declarado = {
        "fondoId": "f1",
        "categoriaGasto": "ATENCION_VETERINARIA",
        "montoDeclarado": 118.0,
        "concepto": "atencion veterinaria de urgencia de tres perros rescatados",
        "proveedorNombre": "Clinica Veterinaria San Roque",
        "proveedorRuc": None,
        "fechaGasto": "2026-09-14",
        "capturadoEn": "2026-09-14",
    }
    comprobante = {
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
    evidencia = {
        "id": "e1",
        "tipo": "FOTO",
        "hashSha256": "b" * 64,
        "hashPerceptual": "ff00ff00",
        "nitidez": 180.0,
        "ancho": 800,
        "alto": 600,
        "exifCapturadoEn": "2026-09-14",
        "distanciaMinimaHistorico": 24,
        "contienePersonas": False,
        "anonimizada": True,
        "archivoUrl": "/y",
    }
    contexto = {
        "saldoRetenido": 500.0,
        "mediaHistoricaCategoria": 130.0,
        "desviacionHistoricaCategoria": 40.0,
        "proveedorConocido": True,
        "gastosRecientesMismaCategoria": 1,
    }

    declarado.update(cambios.pop("declarado", {}))
    comprobante.update(cambios.pop("comprobante", {}))
    evidencia.update(cambios.pop("evidencia", {}))
    contexto.update(cambios.pop("contexto", {}))

    return EntradaAnalisis(
        gastoId="g1",
        declarado=Declarado(**declarado),
        comprobante=Comprobante(**comprobante),
        evidencias=[Evidencia(**evidencia)] if cambios.pop("con_evidencia", True) else [],
        contexto=Contexto(**contexto),
        regla=ReglaUmbrales(
            id="r1",
            umbralAlto=90,
            umbralMedio=60,
            pesoDocumental=0.45,
            pesoVisual=0.25,
            pesoAnomalia=0.30,
        ),
    )


def reglas(resultado, prefijo: str) -> list[str]:
    return [m.regla for m in resultado.explicacion.motivos if m.regla.startswith(prefijo)]


def falla(resultado, regla: str) -> bool:
    return any(m.regla == regla and m.resultado == "falla" for m in resultado.explicacion.motivos)


# --------------------------------------------------------------------------


class TestSinVerificarContraElPapel:
    """ALTO aprueba sin que lo mire nadie: exige haber leido el comprobante."""

    def test_sin_lectura_no_se_aprueba_solo(self, detector):
        r = motor.analizar(entrada(), detector)
        assert r.nivel == "MEDIO"
        assert any(m.regla == "ocr.sin_cotejo" for m in r.explicacion.motivos)
        assert r.explicacion.resumen == motor.SIN_COTEJO

    def test_no_leer_sigue_sin_restar_puntos(self, detector, monkeypatch):
        """Una foto mala no dice que el gasto este mal: cambia quien decide, no
        el puntaje. El mismo gasto, con y sin el papel leido, puntua igual."""
        sin_leer = motor.analizar(entrada(), detector)

        leido = ocr.CamposLeidos(ruc_emisor="20601030579", total=118.0, confianza=0.95)
        monkeypatch.setattr(ocr, "leer_desde", lambda url: leido)
        con_papel = motor.analizar(entrada(), detector)

        assert sin_leer.score_final == con_papel.score_final
        assert (sin_leer.nivel, con_papel.nivel) == ("MEDIO", "ALTO")
        motivo = next(m for m in sin_leer.explicacion.motivos if m.regla == "ocr.sin_cotejo")
        assert motivo.penalizacion == 0
        assert motivo.resultado == "advertencia"

    def test_no_acusa_ni_genera_alertas(self, detector):
        r = motor.analizar(entrada(), detector)
        assert r.alertas == []
        assert "fraude" not in r.explicacion.resumen.lower()

    def test_una_foto_ilegible_tampoco_se_aprueba_sola(self, detector, monkeypatch):
        monkeypatch.setattr(ocr, "leer_desde", lambda url: ocr.CamposLeidos(confianza=0.0))
        assert motor.analizar(entrada(), detector).nivel == "MEDIO"

    def test_con_el_papel_leido_si_se_aprueba(self, detector, papel_coincide):
        r = motor.analizar(entrada(), detector)
        assert r.nivel == "ALTO"
        assert not any(m.regla == "ocr.sin_cotejo" for m in r.explicacion.motivos)

    def test_no_sube_a_nadie(self, detector):
        """Solo baja ALTO a MEDIO: un gasto BAJO sigue BAJO."""
        r = motor.analizar(entrada(declarado={"montoDeclarado": 9999.0}), detector)
        assert r.nivel == "BAJO"
        assert not any(m.regla == "ocr.sin_cotejo" for m in r.explicacion.motivos)


class TestCaminoFeliz:
    def test_un_gasto_coherente_sale_alto(self, detector, papel_coincide):
        r = motor.analizar(entrada(), detector)
        assert r.nivel == "ALTO"
        assert r.score_final >= 90

    def test_siempre_hay_explicacion(self, detector):
        """RNF-09: ninguna decision puede quedar sin motivo legible."""
        r = motor.analizar(entrada(), detector)
        assert r.explicacion.motivos
        assert r.explicacion.resumen
        for m in r.explicacion.motivos:
            assert m.mensaje.strip(), f"la regla {m.regla} no explica nada"

    def test_declara_que_los_datos_son_del_operador(self, detector):
        """Esta version no lee el comprobante; afirmar 'ocr' seria mentir."""
        r = motor.analizar(entrada(), detector)
        assert r.datos_extraidos.fuente == "declarado"


class TestCoherenciaSemantica:
    """La señal que ninguna regla aritmetica puede dar."""

    def test_un_gasto_del_fondo_equivocado_se_detecta(self, detector):
        # Todo lo demas es impecable: el RUC es valido, el IGV cuadra y las
        # fechas son coherentes. Solo el concepto no corresponde.
        r = motor.analizar(
            entrada(declarado={"concepto": "alquiler de oficina administrativa y mobiliario"}),
            detector,
        )
        assert falla(r, "nlp.coherencia_categoria")
        assert r.nivel != "ALTO"
        assert any(a.tipo == "CATEGORIA_INCOHERENTE" for a in r.alertas)

    def test_el_mismo_gasto_en_su_fondo_pasa(self, detector):
        r = motor.analizar(
            entrada(
                declarado={
                    "concepto": "alquiler de oficina administrativa y mobiliario",
                    "categoriaGasto": "ADMINISTRATIVO",
                }
            ),
            detector,
        )
        assert not falla(r, "nlp.coherencia_categoria")

    def test_una_categoria_desconocida_no_inventa_un_veredicto(self, detector):
        """Sin descripcion con que comparar, se admite y no se penaliza."""
        r = motor.analizar(entrada(declarado={"categoriaGasto": "CATEGORIA_QUE_NO_EXISTE"}), detector)
        motivo = next(m for m in r.explicacion.motivos if m.regla == "nlp.coherencia_categoria")
        assert motivo.resultado == "advertencia"
        assert motivo.penalizacion == 0
        assert "no se pudo evaluar" in motivo.mensaje.lower()

    def test_un_gasto_de_esterilizacion_se_evalua(self, detector):
        """ESTERILIZACION es una categoria del backend. Sin descripcion, todo gasto
        de esos fondos pasaba con "no se pudo evaluar"."""
        r = motor.analizar(
            entrada(
                declarado={
                    "concepto": "castración de perros machos del albergue",
                    "categoriaGasto": "ESTERILIZACION",
                }
            ),
            detector,
        )
        motivo = next(m for m in r.explicacion.motivos if m.regla == "nlp.coherencia_categoria")
        assert "no se pudo evaluar" not in motivo.mensaje.lower()
        assert motivo.resultado != "falla"

    def test_un_alquiler_no_corresponde_al_fondo_de_esterilizacion(self, detector):
        r = motor.analizar(
            entrada(
                declarado={
                    "concepto": "alquiler de oficina administrativa y mobiliario",
                    "categoriaGasto": "ESTERILIZACION",
                }
            ),
            detector,
        )
        assert falla(r, "nlp.coherencia_categoria")


class TestSeñalDocumental:
    def test_ruc_con_digito_verificador_equivocado(self, detector):
        r = motor.analizar(entrada(comprobante={"rucEmisor": "20553456575"}), detector)
        assert falla(r, "doc.ruc_modulo11")
        assert r.score_documental < 100

    def test_aritmetica_que_no_cuadra(self, detector):
        r = motor.analizar(
            entrada(comprobante={"subtotal": 100.0, "igv": 18.0, "total": 150.0}), detector
        )
        assert falla(r, "doc.suma_total")

    def test_comprobante_emitido_despues_del_gasto(self, detector):
        r = motor.analizar(entrada(comprobante={"fechaEmision": "2026-09-20"}), detector)
        assert falla(r, "doc.fecha_emision_posterior")

    def test_un_gasto_de_esta_noche_no_es_fecha_futura(self, detector):
        """El falso positivo diario que el huso horario provocaba.

        El backend guarda en UTC y Peru esta en UTC-5: un comprobante emitido a
        las 20:00 hora peruana llega fechado al dia siguiente. Sin margen, todo
        gasto subido despues de las 19:00 —justo cuando un operador de campo
        cierra su jornada— se marcaba como fecha futura.
        """
        manana = (date.today() + timedelta(days=1)).isoformat()
        r = motor.analizar(
            entrada(
                declarado={"fechaGasto": manana},
                comprobante={"fechaEmision": manana},
            ),
            detector,
        )
        assert not falla(r, "doc.fecha_futura")

    def test_una_fecha_realmente_futura_si_se_marca(self, detector):
        """El margen absorbe el huso, no semanas de adelanto."""
        dentro_de_un_mes = (date.today() + timedelta(days=30)).isoformat()
        r = motor.analizar(
            entrada(
                declarado={"fechaGasto": dentro_de_un_mes},
                comprobante={"fechaEmision": dentro_de_un_mes},
            ),
            detector,
        )
        assert falla(r, "doc.fecha_futura")


class TestSeñalVisual:
    def test_evidencia_reciclada_manda_a_bajo(self, detector):
        """Bloqueo duro: no se compensa con un comprobante perfecto."""
        r = motor.analizar(entrada(evidencia={"distanciaMinimaHistorico": 1}), detector)
        assert r.nivel == "BAJO"
        assert r.score_final == 0
        assert any(a.tipo == "EVIDENCIA_REUTILIZADA" for a in r.alertas)

    def test_el_bloqueo_duro_encabeza_las_alertas(self, detector):
        """El backend persiste solo la primera alerta: tiene que ser la causa.

        Un gasto puede disparar varias a la vez. Si la primera fuera la del
        cotejo, el caso quedaria archivado como "lo declarado no coincide"
        cuando lo que realmente ocurrio es que la evidencia estaba reciclada,
        que es mas grave y tiene otro procedimiento.
        """
        r = motor.analizar(entrada(evidencia={"distanciaMinimaHistorico": 1}), detector)
        assert r.alertas[0].tipo == "EVIDENCIA_REUTILIZADA"

    def test_sin_evidencia_no_hay_gasto_verificable(self, detector):
        r = motor.analizar(entrada(con_evidencia=False), detector)
        assert r.nivel == "BAJO"

    def test_personas_sin_anonimizar_se_senala(self, detector):
        r = motor.analizar(
            entrada(evidencia={"contienePersonas": True, "anonimizada": False}), detector
        )
        assert falla(r, "vis.personas_sin_anonimizar")
        assert any(a.tipo == "PRIVACIDAD" for a in r.alertas)


class TestModeloDeAnomalias:
    def test_el_modelo_esta_entrenado(self, detector):
        assert detector.disponible, "ejecute: python -m entrenamiento.entrenar"

    def test_un_perfil_corriente_no_alarma(self, detector):
        r = motor.analizar(entrada(), detector)
        assert r.score_anomalia >= 65

    def test_la_combinacion_pesa_mas_que_cada_señal_suelta(self, detector):
        """El argumento entero de usar un modelo y no mas reglas.

        Ninguna de estas señales por separado basta para desconfiar. Las cuatro
        a la vez si, y eso es lo que una regla por señal no puede expresar.
        """
        solo_monto = motor.analizar(
            entrada(declarado={"montoDeclarado": 480.0}, contexto={"saldoRetenido": 2000.0}),
            detector,
        ).score_anomalia

        solo_proveedor = motor.analizar(
            entrada(contexto={"proveedorConocido": False}), detector
        ).score_anomalia

        todas = motor.analizar(
            entrada(
                declarado={"montoDeclarado": 480.0},
                comprobante={"fechaEmision": "2026-07-20"},
                contexto={
                    "saldoRetenido": 490.0,
                    "proveedorConocido": False,
                    "gastosRecientesMismaCategoria": 5,
                },
            ),
            detector,
        ).score_anomalia

        assert todas < solo_monto
        assert todas < solo_proveedor

    def test_sin_modelo_el_servicio_sigue_evaluando(self):
        """Un modelo ausente degrada la señal, no tumba la verificacion."""
        r = motor.analizar(entrada(), anomalia.DetectorAnomalias())
        assert r.nivel in ("ALTO", "MEDIO", "BAJO")
        assert any(m.regla == "ml.isolation_forest" for m in r.explicacion.motivos)


class TestReglasDelNegocio:
    def test_no_se_puede_gastar_lo_que_no_se_ha_recaudado(self, detector):
        r = motor.analizar(
            entrada(declarado={"montoDeclarado": 900.0}, contexto={"saldoRetenido": 500.0}),
            detector,
        )
        assert r.nivel == "BAJO"
        assert falla(r, "ano.saldo_insuficiente")

    def test_los_umbrales_vienen_en_la_peticion(self, detector, papel_coincide):
        """RN-06: el nivel se calcula con la regla vigente, no con una fija."""
        base = entrada()
        exigente = base.model_copy(
            update={"regla": base.regla.model_copy(update={"umbral_alto": 99.5})}
        )
        assert motor.analizar(base, detector).nivel == "ALTO"
        assert motor.analizar(exigente, detector).nivel == "MEDIO"


def ok(regla: str) -> MotivoAnalisis:
    return MotivoAnalisis(regla=regla, senal="documental", resultado="ok", mensaje="ok")


class TestBorradorDeNarrativa:
    """RF-CO-01 · El borrador solo cuenta lo que una comprobacion respaldo."""

    def test_un_gasto_verificado_trae_borrador(self, detector):
        r = motor.analizar(entrada(), detector)
        assert r.narrativa_borrador
        assert "B001-004521" in r.narrativa_borrador
        assert "Clinica Veterinaria San Roque" in r.narrativa_borrador

    def test_una_evidencia_reciclada_no_lleva_borrador(self, detector):
        r = motor.analizar(entrada(evidencia={"distanciaMinimaHistorico": 1}), detector)
        assert r.narrativa_borrador is None

    def test_sin_lectura_del_papel_no_dice_que_lo_leyo(self, detector):
        """Las pruebas no tienen archivo real: el OCR no lee y no se afirma."""
        r = motor.analizar(entrada(), detector)
        assert "leyó" not in r.narrativa_borrador
        assert "coinciden con lo declarado" not in r.narrativa_borrador

    def test_lo_leido_se_cuenta_con_el_total(self):
        texto = narrativa.redactar_borrador(
            entrada(),
            [ok("ocr.ruc_coincide"), ok("ocr.serie_coincide"), ok("ocr.total_coincide")],
            bloqueo=False,
        )
        assert texto.startswith("La boleta B001-004521 de Clinica Veterinaria San Roque se leyó")
        assert "el total de S/ 118.00" in texto
        assert "coinciden con lo declarado" in texto

    def test_una_comprobacion_fallida_no_se_afirma(self, detector):
        r = motor.analizar(entrada(declarado={"concepto": "alquiler de oficina en Lima"}), detector)
        assert falla(r, "nlp.coherencia_categoria")
        assert "destino del fondo" not in (r.narrativa_borrador or "")

    def test_una_regla_que_paso_en_una_evidencia_y_no_en_otra_no_se_afirma(self):
        mixto = [
            ok("vis.evidencia_nueva"),
            MotivoAnalisis(regla="vis.evidencia_nueva", senal="visual", resultado="advertencia", mensaje="x"),
            ok("doc.ruc_modulo11"),
        ]
        texto = narrativa.redactar_borrador(entrada(), mixto, bloqueo=False)
        assert "foto" not in texto
        assert "RUC del emisor es válido" in texto

    def test_sin_nada_verificado_no_hay_borrador(self):
        assert narrativa.redactar_borrador(entrada(), [], bloqueo=False) is None

    def test_solo_cifras_del_comprobante(self, detector):
        """El backend rechaza cualquier cifra que no salga del gasto: no darle motivo."""
        import re

        r = motor.analizar(entrada(), detector)
        permitidas = set(re.findall(r"\d+(?:[.,]\d+)*", "B001 004521 118.00 20601030579"))
        assert set(re.findall(r"\d+(?:[.,]\d+)*", r.narrativa_borrador)) <= permitidas
