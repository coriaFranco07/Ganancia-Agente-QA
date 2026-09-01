import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { QaCatalogoService } from '../catalogo/qa-catalogo.service';
import { QaSpiderCaso, QaSpiderCasoDocument } from './qa-spider-caso.schema';

export interface GuardarQaSpiderCasoDto {
  nombre: string;
  descripcion?: string;
  transcripcion?: string;
  codigo_playwright: string;
  niveles?: string[];
  ambito?: string;
  aplica_a?: string[];
  activo?: boolean;
}

/**
 * CRUD de los casos del Spider cargados por el operador.
 *
 * Valida contra el catalogo para que no se guarde un caso que despues el runner
 * va a descartar en silencio: niveles inexistentes o rutas fuera del catalogo
 * se rechazan en el alta, no en la corrida.
 */
@Injectable()
export class QaSpiderCasosService {
  constructor(
    @InjectModel(QaSpiderCaso.name) private readonly casos: Model<QaSpiderCasoDocument>,
    private readonly catalogoQa: QaCatalogoService,
  ) {}

  async listar(soloActivos = false) {
    const filtro = soloActivos ? { activo: true } : {};
    const documentos = await this.casos.find(filtro).sort({ updatedAt: -1 }).lean().exec();
    return documentos.map((documento) => this.serializar(documento));
  }

  async obtener(id: string) {
    const documento = await this.buscar(id);
    return this.serializar(documento);
  }

  async crear(dto: GuardarQaSpiderCasoDto) {
    const datos = this.validar(dto);
    const documento = await this.casos.create(datos);
    return this.serializar(documento.toObject());
  }

  async actualizar(id: string, dto: GuardarQaSpiderCasoDto) {
    await this.buscar(id);
    const datos = this.validar(dto);
    const documento = await this.casos
      .findByIdAndUpdate(id, { $set: datos }, { new: true })
      .lean()
      .exec();
    return this.serializar(documento);
  }

  /** Alterna el estado activo sin borrar el caso ni su historial. */
  async alternarActivo(id: string, activo: boolean) {
    await this.buscar(id);
    const documento = await this.casos
      .findByIdAndUpdate(id, { $set: { activo } }, { new: true })
      .lean()
      .exec();
    return this.serializar(documento);
  }

  async eliminar(id: string) {
    const documento = await this.buscar(id);
    await this.casos.deleteOne({ _id: documento._id }).exec();
    return { mensaje: 'Caso eliminado', id };
  }

  /**
   * Corre este caso ahora mismo, aislado del resto de la corrida del Spider.
   * No exige que este activo: el operador lo pidio de forma explicita.
   */
  async ejecutar(id: string) {
    await this.buscar(id);
    return this.catalogoQa.ejecutarCasoUnico(id);
  }

  /** Uso interno del generador desde spec: etiqueta un caso recien creado. */
  async marcarOrigenGenerado(id: string, grupoGenerado: string, nombreArchivo: string | null) {
    await this.casos
      .findByIdAndUpdate(id, { $set: { grupo_generado: grupoGenerado, generado_desde: nombreArchivo } })
      .exec();
  }

  private async buscar(id: string) {
    if (!isValidObjectId(id)) throw new NotFoundException('Caso de Spider no encontrado');
    const documento = await this.casos.findById(id).lean().exec();
    if (!documento) throw new NotFoundException('Caso de Spider no encontrado');
    return documento;
  }

  /**
   * Normaliza y valida el caso contra el catalogo vigente.
   */
  private validar(dto: GuardarQaSpiderCasoDto) {
    const nombre = (dto?.nombre ?? '').trim();
    if (!nombre) throw new BadRequestException('El caso necesita un nombre.');

    const codigo = (dto?.codigo_playwright ?? '').trim();
    if (!codigo) throw new BadRequestException('El caso necesita el codigo Playwright de la pasada.');

    const catalogo = this.catalogoQa.catalogoSpider();
    const nivelesValidos = catalogo.niveles.map((nivel) => nivel.id);
    const niveles = dto.niveles?.length ? dto.niveles : nivelesValidos;

    const desconocido = niveles.find((nivel) => !nivelesValidos.includes(nivel));
    if (desconocido) {
      throw new BadRequestException(
        `Nivel desconocido: "${desconocido}". Validos: ${nivelesValidos.join(', ')}.`,
      );
    }

    const ambito = dto.ambito === 'ruta' ? 'ruta' : 'global';
    const aplicaA = ambito === 'ruta' ? dto.aplica_a ?? [] : [];

    const rutasValidas = catalogo.secciones.map((seccion) => seccion.ruta);
    const rutaInvalida = aplicaA.find((ruta) => !rutasValidas.includes(ruta));
    if (rutaInvalida) {
      throw new BadRequestException(
        `La ruta "${rutaInvalida}" no esta en el catalogo de secciones del Spider.`,
      );
    }

    return {
      nombre,
      descripcion: (dto.descripcion ?? '').trim(),
      transcripcion: (dto.transcripcion ?? '').trim(),
      codigo_playwright: codigo,
      niveles,
      ambito,
      aplica_a: aplicaA,
      activo: dto.activo !== false,
    };
  }

  private serializar(documento: any) {
    if (!documento) return null;
    const { _id, __v, ...resto } = documento;
    return { id: String(_id), ...resto };
  }
}
