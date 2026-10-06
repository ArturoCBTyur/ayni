/**
 * Cifrado en reposo (RNF-01).
 *
 * Lo que se comprueba no es que AES funcione, que eso ya lo garantiza Node:
 * es que el uso que hace el proyecto cierre las puertas que importan. Que lo
 * guardado en disco no se lea, que un archivo cambiado por otro no abra, que
 * un secreto TOTP copiado a otra cuenta no sirva, y que rotar la clave no
 * deje ilegible lo anterior.
 *
 * No toca la base: corre en milisegundos y en cualquier maquina.
 */
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cargarConfiguracion, type Configuracion } from '../../config/configuracion';
import { AlmacenamientoDisco } from '../../modules/gastos/almacenamiento/disco.storage';
import { TotpService } from '../../modules/identidad/servicios/totp.service';
import { CifradoService } from './cifrado.service';
import {
  abrir,
  abrirTexto,
  crearLlavero,
  ErrorCifrado,
  idDeSobre,
  idDeTexto,
  leerClave,
  sellar,
  sellarTexto,
} from './sobre';

const nuevaClave = () => randomBytes(32).toString('base64');

// Varias pruebas provocan a proposito un sobre que no abre, y el servicio lo
// registra como error. Verlos en la salida entrena a ignorar los reales.
let avisos: jest.SpyInstance;

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  avisos = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

function motivoDe(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ErrorCifrado) return error.motivo;
    throw error;
  }
  return undefined;
}

/** Un ConfigService minimo con lo que leen el cifrado, el disco y el TOTP. */
function configCon(valores: Partial<Configuracion>): ConfigService<Configuracion, true> {
  return new ConfigService<Configuracion, true>({
    STORAGE_URL_SECRET: 'secreto-de-urls-para-esta-prueba-000',
    STORAGE_URL_TTL: 900,
    API_PREFIX: 'api/v1',
    TOTP_EMISOR: 'Ayni',
    ...valores,
  } as Configuracion);
}

describe('Sobre de cifrado', () => {
  const llavero = crearLlavero(nuevaClave());
  const foto = randomBytes(4096);

  it('abre lo que sello, con el mismo contexto', () => {
    const sobre = sellar(llavero, foto, 'almacenamiento:evidencias/a.jpg');
    expect(abrir(llavero, sobre, 'almacenamiento:evidencias/a.jpg').equals(foto)).toBe(true);
  });

  it('dos sellos del mismo contenido no se parecen (IV aleatorio)', () => {
    const a = sellar(llavero, foto, 'x');
    const b = sellar(llavero, foto, 'x');
    // Si se parecieran, se sabria que dos evidencias son la misma foto sin
    // descifrar ninguna.
    expect(a.equals(b)).toBe(false);
  });

  it('no abre con otro contexto: un archivo cambiado por otro se detecta', () => {
    const sobre = sellar(llavero, foto, 'almacenamiento:evidencias/a.jpg');
    expect(motivoDe(() => abrir(llavero, sobre, 'almacenamiento:evidencias/b.jpg'))).toBe(
      'alterado',
    );
  });

  it('no abre si se altero un solo byte', () => {
    const sobre = sellar(llavero, foto, 'x');
    sobre[sobre.length - 1] ^= 0x01;
    expect(motivoDe(() => abrir(llavero, sobre, 'x'))).toBe('alterado');
  });

  it('devuelve tal cual lo que no es un sobre: los archivos previos al cifrado', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(idDeSobre(jpeg)).toBeNull();
    expect(abrir(llavero, jpeg, 'x').equals(jpeg)).toBe(true);
  });

  it('dice que falta la clave en vez de decir que el archivo esta dañado', () => {
    const otra = crearLlavero(nuevaClave());
    const sobre = sellar(otra, foto, 'x');
    // Son dos incidentes distintos: una configuracion incompleta se arregla
    // en minutos, una evidencia alterada abre una investigacion.
    expect(motivoDe(() => abrir(llavero, sobre, 'x'))).toBe('clave-desconocida');
  });

  it('se niega a sellar sin clave en lugar de guardar en claro en silencio', () => {
    expect(motivoDe(() => sellar(crearLlavero(), foto, 'x'))).toBe('sin-clave');
  });

  it('rechaza una clave que no tiene 32 bytes', () => {
    expect(() => leerClave(Buffer.from('corta').toString('base64'))).toThrow(/32 bytes/);
    expect(() => leerClave('una frase cualquiera no es una clave')).toThrow(/32 bytes/);
  });

  describe('rotacion de la clave', () => {
    const vieja = nuevaClave();
    const nueva = nuevaClave();

    it('lo sellado con la clave retirada sigue abriendo', () => {
      const sobre = sellar(crearLlavero(vieja), foto, 'x');
      const rotado = crearLlavero(nueva, vieja);
      expect(abrir(rotado, sobre, 'x').equals(foto)).toBe(true);
    });

    it('lo nuevo se sella con la clave actual, no con la retirada', () => {
      const rotado = crearLlavero(nueva, vieja);
      expect(idDeSobre(sellar(rotado, foto, 'x'))).toBe(leerClave(nueva).id);
    });
  });

  describe('texto', () => {
    it('sella y abre, y el texto sellado no contiene el original', () => {
      const secreto = authenticator.generateSecret();
      const sellado = sellarTexto(llavero, secreto, 'u:1');
      expect(sellado).not.toContain(secreto);
      expect(idDeTexto(sellado)).toBe(llavero.actual?.id);
      expect(abrirTexto(llavero, sellado, 'u:1')).toBe(secreto);
    });

    it('un texto sin prefijo se lee como guardado en claro', () => {
      expect(abrirTexto(llavero, 'JBSWY3DPEHPK3PXP', 'u:1')).toBe('JBSWY3DPEHPK3PXP');
      expect(idDeTexto('JBSWY3DPEHPK3PXP')).toBeNull();
    });

    it('un texto con prefijo pero truncado falla, no se lee en claro', () => {
      expect(motivoDe(() => abrirTexto(llavero, 'ayni:v1:AAAA', 'u:1'))).toBe('alterado');
    });
  });
});

