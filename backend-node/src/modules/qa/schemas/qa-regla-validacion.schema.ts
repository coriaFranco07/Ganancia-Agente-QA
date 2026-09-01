import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AlcanceReglaValidacion = 'global' | 'pantalla';

/**
 * Ajuste manual sobre las restricciones de un campo, por pantalla puntual o
 * para todas. Vive aparte del catálogo: el catálogo trae el default de
 * fábrica (`CampoCatalogo.obligatorio` / `.restriccion`), esta colección
 * guarda lo que una persona decidió cambiar. Cada atributo es independiente:
 * dejar uno sin definir (`null`/vacío) hereda el valor de una regla global o,
 * en su defecto, el del catálogo — no lo borra.
 */
@Schema({ collection: 'qa_reglas_validacion', timestamps: true, strict: true })
export class QaReglaValidacion {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  /** Clave del campo tal como aparece en el catálogo (ej: "cuil"). */
  @Prop({ required: true, index: true })
  campo: string;

  @Prop({ required: true, enum: ['global', 'pantalla'], index: true })
  alcance: AlcanceReglaValidacion;

  /** Ruta de la pantalla. Vacío cuando `alcance` es "global". */
  @Prop({ default: '', index: true })
  ruta: string;

  /** null = no fuerza nada sobre la obligatoriedad, hereda lo que haya debajo. */
  @Prop({ type: Boolean, default: null })
  obligatorio: boolean | null;

  /** Cantidad de dígitos exacta que debe tener el valor (ej: CUIL = 11). */
  @Prop({ type: Number, default: null })
  largo_exacto: number | null;

  @Prop({ type: Number, default: null })
  largo_minimo: number | null;

  @Prop({ type: Number, default: null })
  largo_maximo: number | null;

  /** Expresión regular sobre el valor tal cual se cargó. Vacío = sin patrón. */
  @Prop({ default: '' })
  patron: string;

  /** Mensaje a mostrar cuando el valor no matchea `patron`. */
  @Prop({ default: '' })
  patron_mensaje: string;

  /** Rango numérico, para campos tipo "numero" (ej: remuneración, tolerancia). */
  @Prop({ type: Number, default: null })
  valor_minimo: number | null;

  @Prop({ type: Number, default: null })
  valor_maximo: number | null;

  /** Ventana de días respecto de hoy, para campos tipo "fecha". 0 = no permite. */
  @Prop({ type: Number, default: null })
  dias_atras_max: number | null;

  @Prop({ type: Number, default: null })
  dias_adelante_max: number | null;

  @Prop({ default: '' })
  nota: string;

  @Prop({ default: '' })
  creado_por: string;

  /** Baja logica: la regla deja de aplicarse pero queda el registro. */
  @Prop({ default: true, index: true })
  activo: boolean;
}

export type QaReglaValidacionDocument = HydratedDocument<QaReglaValidacion>;
export const QaReglaValidacionSchema = SchemaFactory.createForClass(QaReglaValidacion);
QaReglaValidacionSchema.index({ campo: 1, alcance: 1, ruta: 1 }, { unique: true });
