import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UsuarioSesion } from '../auth/auth.service';
import { EstadoQaEjecucion, QaEjecucion } from './schemas/qa-ejecucion.schema';
import {
  EstadoQaHallazgo,
  QaHallazgo,
  QaHallazgoDocument,
  SeveridadQaHallazgo,
  TipoQaHallazgo,
} from './schemas/qa-hallazgo.schema';

type QaHallazgoLean = QaHallazgo & {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

interface HallazgoConstruido {
  codigo: string;
  tipo: TipoQaHallazgo;
  severidad: SeveridadQaHallazgo;
  titulo: string;
  detalle: string;
  paso?: string;
  campo?: string;
  esperado?: unknown;
  actual?: unknown;
  evidencia: Record<string, unknown>;
  propuesta: Record<string, unknown>;
  origen: Record<string, unknown>;
}

@Injectable()
export class QaHallazgosService {
  constructor(
    @InjectModel(QaHallazgo.name) private readonly hallazgos: Model<QaHallazgoDocument>,
  ) {}

  async listar(filtrosEntrada: unknown = {}): Promise<Record<string, unknown>[]> {
    const filtros = this.objeto(filtrosEntrada);
    const query: Record<string, unknown> = {};
    for (const campo of ['caso_id', 'ejecucion_id', 'tipo', 'estado', 'severidad']) {
      const valor = this.texto(filtros[campo]);
      if (valor) query[campo] = valor;
    }

    const docs = await this.hallazgos
      .find(query)
      .sort({ detectado_en: -1, severidad: 1 })
      .limit(300)
      .lean<QaHallazgoLean[]>();
    return docs.map((doc) => this.serializar(doc));
  }

  async listarPorEjecucion(ejecucionId: string): Promise<Record<string, unknown>[]> {
    const docs = await this.hallazgos
      .find({ ejecucion_id: this.texto(ejecucionId) })
      .sort({ severidad: 1, codigo: 1 })
      .lean<QaHallazgoLean[]>();
    return docs.map((doc) => this.serializar(doc));
  }

  async obtener(id: string): Promise<Record<string, unknown>> {
    const doc = await this.hallazgos.findOne({ id: this.texto(id) }).lean<QaHallazgoLean>();
    if (!doc) throw new NotFoundException('Hallazgo QA inexistente.');
    return this.serializar(doc);
  }

  async cambiarEstado(id: string, entrada: unknown, usuario?: UsuarioSesion): Promise<Record<string, unknown>> {
    const body = this.objeto(entrada);
    const estado = this.estadoValido(body['estado']);
    const motivo = this.texto(body['motivo']);

    const doc = await this.hallazgos.findOneAndUpdate(
      { id: this.texto(id) },
      {
        $set: {
          estado,
          cierre: estado === 'abierto'
            ? null
            : {
                estado,
                motivo,
                por: usuario?.id ?? 'usuario-desconocido',
                correo: usuario?.correo ?? 'desconocido',
                en: new Date().toISOString(),
              },
        },
      },
      { new: true },
    ).lean<QaHallazgoLean>();

    if (!doc) throw new NotFoundException('Hallazgo QA inexistente.');
    return this.serializar(doc);
  }

  async registrarDesdeEjecucion(ejecucion: QaEjecucion | Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const ejecucionId = this.texto(ejecucion['id']);
    const casoId = this.texto(ejecucion['caso_id']);
    if (!ejecucionId || !casoId) return [];

    const construidos = this.construirHallazgos(ejecucion);
    const ids = construidos.map((hallazgo) => this.idHallazgo(ejecucionId, hallazgo.codigo));

    if (ids.length > 0) {
      await this.hallazgos.bulkWrite(construidos.map((hallazgo) => ({
        updateOne: {
          filter: { id: this.idHallazgo(ejecucionId, hallazgo.codigo) },
          update: {
            $set: {
              ejecucion_id: ejecucionId,
              caso_id: casoId,
              tipo: hallazgo.tipo,
              severidad: hallazgo.severidad,
              codigo: hallazgo.codigo,
              titulo: hallazgo.titulo,
              detalle: hallazgo.detalle,
              paso: hallazgo.paso ?? '',
              campo: hallazgo.campo ?? '',
              esperado: hallazgo.esperado ?? null,
              actual: hallazgo.actual ?? null,
              evidencia: hallazgo.evidencia,
              propuesta: hallazgo.propuesta,
              origen: hallazgo.origen,
              detectado_en: this.texto(ejecucion['finalizado_en']) || new Date().toISOString(),
            },
            $setOnInsert: {
              id: this.idHallazgo(ejecucionId, hallazgo.codigo),
              estado: 'abierto',
              cierre: null,
            },
          },
          upsert: true,
        },
      })));
    }

    await this.hallazgos.updateMany(
      { ejecucion_id: ejecucionId, id: { $nin: ids }, estado: 'abierto' },
      {
        $set: {
          estado: 'resuelto',
          cierre: {
            estado: 'resuelto',
            motivo: 'El hallazgo dejó de detectarse al reprocesar la evidencia de la ejecución.',
            por: 'sistema',
            correo: 'sistema',
            en: new Date().toISOString(),
          },
        },
      },
    );

    return this.listarPorEjecucion(ejecucionId);
  }

  resumen(hallazgos: Record<string, unknown>[]): Record<string, unknown> {
    return {
      total: hallazgos.length,
      abiertos: hallazgos.filter((hallazgo) => this.texto(hallazgo['estado']) === 'abierto').length,
      por_tipo: this.contarPor(hallazgos, 'tipo'),
      por_severidad: this.contarPor(hallazgos, 'severidad'),
    };
  }

  private construirHallazgos(ejecucion: QaEjecucion | Record<string, unknown>): HallazgoConstruido[] {
    if (this.texto(ejecucion['estado']) === 'verde') return [];

    const evidencia = this.objeto(ejecucion['evidencia']);
    const detalle = this.texto(ejecucion['detalle']);
    const evidenciaPath = this.texto(ejecucion['evidencia_path']);
    const hallazgos: HallazgoConstruido[] = [];

    const validaciones = [
      ...this.arrayObjetos(evidencia['controles_archivo']),
      ...this.arrayObjetos(evidencia['validaciones']),
    ].filter((validacion) => this.texto(validacion['estado']) === 'fallo');

    for (const validacion of validaciones) {
      hallazgos.push(this.hallazgoDesdeValidacion(validacion, ejecucion, evidenciaPath));
    }

    const capturasFallidas = this.arrayObjetos(evidencia['capturas_fallidas']);
    for (const captura of capturasFallidas) {
      hallazgos.push({
        codigo: 'UI_CAPTURA_FALLIDA',
        tipo: 'estructural',
        severidad: 'baja',
        titulo: 'No se pudo registrar una captura esperada',
        detalle: this.texto(captura['error']) || 'El runner informó una captura fallida.',
        paso: this.texto(captura['paso']) || 'captura_evidencia',
        evidencia: this.evidenciaBase(ejecucion, evidenciaPath),
        propuesta: this.propuesta('desarrollo', 'Revisar permisos, ruta de evidencia y disponibilidad de la pantalla durante la captura.'),
        origen: { fuente: 'evidencia.capturas_fallidas', captura },
      });
    }

    const porDetalle = this.hallazgoDesdeDetalle(detalle, ejecucion, evidenciaPath);
    if (porDetalle && !hallazgos.some((hallazgo) => hallazgo.codigo === porDetalle.codigo)) {
      hallazgos.push(porDetalle);
    }

    if (hallazgos.length === 0) {
      hallazgos.push({
        codigo: 'QA_RUNNER_ROJO_SIN_CLASIFICAR',
        tipo: 'entorno',
        severidad: 'media',
        titulo: 'La ejecución terminó en rojo sin clasificación específica',
        detalle: detalle || 'El runner no dejó detalle suficiente para clasificar el fallo.',
        paso: 'finalizacion_runner',
        evidencia: this.evidenciaBase(ejecucion, evidenciaPath),
        propuesta: this.propuesta('qa', 'Repetir en modo demo y revisar stdout/stderr para completar la clasificación.'),
        origen: { fuente: 'qa_ejecuciones.detalle', detalle },
      });
    }

    return this.deduplicar(hallazgos);
  }

  private hallazgoDesdeValidacion(
    validacion: Record<string, unknown>,
    ejecucion: QaEjecucion | Record<string, unknown>,
    evidenciaPath: string,
  ): HallazgoConstruido {
    const campo = this.texto(validacion['campo']) || 'validacion';
    const precondicion = campo.startsWith('archivo.') || campo.includes('periodo') || campo.includes('legajo');
    const tipo: TipoQaHallazgo = precondicion ? 'precondicion' : 'negocio';
    const codigo = precondicion
      ? `QA_PRECONDICION_${this.codigoCampo(campo)}`
      : `QA_NEGOCIO_${this.codigoCampo(campo)}`;
    const responsable = tipo === 'negocio' ? 'consultoria' : 'qa';

    return {
      codigo,
      tipo,
      severidad: tipo === 'negocio' ? 'alta' : 'media',
      titulo: tipo === 'negocio'
        ? 'El resultado no coincide con el esperado'
        : 'La entrada no cumple una precondición del caso',
      detalle: `${campo}: esperado ${this.valorLegible(validacion['esperado'])}, actual ${this.valorLegible(validacion['actual'])}.`,
      paso: tipo === 'negocio' ? 'comparacion_assertion' : 'validacion_entrada',
      campo,
      esperado: validacion['esperado'] ?? null,
      actual: validacion['actual'] ?? null,
      evidencia: {
        ...this.evidenciaBase(ejecucion, evidenciaPath),
        tolerancia: validacion['tolerancia'] ?? null,
        diferencia: validacion['diferencia'] ?? null,
      },
      propuesta: this.propuesta(
        responsable,
        tipo === 'negocio'
          ? 'Revisar el esperado cargado y la regla del dataset. Si el esperado es correcto, escalar diferencia de cálculo.'
          : 'Corregir el caso QA o el Excel para que período, legajo y dataset hablen del mismo escenario.',
      ),
      origen: { fuente: 'evidencia.validaciones', validacion },
    };
  }

  private hallazgoDesdeDetalle(
    detalle: string,
    ejecucion: QaEjecucion | Record<string, unknown>,
    evidenciaPath: string,
  ): HallazgoConstruido | null {
    const base = this.evidenciaBase(ejecucion, evidenciaPath);
    const legajo = /legajo del caso QA:\s*esperado\s+([^,]+),\s*detectado\s+([^.]+)/i.exec(detalle);
    if (legajo) {
      return {
        codigo: 'QA_PRECONDICION_LEGAJO_EXCEL',
        tipo: 'precondicion',
        severidad: 'media',
        titulo: 'El Excel corresponde a otro legajo',
        detalle: `El caso esperaba legajo ${legajo[1].trim()} y el Excel informó ${legajo[2].trim()}.`,
        paso: 'validacion_excel',
        campo: 'archivo.legajo',
        esperado: legajo[1].trim(),
        actual: legajo[2].trim(),
        evidencia: base,
        propuesta: this.propuesta('qa', 'Usar un Excel del mismo legajo o corregir el legajo del caso QA.'),
        origen: { fuente: 'qa_ejecuciones.detalle', detalle },
      };
    }

    const periodo = /per[ií]odo del caso QA:\s*esperado\s+([^,]+),\s*detectado\s+([^(.\n]+)/i.exec(detalle);
    if (periodo) {
      return {
        codigo: 'QA_PRECONDICION_PERIODO_EXCEL',
        tipo: 'precondicion',
        severidad: 'media',
        titulo: 'El Excel corresponde a otro período',
        detalle: `El caso esperaba período ${periodo[1].trim()} y el Excel informó ${periodo[2].trim()}.`,
        paso: 'validacion_excel',
        campo: 'archivo.periodo',
        esperado: periodo[1].trim(),
        actual: periodo[2].trim(),
        evidencia: base,
        propuesta: this.propuesta('qa', 'Usar un Excel del período correcto o crear un caso QA para el período real del archivo.'),
        origen: { fuente: 'qa_ejecuciones.detalle', detalle },
      };
    }

    const dataset = /periodo caso=([^ ]+)\s+distinto de dataset=([^ ]+)/i.exec(detalle);
    if (dataset || /dataset .*no puede usarse/i.test(detalle)) {
      return {
        codigo: 'QA_PRECONDICION_DATASET_INCOMPATIBLE',
        tipo: 'precondicion',
        severidad: 'alta',
        titulo: 'El dataset no corresponde al caso QA',
        detalle: dataset
          ? `Período caso=${dataset[1].trim()} distinto de dataset=${dataset[2].trim()}.`
          : detalle,
        paso: 'validacion_dataset',
        campo: 'dataset.periodo',
        esperado: dataset?.[1]?.trim() ?? null,
        actual: dataset?.[2]?.trim() ?? null,
        evidencia: base,
        propuesta: this.propuesta('consultoria', 'Elegir o validar un dataset vigente para el período del caso.'),
        origen: { fuente: 'qa_ejecuciones.detalle', detalle },
      };
    }

    const assertion = /([^:]+):\s*esperado\s+([^,]+),\s*actual\s+([^,]+),\s*diferencia\s+([^,]+),\s*tolerancia\s+([^\n]+)/i.exec(detalle);
    if (assertion) {
      return {
        codigo: `QA_NEGOCIO_${this.codigoCampo(assertion[1])}`,
        tipo: 'negocio',
        severidad: 'alta',
        titulo: 'Diferencia contra el valor esperado',
        detalle: `${assertion[1].trim()}: esperado ${assertion[2].trim()}, actual ${assertion[3].trim()}, diferencia ${assertion[4].trim()}.`,
        paso: 'comparacion_assertion',
        campo: assertion[1].trim(),
        esperado: this.valorTextoNumero(assertion[2]),
        actual: this.valorTextoNumero(assertion[3]),
        evidencia: { ...base, diferencia: this.valorTextoNumero(assertion[4]), tolerancia: this.valorTextoNumero(assertion[5]) },
        propuesta: this.propuesta('consultoria', 'Confirmar el esperado. Si es correcto, revisar cálculo/regla aplicada por el sistema.'),
        origen: { fuente: 'qa_ejecuciones.detalle', detalle },
      };
    }

    if (/strict mode violation|locator|timeout|waiting for/i.test(detalle)) {
      return {
        codigo: 'QA_ESTRUCTURAL_SELECTOR_UI',
        tipo: 'estructural',
        severidad: 'alta',
        titulo: 'Playwright no pudo interactuar con la pantalla',
        detalle,
        paso: 'interaccion_ui',
        evidencia: base,
        propuesta: this.propuesta('desarrollo', 'Revisar data-testid, selectores y estado de renderizado de la pantalla.'),
        origen: { fuente: 'qa_ejecuciones.detalle', detalle },
      };
    }

    if (/no encontr|enoent|no existe|archivo|excel/i.test(detalle)) {
      return {
        codigo: 'QA_ENTORNO_ARCHIVO_EXCEL',
        tipo: 'entorno',
        severidad: 'media',
        titulo: 'No se pudo encontrar o cargar el Excel',
        detalle,
        paso: 'carga_excel',
        evidencia: base,
        propuesta: this.propuesta('qa', 'Verificar que el archivo exista en la carpeta esperada y que el nombre coincida exactamente.'),
        origen: { fuente: 'qa_ejecuciones.detalle', detalle },
      };
    }

    return null;
  }

  private evidenciaBase(ejecucion: QaEjecucion | Record<string, unknown>, evidenciaPath: string): Record<string, unknown> {
    const evidencia = this.objeto(ejecucion['evidencia']);
    return {
      ejecucion_id: this.texto(ejecucion['id']),
      caso_id: this.texto(ejecucion['caso_id']),
      evidencia_path: evidenciaPath,
      capturas: Array.isArray(evidencia['capturas']) ? evidencia['capturas'] : [],
      dataset: this.objeto(evidencia['dataset']),
      excel: this.objeto(evidencia['excel']),
      periodo: this.objeto(evidencia['periodo']),
      empleado: this.objeto(evidencia['empleado']),
    };
  }

  private propuesta(responsable: string, accion: string): Record<string, unknown> {
    return {
      responsable_sugerido: responsable,
      accion_recomendada: accion,
      auto_fix: false,
    };
  }

  private deduplicar(hallazgos: HallazgoConstruido[]): HallazgoConstruido[] {
    const vistos = new Set<string>();
    return hallazgos.filter((hallazgo) => {
      if (vistos.has(hallazgo.codigo)) return false;
      vistos.add(hallazgo.codigo);
      return true;
    });
  }

  private idHallazgo(ejecucionId: string, codigo: string): string {
    return `QA-HALL-${ejecucionId.replace(/^QA-RUN-/, '')}-${codigo}`.replace(/[^A-Z0-9_-]/gi, '-').toUpperCase();
  }

  private codigoCampo(campo: string): string {
    return this.texto(campo)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase() || 'GENERAL';
  }

  private estadoValido(valor: unknown): EstadoQaHallazgo {
    const estado = this.texto(valor);
    if (['abierto', 'resuelto', 'descartado'].includes(estado)) return estado as EstadoQaHallazgo;
    throw new BadRequestException('Estado de hallazgo inválido. Usá abierto, resuelto o descartado.');
  }

  private contarPor(items: Record<string, unknown>[], campo: string): Record<string, number> {
    return items.reduce<Record<string, number>>((acc, item) => {
      const key = this.texto(item[campo]) || 'sin_dato';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }

  private serializar(doc: QaHallazgoLean): Record<string, unknown> {
    const { _id, ...resto } = doc;
    void _id;
    return resto as Record<string, unknown>;
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? valor as Record<string, unknown>
      : {};
  }

  private arrayObjetos(valor: unknown): Record<string, unknown>[] {
    return Array.isArray(valor)
      ? valor.map((item) => this.objeto(item)).filter((item) => Object.keys(item).length > 0)
      : [];
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }

  private valorLegible(valor: unknown): string {
    if (valor === undefined || valor === null || valor === '') return '-';
    if (typeof valor === 'object') return JSON.stringify(valor);
    return String(valor);
  }

  private numero(valor: unknown): number | null {
    if (valor === undefined || valor === null || valor === '') return null;
    const texto = String(valor).trim();
    const normalizado = texto.includes(',')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto;
    const n = Number(normalizado);
    return Number.isFinite(n) ? n : null;
  }

  private valorTextoNumero(valor: string): string | number {
    const numero = this.numero(valor);
    return numero === null ? this.texto(valor) : numero;
  }
}
