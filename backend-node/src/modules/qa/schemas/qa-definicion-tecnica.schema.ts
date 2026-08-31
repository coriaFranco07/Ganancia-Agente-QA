import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({ collection: 'qa_definiciones_tecnicas', timestamps: true, strict: true })
export class QaDefinicionTecnica {
  @Prop({ required: true, unique: true, index: true })
  codigo: string;

  @Prop({ required: true, default: 1 })
  version: number;

  @Prop({ required: true })
  nombre: string;

  @Prop()
  descripcion: string;

  @Prop({ default: 'auditoria-ganancias', index: true })
  sistema: string;

  @Prop({ default: 'qa' })
  modulo: string;

  @Prop({ default: 'vigente', index: true })
  estado: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  rutas: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  selectores: Record<string, unknown>;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  pasos: Array<Record<string, unknown>>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  esperas: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  origen: Record<string, unknown>;
}

export type QaDefinicionTecnicaDocument = HydratedDocument<QaDefinicionTecnica>;
export const QaDefinicionTecnicaSchema = SchemaFactory.createForClass(QaDefinicionTecnica);
QaDefinicionTecnicaSchema.index({ sistema: 1, estado: 1, updatedAt: -1 });
