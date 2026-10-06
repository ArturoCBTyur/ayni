import { z } from 'zod';

import { leerClave } from '../comun/cifrado/sobre';

/** Una clave de 32 bytes en base64, o una lista de ellas separadas por coma. */
function sonClavesValidas(valor: string): boolean {
  try {
    valor
      .split(',')
      .filter((v) => v.trim())
      .forEach((v) => leerClave(v));
    return true;
  } catch {
    return false;
  }
}

const MENSAJE_CLAVE = 'debe ser de 32 bytes en base64. Generela con: openssl rand -base64 32';

/**
 * Configuracion validada al arrancar. Si falta o es invalida una variable,
 * la API no levanta: es preferible fallar al inicio que a mitad de una
 * transaccion contable.
 */
const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('api/v1'),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(24),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_SECRET: z.string().min(24),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604800),
  COOKIE_SECRET: z.string().min(24),

  TOTP_EMISOR: z.string().default('Ayni'),

  CORS_ORIGENES: z.string().default('http://localhost:5000'),

  STORAGE_DRIVER: z.enum(['disco', 's3']).default('disco'),
  STORAGE_DIR: z.string().default('../../storage'),
  STORAGE_URL_SECRET: z.string().min(24),
  STORAGE_URL_TTL: z.coerce.number().int().positive().default(900),

  /**
   * RNF-01 · Clave de cifrado en reposo de evidencias y secretos TOTP.
   *
   * Va separada de los demas secretos a proposito: un respaldo de la base y de
   * los archivos no sirve de nada sin ella, y por eso mismo no debe viajar con
   * el respaldo. Obligatoria en produccion.
   */
  CIFRADO_CLAVE: z
    .string()
    .optional()
    .refine((v) => !v || sonClavesValidas(v), { message: MENSAJE_CLAVE }),
  /** Claves retiradas, separadas por coma: solo descifran (rotacion). */
  CIFRADO_CLAVES_ANTERIORES: z
    .string()
    .optional()
    .refine((v) => !v || sonClavesValidas(v), { message: MENSAJE_CLAVE }),

  PASARELA_DRIVER: z.enum(['fake', 'culqi']).default('fake'),
  PASARELA_COMISION_PORCENTAJE: z.coerce.number().min(0).default(3.44),
  PASARELA_COMISION_FIJA: z.coerce.number().min(0).default(1.0),
  PASARELA_WEBHOOK_SECRET: z.string().min(24),
  /**
   * A donde entrega FakeGateway sus webhooks. Vacio en pruebas: alli no hay
   * servidor HTTP escuchando y el handler se invoca directamente.
   */
  PASARELA_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),

  CPE_DRIVER: z.enum(['fake', 'sunat']).default('fake'),

  /** El seam de AIni: conmuta la implementacion de MotorVerificacion. */
  VERIFICACION_DRIVER: z.enum(['reglas-v0', 'aini']).default('reglas-v0'),
  AINI_URL: z.string().url().optional(),
  /** Token compartido con el servicio. Opcional en local, exigido fuera. */
  AINI_TOKEN: z.string().optional(),
  /**
   * Sin limite de tiempo, un servicio que acepta la conexion y no responde
   * deja colgado al trabajador de la cola y detiene la verificacion de todos
   * los demas gastos. 20 s da margen a la carga del modelo y corta antes de
   * que un gasto bloquee la fila.
   */
  AINI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  /**
   * Desde donde AIni puede descargar los comprobantes.
   *
   * El analisis recibe URLs firmadas y absolutas, no claves de objeto: el
   * servicio corre en otro proceso --y en el despliegue, en otra maquina-- y
   * no tiene acceso al disco del backend. Es la misma razon por la que S3
   * entrega URLs prefirmadas en vez de rutas.
   */
  API_URL_PUBLICA: z.string().url().default('http://127.0.0.1:3000'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  CORREO_REMITENTE: z.string().default('Ayni <no-responder@localhost>'),
});

/**
 * Reglas que cruzan variables. Van aparte porque `superRefine` convierte el
 * objeto en un efecto y el tipo se deriva del objeto, no del efecto.
 */
const esquemaValidado = esquema.superRefine((c, ctx) => {
  if (c.NODE_ENV === 'production' && !c.CIFRADO_CLAVE) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CIFRADO_CLAVE'],
      message:
        'es obligatoria en produccion: sin ella las evidencias de los beneficiarios y ' +
        'los secretos del segundo factor quedan en claro (RNF-01).',
    });
  }
});

export type Configuracion = z.infer<typeof esquema> & {
  corsOrigenes: string[];
};

export function cargarConfiguracion(): Configuracion {
  const resultado = esquemaValidado.safeParse(process.env);

  if (!resultado.success) {
    const detalles = resultado.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Configuracion invalida. Revise el archivo .env (vea .env.example):\n${detalles}`,
    );
  }

  return {
    ...resultado.data,
    corsOrigenes: resultado.data.CORS_ORIGENES.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
