import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, join, relative, resolve } from 'path';
import { Model } from 'mongoose';
import { QaCasosService } from './qa-casos.service';
import { QaHallazgosService } from './qa-hallazgos.service';
import {
  EstadoQaEjecucion,
  ModoQaEjecucion,
  QaEjecucion,
  QaEjecucionDocument,
} from './schemas/qa-ejecucion.schema';

type QaEjecucionLean = QaEjecucion & {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

interface ResultadoParseado {
  estado: EstadoQaEjecucion;
  detalle: string;
  evidencia_path?: string;
  resultado?: Record<string, unknown> | null;
  evidencia?: Record<string, unknown> | null;
  capturas?: string[];
}

@Injectable()
export class QaRunnerService {
  private readonly procesosPorCaso = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly procesosPorEjecucion = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly staleMs = this.msDesdeEnv('AUDITORIA_QA_STALE_MS', 15 * 60 * 1000);

  constructor(
    @InjectModel(QaEjecucion.name) private readonly ejecuciones: Model<QaEjecucionDocument>,
    private readonly casos: QaCasosService,
    private readonly hallazgos: QaHallazgosService,
  ) {}

  async ejecutarCaso(casoIdEntrada: string, modoEntrada: unknown): Promise<Record<string, unknown>> {
    const casoId = this.texto(casoIdEntrada);
    if (!casoId) throw new NotFoundException('Caso QA inexistente.');
    await this.marcarEjecucionesColgadas();

    const procesoActivo = this.procesosPorCaso.get(casoId);
    if (procesoActivo && !procesoActivo.killed) {
      const ejecucionActiva = await this.ejecuciones
        .findOne({ caso_id: casoId, estado: 'corriendo' })
        .sort({ iniciado_en: -1 })
        .lean<QaEjecucionLean>();
      if (ejecucionActiva) return this.serializar(ejecucionActiva);
      throw new ConflictException(`El caso ${casoId} ya se está ejecutando.`);
    }

    await this.casos.obtener(casoId);

    const modo = this.normalizarModo(modoEntrada);
    const scriptPath = join(process.cwd(), 'scripts', 'run-qa-cases-playwright.mjs');
    if (!existsSync(scriptPath)) {
      throw new InternalServerErrorException(`No encontré el runner Playwright en ${scriptPath}.`);
    }

    const ejecucionId = `QA-RUN-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const args = modo === 'demo' ? [scriptPath, '--demo', '--muy-lento'] : [scriptPath];
    const comando = {
      binario: process.execPath,
      script: scriptPath,
      version_script: 'run-qa-cases-playwright@1',
      args: args.slice(1),
      cwd: process.cwd(),
    };

    const doc = await this.ejecuciones.create({
      id: ejecucionId,
      caso_id: casoId,
      modo,
      estado: 'corriendo',
      iniciado_en: new Date().toISOString(),
      comando,
      stdout_tail: '',
      stderr_tail: '',
      evidencia: null,
      capturas: [],
    });

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: this.envRunner(casoId, modo),
      windowsHide: true,
    });

    this.procesosPorCaso.set(casoId, child);
    this.procesosPorEjecucion.set(doc.id, child);
    this.observarProceso(child, doc.id, casoId, modo);

    return this.serializar(doc.toObject() as QaEjecucionLean);
  }

  async obtener(id: string): Promise<Record<string, unknown>> {
    await this.marcarEjecucionesColgadas();
    const doc = await this.ejecuciones.findOne({ id }).lean<QaEjecucionLean>();
    if (!doc) throw new NotFoundException('Ejecución QA inexistente.');
    return this.serializarConHallazgos(doc);
  }

  async obtenerCaptura(id: string, indexEntrada: string): Promise<{ path: string; nombre: string }> {
    await this.marcarEjecucionesColgadas();
    const index = Number(indexEntrada);
    if (!Number.isInteger(index) || index < 0) throw new BadRequestException('Índice de captura inválido.');

    const doc = await this.ejecuciones.findOne({ id }).lean<QaEjecucionLean>();
    if (!doc) throw new NotFoundException('Ejecución QA inexistente.');

    const capturas = this.capturasEjecucion(doc);
    const captura = capturas[index];
    if (!captura) throw new NotFoundException('Captura QA inexistente para la ejecución.');

    const path = resolve(captura);
    if (!this.pathCapturaPermitido(path, capturas)) {
      throw new BadRequestException('La captura no pertenece al directorio permitido de evidencias QA.');
    }
    if (!existsSync(path)) throw new NotFoundException('El archivo de captura QA no existe en disco.');

    return { path, nombre: basename(path) };
  }

  async listarUltimas(): Promise<Record<string, unknown>[]> {
    await this.marcarEjecucionesColgadas();
    const docs = await this.ejecuciones
      .aggregate<QaEjecucionLean>([
        { $sort: { iniciado_en: -1 } },
        { $group: { _id: '$caso_id', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { iniciado_en: -1 } },
      ])
      .exec();

    const hallazgos = await Promise.all(docs.map((doc) => this.hallazgos.listarPorEjecucion(doc.id)));
    return docs.map((doc, index) => this.serializar(doc, hallazgos[index]));
  }

  /** Cuántas veces se corrió cada caso, sin importar el resultado. Para la
   * tarjeta de "Casos": no importa si dio verde o rojo, importa que se probó. */
  async contarPorCaso(): Promise<Record<string, number>> {
    const filas = await this.ejecuciones
      .aggregate<{ _id: string; total: number }>([{ $group: { _id: '$caso_id', total: { $sum: 1 } } }])
      .exec();
    const conteos: Record<string, number> = {};
    for (const fila of filas) {
      if (fila._id) conteos[fila._id] = fila.total;
    }
    return conteos;
  }

  private observarProceso(child: ChildProcessWithoutNullStreams, ejecucionId: string, casoId: string, modo: ModoQaEjecucion): void {
    let stdout = '';
    let stderr = '';
    let finalizado = false;
    const maxMs = this.maxMsPorModo(modo);
    const timer = setTimeout(() => {
      child.kill();
      finalizar(null, new Error(`Playwright excedió el tiempo máximo de ${Math.round(maxMs / 60000)} minuto(s) para ${casoId}.`));
    }, maxMs);
    timer.unref?.();

    const finalizar = (code: number | null, error: Error | null) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer);
      this.procesosPorCaso.delete(casoId);
      this.procesosPorEjecucion.delete(ejecucionId);
      void this.finalizarEjecucion(ejecucionId, casoId, stdout, stderr, code, error);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = this.tail(`${stdout}${chunk}`);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = this.tail(`${stderr}${chunk}`);
    });

    child.on('error', (error) => {
      finalizar(null, error);
    });

    child.on('close', (code) => {
      finalizar(code, null);
    });
  }

  private async marcarEjecucionesColgadas(): Promise<void> {
    const corriendo = await this.ejecuciones
      .find({ estado: 'corriendo' })
      .select({ id: 1, caso_id: 1, iniciado_en: 1 })
      .lean<QaEjecucionLean[]>();
    const ahora = Date.now();

    for (const ejecucion of corriendo) {
      const proceso = this.procesosPorEjecucion.get(ejecucion.id);
      const edadMs = ahora - Date.parse(ejecucion.iniciado_en);
      const huerfana = !proceso || proceso.killed;
      const vencida = Number.isFinite(edadMs) && edadMs > this.staleMs;

      if (!huerfana && !vencida) continue;

      if (proceso && vencida) {
        proceso.kill();
        this.procesosPorCaso.delete(ejecucion.caso_id);
        this.procesosPorEjecucion.delete(ejecucion.id);
      }

      const tipoCierre = huerfana ? 'huerfana' : 'vencida';
      const detalle = huerfana
        ? 'Ejecución QA huérfana: el backend se reinició o perdió el proceso Playwright antes de registrar el cierre.'
        : `Ejecución QA vencida: Playwright superó ${Math.round(this.staleMs / 60000)} minuto(s) sin finalizar.`;

      await this.ejecuciones.updateOne(
        { id: ejecucion.id, estado: 'corriendo' },
        {
          $set: {
            estado: 'rojo',
            finalizado_en: new Date().toISOString(),
            exit_code: null,
            detalle,
            evidencia: {
              caso_id: ejecucion.caso_id,
              estado: 'rojo',
              tipo_cierre: tipoCierre,
              detalle,
              generado_en: new Date().toISOString(),
              recomendacion: huerfana
                ? 'Reejecutar el caso para generar evidencia completa.'
                : 'Revisar timeout, estado del frontend/backend y repetir en modo demo si hace falta.',
            },
            capturas: [],
          },
        },
      );
      await this.registrarHallazgosEjecucion(ejecucion.id);
    }
  }

  private async finalizarEjecucion(
    ejecucionId: string,
    casoId: string,
    stdout: string,
    stderr: string,
    exitCode: number | null,
    error: Error | null,
  ): Promise<void> {
    const parseado = await this.parsearResultado(casoId, stdout, stderr, exitCode, error);

    await this.ejecuciones.updateOne(
      { id: ejecucionId },
      {
        $set: {
          estado: parseado.estado,
          finalizado_en: new Date().toISOString(),
          exit_code: exitCode,
          detalle: parseado.detalle,
          evidencia_path: parseado.evidencia_path,
          resultado: parseado.resultado ?? null,
          evidencia: parseado.evidencia ?? null,
          capturas: parseado.capturas ?? [],
          stdout_tail: this.tail(stdout),
          stderr_tail: this.tail(stderr),
        },
      },
    );

    await this.registrarHallazgosEjecucion(ejecucionId);
  }

  private async registrarHallazgosEjecucion(ejecucionId: string): Promise<void> {
    try {
      const doc = await this.ejecuciones.findOne({ id: ejecucionId }).lean<QaEjecucionLean>();
      if (!doc) return;
      await this.hallazgos.registrarDesdeEjecucion(doc);
    } catch {
      // La ejecución QA ya quedó registrada; el catálogo se puede regenerar desde la evidencia.
    }
  }

  private async parsearResultado(
    casoId: string,
    stdout: string,
    stderr: string,
    exitCode: number | null,
    error: Error | null,
  ): Promise<ResultadoParseado> {
    const salida = `${stdout}\n${stderr}`;
    const estadoMatch = /QA Playwright Auditoria Ganancias:\s*(verde|rojo)/i.exec(salida);
    const estado = estadoMatch?.[1]?.toLowerCase() === 'verde' && exitCode === 0 ? 'verde' : 'rojo';
    const evidenciaPath = /-\s*evidencia=(.+)/i.exec(salida)?.[1]?.trim();
    const lineaCaso = this.lineaResultadoCaso(salida, casoId);
    const evidencia = await this.leerEvidencia(evidenciaPath);
    const resultado = this.resultadoDesdeEvidencia(evidencia, casoId);
    const detalle = this.texto(resultado?.['detalle']) ||
      lineaCaso ||
      (error ? error.message : estado === 'verde' ? 'Caso QA finalizado en verde.' : `Runner finalizó con código ${exitCode ?? 'sin código'}.`);
    const evidenciaResumen = this.resumenEvidencia(evidencia, resultado, casoId, evidenciaPath, estado, detalle);

    return {
      estado,
      detalle,
      evidencia_path: evidenciaPath,
      resultado,
      evidencia: evidenciaResumen,
      capturas: this.capturasDesdeEvidenciaResumen(evidenciaResumen),
    };
  }

  private lineaResultadoCaso(salida: string, casoId: string): string {
    const regex = /^-\s+(VERDE|ROJO)\s+([^:]+):\s+(.+)$/gim;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(salida)) !== null) {
      if (match[2]?.trim() === casoId) return match[3]?.trim() ?? '';
    }
    return '';
  }

  private async leerEvidencia(path: string | undefined): Promise<Record<string, unknown> | null> {
    if (!path || !existsSync(path)) return null;
    try {
      const contenido = await readFile(path, 'utf8');
      const parsed = JSON.parse(contenido) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  private resultadoDesdeEvidencia(evidencia: Record<string, unknown> | null, casoId: string): Record<string, unknown> | null {
    const resultados = evidencia?.['resultados'];
    if (!Array.isArray(resultados)) return null;
    return resultados.find((resultado) => {
      return resultado && typeof resultado === 'object' && (resultado as Record<string, unknown>)['caso'] === casoId;
    }) as Record<string, unknown> | null ?? null;
  }

  private resumenEvidencia(
    evidencia: Record<string, unknown> | null,
    resultado: Record<string, unknown> | null,
    casoId: string,
    evidenciaPath: string | undefined,
    estado: EstadoQaEjecucion,
    detalle: string,
  ): Record<string, unknown> {
    const evidenciaObj = this.objeto(evidencia);
    const resultadoObj = this.objeto(resultado);
    const dataset = this.objeto(resultadoObj['dataset']);
    const fuenteNormativa = this.objeto(dataset['fuente_normativa']);
    const definicion = this.objeto(resultadoObj['definicion_tecnica']);
    const controlArchivo = this.objeto(resultadoObj['control_archivo']);
    const metadataDetectada = this.objeto(controlArchivo['metadata_detectada']);
    const periodoDetectado = this.objeto(controlArchivo['periodo_detectado']);
    const controlesArchivo = this.validacionesDesdeObjetos(this.arrayObjetos(resultadoObj['controles_archivo']));
    const validaciones = this.validacionesDesdeObjetos(this.arrayObjetos(resultadoObj['assertions']));
    const validacionesFinales = validaciones.length > 0 ? validaciones : this.validacionesDesdeDetalle(detalle);
    const capturas = this.capturasDesdeEvidencia(evidenciaObj, casoId);
    const capturasFallidas = this.arrayObjetos(evidenciaObj['capturas_fallidas']);

    return {
      caso_id: casoId,
      estado,
      detalle,
      evidencia_path: evidenciaPath ?? '',
      generado_en: this.texto(evidenciaObj['fecha']) || new Date().toISOString(),
      sistema: this.texto(evidenciaObj['sistema']) || 'auditoria-ganancias',
      frontend_url: this.texto(evidenciaObj['frontend_url']),
      api_url: this.texto(evidenciaObj['api_url']),
      modo_demo: evidenciaObj['modo_demo'] === true,
      carga_formulario_qa: evidenciaObj['carga_formulario_qa'] === true,
      dataset: {
        codigo: this.texto(dataset['codigo']),
        periodo: this.texto(dataset['periodo']),
        convenio: this.texto(dataset['convenio']),
        estado: this.texto(dataset['estado']),
        fuente_normativa: this.texto(fuenteNormativa['ref']),
      },
      definicion_tecnica: {
        codigo: this.texto(definicion['codigo']),
        version: this.numero(definicion['version']),
        nombre: this.texto(definicion['nombre']),
      },
      excel: {
        nombre: this.texto(resultadoObj['archivo']) || this.texto(controlArchivo['archivo']),
        directorio: this.texto(evidenciaObj['excel_dir']),
        snapshot_id: this.texto(resultadoObj['snapshot_id']),
      },
      periodo: {
        esperado: this.valorValidacion(validacionesFinales, 'archivo.periodo', 'esperado'),
        detectado: this.texto(periodoDetectado['etiqueta']) || this.valorValidacion(validacionesFinales, 'archivo.periodo', 'actual'),
        fuente: this.texto(periodoDetectado['fuente']),
      },
      empleado: {
        legajo_esperado: this.valorValidacion(validacionesFinales, 'archivo.legajo', 'esperado'),
        legajo_detectado: this.texto(controlArchivo['legajo_detectado']) ||
          this.texto(metadataDetectada['legajo']) ||
          this.valorValidacion(validacionesFinales, 'archivo.legajo', 'actual'),
        cliente_detectado: this.texto(controlArchivo['cliente_detectado']) || this.texto(metadataDetectada['cliente']),
        cuil_detectado: this.texto(controlArchivo['cuil_detectado']),
      },
      validaciones: validacionesFinales,
      controles_archivo: controlesArchivo,
      capturas,
      capturas_fallidas: capturasFallidas,
    };
  }

  private validacionesDesdeObjetos(items: Record<string, unknown>[]): Record<string, unknown>[] {
    return items.map((item) => ({
      campo: this.texto(item['campo']),
      esperado: item['esperado'] ?? null,
      actual: item['actual'] ?? null,
      tolerancia: item['tolerancia'] ?? null,
      estado: this.validacionOk(item) ? 'ok' : 'fallo',
    })).filter((item) => this.texto(item['campo']));
  }

  private validacionesDesdeDetalle(detalle: string): Record<string, unknown>[] {
    const match = /([^:]+):\s*esperado\s+([^,]+),\s*actual\s+([^,]+),\s*diferencia\s+([^,]+),\s*tolerancia\s+([^\n]+)/i.exec(detalle);
    if (!match) return [];
    return [{
      campo: match[1].trim(),
      esperado: this.valorTextoNumero(match[2]),
      actual: this.valorTextoNumero(match[3]),
      diferencia: this.valorTextoNumero(match[4]),
      tolerancia: this.valorTextoNumero(match[5]),
      estado: 'fallo',
    }];
  }

  private validacionOk(item: Record<string, unknown>): boolean {
    const esperado = item['esperado'];
    const actual = item['actual'];
    const tolerancia = this.numero(item['tolerancia']);
    const esperadoNumero = this.numero(esperado);
    const actualNumero = this.numero(actual);
    if (esperadoNumero !== null || actualNumero !== null) {
      if (esperadoNumero === null || actualNumero === null) return false;
      return Math.abs(esperadoNumero - actualNumero) <= (tolerancia ?? 0);
    }
    return this.texto(esperado) === this.texto(actual);
  }

  private valorValidacion(validaciones: Record<string, unknown>[], campo: string, key: 'esperado' | 'actual'): unknown {
    const validacion = validaciones.find((item) => this.texto(item['campo']) === campo);
    return validacion?.[key] ?? '';
  }

  private capturasDesdeEvidencia(evidencia: Record<string, unknown>, casoId: string): string[] {
    const caso = casoId.toLowerCase();
    return (Array.isArray(evidencia['capturas']) ? evidencia['capturas'] : [])
      .map((item) => this.texto(item))
      .filter(Boolean)
      .filter((path) => {
        const nombre = basename(path).toLowerCase();
        return nombre === '00-login.png' || nombre.includes(caso);
      });
  }

  private capturasDesdeEvidenciaResumen(evidencia: Record<string, unknown> | null): string[] {
    const capturas = evidencia?.['capturas'];
    return Array.isArray(capturas) ? capturas.map((item) => this.texto(item)).filter(Boolean) : [];
  }

  private capturasEjecucion(ejecucion: QaEjecucionLean): string[] {
    const capturas = Array.isArray(ejecucion.capturas)
      ? ejecucion.capturas.map((item) => this.texto(item)).filter(Boolean)
      : [];
    if (capturas.length > 0) return capturas;

    const evidencia = this.objeto(ejecucion.evidencia);
    const capturasEvidencia = evidencia['capturas'];
    return Array.isArray(capturasEvidencia)
      ? capturasEvidencia.map((item) => this.texto(item)).filter(Boolean)
      : [];
  }

  private pathCapturaPermitido(path: string, capturas: string[]): boolean {
    if (!/\.png$/i.test(path)) return false;

    const perteneceAEjecucion = capturas.some((captura) => resolve(captura) === path);
    if (!perteneceAEjecucion) return false;

    const raizOutputs = resolve(process.cwd(), '..', 'outputs', 'playwright');
    const relativo = relative(raizOutputs, path);
    return Boolean(relativo) && !relativo.startsWith('..') && !/^[A-Za-z]:/.test(relativo);
  }

  private envRunner(casoId: string, modo: ModoQaEjecucion): NodeJS.ProcessEnv {
    const demo = modo === 'demo';
    return {
      ...process.env,
      AUDITORIA_QA_CASE: casoId,
      AUDITORIA_QA_CARGAR_FORM: demo ? 'true' : 'false',
      AUDITORIA_PLAYWRIGHT_DEMO: demo ? 'true' : 'false',
      AUDITORIA_PLAYWRIGHT_MUY_LENTO: demo ? 'true' : 'false',
      PLAYWRIGHT_HEADLESS: demo ? 'false' : 'true',
      PLAYWRIGHT_SLOWMO_MS: demo ? process.env.PLAYWRIGHT_SLOWMO_MS ?? '2600' : '0',
      PLAYWRIGHT_DEMO_PAUSE_MS: demo ? process.env.PLAYWRIGHT_DEMO_PAUSE_MS ?? '1800' : '0',
      PLAYWRIGHT_DEMO_FINAL_PAUSE_MS: demo ? process.env.PLAYWRIGHT_DEMO_FINAL_PAUSE_MS ?? '25000' : '0',
    };
  }

  private normalizarModo(valor: unknown): ModoQaEjecucion {
    return this.texto(valor) === 'demo' ? 'demo' : 'rapido';
  }

  private maxMsPorModo(modo: ModoQaEjecucion): number {
    return modo === 'demo'
      ? this.msDesdeEnv('AUDITORIA_QA_DEMO_MAX_MS', 12 * 60 * 1000)
      : this.msDesdeEnv('AUDITORIA_QA_RAPIDO_MAX_MS', 6 * 60 * 1000);
  }

  private async serializarConHallazgos(doc: QaEjecucionLean): Promise<Record<string, unknown>> {
    const hallazgos = await this.hallazgos.listarPorEjecucion(doc.id);
    return this.serializar(doc, hallazgos);
  }

  private serializar(doc: QaEjecucionLean, hallazgos: Record<string, unknown>[] = []): Record<string, unknown> {
    const { _id, ...resto } = doc;
    void _id;
    return {
      ...(resto as Record<string, unknown>),
      hallazgos,
      resumen_hallazgos: this.hallazgos.resumen(hallazgos),
    };
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

  private tail(valor: string): string {
    return valor.slice(-8000);
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
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

  private msDesdeEnv(nombre: string, fallback: number): number {
    const valor = Number(process.env[nombre]);
    return Number.isFinite(valor) && valor > 0 ? valor : fallback;
  }
}
