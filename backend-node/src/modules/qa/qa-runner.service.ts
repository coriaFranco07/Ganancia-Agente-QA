import { ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Model } from 'mongoose';
import { QaCasosService } from './qa-casos.service';
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
}

@Injectable()
export class QaRunnerService {
  private readonly procesosPorCaso = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(
    @InjectModel(QaEjecucion.name) private readonly ejecuciones: Model<QaEjecucionDocument>,
    private readonly casos: QaCasosService,
  ) {}

  async ejecutarCaso(casoIdEntrada: string, modoEntrada: unknown): Promise<Record<string, unknown>> {
    const casoId = this.texto(casoIdEntrada);
    if (!casoId) throw new NotFoundException('Caso QA inexistente.');

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
    });

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: this.envRunner(casoId, modo),
      windowsHide: true,
    });

    this.procesosPorCaso.set(casoId, child);
    this.observarProceso(child, doc.id, casoId);

    return this.serializar(doc.toObject() as QaEjecucionLean);
  }

  async obtener(id: string): Promise<Record<string, unknown>> {
    const doc = await this.ejecuciones.findOne({ id }).lean<QaEjecucionLean>();
    if (!doc) throw new NotFoundException('Ejecución QA inexistente.');
    return this.serializar(doc);
  }

  async listarUltimas(): Promise<Record<string, unknown>[]> {
    const docs = await this.ejecuciones
      .aggregate<QaEjecucionLean>([
        { $sort: { iniciado_en: -1 } },
        { $group: { _id: '$caso_id', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { iniciado_en: -1 } },
      ])
      .exec();

    return docs.map((doc) => this.serializar(doc));
  }

  private observarProceso(child: ChildProcessWithoutNullStreams, ejecucionId: string, casoId: string): void {
    let stdout = '';
    let stderr = '';
    let finalizado = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = this.tail(`${stdout}${chunk}`);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = this.tail(`${stderr}${chunk}`);
    });

    child.on('error', (error) => {
      if (finalizado) return;
      finalizado = true;
      this.procesosPorCaso.delete(casoId);
      void this.finalizarEjecucion(ejecucionId, casoId, stdout, stderr, null, error);
    });

    child.on('close', (code) => {
      if (finalizado) return;
      finalizado = true;
      this.procesosPorCaso.delete(casoId);
      void this.finalizarEjecucion(ejecucionId, casoId, stdout, stderr, code, null);
    });
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
          stdout_tail: this.tail(stdout),
          stderr_tail: this.tail(stderr),
        },
      },
    );
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

    return {
      estado,
      detalle,
      evidencia_path: evidenciaPath,
      resultado,
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

  private serializar(doc: QaEjecucionLean): Record<string, unknown> {
    const { _id, ...resto } = doc;
    void _id;
    return resto as Record<string, unknown>;
  }

  private tail(valor: string): string {
    return valor.slice(-8000);
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }
}
