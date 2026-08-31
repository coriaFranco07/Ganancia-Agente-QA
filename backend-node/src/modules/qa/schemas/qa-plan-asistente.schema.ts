import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type EstadoQaPlanAsistente =
  | 'recolectando'
  | 'plan_propuesto'
  | 'aprobado'
  | 'ejecutando'
  | 'verificado'
  | 'fallido'
  | 'abortado'
  | 'vencido';

export type ModoQaPlanAsistente = 'rapido' | 'demo';

@Schema({ collection: 'qa_planes_asistente', timestamps: true, strict: true })
export class QaPlanAsistente {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ index: true, default: '' })
  caso_id: string;

  @Prop({ required: true, enum: ['rapido', 'demo'], default: 'demo' })
  modo: ModoQaPlanAsistente;

  @Prop({ required: true, enum: ['recolectando', 'plan_propuesto', 'aprobado', 'ejecutando', 'verificado', 'fallido', 'abortado', 'vencido'], index: true })
  estado: EstadoQaPlanAsistente;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  pedido_original: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  actor?: Record<string, unknown> | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  ejecutor: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  versiones: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  parametros: Record<string, unknown>;

  @Prop({ type: [String], default: [] })
  parametros_pendientes: string[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  plan: Record<string, unknown>;

  @Prop()
  texto_mostrado?: string;

  @Prop({ required: true, index: true })
  hash_plan: string;

  @Prop({ required: true, index: true })
  vence_en: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  aprobacion?: Record<string, unknown> | null;

  @Prop()
  ejecucion_id?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  verificacion?: Record<string, unknown> | null;

  @Prop()
  abortado_motivo?: string;
}

export type QaPlanAsistenteDocument = HydratedDocument<QaPlanAsistente>;
export const QaPlanAsistenteSchema = SchemaFactory.createForClass(QaPlanAsistente);
QaPlanAsistenteSchema.index({ caso_id: 1, createdAt: -1 });
QaPlanAsistenteSchema.index({ estado: 1, vence_en: 1 });
