import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type CategoriaQaSuite = 'funcional' | 'seguridad' | 'accesibilidad';
export type ModoQaSuite = 'rapido' | 'demo';
/**
 * `rojo` es "la aplicacion fallo una prueba real" (hay evidencia de que la
 * corrida llego a evaluar algo). `error` es "la Suite no pudo correr la
 * prueba" (se cayo la conexion, la pantalla cambio desde la aprobacion,
 * excedio el tiempo maximo) -no hay evidencia porque nunca se llego a
 * evaluar nada. Distinguirlos es lo que evita que un runner caido se lea
 * como "la app esta bien".
 */
export type EstadoQaSuiteEjecucion = 'corriendo' | 'verde' | 'rojo' | 'error';

/**
 * Una corrida de UNA categoria sobre UN aprendizaje de SOP Loom.
 *
 * Vive separada de `QaEjecucion` (que es exclusiva del validador de negocio
 * sobre `qa_casos`): esta coleccion nunca hace referencia a un caso, siempre
 * a un aprendizaje ya aprobado. Los valores que se escriben en cada campo
 * durante la corrida los calcula `QaSuiteDerivadorService` a partir de las
 * restricciones reales declaradas en el propio aprendizaje -nunca de datos
 * de negocio.
 */
@Schema({ collection: 'qa_suite_ejecuciones', timestamps: true, strict: true })
export class QaSuiteEjecucion {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  aprendizaje_id: string;

  @Prop({ required: true, enum: ['funcional', 'seguridad', 'accesibilidad'], index: true })
  categoria: CategoriaQaSuite;

  @Prop({ required: true, enum: ['rapido', 'demo'] })
  modo: ModoQaSuite;

  @Prop({ required: true, enum: ['corriendo', 'verde', 'rojo', 'error'], index: true })
  estado: EstadoQaSuiteEjecucion;

  @Prop({ required: true, index: true })
  iniciado_en: string;

  @Prop()
  finalizado_en?: string;

  @Prop({ type: Number, default: null })
  exit_code?: number | null;

  @Prop()
  detalle?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  evidencia?: Record<string, unknown> | null;

  @Prop({ type: [String], default: [] })
  capturas?: string[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  comando: Record<string, unknown>;

  @Prop({ default: '' })
  stdout_tail: string;

  @Prop({ default: '' })
  stderr_tail: string;

  /** Cuantos documentos de `qa_casos` creo esta ejecucion y se borraron al cerrarla (ver Fase 7 del aislamiento de datos). */
  @Prop({ type: Number, default: 0 })
  casos_negocio_limpiados?: number;
}

export type QaSuiteEjecucionDocument = HydratedDocument<QaSuiteEjecucion>;
export const QaSuiteEjecucionSchema = SchemaFactory.createForClass(QaSuiteEjecucion);
QaSuiteEjecucionSchema.index({ aprendizaje_id: 1, categoria: 1, iniciado_en: -1 });
