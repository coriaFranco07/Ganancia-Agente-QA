import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * Caso del QA Spider cargado por el operador desde la pantalla.
 *
 * Guarda el codigo Playwright de la pasada junto con su transcripcion en
 * lenguaje natural, de modo que el caso quede documentado y reutilizable: el
 * Spider lo ejecuta sobre la sesion ya iniciada, dentro de la misma corrida que
 * los casos del catalogo.
 *
 * Es una coleccion distinta de `qa_casos_grabados` (las grabaciones de Codegen,
 * que se ejecutan solas en su propia cola) porque un caso del Spider necesita
 * declarar en que niveles corre y sobre que rutas aplica.
 */
@Schema({ collection: 'qa_spider_casos', timestamps: true, strict: true })
export class QaSpiderCaso {
  @Prop({ required: true, trim: true })
  nombre: string;

  @Prop({ default: '' })
  descripcion: string;

  /** Descripcion en prosa de la pasada: que hace el caso, paso a paso. */
  @Prop({ default: '' })
  transcripcion: string;

  /** Codigo Playwright que se ejecuta con `page` y `expect` ya disponibles. */
  @Prop({ required: true })
  codigo_playwright: string;

  /** Niveles de agresividad en los que corre. Se valida contra el catalogo. */
  @Prop({ type: [String], default: ['suave', 'media', 'extrema'], index: true })
  niveles: string[];

  /** `global` corre una vez por corrida; `ruta` corre en cada ruta de `aplica_a`. */
  @Prop({ enum: ['global', 'ruta'], default: 'global' })
  ambito: string;

  /** `[]` equivale a todas las rutas. Solo se usa cuando `ambito` es `ruta`. */
  @Prop({ type: [String], default: [] })
  aplica_a: string[];

  @Prop({ default: true, index: true })
  activo: boolean;

  /** Resultado de la ultima corrida del Spider que ejecuto este caso. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  ultima_ejecucion: Record<string, unknown> | null;

  /**
   * Id compartido por los 3 casos (suave/media/extrema) generados a partir del
   * mismo spec subido. Null si el caso se cargo a mano.
   */
  @Prop({ type: String, index: true, default: null })
  grupo_generado: string | null;

  /** Nombre del archivo/spec de origen, solo para los casos generados. */
  @Prop({ type: String, default: null })
  generado_desde: string | null;
}

export type QaSpiderCasoDocument = HydratedDocument<QaSpiderCaso>;
export const QaSpiderCasoSchema = SchemaFactory.createForClass(QaSpiderCaso);
QaSpiderCasoSchema.index({ activo: 1, updatedAt: -1 });
