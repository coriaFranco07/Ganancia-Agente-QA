import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { CategoriaQaSuite } from './qa-suite-ejecucion.schema';

export type TipoQaSuiteHallazgo = 'negocio' | 'estructural' | 'precondicion' | 'entorno';
export type SeveridadQaSuiteHallazgo = 'info' | 'baja' | 'media' | 'alta' | 'critica';
export type EstadoQaSuiteHallazgo = 'abierto' | 'resuelto' | 'descartado';

/**
 * Ledger de hallazgos de la Suite de Calidad.
 *
 * Colección propia, separada de `qa_hallazgos`: ese ledger es del validador
 * de negocio y sus documentos son obligatoriamente de un `caso_id`. Duplicar
 * la forma acá evita forzar ese esquema con un origen que no es un caso, y
 * evita cualquier riesgo de romper el ledger existente.
 */
@Schema({ collection: 'qa_suite_hallazgos', timestamps: true, strict: true })
export class QaSuiteHallazgo {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  ejecucion_id: string;

  @Prop({ required: true, index: true })
  aprendizaje_id: string;

  @Prop({ required: true, enum: ['funcional', 'seguridad', 'accesibilidad'], index: true })
  categoria_prueba: CategoriaQaSuite;

  @Prop({ required: true, enum: ['negocio', 'estructural', 'precondicion', 'entorno'], index: true })
  tipo: TipoQaSuiteHallazgo;

  @Prop({ required: true, enum: ['info', 'baja', 'media', 'alta', 'critica'], index: true })
  severidad: SeveridadQaSuiteHallazgo;

  @Prop({ required: true, enum: ['abierto', 'resuelto', 'descartado'], default: 'abierto', index: true })
  estado: EstadoQaSuiteHallazgo;

  @Prop({ required: true, index: true })
  codigo: string;

  @Prop({ required: true })
  titulo: string;

  @Prop({ required: true })
  detalle: string;

  @Prop({ default: '' })
  paso?: string;

  @Prop({ default: '' })
  campo?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  esperado?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  actual?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  evidencia: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  propuesta: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  origen: Record<string, unknown>;

  @Prop({ required: true, index: true })
  detectado_en: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  cierre?: Record<string, unknown> | null;
}

export type QaSuiteHallazgoDocument = HydratedDocument<QaSuiteHallazgo>;
export const QaSuiteHallazgoSchema = SchemaFactory.createForClass(QaSuiteHallazgo);
QaSuiteHallazgoSchema.index({ aprendizaje_id: 1, detectado_en: -1 });
QaSuiteHallazgoSchema.index({ ejecucion_id: 1, codigo: 1 });
QaSuiteHallazgoSchema.index({ categoria_prueba: 1, estado: 1, severidad: 1 });
