/**
 * Pruebas del procesamiento de imagen sin IA.
 *
 * Son las que sostienen la afirmacion de que RF-IA-05 queda implementado de
 * verdad en esta version: si el dHash no distingue una foto reciclada de una
 * nueva, la deteccion de evidencias reutilizadas no existe.
 */
import sharp from 'sharp';

import {
  calcularDHash,
  calcularNitidez,
  comprimirEvidencia,
  difuminarRegiones,
  distanciaHamming,
  leerMetadatos,
  UMBRAL_DUPLICADO_PERCEPTUAL,
} from './imagen';

/**
 * Imagen de prueba con estructura reproducible.
 *
 * Usa un generador pseudoaleatorio con semilla en vez de un patron regular:
 * dos tableros con celdas de distinto tamaño pueden verse identicos una vez
 * reducidos a 9x8, y la prueba de "imagenes distintas" fallaria sin que el
 * dHash tenga nada de malo.
 */
async function imagenDePrueba(
  opciones: { ancho?: number; alto?: number; semilla?: number } = {},
): Promise<Buffer> {
  const ancho = opciones.ancho ?? 320;
  const alto = opciones.alto ?? 240;
  const canales = 3;
  const datos = Buffer.alloc(ancho * alto * canales);

  let estado = (opciones.semilla ?? 1) * 2654435761;
  const siguiente = () => {
    estado = (estado * 1103515245 + 12345) & 0x7fffffff;
    return estado / 0x7fffffff;
  };

  // Manchas grandes de intensidad aleatoria: estructura suficiente para que
  // el hash perceptual tenga algo que describir, y distinta en cada semilla.
  //
  // El tamaño del bloque importa y se eligio midiendo. Con bloques de 20 px
  // la imagen se parece mas a ruido de alta frecuencia que a una fotografia,
  // y al reescalarla la distancia de Hamming sube a 12; con bloques de 60 px
  // baja a 4, manteniendo una distancia de 20 entre semillas distintas. Una
  // evidencia real (un animal, una sala, una boleta) tiene estructura de gran
  // escala, asi que 60 px representa mejor el caso de uso.
  const bloque = 60;
  for (let by = 0; by < Math.ceil(alto / bloque); by += 1) {
    for (let bx = 0; bx < Math.ceil(ancho / bloque); bx += 1) {
      const tono = Math.floor(siguiente() * 255);
      for (let y = by * bloque; y < Math.min((by + 1) * bloque, alto); y += 1) {
        for (let x = bx * bloque; x < Math.min((bx + 1) * bloque, ancho); x += 1) {
          const i = (y * ancho + x) * canales;
          datos[i] = tono;
          datos[i + 1] = (tono + 40) % 256;
          datos[i + 2] = (tono + 90) % 256;
        }
      }
    }
  }

  return sharp(datos, { raw: { width: ancho, height: alto, channels: canales } })
    .png()
    .toBuffer();
}

/** Extrae una region como RGB puro, para poder comparar pixel a pixel. */
async function regionRgb(
  imagen: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  // removeAlpha() es indispensable: componer puede añadir canal alfa y dos
  // buffers con distinto numero de canales nunca serian iguales, aunque los
  // colores lo fueran.
  return sharp(imagen).extract(region).removeAlpha().raw().toBuffer();
}

/** Imagen uniforme: sin bordes, por tanto sin nitidez. */
async function imagenPlana(): Promise<Buffer> {
  return sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: 128, g: 128, b: 128 } },
  })
    .png()
    .toBuffer();
}

