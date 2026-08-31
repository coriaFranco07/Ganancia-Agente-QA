import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type TipoQaHallazgo = 'negocio' | 'estructural' | 'precondicion' | 'entorno';
export type SeveridadQaHallazgo = 'info' | 'baja' | 'media' | 'alta' | 'critica';
export type EstadoQaHallazgo = 'abierto' | 'resuelto' | 'descartado';

@Schema({ collection: 'qa_hallazgos', timestamps: true, strict: true })
export class QaHallazgo {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  ejecucion_id: string;

  @Prop({ required: true, index: true })
  caso_id: string;

  @Prop({ required: true, enum: ['negocio', 'estructural', 'precondicion', 'entorno'], index: true })
  tipo: TipoQaHallazgo;

  @Prop({ required: true, enum: ['info', 'baja', 'media', 'alta', 'critica'], index: true })
  severidad: SeveridadQaHallazgo;

  @Prop({ required: true, enum: ['abierto', 'resuelto', 'descartado'], default: 'abierto', index: true })
  estado: EstadoQaHallazgo;

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

export type QaHallazgoDocument = HydratedDocument<QaHallazgo>;
export const QaHallazgoSchema = SchemaFactory.createForClass(QaHallazgo);
QaHallazgoSchema.index({ caso_id: 1, detectado_en: -1 });
QaHallazgoSchema.index({ ejecucion_id: 1, codigo: 1 });
QaHallazgoSchema.index({ tipo: 1, estado: 1, severidad: 1 });
