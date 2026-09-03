import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type EstadoQaSopLoom = 'borrador' | 'revisar' | 'listo' | 'aprobado';

@Schema({ collection: 'qa_sop_loom_aprendizajes', timestamps: true, strict: true })
export class QaSopLoomAprendizaje {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true })
  nombre: string;

  @Prop({ required: true })
  modulo: string;

  @Prop({ required: true, index: true })
  ruta: string;

  @Prop({ required: true })
  rol: string;

  @Prop({ required: true })
  entorno: string;

  @Prop({ required: true, enum: ['borrador', 'revisar', 'listo', 'aprobado'], index: true })
  estado: EstadoQaSopLoom;

  @Prop({ required: true })
  creado_en: string;

  @Prop({ default: '' })
  loom_ref: string;

  @Prop({ default: '' })
  objetivo: string;

  @Prop({ default: '' })
  criterio_aceptacion: string;

  @Prop({ default: '' })
  descripcion_video: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  pasos: Record<string, unknown>[];

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  campos: Record<string, unknown>[];

  @Prop({ type: [String], default: [] })
  acciones: string[];

  /** Guardas del SOP y la decisión humana sobre si son testeables. */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  consideraciones: Record<string, unknown>[];

  @Prop({ type: [String], default: [] })
  pendientes: string[];

  /** Ids de casos QA a ejecutar. Vacio = todos los activos de la pantalla. */
  @Prop({ type: [String], default: [] })
  casos_seleccionados: string[];

  /**
   * Orden que una persona eligió a mano para los pasos `completar` del plan
   * ejecutable (ej: cargar CUIL antes que DNI). Claves con forma
   * `completar:<campo>`. Se reaplica cada vez que se recompila el flujo.
   */
  @Prop({ type: [String], default: [] })
  orden_manual_pasos: string[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  definicion_ejecutable?: Record<string, unknown> | null;

  /** Snapshot inmutable de los elementos observados por Playwright en el sandbox. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  inspeccion_navegacion?: Record<string, unknown> | null;

  /**
   * Todas las inspecciones de las que dependen los selectores del plan, una por
   * pantalla del recorrido (la primera es la de entrada, la misma que
   * `inspeccion_navegacion`). Un flujo de una sola pantalla tiene un elemento.
   * Se revalidan todas antes de ejecutar: si cambió el DOM de cualquiera de
   * ellas, la corrida se aborta en vez de operar a ciegas.
   */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  inspecciones_navegacion?: Record<string, unknown>[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  aprobacion?: Record<string, unknown> | null;

  /** Firma de negocio y firma técnica, cada una sobre su mitad (§8). */
  @Prop({ type: MongooseSchema.Types.Mixed, default: { negocio: null, tecnica: null } })
  firmas?: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  ultima_ejecucion?: Record<string, unknown> | null;

  /** Baja logica: el aprendizaje deja de listarse pero queda el registro. */
  @Prop({ default: true, index: true })
  activo: boolean;
}

export type QaSopLoomAprendizajeDocument = HydratedDocument<QaSopLoomAprendizaje>;
export const QaSopLoomAprendizajeSchema = SchemaFactory.createForClass(QaSopLoomAprendizaje);
QaSopLoomAprendizajeSchema.index({ modulo: 1, ruta: 1 });
