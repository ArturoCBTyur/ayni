-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EstadoUsuario" AS ENUM ('PENDIENTE_VERIFICACION', 'ACTIVO', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "FinalidadConsentimiento" AS ENUM ('TRATAMIENTO_DATOS', 'COMUNICACIONES', 'USO_IMAGEN');

-- CreateEnum
CREATE TYPE "TipoArco" AS ENUM ('ACCESO', 'RECTIFICACION', 'CANCELACION', 'OPOSICION');

-- CreateEnum
CREATE TYPE "EstadoArco" AS ENUM ('RECIBIDA', 'EN_PROCESO', 'ATENDIDA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "EstadoVerificacionOng" AS ENUM ('PENDIENTE', 'EN_REVISION', 'VERIFICADA', 'RECHAZADA', 'SUSPENDIDA');

-- CreateEnum
CREATE TYPE "CargoOng" AS ENUM ('ADMINISTRADOR', 'OPERADOR');

-- CreateEnum
CREATE TYPE "EstadoCampana" AS ENUM ('BORRADOR', 'ACTIVA', 'PAUSADA', 'CERRADA');

-- CreateEnum
CREATE TYPE "CategoriaGasto" AS ENUM ('ALIMENTOS', 'ATENCION_VETERINARIA', 'MEDICAMENTOS', 'INSUMOS', 'TRANSPORTE', 'INFRAESTRUCTURA', 'ESTERILIZACION', 'OTROS');

-- CreateEnum
CREATE TYPE "EstadoFondo" AS ENUM ('ACTIVO', 'PAUSADO', 'CERRADO');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('INGRESO', 'COMISION', 'RETENCION', 'EJECUCION', 'REVERSO', 'REASIGNACION');

-- CreateEnum
CREATE TYPE "FrecuenciaNotificacion" AS ENUM ('CADA_GASTO', 'SEMANAL', 'MENSUAL');

-- CreateEnum
CREATE TYPE "EstadoSuscripcion" AS ENUM ('ACTIVA', 'PAUSADA', 'CANCELADA', 'FALLIDA');

-- CreateEnum
CREATE TYPE "EstadoDonacion" AS ENUM ('PENDIENTE', 'CONFIRMADA', 'FALLIDA', 'REVERSADA');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'REVERSADO');

