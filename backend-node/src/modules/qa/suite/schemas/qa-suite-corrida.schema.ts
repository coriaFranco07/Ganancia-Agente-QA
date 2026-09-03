import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { CategoriaQaSuite, ModoQaSuite } from './qa-suite-ejecucion.schema';

export type EstadoQaSuiteCorrida = 'corriendo' | 'verde' | 'amarillo' | 'rojo';

/**
 * Agrupa una corrida de la Suite: N aprendizajes x M categorias, con sus
 * ejecuciones y el informe consolidado para revision humana.
 */
@Schema({ collection: 'qa_suite_corridas', timestamps: true, strict: true })
export class QaSuiteCorrida {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true })
  disparado_por: string;

  @Prop({ required: true, index: true })
  disparado_en: string;

  @Prop({ required: true, enum: ['rapido', 'demo'] })
  modo: ModoQaSuite;

  @Prop({ type: [String], required: true })
  aprendizajes: string[];

  @Prop({ type: [String], required: true, enum: ['funcional', 'seguridad', 'accesibilidad'] })
  categorias: CategoriaQaSuite[];

  @Prop({ type: [String], default: [] })
  ejecuciones: string[];

  @Prop({ required: true, enum: ['corriendo', 'verde', 'amarillo', 'rojo'], default: 'corriendo', index: true })
  estado_consolidado: EstadoQaSuiteCorrida;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  informe?: Record<string, unknown> | null;
}

export type QaSuiteCorridaDocument = HydratedDocument<QaSuiteCorrida>;
export const QaSuiteCorridaSchema = SchemaFactory.createForClass(QaSuiteCorrida);
QaSuiteCorridaSchema.index({ disparado_en: -1 });