describe('dHash perceptual (RF-IA-05)', () => {
  it('produce 64 bits en 16 caracteres hexadecimales', async () => {
    const hash = await calcularDHash(await imagenDePrueba());

    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('es estable: la misma imagen da siempre el mismo hash', async () => {
    const imagen = await imagenDePrueba();

    expect(await calcularDHash(imagen)).toBe(await calcularDHash(imagen));
  });

  it('sobrevive al cambio de tamaño y a la recompresion', async () => {
    // Este es el punto: cambiar de tamaño o recomprimir destruye el SHA-256,
    // pero apenas mueve el dHash. Es como se detecta una foto reciclada.
    const original = await imagenDePrueba({ ancho: 640, alto: 480 });
    const reescalada = await sharp(original).resize(300, 225).jpeg({ quality: 70 }).toBuffer();

    const distancia = distanciaHamming(
      await calcularDHash(original),
      await calcularDHash(reescalada),
    );

    expect(distancia).toBeLessThan(UMBRAL_DUPLICADO_PERCEPTUAL);
  });

  it('distingue imagenes realmente distintas', async () => {
    const a = await calcularDHash(await imagenDePrueba({ semilla: 1 }));
    const b = await calcularDHash(await imagenDePrueba({ semilla: 4 }));

    expect(distanciaHamming(a, b)).toBeGreaterThanOrEqual(UMBRAL_DUPLICADO_PERCEPTUAL);
  });

  it('la distancia de Hamming se comporta como una metrica', async () => {
    const a = await calcularDHash(await imagenDePrueba({ semilla: 1 }));
    const b = await calcularDHash(await imagenDePrueba({ semilla: 3 }));

    expect(distanciaHamming(a, a)).toBe(0);
    expect(distanciaHamming(a, b)).toBe(distanciaHamming(b, a));
    expect(distanciaHamming(a, b)).toBeGreaterThan(0);
  });

  it('hashes de distinta longitud no se comparan como iguales', () => {
    // Defensa ante datos historicos o corruptos: devolver 0 aqui haria que
    // un registro invalido pareciera un duplicado exacto.
    expect(distanciaHamming('abc', 'abcdef0123456789')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('Nitidez por varianza del laplaciano', () => {
  it('una imagen con bordes marcados puntua alto', async () => {
    const nitidez = await calcularNitidez(await imagenDePrueba());

    expect(nitidez).toBeGreaterThan(100);
  });

  it('una imagen plana puntua practicamente cero', async () => {
    const nitidez = await calcularNitidez(await imagenPlana());

    expect(nitidez).toBeLessThan(5);
  });

  it('desenfocar reduce la nitidez de forma clara', async () => {
    const original = await imagenDePrueba();
    const borrosa = await sharp(original).blur(8).png().toBuffer();

    const nitida = await calcularNitidez(original);
    const desenfocada = await calcularNitidez(borrosa);

    // Es la señal que avisa al operador de que la foto no sirve antes de
    // que el auditor pierda tiempo con ella.
    expect(desenfocada).toBeLessThan(nitida / 2);
  });
});

describe('Difuminado manual de regiones (RF-DE-04, RNF-06)', () => {
  it('altera la zona marcada y deja el resto igual', async () => {
    const original = await imagenDePrueba({ ancho: 400, alto: 300 });
    const difuminada = await difuminarRegiones(original, [
      { x: 50, y: 50, ancho: 100, alto: 100 },
    ]);

    const region = { left: 60, top: 60, width: 60, height: 60 };
    expect(
      (await regionRgb(original, region)).equals(await regionRgb(difuminada, region)),
    ).toBe(false);

    // Una esquina lejana no debe cambiar: difuminar de mas tambien destruye
    // la evidencia que el donante necesita ver.
    const esquina = { left: 300, top: 220, width: 60, height: 60 };
    expect(
      (await regionRgb(original, esquina)).equals(await regionRgb(difuminada, esquina)),
    ).toBe(true);
  });

  it('recorta regiones que se salen de la imagen en lugar de fallar', async () => {
    const original = await imagenDePrueba({ ancho: 200, alto: 200 });

    // Una region fuera de rango haria fallar la extraccion y la evidencia
    // quedaria sin anonimizar, que es el peor desenlace posible.
    const difuminada = await difuminarRegiones(original, [
      { x: 150, y: 150, ancho: 500, alto: 500 },
      { x: -40, y: -40, ancho: 100, alto: 100 },
    ]);

    const meta = await sharp(difuminada).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
  });

  it('sin regiones devuelve la imagen tal cual', async () => {
    const original = await imagenDePrueba();

    expect(await difuminarRegiones(original, [])).toBe(original);
  });

  it('difuminar cambia el SHA-256 pero conserva la escena', async () => {
    const original = await imagenDePrueba({ ancho: 400, alto: 300 });
    const difuminada = await difuminarRegiones(original, [
      { x: 10, y: 10, ancho: 40, alto: 40 },
    ]);

    // El dHash sigue reconociendo que es la misma escena, que es lo que
    // permite seguir detectando reutilizacion aunque este anonimizada.
    const distancia = distanciaHamming(
      await calcularDHash(original),
      await calcularDHash(difuminada),
    );
    expect(distancia).toBeLessThan(UMBRAL_DUPLICADO_PERCEPTUAL);
  });
});

describe('Compresion y metadatos', () => {
  it('limita el lado mayor a 1920 px y entrega JPEG', async () => {
    const grande = await imagenDePrueba({ ancho: 3000, alto: 2000 });
    const comprimida = await comprimirEvidencia(grande);
    const meta = await sharp(comprimida).metadata();

    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1280);
    expect(meta.format).toBe('jpeg');
    // No se afirma nada sobre el tamaño en bytes: con una imagen sintetica
    // de bloques planos el PNG de origen comprime mejor que el JPEG, y la
    // comparacion diria mas sobre el fixture que sobre la funcion.
    //
    // Plazo propio: generar y recomprimir 6 megapixeles tarda entre 3 y 9 s
    // en una maquina de 4 nucleos, y con los 5 s por defecto de Jest la
    // prueba fallaba o pasaba segun la maquina, no segun el codigo.
  }, 30_000);

  it('no amplia una imagen que ya es pequeña', async () => {
    const pequena = await imagenDePrueba({ ancho: 300, alto: 200 });
    const meta = await sharp(await comprimirEvidencia(pequena)).metadata();

    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);
  });

  it('endereza la foto vertical de un celular segun su EXIF', async () => {
    // Orientacion 6: el sensor guardo 300x200 y la camara indica girar 90
    // grados para verla derecha, como hace un celular en vertical.
    const acostada = await sharp(await imagenDePrueba({ ancho: 300, alto: 200 }))
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const meta = await sharp(await comprimirEvidencia(acostada)).metadata();

    expect(meta.width).toBe(200);
    expect(meta.height).toBe(300);
    // Ya no queda una orientacion que un visor pudiera aplicar dos veces.
    expect(meta.orientation ?? 1).toBe(1);
  });

  it('lee las dimensiones y tolera la ausencia de EXIF', async () => {
    const meta = await leerMetadatos(await imagenDePrueba({ ancho: 320, alto: 240 }));

    expect(meta.ancho).toBe(320);
    expect(meta.alto).toBe(240);
    // Sin EXIF la señal simplemente no se usa; no es un error.
    expect(meta.capturadaEn).toBeNull();
  });
});
