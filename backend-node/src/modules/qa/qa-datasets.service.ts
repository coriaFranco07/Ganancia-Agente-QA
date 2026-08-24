import { BadRequestException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Connection, createConnection } from 'mongoose';

export interface DatasetQaResumen extends Record<string, unknown> {
  codigo: string;
  convenio: string;
  periodo: string;
  vigencia: Record<string, unknown>;
  validado_por: string;
  validado_en: string;
  fuente_normativa: Record<string, unknown>;
  estado: string;
}

@Injectable()
export class QaDatasetsService implements OnModuleDestroy {
  private conexion?: Promise<Connection>;
  private readonly uri = process.env.QA_DATASETS_MONGODB_URI ??
    process.env.DATASETS_MONGODB_URI ??
    'mongodb://127.0.0.1:27017/qa_agentico_esueldos';
  private readonly coleccion = process.env.QA_DATASETS_COLLECTION ?? 'datasets';

  async listar(): Promise<DatasetQaResumen[]> {
    const collection = await this.collection();
    const docs = await collection.find({}, {
      projection: {
        _id: 0,
        codigo: 1,
        convenio: 1,
        periodo: 1,
        vigencia: 1,
        validado_por: 1,
        validado_en: 1,
        fuente_normativa: 1,
        estado: 1,
      },
    }).sort({ codigo: 1 }).toArray();

    return docs
      .map((doc) => this.serializarDataset(doc))
      .filter((dataset) => this.validarDataset(dataset).length === 0);
  }

  async obtener(codigo: string): Promise<DatasetQaResumen> {
    const dataset = await this.buscar(codigo);
    if (!dataset) throw new BadRequestException(`Dataset inexistente: ${codigo}`);
    return dataset;
  }

  async resolverParaCaso(codigo: string, periodoCaso: string): Promise<DatasetQaResumen> {
    const datasetCodigo = this.texto(codigo);
    if (!datasetCodigo) throw new BadRequestException('Seleccioná un dataset existente para el caso QA.');

    const dataset = await this.buscar(datasetCodigo);
    if (!dataset) {
      throw new BadRequestException(`El dataset ${datasetCodigo} no existe en el catálogo QA.`);
    }

    const errores = this.validarDataset(dataset);
    const periodoDataset = this.normalizarPeriodo(dataset.periodo);
    const periodoQa = this.normalizarPeriodo(periodoCaso);
    if (periodoDataset && periodoQa && periodoDataset !== periodoQa) {
      errores.push(`El período del caso (${periodoCaso}) no coincide con el período del dataset (${dataset.periodo}).`);
    }

    if (errores.length) {
      throw new BadRequestException({
        message: `Dataset ${datasetCodigo} no puede usarse para este caso QA.`,
        errores,
      });
    }

    return dataset;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.conexion) return;
    const conexion = await this.conexion.catch(() => undefined);
    await conexion?.close().catch(() => undefined);
  }

  private async buscar(codigo: string): Promise<DatasetQaResumen | null> {
    const collection = await this.collection();
    const doc = await collection.findOne({ codigo: this.texto(codigo) }, {
      projection: {
        _id: 0,
        codigo: 1,
        convenio: 1,
        periodo: 1,
        vigencia: 1,
        validado_por: 1,
        validado_en: 1,
        fuente_normativa: 1,
        estado: 1,
      },
    });
    return doc ? this.serializarDataset(doc) : null;
  }

  private async collection() {
    const conexion = await this.conectar();
    return conexion.collection(this.coleccion);
  }

  private conectar(): Promise<Connection> {
    if (!this.conexion) {
      this.conexion = createConnection(this.uri, { serverSelectionTimeoutMS: 5000 }).asPromise();
    }
    return this.conexion;
  }

  private serializarDataset(doc: Record<string, unknown>): DatasetQaResumen {
    return {
      codigo: this.texto(doc['codigo']),
      convenio: this.texto(doc['convenio']),
      periodo: this.texto(doc['periodo']),
      vigencia: this.objeto(doc['vigencia']),
      validado_por: this.texto(doc['validado_por']),
      validado_en: this.texto(doc['validado_en']),
      fuente_normativa: this.objeto(doc['fuente_normativa']),
      estado: this.texto(doc['estado']) || 'validado',
    };
  }

  private validarDataset(dataset: DatasetQaResumen): string[] {
    const errores: string[] = [];
    if (!dataset.codigo) errores.push('codigo es obligatorio.');
    if (!/^DS-[A-Z0-9_-]+$/i.test(dataset.codigo)) errores.push('codigo debe comenzar con DS-.');
    if (!dataset.convenio) errores.push('convenio es obligatorio.');
    if (!this.normalizarPeriodo(dataset.periodo)) errores.push('periodo debe tener formato MM/AAAA.');
    if (!this.texto(dataset.vigencia['desde'])) errores.push('vigencia.desde es obligatorio.');
    if (!dataset.validado_por) errores.push('validado_por es obligatorio.');
    if (!dataset.validado_en || Number.isNaN(Date.parse(dataset.validado_en))) errores.push('validado_en debe ser fecha ISO válida.');
    if (!this.texto(dataset.fuente_normativa['ref'])) errores.push('fuente_normativa.ref es obligatorio.');
    if (dataset.estado && dataset.estado !== 'validado') errores.push(`estado debe ser validado; actual=${dataset.estado}.`);
    return errores;
  }

  private normalizarPeriodo(periodo: string): string {
    const match = /^(0?[1-9]|1[0-2])\/(20\d{2})$/.exec(this.texto(periodo));
    if (!match) return '';
    return `${match[1].padStart(2, '0')}/${match[2]}`;
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? { ...(valor as Record<string, unknown>) }
      : {};
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }
}
