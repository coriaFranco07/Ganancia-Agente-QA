import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QaDatasetsService } from './qa-datasets.service';
import { QaCaso, QaCasoDocument } from './schemas/qa-caso.schema';

type OperadorAssertion = 'igual';

interface AssertionQa {
  campo: string;
  operador: OperadorAssertion;
  esperado: unknown;
  tolerancia?: number;
}

interface CasoNormalizado {
  id: string;
  dataset_codigo: string;
  dataset: Record<string, unknown> | null;
  periodo: string;
  descripcion: string;
  archivo: Record<string, unknown> | null;
  contexto: Record<string, unknown>;
  resultado_esperado: Record<string, unknown>;
  assertions: AssertionQa[];
  origen: Record<string, unknown>;
  activo: boolean;
}

type QaCasoLean = QaCaso & {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

@Injectable()
export class QaCasosService {
  constructor(
    @InjectModel(QaCaso.name) private readonly casos: Model<QaCasoDocument>,
    private readonly datasets: QaDatasetsService,
  ) {}

  async listar(activo = true): Promise<Record<string, unknown>[]> {
    const filtro = activo ? { activo: { $ne: false } } : {};
    const docs = await this.casos.find(filtro).sort({ updatedAt: -1 }).lean<QaCasoLean[]>();
    return docs.map((doc) => this.serializar(doc));
  }

  async obtener(id: string): Promise<Record<string, unknown>> {
    const doc = await this.casos.findOne({ id }).lean<QaCasoLean>();
    if (!doc || doc.activo === false) throw new NotFoundException('Caso QA inexistente.');
    return this.serializar(doc);
  }

  async guardar(entrada: unknown): Promise<Record<string, unknown>> {
    const caso = await this.normalizarCaso(entrada);
    const doc = await this.casos
      .findOneAndUpdate(
        { id: caso.id },
        { $set: caso },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<QaCasoLean>();

    if (!doc) throw new BadRequestException('No se pudo guardar el caso QA.');
    return this.serializar(doc);
  }

  async desactivar(id: string): Promise<{ id: string; activo: false }> {
    const doc = await this.casos.findOneAndUpdate({ id }, { $set: { activo: false } }, { new: true }).lean<QaCasoLean>();
    if (!doc) throw new NotFoundException('Caso QA inexistente.');
    return { id, activo: false };
  }

  private async normalizarCaso(entrada: unknown): Promise<CasoNormalizado> {
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
      throw new BadRequestException('El caso QA debe ser un objeto JSON.');
    }

    const body = entrada as Record<string, unknown>;
    const id = this.texto(body['id']);
    if (!id) throw new BadRequestException('El caso QA requiere id.');
    const periodo = this.texto(body['periodo']);
    const dataset = await this.datasets.resolverParaCaso(this.texto(body['dataset_codigo']), periodo);

    const resultadoEntrada = this.objeto(body['resultado_esperado']);
    const campo = this.texto(resultadoEntrada['campo']) || 'calculo.retencion_excel';
    const valor = resultadoEntrada['valor'] ?? resultadoEntrada['retencion_ganancias'] ?? null;
    const tolerancia = this.numero(resultadoEntrada['tolerancia']) ?? 0.05;
    const resultado_esperado = {
      ...resultadoEntrada,
      campo,
      valor,
      tolerancia,
      estado: this.texto(resultadoEntrada['estado']) || 'validado',
    };

    const assertionsEntrada = Array.isArray(body['assertions']) ? body['assertions'] : [];
    const assertions = assertionsEntrada.length > 0
      ? assertionsEntrada.map((assertion) => this.normalizarAssertion(assertion))
      : [this.normalizarAssertion({ campo, operador: 'igual', esperado: valor, tolerancia })];

    return {
      id,
      dataset_codigo: dataset.codigo,
      dataset,
      periodo,
      descripcion: this.texto(body['descripcion']),
      archivo: this.normalizarArchivo(body['archivo']),
      contexto: this.objeto(body['contexto']),
      resultado_esperado,
      assertions,
      origen: this.objeto(body['origen']),
      activo: body['activo'] === false ? false : true,
    };
  }

  private normalizarAssertion(entrada: unknown): AssertionQa {
    const assertion = this.objeto(entrada);
    const campo = this.texto(assertion['campo']);
    if (!campo) throw new BadRequestException('Cada assertion requiere campo.');

    const operador = this.texto(assertion['operador']) || 'igual';
    if (operador !== 'igual') throw new BadRequestException(`Operador QA no soportado: ${operador}`);

    return {
      campo,
      operador,
      esperado: assertion['esperado'],
      tolerancia: this.numero(assertion['tolerancia']) ?? 0.05,
    };
  }

  private normalizarArchivo(entrada: unknown): Record<string, unknown> | null {
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return null;
    const archivo = entrada as Record<string, unknown>;
    const nombre = this.texto(archivo['nombre']);
    if (!nombre) return null;

    return {
      nombre,
      size_bytes: this.numero(archivo['size_bytes']) ?? this.numero(archivo['sizeBytes']),
      mime: this.texto(archivo['mime']),
      seleccionado_en: this.texto(archivo['seleccionado_en']) || this.texto(archivo['seleccionadoEn']),
    };
  }

  private objeto(entrada: unknown): Record<string, unknown> {
    return entrada && typeof entrada === 'object' && !Array.isArray(entrada)
      ? { ...(entrada as Record<string, unknown>) }
      : {};
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }

  private numero(valor: unknown): number | null {
    if (valor === undefined || valor === null || valor === '') return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }

  private serializar(doc: QaCasoLean): Record<string, unknown> {
    const { _id, ...resto } = doc;
    void _id;
    return resto as Record<string, unknown>;
  }
}
