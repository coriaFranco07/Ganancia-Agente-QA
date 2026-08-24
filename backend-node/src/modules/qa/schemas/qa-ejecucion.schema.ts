import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ModoQaEjecucion = 'rapido' | 'demo';
export type EstadoQaEjecucion = 'corriendo' | 'verde' | 'rojo';

@Schema({ collection: 'qa_ejecuciones', timestamps: true, strict: true })
export class QaEjecucion {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  caso_id: string;

  @Prop({ required: true, enum: ['rapido', 'demo'] })
  modo: ModoQaEjecucion;

  @Prop({ required: true, enum: ['corriendo', 'verde', 'rojo'], index: true })
  estado: EstadoQaEjecucion;

  @Prop({ required: true, index: true })
  iniciado_en: string;

  @Prop()
  finalizado_en?: string;

  @Prop()
  exit_code?: number | null;

  @Prop()
  detalle?: string;

  @Prop()
  evidencia_path?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  resultado?: Record<string, unknown> | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  comando: Record<string, unknown>;

  @Prop({ default: '' })
  stdout_tail: string;

  @Prop({ default: '' })
  stderr_tail: string;
}

export type QaEjecucionDocument = HydratedDocument<QaEjecucion>;
export const QaEjecucionSchema = SchemaFactory.createForClass(QaEjecucion);
QaEjecucionSchema.index({ caso_id: 1, iniciado_en: -1 });
