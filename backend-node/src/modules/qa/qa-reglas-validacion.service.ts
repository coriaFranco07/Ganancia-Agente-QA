import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QaReglaValidacion, QaReglaValidacionDocument } from './schemas/qa-regla-validacion.schema';
import {
  ReglaValidacionResuelta,
  TipoCampoCatalogo,
  buscarPantallaPorRuta,
  normalizarRuta,
  pantallasConCampos,
  tipoDeCampo,
} from './qa-catalogo-elementos';

type QaReglaValidacionLean = QaReglaValidacion & { _id?: unknown; createdAt?: Date; updatedAt?: Date };

/** Qué atributos de restricción tienen sentido para cada tipo de dato (ver `qa-catalogo-elementos.validarValorCampo`). */
const ATRIBUTOS_POR_TIPO: Record<TipoCampoCatalogo, string[]> = {
  texto: ['largoExacto', 'largoMinimo', 'largoMaximo', 'patron'],
  numero: ['valorMinimo', 'valorMaximo'],
  fecha: ['diasAtrasMax', 'diasAdelanteMax'],
  select: [],
  archivo: [],
};

@Injectable()
export class QaReglasValidacionService {
  constructor(
    @InjectModel(QaReglaValidacion.name) private readonly reglas: Model<QaReglaValidacionDocument>,
  ) {}

  /** Pantallas y campos disponibles, con su tipo, para armar el selector al crear una regla. */
  catalogo(): Array<{ ruta: string; nombre: string; campos: Array<{ clave: string; etiqueta: string; tipo: TipoCampoCatalogo }> }> {
    return pantallasConCampos().map((pantalla) => ({
      ruta: pantalla.ruta,
      nombre: pantalla.nombre,
      campos: pantalla.campos.map((campo) => ({ clave: campo.clave, etiqueta: campo.etiqueta, tipo: campo.tipo })),
    }));
  }

  async listar(): Promise<Record<string, unknown>[]> {
    const docs = await this.reglas
      .find({ activo: { $ne: false } })
      .sort({ campo: 1, alcance: 1 })
      .lean<QaReglaValidacionLean[]>();
    return docs.map((doc) => this.serializar(doc));
  }

  /** Reglas activas en la forma que consume `aplicarReglasCampos`. */
  async listarResueltas(): Promise<ReglaValidacionResuelta[]> {
    const docs = await this.reglas.find({ activo: { $ne: false } }).lean<QaReglaValidacionLean[]>();
    return docs.map((doc) => ({
      campo: doc.campo,
      alcance: doc.alcance,
      ruta: doc.ruta,
      obligatorio: doc.obligatorio ?? null,
      largo_exacto: doc.largo_exacto ?? null,
      largo_minimo: doc.largo_minimo ?? null,
      largo_maximo: doc.largo_maximo ?? null,
      patron: doc.patron,
      patron_mensaje: doc.patron_mensaje,
      valor_minimo: doc.valor_minimo ?? null,
      valor_maximo: doc.valor_maximo ?? null,
      dias_atras_max: doc.dias_atras_max ?? null,
      dias_adelante_max: doc.dias_adelante_max ?? null,
    }));
  }