describe('CifradoService sin clave', () => {
  // Vacia y no ausente: ConfigService busca en process.env lo que no esta en
  // su configuracion, y en CI la clave esta definida.
  let servicio: CifradoService;

  beforeAll(() => {
    servicio = new CifradoService(configCon({ CIFRADO_CLAVE: '' }));
  });

  it('no cifra y lo dice al arrancar', () => {
    expect(servicio.activo).toBe(false);
    expect(servicio.idClave).toBeNull();
    expect(avisos).toHaveBeenCalledWith(
      expect.stringMatching(/CIFRADO_CLAVE no esta definida/),
    );
  });

  it('guarda tal cual y lee tal cual', () => {
    const foto = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
    expect(servicio.sellarBytes(foto, 'x')).toBe(foto);
    expect(servicio.abrirBytes(foto, 'x')).toBe(foto);
    expect(servicio.sellarTexto('JBSWY3DPEHPK3PXP', 'x')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('lo que se cifro con una clave no se lee sin ella', () => {
    const sobre = sellar(crearLlavero(nuevaClave()), Buffer.from('foto'), 'x');
    expect(() => servicio.abrirBytes(sobre, 'x')).toThrow(ErrorCifrado);
  });
});

describe('Almacenamiento en disco cifrado', () => {
  let carpeta: string;
  let disco: AlmacenamientoDisco;

  beforeAll(async () => {
    carpeta = await mkdtemp(join(tmpdir(), 'ayni-cifrado-'));
    const config = configCon({ STORAGE_DIR: carpeta, CIFRADO_CLAVE: nuevaClave() });
    disco = new AlmacenamientoDisco(config, new CifradoService(config));
  });

  afterAll(async () => {
    await rm(carpeta, { recursive: true, force: true });
  });

  it('lo que queda en disco no es la foto, y lo que se lee si', async () => {
    // Un texto reconocible hace evidente si quedo algo en claro.
    const original = Buffer.from('DNI 45879632 · Rosa Chavez · boleta B001-00042'.repeat(20));
    await disco.guardar('evidencias/a.jpg', original, 'image/jpeg');

    const enDisco = await readFile(join(carpeta, 'evidencias/a.jpg'));
    expect(enDisco.includes(Buffer.from('45879632'))).toBe(false);
    expect(enDisco.subarray(0, 4).toString('ascii')).toBe('AYNI');

    expect((await disco.leer('evidencias/a.jpg')).equals(original)).toBe(true);
  });

  it('la huella es la del contenido, no la del sobre', async () => {
    // El hash identifica la evidencia en la deteccion de duplicados (RF-IA-05)
    // y en la cadena de custodia: no puede cambiar porque cambie la clave.
    const original = randomBytes(2048);
    const guardado = await disco.guardar('evidencias/h.jpg', original, 'image/jpeg');
    expect(guardado.hashSha256).toBe(createHash('sha256').update(original).digest('hex'));
    expect(guardado.bytes).toBe(original.length);
  });

  it('una evidencia reemplazada por la de otro gasto no abre', async () => {
    await disco.guardar('evidencias/gasto-1.jpg', randomBytes(512), 'image/jpeg');
    await disco.guardar('evidencias/gasto-2.jpg', randomBytes(512), 'image/jpeg');

    // Quien tiene acceso al disco copia una evidencia valida sobre otra.
    const ajena = await readFile(join(carpeta, 'evidencias/gasto-2.jpg'));
    await writeFile(join(carpeta, 'evidencias/gasto-1.jpg'), ajena);

    await expect(disco.leer('evidencias/gasto-1.jpg')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('sigue leyendo los archivos guardados antes de activar el cifrado', async () => {
    const previo = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
    await writeFile(join(carpeta, 'evidencias/previo.png'), previo);
    expect((await disco.leer('evidencias/previo.png')).equals(previo)).toBe(true);
  });
});

describe('Secreto TOTP cifrado', () => {
  const config = configCon({ CIFRADO_CLAVE: nuevaClave() });
  const totp = new TotpService(config, new CifradoService(config));
  const secreto = authenticator.generateSecret();

  it('lo guardado no sirve para generar codigos', () => {
    const guardado = totp.sellarSecreto('usuario-a', secreto);
    expect(guardado).not.toContain(secreto);
    expect(authenticator.generate(guardado)).not.toBe(authenticator.generate(secreto));
  });

  it('verifica el codigo contra el secreto guardado', () => {
    const guardado = totp.sellarSecreto('usuario-a', secreto);
    const codigo = authenticator.generate(secreto);
    expect(totp.verificarGuardado(codigo, guardado, 'usuario-a')).toBe(true);

    const malo = codigo === '000000' ? '111111' : '000000';
    expect(totp.verificarGuardado(malo, guardado, 'usuario-a')).toBe(false);
  });

  it('copiado a otra cuenta no abre: no da acceso, avisa', () => {
    const guardado = totp.sellarSecreto('usuario-a', secreto);
    // null y no false: el codigo puede estar bien, lo que no sirve es el
    // secreto, y soporte tiene que saber que hay que restablecerlo.
    expect(totp.verificarGuardado(authenticator.generate(secreto), guardado, 'usuario-b')).toBe(
      null,
    );
  });

  it('acepta los secretos guardados en claro antes de activar el cifrado', () => {
    expect(totp.verificarGuardado(authenticator.generate(secreto), secreto, 'usuario-a')).toBe(
      true,
    );
  });
});

describe('Configuracion del cifrado', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'x'.repeat(32),
    COOKIE_SECRET: 'x'.repeat(32),
    STORAGE_URL_SECRET: 'x'.repeat(32),
    PASARELA_WEBHOOK_SECRET: 'x'.repeat(32),
  };

  it('en produccion no arranca sin clave', () => {
    process.env = { ...base, NODE_ENV: 'production' };
    expect(() => cargarConfiguracion()).toThrow(/CIFRADO_CLAVE/);
  });

  it('en produccion arranca con una clave valida', () => {
    process.env = { ...base, NODE_ENV: 'production', CIFRADO_CLAVE: nuevaClave() };
    expect(cargarConfiguracion().CIFRADO_CLAVE).toBeDefined();
  });

  it('rechaza una clave mal formada aunque no sea produccion', () => {
    process.env = { ...base, NODE_ENV: 'development', CIFRADO_CLAVE: 'clave123' };
    expect(() => cargarConfiguracion()).toThrow(/CIFRADO_CLAVE/);
  });
});
