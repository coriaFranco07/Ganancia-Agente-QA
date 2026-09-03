import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EstadoQaSopLoomEjecucion = 'corriendo' | 'verde' | 'rojo';

/**
 * Un registro por cada corrida de un flujo SOP Loom. `ultima_ejecucion` en
 * `QaSopLoomAprendizaje` se pisa en cada corrida y no alcanza para saber
 * cuántas veces se corrió una pantalla: esta colección es la que lo permite.
 */
@Schema({ collection: 'qa_sop_loom_ejecuciones', timestamps: true, strict: true })
export class QaSopLoomEjecucion {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  aprendizaje_id: string;

  @Prop({ required: true, index: true })
  ruta: string;

  /** Nombre de la pantalla al momento de la corrida, para no depender de un join si se renombra después. */
  @Prop({ required: true })
  pantalla_nombre: string;

  @Prop({ required: true, enum: ['rapido', 'demo'] })
  modo: string;

  @Prop({ required: true, enum: ['corriendo', 'verde', 'rojo'], index: true })
  estado: EstadoQaSopLoomEjecucion;

  @Prop({ required: true, index: true })
  iniciada_en: string;

  @Prop()
  finalizada_en?: string;

  @Prop({ type: Number, default: null })
  exit_code?: number | null;

  @Prop({ default: '' })
  detalle?: string;

  @Prop({ default: '' })
  evidencia_path?: string;

  @Prop({ type: Number, default: 0 })
  casos_count: number;
}

export type QaSopLoomEjecucionDocument = HydratedDocument<QaSopLoomEjecucion>;
export const QaSopLoomEjecucionSchema = SchemaFactory.createForClass(QaSopLoomEjecucion);
QaSopLoomEjecucionSchema.index({ ruta: 1, iniciada_en: -1 });