-- CreateEnum
CREATE TYPE "EstadoGasto" AS ENUM ('BORRADOR', 'EN_ANALISIS', 'EN_REVISION', 'OBSERVADO', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "TipoComprobante" AS ENUM ('FACTURA', 'BOLETA', 'RECIBO_HONORARIOS', 'NOTA_VENTA');

-- CreateEnum
CREATE TYPE "ValidezCpe" AS ENUM ('NO_VALIDADO', 'VALIDO', 'INVALIDO', 'NO_DISPONIBLE');

-- CreateEnum
CREATE TYPE "TipoEvidencia" AS ENUM ('FOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "TipoModelo" AS ENUM ('REGLAS', 'ML_CLASICO', 'DEEP_LEARNING');

-- CreateEnum
CREATE TYPE "EstadoModelo" AS ENUM ('ACTIVO', 'INACTIVO', 'EN_PRUEBAS');

-- CreateEnum
CREATE TYPE "NivelConfianza" AS ENUM ('ALTO', 'MEDIO', 'BAJO');

-- CreateEnum
CREATE TYPE "SeveridadAlerta" AS ENUM ('ALTA', 'MEDIA', 'BAJA');

-- CreateEnum
CREATE TYPE "EstadoAlerta" AS ENUM ('ABIERTA', 'EN_SUBSANACION', 'RESUELTA', 'DESCARTADA');

-- CreateEnum
CREATE TYPE "DecisionAuditoria" AS ENUM ('APROBAR', 'OBSERVAR', 'RECHAZAR');

-- CreateEnum
CREATE TYPE "CanalNotificacion" AS ENUM ('IN_APP', 'CORREO', 'PUSH');

-- CreateEnum
CREATE TYPE "EstadoNotificacion" AS ENUM ('PENDIENTE', 'ENVIADA', 'FALLIDA');

-- CreateEnum
CREATE TYPE "EstadoTrabajo" AS ENUM ('PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'FALLIDO');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "correo" TEXT NOT NULL,
    "hash_password" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "telefono" TEXT,
    "estado" "EstadoUsuario" NOT NULL DEFAULT 'PENDIENTE_VERIFICACION',
    "correo_verificado_en" TIMESTAMPTZ(6),
    "totp_secreto" TEXT,
    "totp_habilitado" BOOLEAN NOT NULL DEFAULT false,
    "ultimo_acceso_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_roles" (
    "usuario_id" UUID NOT NULL,
    "rol_id" UUID NOT NULL,
    "asignado_por" UUID,
    "asignado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_roles_pkey" PRIMARY KEY ("usuario_id","rol_id")
);

-- CreateTable
CREATE TABLE "consentimientos" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "finalidad" "FinalidadConsentimiento" NOT NULL,
    "version_politica" TEXT NOT NULL,
    "otorgado" BOOLEAN NOT NULL,
    "otorgado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocado_en" TIMESTAMPTZ(6),
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "consentimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_arco" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "tipo" "TipoArco" NOT NULL,
    "detalle" TEXT NOT NULL,
    "estado" "EstadoArco" NOT NULL DEFAULT 'RECIBIDA',
    "plazo_limite" TIMESTAMPTZ(6) NOT NULL,
    "respuesta" TEXT,
    "atendido_por" UUID,
    "respondido_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_arco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitacora_auditoria" (
    "id" UUID NOT NULL,
    "usuario_id" UUID,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT,
    "valor_anterior" JSONB,
    "valor_nuevo" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bitacora_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ongs" (
    "id" UUID NOT NULL,
    "ruc" VARCHAR(11) NOT NULL,
    "razon_social" TEXT NOT NULL,
    "nombre_comercial" TEXT,
    "representante_legal" TEXT NOT NULL,
    "documento_representante" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "departamento" TEXT NOT NULL,
    "provincia" TEXT,
    "distrito" TEXT,
    "correo_contacto" TEXT NOT NULL,
    "telefono" TEXT,
    "sitio_web" TEXT,
    "descripcion" TEXT,
    "logo_url" TEXT,
    "estado_verificacion" "EstadoVerificacionOng" NOT NULL DEFAULT 'PENDIENTE',
    "verificada_en" TIMESTAMPTZ(6),
    "verificada_por" UUID,
    "motivo_rechazo" TEXT,
    "puntaje_confianza" DECIMAL(5,2) NOT NULL DEFAULT 50.00,
    "desglose_puntaje" JSONB,
    "cuenta_recaudacion" TEXT,
    "banco" TEXT,
    "terminos_aceptados_en" TIMESTAMPTZ(6),
    "version_terminos" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ongs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ong_miembros" (
    "id" UUID NOT NULL,
    "ong_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "cargo" "CargoOng" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ong_miembros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanas" (
    "id" UUID NOT NULL,
    "ong_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "causa" TEXT NOT NULL,
    "imagen_url" TEXT,
    "departamento" TEXT,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE,
    "estado" "EstadoCampana" NOT NULL DEFAULT 'BORRADOR',
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "campanas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fondos" (
    "id" UUID NOT NULL,
    "campana_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "categoria_gasto" "CategoriaGasto" NOT NULL,
    "meta" DECIMAL(12,2) NOT NULL,
    "saldo_recaudado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldo_retenido" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldo_ejecutado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estado" "EstadoFondo" NOT NULL DEFAULT 'ACTIVO',
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fondos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_contables" (
    "id" UUID NOT NULL,
    "fondo_id" UUID NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "cuenta_debe" TEXT NOT NULL,
    "cuenta_haber" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "donacion_id" UUID,
    "gasto_id" UUID,
    "pago_id" UUID,
    "movimiento_reversado_id" UUID,
    "secuencia" BIGINT NOT NULL,
    "hash_previo" CHAR(64),
    "hash_actual" CHAR(64) NOT NULL,
    "creado_por" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_contables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donantes" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "alias" TEXT,
    "anonimo_por_defecto" BOOLEAN NOT NULL DEFAULT false,
    "documento_tipo" TEXT,
    "documento_numero" TEXT,
    "frecuencia_notificacion" "FrecuenciaNotificacion" NOT NULL DEFAULT 'CADA_GASTO',
    "preferencias" JSONB,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suscripciones" (
    "id" UUID NOT NULL,
    "donante_id" UUID NOT NULL,
    "fondo_id" UUID,
    "ong_id" UUID,
    "monto" DECIMAL(12,2) NOT NULL,
    "dia_cobro" INTEGER NOT NULL,
    "estado" "EstadoSuscripcion" NOT NULL DEFAULT 'ACTIVA',
    "token_pago" TEXT NOT NULL,
    "proximo_cobro_en" TIMESTAMPTZ(6) NOT NULL,
    "pausada_en" TIMESTAMPTZ(6),
    "cancelada_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suscripciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donaciones" (
    "id" UUID NOT NULL,
    "donante_id" UUID NOT NULL,
    "fondo_id" UUID NOT NULL,
    "suscripcion_id" UUID,
    "monto" DECIMAL(12,2) NOT NULL,
    "monto_neto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monto_aplicado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "anonima" BOOLEAN NOT NULL DEFAULT false,
    "mensaje" TEXT,
    "estado" "EstadoDonacion" NOT NULL DEFAULT 'PENDIENTE',
    "confirmada_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "id" UUID NOT NULL,
    "donacion_id" UUID NOT NULL,
    "pasarela" TEXT NOT NULL,
    "referencia_externa" TEXT NOT NULL,
    "token_tarjeta" TEXT,
    "monto" DECIMAL(12,2) NOT NULL,
    "comision" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monto_neto" DECIMAL(12,2) NOT NULL,
    "estado" "EstadoPago" NOT NULL DEFAULT 'PENDIENTE',
    "metodo" TEXT,
    "ultimos4" VARCHAR(4),
    "marca" TEXT,
    "motivo_rechazo" TEXT,
    "evento_idempotencia" TEXT,
    "payload" JSONB,
    "procesado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gastos" (
    "id" UUID NOT NULL,
    "fondo_id" UUID NOT NULL,
    "ong_id" UUID NOT NULL,
    "registrado_por" UUID NOT NULL,
    "monto_declarado" DECIMAL(12,2) NOT NULL,
    "monto_aprobado" DECIMAL(12,2),
    "concepto" TEXT NOT NULL,
    "proveedor_nombre" TEXT NOT NULL,
    "proveedor_ruc" VARCHAR(11),
    "fecha_gasto" DATE NOT NULL,
    "estado" "EstadoGasto" NOT NULL DEFAULT 'BORRADOR',
    "capturado_en" TIMESTAMPTZ(6),
    "sincronizado_en" TIMESTAMPTZ(6),
    "latitud" DECIMAL(10,7),
    "longitud" DECIMAL(10,7),
    "aprobado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gastos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobantes" (
    "id" UUID NOT NULL,
    "gasto_id" UUID NOT NULL,
    "tipo" "TipoComprobante" NOT NULL,
    "ruc_emisor" VARCHAR(11) NOT NULL,
    "razon_social_emisor" TEXT,
    "serie" VARCHAR(8) NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "fecha_emision" DATE NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "igv" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "moneda" VARCHAR(3) NOT NULL DEFAULT 'PEN',
    "archivo_url" TEXT NOT NULL,
    "archivo_mime" TEXT NOT NULL,
    "archivo_bytes" INTEGER NOT NULL,
    "hash_sha256" CHAR(64) NOT NULL,
    "validez_cpe" "ValidezCpe" NOT NULL DEFAULT 'NO_VALIDADO',
    "validez_detalle" JSONB,
    "validado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comprobantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidencias" (
    "id" UUID NOT NULL,
    "gasto_id" UUID NOT NULL,
    "tipo" "TipoEvidencia" NOT NULL DEFAULT 'FOTO',
    "archivo_url" TEXT NOT NULL,
    "archivo_anonimizado_url" TEXT,
    "archivo_mime" TEXT NOT NULL,
    "archivo_bytes" INTEGER NOT NULL,
    "ancho" INTEGER,
    "alto" INTEGER,
    "hash_sha256" CHAR(64) NOT NULL,
    "hash_perceptual" CHAR(16),
    "nitidez" DECIMAL(10,2),
    "exif_capturado_en" TIMESTAMPTZ(6),
    "latitud" DECIMAL(10,7),
    "longitud" DECIMAL(10,7),
    "contiene_personas" BOOLEAN NOT NULL DEFAULT false,
    "anonimizada" BOOLEAN NOT NULL DEFAULT false,
    "regiones_difuminadas" JSONB,
    "consentimiento_imagen" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aplicaciones_donacion" (
    "id" UUID NOT NULL,
    "gasto_id" UUID NOT NULL,
    "donacion_id" UUID NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aplicaciones_donacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modelos_ia" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "tipo" "TipoModelo" NOT NULL,
    "descripcion" TEXT,
    "metricas" JSONB,
    "estado" "EstadoModelo" NOT NULL DEFAULT 'EN_PRUEBAS',
    "activado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modelos_ia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reglas_confianza" (
    "id" UUID NOT NULL,
    "umbral_alto" INTEGER NOT NULL DEFAULT 90,
    "umbral_medio" INTEGER NOT NULL DEFAULT 60,
    "peso_documental" DECIMAL(4,3) NOT NULL DEFAULT 0.45,
    "peso_visual" DECIMAL(4,3) NOT NULL DEFAULT 0.25,
    "peso_anomalia" DECIMAL(4,3) NOT NULL DEFAULT 0.30,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "vigente_desde" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_hasta" TIMESTAMPTZ(6),
    "configurado_por" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reglas_confianza_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analisis_aini" (
    "id" UUID NOT NULL,
    "gasto_id" UUID NOT NULL,
    "modelo_id" UUID NOT NULL,
    "regla_id" UUID NOT NULL,
    "score_documental" DECIMAL(5,2) NOT NULL,
    "score_visual" DECIMAL(5,2) NOT NULL,
    "score_anomalia" DECIMAL(5,2) NOT NULL,
    "score_final" DECIMAL(5,2) NOT NULL,
    "nivel" "NivelConfianza" NOT NULL,
    "datos_extraidos" JSONB NOT NULL,
    "explicacion" JSONB NOT NULL,
    "narrativa_borrador" TEXT,
    "duracion_ms" INTEGER,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analisis_aini_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alertas" (
    "id" UUID NOT NULL,
    "ong_id" UUID NOT NULL,
    "gasto_id" UUID,
    "analisis_id" UUID,
    "tipo" TEXT NOT NULL,
    "severidad" "SeveridadAlerta" NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "estado" "EstadoAlerta" NOT NULL DEFAULT 'ABIERTA',
    "plazo_subsanacion" TIMESTAMPTZ(6),
    "afecta_reputacion" BOOLEAN NOT NULL DEFAULT false,
    "resuelta_en" TIMESTAMPTZ(6),
    "resuelta_por" UUID,
    "nota_resolucion" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revisiones_auditoria" (
    "id" UUID NOT NULL,
    "gasto_id" UUID NOT NULL,
    "analisis_id" UUID,
    "auditor_id" UUID NOT NULL,
    "decision" "DecisionAuditoria" NOT NULL,
    "comentario" TEXT NOT NULL,
    "monto_aprobado" DECIMAL(12,2),
    "es_muestreo" BOOLEAN NOT NULL DEFAULT false,
    "conflicto_interes" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revisiones_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "canal" "CanalNotificacion" NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "narrativa" TEXT,
    "gasto_id" UUID,
    "donacion_id" UUID,
    "evidencia_id" UUID,
    "aplicacion_id" UUID,
    "monto_aplicado" DECIMAL(12,2),
    "transaccional" BOOLEAN NOT NULL DEFAULT false,
    "estado" "EstadoNotificacion" NOT NULL DEFAULT 'PENDIENTE',
    "plantilla" TEXT,
    "enviada_en" TIMESTAMPTZ(6),
    "leida_en" TIMESTAMPTZ(6),
    "error" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_donante" (
    "id" UUID NOT NULL,
    "donante_id" UUID NOT NULL,
    "notificacion_id" UUID,
    "gasto_id" UUID,
    "valoracion" INTEGER,
    "comentario" TEXT,
    "reporta_inconsistencia" BOOLEAN NOT NULL DEFAULT false,
    "alerta_generada_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_donante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "refresh_hash" CHAR(64) NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "revocada_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trabajos_verificacion" (
    "id" UUID NOT NULL,
    "gasto_id" UUID NOT NULL,
    "estado" "EstadoTrabajo" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "max_intentos" INTEGER NOT NULL DEFAULT 3,
    "proximo_intento_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tomado_en" TIMESTAMPTZ(6),
    "completado_en" TIMESTAMPTZ(6),
    "error" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trabajos_verificacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_key" ON "usuarios"("correo");

-- CreateIndex
CREATE INDEX "usuarios_estado_idx" ON "usuarios"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "roles_codigo_key" ON "roles"("codigo");

-- CreateIndex
CREATE INDEX "usuario_roles_rol_id_idx" ON "usuario_roles"("rol_id");

-- CreateIndex
CREATE INDEX "consentimientos_usuario_id_finalidad_idx" ON "consentimientos"("usuario_id", "finalidad");

-- CreateIndex
CREATE INDEX "solicitudes_arco_estado_plazo_limite_idx" ON "solicitudes_arco"("estado", "plazo_limite");

-- CreateIndex
CREATE INDEX "bitacora_auditoria_entidad_entidad_id_idx" ON "bitacora_auditoria"("entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "bitacora_auditoria_creado_en_idx" ON "bitacora_auditoria"("creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "ongs_ruc_key" ON "ongs"("ruc");

-- CreateIndex
CREATE INDEX "ongs_estado_verificacion_idx" ON "ongs"("estado_verificacion");

-- CreateIndex
CREATE INDEX "ong_miembros_usuario_id_idx" ON "ong_miembros"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "ong_miembros_ong_id_usuario_id_key" ON "ong_miembros"("ong_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "campanas_slug_key" ON "campanas"("slug");

-- CreateIndex
CREATE INDEX "campanas_estado_causa_idx" ON "campanas"("estado", "causa");

-- CreateIndex
CREATE INDEX "fondos_campana_id_estado_idx" ON "fondos"("campana_id", "estado");

-- CreateIndex
CREATE INDEX "movimientos_contables_fondo_id_creado_en_idx" ON "movimientos_contables"("fondo_id", "creado_en");

-- CreateIndex
CREATE INDEX "movimientos_contables_gasto_id_idx" ON "movimientos_contables"("gasto_id");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_contables_fondo_id_secuencia_key" ON "movimientos_contables"("fondo_id", "secuencia");

-- CreateIndex
CREATE UNIQUE INDEX "donantes_usuario_id_key" ON "donantes"("usuario_id");

-- CreateIndex
CREATE INDEX "suscripciones_estado_proximo_cobro_en_idx" ON "suscripciones"("estado", "proximo_cobro_en");

-- CreateIndex
CREATE INDEX "donaciones_fondo_id_estado_confirmada_en_idx" ON "donaciones"("fondo_id", "estado", "confirmada_en");

-- CreateIndex
CREATE INDEX "donaciones_donante_id_creado_en_idx" ON "donaciones"("donante_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_donacion_id_key" ON "pagos"("donacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_referencia_externa_key" ON "pagos"("referencia_externa");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_evento_idempotencia_key" ON "pagos"("evento_idempotencia");

-- CreateIndex
CREATE INDEX "pagos_estado_creado_en_idx" ON "pagos"("estado", "creado_en");

-- CreateIndex
CREATE INDEX "gastos_fondo_id_estado_idx" ON "gastos"("fondo_id", "estado");

-- CreateIndex
CREATE INDEX "gastos_ong_id_estado_idx" ON "gastos"("ong_id", "estado");

-- CreateIndex
CREATE INDEX "gastos_estado_creado_en_idx" ON "gastos"("estado", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_gasto_id_key" ON "comprobantes"("gasto_id");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_hash_sha256_key" ON "comprobantes"("hash_sha256");

-- CreateIndex
CREATE INDEX "comprobantes_ruc_emisor_idx" ON "comprobantes"("ruc_emisor");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_ruc_emisor_tipo_serie_numero_key" ON "comprobantes"("ruc_emisor", "tipo", "serie", "numero");

-- CreateIndex
CREATE INDEX "evidencias_gasto_id_idx" ON "evidencias"("gasto_id");

-- CreateIndex
CREATE INDEX "evidencias_hash_sha256_idx" ON "evidencias"("hash_sha256");

-- CreateIndex
CREATE INDEX "evidencias_hash_perceptual_idx" ON "evidencias"("hash_perceptual");

-- CreateIndex
CREATE INDEX "aplicaciones_donacion_donacion_id_idx" ON "aplicaciones_donacion"("donacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "aplicaciones_donacion_gasto_id_donacion_id_key" ON "aplicaciones_donacion"("gasto_id", "donacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "modelos_ia_nombre_version_key" ON "modelos_ia"("nombre", "version");

-- CreateIndex
CREATE INDEX "analisis_aini_gasto_id_creado_en_idx" ON "analisis_aini"("gasto_id", "creado_en");

-- CreateIndex
CREATE INDEX "analisis_aini_nivel_idx" ON "analisis_aini"("nivel");

-- CreateIndex
CREATE INDEX "alertas_ong_id_estado_idx" ON "alertas"("ong_id", "estado");

-- CreateIndex
CREATE INDEX "alertas_estado_severidad_idx" ON "alertas"("estado", "severidad");

-- CreateIndex
CREATE INDEX "revisiones_auditoria_auditor_id_creado_en_idx" ON "revisiones_auditoria"("auditor_id", "creado_en");

-- CreateIndex
CREATE INDEX "revisiones_auditoria_gasto_id_idx" ON "revisiones_auditoria"("gasto_id");

-- CreateIndex
CREATE INDEX "notificaciones_usuario_id_leida_en_idx" ON "notificaciones"("usuario_id", "leida_en");

-- CreateIndex
CREATE INDEX "notificaciones_estado_creado_en_idx" ON "notificaciones"("estado", "creado_en");

-- CreateIndex
CREATE INDEX "feedback_donante_donante_id_creado_en_idx" ON "feedback_donante"("donante_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_refresh_hash_key" ON "sesiones"("refresh_hash");

-- CreateIndex
CREATE INDEX "sesiones_usuario_id_revocada_en_idx" ON "sesiones"("usuario_id", "revocada_en");

-- CreateIndex
CREATE INDEX "trabajos_verificacion_estado_proximo_intento_en_idx" ON "trabajos_verificacion"("estado", "proximo_intento_en");

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_asignado_por_fkey" FOREIGN KEY ("asignado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_arco" ADD CONSTRAINT "solicitudes_arco_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_arco" ADD CONSTRAINT "solicitudes_arco_atendido_por_fkey" FOREIGN KEY ("atendido_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bitacora_auditoria" ADD CONSTRAINT "bitacora_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ongs" ADD CONSTRAINT "ongs_verificada_por_fkey" FOREIGN KEY ("verificada_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ong_miembros" ADD CONSTRAINT "ong_miembros_ong_id_fkey" FOREIGN KEY ("ong_id") REFERENCES "ongs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ong_miembros" ADD CONSTRAINT "ong_miembros_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanas" ADD CONSTRAINT "campanas_ong_id_fkey" FOREIGN KEY ("ong_id") REFERENCES "ongs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fondos" ADD CONSTRAINT "fondos_campana_id_fkey" FOREIGN KEY ("campana_id") REFERENCES "campanas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_contables" ADD CONSTRAINT "movimientos_contables_fondo_id_fkey" FOREIGN KEY ("fondo_id") REFERENCES "fondos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_contables" ADD CONSTRAINT "movimientos_contables_donacion_id_fkey" FOREIGN KEY ("donacion_id") REFERENCES "donaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_contables" ADD CONSTRAINT "movimientos_contables_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_contables" ADD CONSTRAINT "movimientos_contables_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donantes" ADD CONSTRAINT "donantes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones" ADD CONSTRAINT "suscripciones_donante_id_fkey" FOREIGN KEY ("donante_id") REFERENCES "donantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones" ADD CONSTRAINT "suscripciones_fondo_id_fkey" FOREIGN KEY ("fondo_id") REFERENCES "fondos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones" ADD CONSTRAINT "suscripciones_ong_id_fkey" FOREIGN KEY ("ong_id") REFERENCES "ongs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donaciones" ADD CONSTRAINT "donaciones_donante_id_fkey" FOREIGN KEY ("donante_id") REFERENCES "donantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donaciones" ADD CONSTRAINT "donaciones_fondo_id_fkey" FOREIGN KEY ("fondo_id") REFERENCES "fondos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donaciones" ADD CONSTRAINT "donaciones_suscripcion_id_fkey" FOREIGN KEY ("suscripcion_id") REFERENCES "suscripciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_donacion_id_fkey" FOREIGN KEY ("donacion_id") REFERENCES "donaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_fondo_id_fkey" FOREIGN KEY ("fondo_id") REFERENCES "fondos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_ong_id_fkey" FOREIGN KEY ("ong_id") REFERENCES "ongs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencias" ADD CONSTRAINT "evidencias_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aplicaciones_donacion" ADD CONSTRAINT "aplicaciones_donacion_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aplicaciones_donacion" ADD CONSTRAINT "aplicaciones_donacion_donacion_id_fkey" FOREIGN KEY ("donacion_id") REFERENCES "donaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reglas_confianza" ADD CONSTRAINT "reglas_confianza_configurado_por_fkey" FOREIGN KEY ("configurado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analisis_aini" ADD CONSTRAINT "analisis_aini_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analisis_aini" ADD CONSTRAINT "analisis_aini_modelo_id_fkey" FOREIGN KEY ("modelo_id") REFERENCES "modelos_ia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analisis_aini" ADD CONSTRAINT "analisis_aini_regla_id_fkey" FOREIGN KEY ("regla_id") REFERENCES "reglas_confianza"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_ong_id_fkey" FOREIGN KEY ("ong_id") REFERENCES "ongs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_analisis_id_fkey" FOREIGN KEY ("analisis_id") REFERENCES "analisis_aini"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_resuelta_por_fkey" FOREIGN KEY ("resuelta_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisiones_auditoria" ADD CONSTRAINT "revisiones_auditoria_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisiones_auditoria" ADD CONSTRAINT "revisiones_auditoria_analisis_id_fkey" FOREIGN KEY ("analisis_id") REFERENCES "analisis_aini"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisiones_auditoria" ADD CONSTRAINT "revisiones_auditoria_auditor_id_fkey" FOREIGN KEY ("auditor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_donacion_id_fkey" FOREIGN KEY ("donacion_id") REFERENCES "donaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_evidencia_id_fkey" FOREIGN KEY ("evidencia_id") REFERENCES "evidencias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_aplicacion_id_fkey" FOREIGN KEY ("aplicacion_id") REFERENCES "aplicaciones_donacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_donante" ADD CONSTRAINT "feedback_donante_donante_id_fkey" FOREIGN KEY ("donante_id") REFERENCES "donantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_donante" ADD CONSTRAINT "feedback_donante_notificacion_id_fkey" FOREIGN KEY ("notificacion_id") REFERENCES "notificaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_donante" ADD CONSTRAINT "feedback_donante_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_donante" ADD CONSTRAINT "feedback_donante_alerta_generada_id_fkey" FOREIGN KEY ("alerta_generada_id") REFERENCES "alertas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trabajos_verificacion" ADD CONSTRAINT "trabajos_verificacion_gasto_id_fkey" FOREIGN KEY ("gasto_id") REFERENCES "gastos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

