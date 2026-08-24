import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({ collection: 'qa_casos', timestamps: true, strict: true })
export class QaCaso {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ index: true })
  dataset_codigo: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  dataset: Record<string, unknown> | null;

  @Prop({ index: true })
  periodo: string;

  @Prop()
  descripcion: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  archivo: Record<string, unknown> | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  contexto: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  resultado_esperado: Record<string, unknown>;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  assertions: Array<Record<string, unknown>>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  origen: Record<string, unknown>;

  @Prop({ default: true, index: true })
  activo: boolean;
}

export type QaCasoDocument = HydratedDocument<QaCaso>;
export const QaCasoSchema = SchemaFactory.createForClass(QaCaso);
QaCasoSchema.index({ dataset_codigo: 1, periodo: 1, updatedAt: -1 });