  async guardar(entrada: unknown): Promise<Record<string, unknown>> {
    const body = this.objeto(entrada);
    const campo = this.texto(body['campo']);
    if (!campo) throw new BadRequestException('La regla requiere un campo.');

    const alcance = this.texto(body['alcance']) === 'pantalla' ? 'pantalla' : 'global';
    const ruta = alcance === 'pantalla' ? normalizarRuta(this.texto(body['ruta'])) : '';
    if (alcance === 'pantalla' && !ruta) {
      throw new BadRequestException('Una regla por pantalla requiere indicar la pantalla.');
    }

    if (alcance === 'pantalla') {
      const pantalla = buscarPantallaPorRuta(ruta);
      if (!pantalla) throw new BadRequestException(`No existe la pantalla ${ruta} en el catálogo.`);
      if (!pantalla.campos.some((item) => item.clave === campo)) {
        throw new BadRequestException(`La pantalla ${pantalla.nombre} no tiene el campo "${campo}".`);
      }
    } else if (!pantallasConCampos().some((pantalla) => pantalla.campos.some((item) => item.clave === campo))) {
      throw new BadRequestException(`Ningún campo del catálogo se llama "${campo}".`);
    }

    // Qué restricciones tienen sentido depende del tipo de dato del campo:
    // a una fecha no se le pide largo en dígitos, a un texto no se le pide
    // una ventana de días. Esto es lo que evita que la UI (o quien use la
    // API directo) tenga que "saber" por campo qué pedir: lo decide el tipo.
    const tipo = tipoDeCampo(campo, alcance === 'pantalla' ? ruta : undefined);
    const permitidos = new Set(tipo ? ATRIBUTOS_POR_TIPO[tipo] : []);

    const obligatorio = this.booleanoONull(body['obligatorio']);

    const crudoLargoExacto = body['largoExacto'] ?? body['largo_exacto'];
    const crudoLargoMinimo = body['largoMinimo'] ?? body['largo_minimo'];
    const crudoLargoMaximo = body['largoMaximo'] ?? body['largo_maximo'];
    const crudoPatron = this.texto(body['patron']);
    const crudoValorMinimo = body['valorMinimo'] ?? body['valor_minimo'];
    const crudoValorMaximo = body['valorMaximo'] ?? body['valor_maximo'];
    const crudoDiasAtras = body['diasAtrasMax'] ?? body['dias_atras_max'];
    const crudoDiasAdelante = body['diasAdelanteMax'] ?? body['dias_adelante_max'];

    if (this.seEnvioAlgunoDe([crudoLargoExacto, crudoLargoMinimo, crudoLargoMaximo, crudoPatron]) && !permitidos.has('largoExacto')) {
      throw new BadRequestException(`Un campo de tipo "${tipo}" no admite restricciones de largo ni patrón.`);
    }
    if (this.seEnvioAlgunoDe([crudoValorMinimo, crudoValorMaximo]) && !permitidos.has('valorMinimo')) {
      throw new BadRequestException(`Un campo de tipo "${tipo}" no admite restricciones de valor mínimo/máximo.`);
    }
    if (this.seEnvioAlgunoDe([crudoDiasAtras, crudoDiasAdelante]) && !permitidos.has('diasAtrasMax')) {
      throw new BadRequestException(`Un campo de tipo "${tipo}" no admite restricciones de fecha.`);
    }

    const largoExacto = this.enteroPositivoONull(crudoLargoExacto);
    const largoMinimo = this.enteroPositivoONull(crudoLargoMinimo);
    const largoMaximo = this.enteroPositivoONull(crudoLargoMaximo);
    if (largoMinimo != null && largoMaximo != null && largoMinimo > largoMaximo) {
      throw new BadRequestException('El largo mínimo no puede ser mayor que el largo máximo.');
    }

    const patron = crudoPatron;
    if (patron) this.validarPatron(patron);

    const valorMinimo = this.numeroONull(crudoValorMinimo);
    const valorMaximo = this.numeroONull(crudoValorMaximo);
    if (valorMinimo != null && valorMaximo != null && valorMinimo > valorMaximo) {
      throw new BadRequestException('El valor mínimo no puede ser mayor que el valor máximo.');
    }

    const diasAtrasMax = this.enteroPositivoONull(crudoDiasAtras);
    const diasAdelanteMax = this.enteroPositivoONull(crudoDiasAdelante);

    if (
      obligatorio === null && largoExacto === null && largoMinimo === null && largoMaximo === null && !patron
      && valorMinimo === null && valorMaximo === null && diasAtrasMax === null && diasAdelanteMax === null
    ) {
      throw new BadRequestException('La regla necesita al menos una restricción.');
    }

    const id = this.texto(body['id']) || `${campo}-${alcance}${ruta ? `-${this.slug(ruta)}` : ''}`;
    const doc = await this.reglas
      .findOneAndUpdate(
        { id },
        {
          $set: {
            id,
            campo,
            alcance,
            ruta,
            obligatorio,
            largo_exacto: largoExacto,
            largo_minimo: largoMinimo,
            largo_maximo: largoMaximo,
            patron,
            patron_mensaje: this.texto(body['patronMensaje'] ?? body['patron_mensaje']),
            valor_minimo: valorMinimo,
            valor_maximo: valorMaximo,
            dias_atras_max: diasAtrasMax,
            dias_adelante_max: diasAdelanteMax,
            nota: this.texto(body['nota']),
            creado_por: this.texto(body['creadoPor'] ?? body['creado_por']),
            activo: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<QaReglaValidacionLean>();

    if (!doc) throw new BadRequestException('No se pudo guardar la regla de validación.');
    return this.serializar(doc);
  }

  async eliminar(idEntrada: string): Promise<{ id: string; activo: false }> {
    const id = this.texto(idEntrada);
    const doc = await this.reglas
      .findOneAndUpdate({ id, activo: { $ne: false } }, { $set: { activo: false } }, { new: true })
      .lean<QaReglaValidacionLean>();
    if (!doc) throw new NotFoundException('Regla de validación inexistente.');
    return { id, activo: false };
  }

  private validarPatron(patron: string): void {
    try {
      // eslint-disable-next-line no-new
      new RegExp(patron);
    } catch {
      throw new BadRequestException(`El patrón "${patron}" no es una expresión regular válida.`);
    }
  }

  private serializar(doc: QaReglaValidacionLean): Record<string, unknown> {
    const { _id, ...resto } = doc;
    void _id;
    return resto as Record<string, unknown>;
  }

  private slug(valor: string): string {
    return this.texto(valor)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? valor as Record<string, unknown>
      : {};
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }

  private booleanoONull(valor: unknown): boolean | null {
    if (valor === true || valor === false) return valor;
    return null;
  }

  private enteroPositivoONull(valor: unknown): number | null {
    if (valor === undefined || valor === null || valor === '') return null;
    const n = Number(valor);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new BadRequestException('Los largos y las cantidades de días deben ser números enteros positivos.');
    }
    return n;
  }

  private numeroONull(valor: unknown): number | null {
    if (valor === undefined || valor === null || valor === '') return null;
    const n = Number(valor);
    if (!Number.isFinite(n)) throw new BadRequestException('Los valores mínimo/máximo deben ser números.');
    return n;
  }

  private seEnvioAlgunoDe(valores: unknown[]): boolean {
    return valores.some((valor) => valor !== undefined && valor !== null && valor !== '');
  }
}
