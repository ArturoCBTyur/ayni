"""Pruebas del reconocimiento de escena.

Dos grupos. El primero fija **que se hace** con lo que el modelo ve, y no
necesita el modelo: recibe lecturas escritas a mano. El segundo comprueba que
el modelo cargado distingue lo mas basico, con imagenes dibujadas en la propia
prueba, y se omite donde el modelo no esta descargado (la integracion
continua), porque pesa 350 MB.

Cuanto acierta sobre fotos de verdad no se prueba aqui: lo mide
`python -m evaluacion --solo escena`.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aini import escena, motor  # noqa: E402
from pruebas.test_motor import detector, entrada, papel_coincide, reglas  # noqa: E402, F401


def lectura(**probabilidades: float) -> escena.Lectura:
    """Una lectura con la probabilidad dada en cada escena y cero en el resto."""
    assert abs(sum(probabilidades.values()) - 1) < 1e-6
    return escena.Lectura({e: probabilidades.get(e, 0.0) for e in escena.ESCENAS})


RESTAURANTE = lectura(comida=0.97, animal=0.03)
BOLETA = lectura(documento=0.96, medicamento=0.04)
CONSULTA = lectura(veterinaria=0.90, animal=0.10)
PERRO = lectura(animal=0.85, albergue=0.15)


@pytest.fixture
def ve(monkeypatch):
    """Hace que el modelo "vea" lo que la prueba diga en cada evidencia."""

    def fijar(*lecturas):
        monkeypatch.setattr(
            motor,
            "_mirar_evidencias",
            lambda e: {ev.id: l for ev, l in zip(e.evidencias, lecturas)},
        )

    return fijar


def con_dos_evidencias():
    e = entrada()
    e.evidencias.append(e.evidencias[0].model_copy(update={"id": "e2"}))
    return e


class TestCatalogo:
    def test_las_categorias_son_las_del_backend(self):
        backend = {
            "ALIMENTOS", "ATENCION_VETERINARIA", "MEDICAMENTOS", "INSUMOS",
            "TRANSPORTE", "INFRAESTRUCTURA", "ESTERILIZACION", "OTROS",
        }  # fmt: skip
        usadas = {c for e in escena.ESCENAS.values() for c in e.categorias}
        assert usadas <= backend
        # OTROS no tiene escena propia: ahi solo se mira que no sea ajena.
        assert usadas == backend - {"OTROS"}

    def test_una_escena_ajena_no_respalda_ninguna_categoria(self):
        for clave, e in escena.ESCENAS.items():
            assert not (e.ajena and e.categorias), clave

    def test_los_vectores_versionados_son_los_del_catalogo(self):
        """Si alguien cambia una frase y no recalcula, el servicio compararia
        la foto contra las frases viejas sin avisar."""
        import numpy as np

        ficha = escena.ficha()
        assert ficha is not None, "falta modelos/escena.ficha.json"
        assert {k: v["frases"] for k, v in ficha["escenas"].items()} == {
            k: list(e.frases) for k, e in escena.ESCENAS.items()
        }, "ejecute: python -m entrenamiento.escena"
        datos = np.load(escena.RUTA_TEXTOS)
        assert [str(e) for e in datos["escenas"]] == list(escena.ESCENAS)


class TestQueSeHaceConLoQueSeVe:
    def test_una_foto_ajena_no_se_aprueba_sola(self, detector, papel_coincide, ve):
        ve(RESTAURANTE)
        r = motor.analizar(entrada(), detector)
        assert "vis.escena_ajena" in reglas(r, "vis.")
        assert r.nivel == "MEDIO"
        assert [a.tipo for a in r.alertas] == ["EVIDENCIA_NO_CORRESPONDE"]

    def test_la_misma_foto_relacionada_si_se_aprueba(self, detector, papel_coincide, ve):
        ve(CONSULTA)
        r = motor.analizar(entrada(), detector)
        assert "vis.escena_coherente" in reglas(r, "vis.")
        assert r.nivel == "ALTO"
        assert r.alertas == []

    def test_es_advertencia_y_no_falla(self, detector, papel_coincide, ve):
        """El modelo se puede equivocar: resta poco y deriva a una persona."""
        ve(RESTAURANTE)
        r = motor.analizar(entrada(), detector)
        (m,) = [m for m in r.explicacion.motivos if m.regla == "vis.escena_ajena"]
        assert m.resultado == "advertencia"
        assert r.score_visual == 80.0

    def test_el_mensaje_no_acusa(self, detector, papel_coincide, ve):
        ve(RESTAURANTE)
        r = motor.analizar(entrada(), detector)
        texto = " ".join(
            [m.mensaje for m in r.explicacion.motivos if m.regla.startswith("vis.escena")]
            + [a.titulo + " " + a.descripcion for a in r.alertas]
        ).lower()
        for palabra in ("fraude", "falsa", "falso", "engañ", "sospech", "irregular"):
            assert palabra not in texto
        assert "parece" in texto

    def test_un_animal_sin_contexto_no_resta(self, detector, papel_coincide, ve):
        """Fotografiar al perro y no la compra es lo habitual."""
        ve(PERRO)
        r = motor.analizar(entrada(declarado={"categoriaGasto": "TRANSPORTE",
                                              "concepto": "traslado de perros al albergue"}), detector)
        assert "vis.escena_relacionada" in reglas(r, "vis.")
        assert r.score_visual == 100.0

    def test_otra_categoria_del_rescate_no_resta(self, detector, papel_coincide, ve):
        ve(lectura(alimento=0.9, animal=0.1))
        r = motor.analizar(entrada(), detector)
        assert "vis.escena_ajena" not in reglas(r, "vis.")
        assert r.score_visual == 100.0

    def test_la_foto_del_comprobante_junto_a_otra_que_si_corresponde(
        self, detector, papel_coincide, ve
    ):
        ve(CONSULTA, BOLETA)
        r = motor.analizar(con_dos_evidencias(), detector)
        vis = reglas(r, "vis.")
        assert "vis.escena_complementaria" in vis and "vis.escena_ajena" not in vis
        assert r.nivel == "ALTO"

    def test_dos_fotos_ajenas_son_un_solo_problema(self, detector, papel_coincide, ve):
        ve(RESTAURANTE, BOLETA)
        r = motor.analizar(con_dos_evidencias(), detector)
        assert reglas(r, "vis.").count("vis.escena_ajena") == 2
        assert r.score_visual == 80.0
        assert len(r.alertas) == 1

    def test_una_duda_no_es_una_advertencia(self, detector, papel_coincide, ve):
        ve(lectura(comida=0.5, animal=0.5))
        r = motor.analizar(entrada(), detector)
        assert "vis.escena_ajena" not in reglas(r, "vis.")

    def test_no_poder_abrir_la_foto_no_resta(self, detector, papel_coincide, ve):
        ve(None)
        r = motor.analizar(entrada(), detector)
        assert "vis.escena_no_evaluada" in reglas(r, "vis.")
        assert r.score_visual == 100.0
        assert r.nivel == "ALTO"

    def test_sin_modelo_no_aparece_ningun_motivo(self, detector, papel_coincide, monkeypatch):
        monkeypatch.setattr(escena, "disponible", lambda: False)
        r = motor.analizar(entrada(), detector)
        assert not [m for m in reglas(r, "vis.") if m.startswith("vis.escena")]
        assert r.nivel == "ALTO"

    def test_la_evidencia_reciclada_sigue_mandando(self, detector, papel_coincide, ve):
        ve(RESTAURANTE)
        r = motor.analizar(entrada(evidencia={"distanciaMinimaHistorico": 2}), detector)
        assert r.nivel == "BAJO"
        assert r.alertas[0].tipo == "EVIDENCIA_REUTILIZADA"

    def test_un_video_no_se_mira(self, detector, papel_coincide, monkeypatch):
        monkeypatch.setattr(escena, "disponible", lambda: True)
        monkeypatch.setattr(escena, "mirar_desde", lambda url: pytest.fail("miro un video"))
        r = motor.analizar(entrada(evidencia={"tipo": "VIDEO"}), detector)
        assert not [m for m in reglas(r, "vis.") if m.startswith("vis.escena")]


def _jpg(imagen) -> bytes:
    salida = io.BytesIO()
    imagen.save(salida, "JPEG", quality=90)
    return salida.getvalue()


@pytest.mark.skipif(not escena.disponible(), reason="modelo de escena no descargado")
class TestElModelo:
    def test_un_mosaico_de_colores_no_es_evidencia(self):
        """Las evidencias que genera el seed de la demo son esto."""
        import random

        from PIL import Image, ImageDraw

        azar = random.Random(7)
        im = Image.new("RGB", (800, 600))
        dibujo = ImageDraw.Draw(im)
        for x in range(0, 800, 40):
            for y in range(0, 600, 40):
                color = azar.choice(["#3b6ea5", "#9ec1e8", "#c5e000", "#e00020", "#1f4e79"])
                dibujo.rectangle([x, y, x + 40, y + 40], fill=color)
        l = escena.mirar(_jpg(im))
        assert l.ajena >= escena.UMBRAL_AJENA

    def test_una_boleta_no_es_una_foto_del_gasto(self):
        from evaluacion import comprobantes

        datos = comprobantes.banco_sintetico()[0].imagen()
        l = escena.mirar(datos)
        assert l.ajena >= escena.UMBRAL_AJENA
        assert l.escena_ajena_principal == "documento"

    def test_las_probabilidades_suman_uno(self):
        from PIL import Image

        l = escena.mirar(_jpg(Image.new("RGB", (300, 300), "#777777")))
        assert abs(sum(l.probabilidades.values()) - 1) < 1e-4

    def test_un_archivo_que_no_es_imagen_no_tumba_nada(self):
        assert escena.mirar(b"%PDF-1.7 esto no es una imagen") is None

    def test_la_foto_vertical_del_celular_no_entra_acostada(self):
        """`preparar` respeta la orientacion EXIF."""
        from PIL import Image

        im = Image.new("RGB", (400, 200), "white")
        im.paste("black", (0, 0, 200, 200))  # mitad izquierda negra
        exif = Image.Exif()
        exif[0x0112] = 6  # girar 90° al mostrar
        salida = io.BytesIO()
        im.save(salida, "JPEG", exif=exif)
        girada = escena.preparar(salida.getvalue())
        derecha = escena.preparar(_jpg(im))
        assert girada is not None and derecha is not None
        assert abs(float(girada.mean()) - float(derecha.mean())) < 0.5
        assert not (girada == derecha).all()

