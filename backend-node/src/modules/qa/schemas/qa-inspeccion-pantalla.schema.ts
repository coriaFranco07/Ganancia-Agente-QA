import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({ collection: 'qa_inspecciones_pantalla', timestamps: true, strict: true })
export class QaInspeccionPantalla {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  ruta: string;

  @Prop({ required: true })
  frontend_url: string;

  @Prop({ default: '' })
  titulo: string;

  @Prop({ default: '' })
  encabezado: string;

  @Prop({ required: true })
  inspeccionada_en: string;

  @Prop({ required: true })
  solicitada_por: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  elementos: Record<string, unknown>[];

  @Prop({ default: '' })
  captura_path: string;

  @Prop({ required: true, index: true })
  hash: string;

  @Prop({ default: true, index: true })
  activa: boolean;
}

export type QaInspeccionPantallaDocument = HydratedDocument<QaInspeccionPantalla>;
export const QaInspeccionPantallaSchema = SchemaFactory.createForClass(QaInspeccionPantalla);
QaInspeccionPantallaSchema.index({ ruta: 1, inspeccionada_en: -1 });
