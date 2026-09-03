import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Model } from 'mongoose';
import { QaSopLoomAprendizaje, QaSopLoomAprendizajeDocument } from '../schemas/qa-sop-loom-aprendizaje.schema';
import { CategoriaQaSuite, ModoQaSuite, QaSuiteEjecucion, QaSuiteEjecucionDocument } from './schemas/qa-suite-ejecucion.schema';
import { QaSuiteCorrida, QaSuiteCorridaDocument } from './schemas/qa-suite-corrida.schema';
import { QaSuiteHallazgo, QaSuiteHallazgoDocument } from './schemas/qa-suite-hallazgo.schema';
import { QaSuiteDerivadorService } from './qa-suite-derivador.service';
import { CampoCatalogo } from '../qa-catalogo-elementos';

const SCRIPT_POR_CATEGORIA: Record<CategoriaQaSuite, string> = {
  funcional: 'run-qa-suite-funcional.mjs',
  seguridad: 'run-qa-suite-seguridad.mjs',
  accesibilidad: 'run-qa-suite-accesibilidad.mjs',
};

const MAX_MS_POR_MODO: Record<ModoQaSuite, number> = {
  rapido: 4 * 60 * 1000,
  demo: 10 * 60 * 1000,
};

type QaSopLoomLean = QaSopLoomAprendizaje & { _id?: unknown };
type QaSuiteEjecucionLean = QaSuiteEjecucion & { _id?: unknown };
type QaSuiteCorridaLean = QaSuiteCorrida & { _id?: unknown };

@Injectable()
export class QaSuiteRunnerService {
  private readonly procesos = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(
    @InjectModel(QaSopLoomAprendizaje.name) private readonly aprendizajes: Model<QaSopLoomAprendizajeDocument>,
    @InjectModel(QaSuiteEjecucion.name) private readonly ejecuciones: Model<QaSuiteEjecucionDocument>,
    @InjectModel(QaSuiteCorrida.name) private readonly corridas: Model<QaSuiteCorridaDocument>,
    @InjectModel(QaSuiteHallazgo.name) private readonly hallazgosModel: Model<QaSuiteHallazgoDocument>,
    private readonly derivador: QaSuiteDerivadorService,
  ) {}

  /**
   * Muestra, sin correr nada, exactamente que valor va a escribir la Suite en
   * cada campo y por que -la misma derivacion que despues usan los scripts,
   * calculada acá para previsualizar antes de disparar la corrida real.
   */
  async previsualizar(
    aprendizajeIds: string[],
    categorias: CategoriaQaSuite[],
  ): Promise<Record<string, unknown>[]> {
    const previa: Record<string, unknown>[] = [];

    for (const aprendizajeId of aprendizajeIds) {
      const doc = await this.aprendizajes.findOne({ id: aprendizajeId, activo: { $ne: false } }).lean<QaSopLoomLean>();
      if (!doc) throw new NotFoundException(`Aprendizaje ${aprendizajeId} inexistente.`);

      const definicion = this.objeto(doc.definicion_ejecutable);
      const pasos = Array.isArray(definicion['pasos_ejecutables']) ? (definicion['pasos_ejecutables'] as never[]) : [];
      // El catalogo de campos vive en `doc.campos` (nivel raiz del aprendizaje),
      // no en `definicion_ejecutable`: ese objeto nunca tuvo esa clave.
      const campos = this.mapearCampos(doc.campos);

      const porCategoria = categorias.map((categoria) => {
        const escenarios = this.derivador.derivarEscenarios(aprendizajeId, pasos, campos, categoria);
        return {
          categoria,
          escenarios: escenarios.map((e) => ({
            campo: e.campo_bajo_prueba,
            valor: e.valor_bajo_prueba,
            motivo: e.motivo,
            datos_completos: e.campo_bajo_prueba ? null : e.datos,
          })),
        };
      });

      previa.push({ aprendizaje_id: aprendizajeId, aprendizaje_nombre: doc.nombre, categorias: porCategoria });
    }

    return previa;
  }

  /**
   * Lista los aprendizajes elegibles para la Suite: no hace falta que esten
   * aprobados, alcanza con que ya esten cargados y compilados (tengan
   * definicion ejecutable). Los que ademas estan aprobados conservan, al
   * correr, la verificacion de que no cambiaron desde la aprobacion.
   */
  async listarAprendizajesAprobados(): Promise<Record<string, unknown>[]> {
    const docs = await this.aprendizajes
      .find({ activo: { $ne: false }, definicion_ejecutable: { $ne: null } })
      .sort({ nombre: 1 })
      .lean<QaSopLoomLean[]>();
    return docs.map((doc) => ({
      id: doc.id,
      nombre: doc.nombre,
      modulo: doc.modulo,
      ruta: doc.ruta,
      estado: doc.estado,
      firmas: doc.firmas ?? { negocio: null, tecnica: null },
      ultima_corrida: null,
    }));
  }

  async dispararCorrida(
    aprendizajeIds: string[],
    categorias: CategoriaQaSuite[],
    modo: ModoQaSuite,
    disparadoPor: string,
  ): Promise<Record<string, unknown>> {
    if (!aprendizajeIds?.length) throw new BadRequestException('Elegí al menos un flujo aprendido.');
    if (!categorias?.length) throw new BadRequestException('Elegí al menos una categoría.');

    const corridaId = `QA-SUITE-RUN-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const idsEjecucion: string[] = [];

    for (const aprendizajeId of aprendizajeIds) {
      for (const categoria of categorias) {
        const ejecucion = await this.iniciarEjecucion(aprendizajeId, categoria, modo, corridaId);
        idsEjecucion.push(ejecucion.id);
      }
    }

    const doc = await this.corridas.create({
      id: corridaId,
      disparado_por: disparadoPor,
      disparado_en: new Date().toISOString(),
      modo,
      aprendizajes: aprendizajeIds,
      categorias,
      ejecuciones: idsEjecucion,
      estado_consolidado: 'corriendo',
      informe: null,
    });

    return this.serializarCorrida(doc.toObject() as QaSuiteCorridaLean);
  }

  async obtenerCorrida(id: string): Promise<Record<string, unknown>> {
    const doc = await this.corridas.findOne({ id }).lean<QaSuiteCorridaLean>();
    if (!doc) throw new NotFoundException('Corrida de Suite inexistente.');
    return this.serializarCorrida(doc);
  }

  async listarCorridas(): Promise<Record<string, unknown>[]> {
    const docs = await this.corridas.find().sort({ disparado_en: -1 }).limit(50).lean<QaSuiteCorridaLean[]>();
    return docs.map((doc) => this.serializarCorrida(doc));
  }

  /**
   * No exige que el aprendizaje este aprobado: alcanza con que este cargado
   * y compilado. A los que si estan aprobados les mantiene la verificacion
   * de que la definicion y la navegacion no cambiaron desde la aprobacion.
   * A diferencia de la ejecucion propia de SOP Loom, nunca revalida casos
   * congelados: la Suite no los usa.
   */
  private async iniciarEjecucion(
    aprendizajeId: string,
    categoria: CategoriaQaSuite,
    modo: ModoQaSuite,
    corridaId: string,
  ): Promise<QaSuiteEjecucionLean> {
    const doc = await this.aprendizajes.findOne({ id: aprendizajeId, activo: { $ne: false } }).lean<QaSopLoomLean>();
    if (!doc) throw new NotFoundException(`Aprendizaje ${aprendizajeId} inexistente.`);
    if (!doc.definicion_ejecutable) {
      throw new BadRequestException(`El aprendizaje ${aprendizajeId} todavía no tiene una definición compilada.`);
    }

    if (doc.estado === 'aprobado') {
      const aprobacion = this.objeto(doc.aprobacion);
      const hashDefinicion = this.hash(this.objeto(doc.definicion_ejecutable));
      if (this.texto(aprobacion['hash_definicion']) !== hashDefinicion) {
        throw new BadRequestException(`La definición de ${aprendizajeId} cambió después de aprobarse. Volvé a revisarla y aprobarla.`);
      }
      const inspeccionAprobada = this.objeto(doc.inspeccion_navegacion);
      if (this.texto(aprobacion['hash_navegacion']) !== this.texto(inspeccionAprobada['hash'])) {
        throw new BadRequestException(`La inspección navegada de ${aprendizajeId} no coincide con la aprobación técnica vigente.`);
      }
    }

    const clave = `${aprendizajeId}:${categoria}`;
    const activo = this.procesos.get(clave);
    if (activo && !activo.killed) {
      throw new ConflictException(`${aprendizajeId} ya tiene una corrida de ${categoria} en curso.`);
    }

    const scriptName = SCRIPT_POR_CATEGORIA[categoria];
    const scriptPath = join(process.cwd(), 'scripts', scriptName);
    if (!existsSync(scriptPath)) {
      throw new InternalServerErrorException(`No encontré el runner de la Suite en ${scriptPath}.`);
    }

    const ejecucionId = `QA-SUITE-${categoria.toUpperCase()}-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const args = modo === 'demo' ? [scriptPath, '--demo'] : [scriptPath];

    const ejecucionDoc = await this.ejecuciones.create({
      id: ejecucionId,
      aprendizaje_id: aprendizajeId,
      categoria,
      modo,
      estado: 'corriendo',
      iniciado_en: new Date().toISOString(),
      comando: { script: scriptName, args: args.slice(1) },
      stdout_tail: '',
      stderr_tail: '',
      capturas: [],
    });

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: this.envRunner(aprendizajeId, modo),
      windowsHide: true,
    });

    this.procesos.set(clave, child);
    this.observarProceso(child, clave, ejecucionId, categoria, aprendizajeId, corridaId, modo);

    return ejecucionDoc.toObject() as QaSuiteEjecucionLean;
  }

  private observarProceso(
    child: ChildProcessWithoutNullStreams,
    claveProceso: string,
    ejecucionId: string,
    categoria: CategoriaQaSuite,
    aprendizajeId: string,
    corridaId: string,
    modo: ModoQaSuite,
  ): void {
    let stdout = '';
    let stderr = '';
    let finalizado = false;
    const maxMs = MAX_MS_POR_MODO[modo];
    const timer = setTimeout(() => {
      child.kill();
      finalizar(null, new Error(`La corrida de ${categoria} excedió el tiempo máximo de ${Math.round(maxMs / 60000)} minuto(s).`));
    }, maxMs);
    timer.unref?.();

    const finalizar = (code: number | null, error: Error | null) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer);
      this.procesos.delete(claveProceso);
      void this.finalizarEjecucion(ejecucionId, categoria, aprendizajeId, corridaId, stdout, stderr, code, error);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout = this.tail(`${stdout}${chunk}`)));
    child.stderr.on('data', (chunk: string) => (stderr = this.tail(`${stderr}${chunk}`)));
    child.on('error', (error) => finalizar(null, error));
    child.on('close', (code) => finalizar(code, null));
  }

  private async finalizarEjecucion(
    ejecucionId: string,
    categoria: CategoriaQaSuite,
    aprendizajeId: string,
    corridaId: string,
    stdout: string,
    stderr: string,
    exitCode: number | null,
    error: Error | null,
  ): Promise<void> {
    const salida = `${stdout}\n${stderr}`;
    const verde = new RegExp(`QA Suite ${categoria}:\\s*verde`, 'i').test(salida) && exitCode === 0;
    const evidenciaPath = /-\s*evidencia=(.+)/i.exec(salida)?.[1]?.trim() ?? '';
    const detalle =
      /-\s*detalle=(.+)$/im.exec(salida)?.[1]?.trim() ||
      error?.message ||
      (verde ? 'Corrida finalizada correctamente.' : `Runner finalizó con código ${exitCode ?? 'sin código'}.`);

    const evidencia = await this.leerEvidencia(evidenciaPath);
    const capturas = Array.isArray(evidencia?.['capturas']) ? (evidencia!['capturas'] as string[]) : [];

    await this.ejecuciones.updateOne(
      { id: ejecucionId },
      {
        $set: {
          estado: verde ? 'verde' : 'rojo',
          finalizado_en: new Date().toISOString(),
          exit_code: exitCode,
          detalle,
          evidencia,
          capturas,
          stdout_tail: this.tail(stdout),
          stderr_tail: this.tail(stderr),
        },
      },
    );

    await this.registrarHallazgos(ejecucionId, categoria, aprendizajeId, evidencia);
    await this.cerrarCorridaSiCorresponde(corridaId);
  }

  /** Traduce la evidencia de cada categoria a documentos de `qa_suite_hallazgos`. */
  private async registrarHallazgos(
    ejecucionId: string,
    categoria: CategoriaQaSuite,
    aprendizajeId: string,
    evidencia: Record<string, unknown> | null,
  ): Promise<void> {
    if (!evidencia) return;
    const ahora = new Date().toISOString();
    const documentos: Partial<QaSuiteHallazgo>[] = [];

    if (categoria === 'seguridad' && Array.isArray(evidencia['hallazgos'])) {
      for (const h of evidencia['hallazgos'] as Record<string, unknown>[]) {
        documentos.push({
          id: `${ejecucionId}-${this.texto(h['codigo']) || randomUUID().slice(0, 8)}`,
          ejecucion_id: ejecucionId,
          aprendizaje_id: aprendizajeId,
          categoria_prueba: 'seguridad',
          tipo: 'estructural',
          severidad: (this.texto(h['gravedad']) as QaSuiteHallazgo['severidad']) || 'media',
          estado: 'abierto',
          codigo: this.texto(h['codigo']) || 'SUITE-SEG-000',
          titulo: this.texto(h['titulo']) || 'Hallazgo de seguridad',
          detalle: this.texto(h['detalle']),
          campo: this.texto(h['campo']),
          esperado: h['esperado'] ?? null,
          actual: h['actual'] ?? null,
          detectado_en: ahora,
        });
      }
    }

    if (categoria === 'accesibilidad' && Array.isArray(evidencia['auditorias'])) {
      for (const auditoria of evidencia['auditorias'] as Record<string, unknown>[]) {
        for (const v of (auditoria['violaciones'] as Record<string, unknown>[] | undefined) ?? []) {
          documentos.push({
            id: `${ejecucionId}-${this.texto(v['regla']) || randomUUID().slice(0, 8)}`,
            ejecucion_id: ejecucionId,
            aprendizaje_id: aprendizajeId,
            categoria_prueba: 'accesibilidad',
            tipo: 'estructural',
            severidad: (this.texto(v['gravedad']) as QaSuiteHallazgo['severidad']) || 'media',
            estado: 'abierto',
            codigo: `WCAG-${this.texto(v['regla'])}`,
            titulo: this.texto(v['ayuda']) || 'Violación WCAG',
            detalle: `Regla "${this.texto(v['regla'])}", impacto ${this.texto(v['impacto'])}, ${this.numero(v['nodos_afectados'])} elemento(s).`,
            evidencia: { url_ayuda: this.texto(v['url_ayuda']), ejemplos: v['ejemplos'] ?? [] },
            detectado_en: ahora,
          });
        }
      }
    }

    if (categoria === 'funcional' && Array.isArray(evidencia['escenarios'])) {
      for (const escenario of evidencia['escenarios'] as Record<string, unknown>[]) {
        if (escenario['estado'] === 'ok') continue;
        documentos.push({
          id: `${ejecucionId}-${this.texto(escenario['id']) || randomUUID().slice(0, 8)}`,
          ejecucion_id: ejecucionId,
          aprendizaje_id: aprendizajeId,
          categoria_prueba: 'funcional',
          tipo: 'negocio',
          severidad: escenario['estado'] === 'error' ? 'alta' : 'media',
          estado: 'abierto',
          codigo: 'SUITE-FUN-000',
          titulo: `El flujo no aceptó un valor válido en ${this.texto(escenario['campo_bajo_prueba'])}`,
          detalle: this.texto(escenario['detalle']),
          campo: this.texto(escenario['campo_bajo_prueba']),
          actual: escenario['valor_bajo_prueba'] ?? null,
          detectado_en: ahora,
        });
      }
    }

    if (documentos.length) await this.hallazgosModel.insertMany(documentos, { ordered: false }).catch(() => undefined);
  }

  /** Cuando todas las ejecuciones de una corrida terminaron, calcula el semaforo y arma el informe. */
  private async cerrarCorridaSiCorresponde(corridaId: string): Promise<void> {
    const corrida = await this.corridas.findOne({ id: corridaId }).lean<QaSuiteCorridaLean>();
    if (!corrida) return;

    const ejecuciones = await this.ejecuciones
      .find({ id: { $in: corrida.ejecuciones } })
      .lean<QaSuiteEjecucionLean[]>();
    if (ejecuciones.some((e) => e.estado === 'corriendo')) return;

    const hallazgos = await this.hallazgosModel
      .find({ ejecucion_id: { $in: corrida.ejecuciones } })
      .lean<(QaSuiteHallazgo & { _id?: unknown })[]>();

    const informe = await this.armarInforme(corrida, ejecuciones, hallazgos);
    const estadoConsolidado = this.calcularEstadoConsolidado(hallazgos);

    await this.corridas.updateOne({ id: corridaId }, { $set: { estado_consolidado: estadoConsolidado, informe } });
  }

  private calcularEstadoConsolidado(hallazgos: QaSuiteHallazgo[]): QaSuiteCorrida['estado_consolidado'] {
    if (hallazgos.some((h) => h.severidad === 'alta' || h.severidad === 'critica')) return 'rojo';
    if (hallazgos.length > 0) return 'amarillo';
    return 'verde';
  }

  private async armarInforme(
    corrida: QaSuiteCorridaLean,
    ejecuciones: QaSuiteEjecucionLean[],
    hallazgos: QaSuiteHallazgo[],
  ): Promise<Record<string, unknown>> {
    const porAprendizaje: Record<string, unknown> = {};

    for (const aprendizajeId of corrida.aprendizajes) {
      const doc = await this.aprendizajes.findOne({ id: aprendizajeId }).lean<QaSopLoomLean>();
      const ejecucionesDelFlujo = ejecuciones.filter((e) => e.aprendizaje_id === aprendizajeId);
      const hallazgosDelFlujo = hallazgos.filter((h) => h.aprendizaje_id === aprendizajeId);

      const tablaCategorias = ejecucionesDelFlujo.map((e) => ({
        categoria: e.categoria,
        estado: e.estado,
        duracion_ms: e.finalizado_en ? Date.parse(e.finalizado_en) - Date.parse(e.iniciado_en) : null,
        ejecucion_id: e.id,
        hallazgos_por_severidad: this.contarPorSeveridad(hallazgosDelFlujo.filter((h) => h.categoria_prueba === e.categoria)),
      }));

      const anterior = await this.corridaAnteriorSobre(aprendizajeId, corrida.id, corrida.disparado_en);

      porAprendizaje[aprendizajeId] = {
        ficha: {
          aprendizaje_id: aprendizajeId,
          nombre: doc?.nombre ?? aprendizajeId,
          modulo: doc?.modulo ?? '',
          ruta: doc?.ruta ?? '',
          disparado_por: corrida.disparado_por,
          disparado_en: corrida.disparado_en,
          modo: corrida.modo,
        },
        semaforo: this.calcularEstadoConsolidado(hallazgosDelFlujo),
        tabla_categorias: tablaCategorias,
        hallazgos_priorizados: this.priorizar(hallazgosDelFlujo),
        evidencia: ejecucionesDelFlujo.flatMap((e) => e.capturas ?? []),
        comparacion_historica: anterior,
      };
    }

    return { por_aprendizaje: porAprendizaje };
  }

  private async corridaAnteriorSobre(
    aprendizajeId: string,
    corridaActualId: string,
    disparadoEnActual: string,
  ): Promise<Record<string, unknown> | null> {
    const anterior = await this.corridas
      .findOne({
        id: { $ne: corridaActualId },
        aprendizajes: aprendizajeId,
        disparado_en: { $lt: disparadoEnActual },
        estado_consolidado: { $ne: 'corriendo' },
      })
      .sort({ disparado_en: -1 })
      .lean<QaSuiteCorridaLean>();

    if (!anterior) return null;

    const infoAnterior = this.objeto(anterior.informe)['por_aprendizaje'];
    const datosAnteriores = this.objeto(this.objeto(infoAnterior)[aprendizajeId]);
    const hallazgosAnteriores = this.numero(this.objeto(datosAnteriores).hallazgos_priorizados_total) ?? 0;
    return {
      corrida_id: anterior.id,
      disparado_en: anterior.disparado_en,
      semaforo: anterior.estado_consolidado,
      hallazgos_total_anterior: Array.isArray(datosAnteriores['hallazgos_priorizados'])
        ? (datosAnteriores['hallazgos_priorizados'] as unknown[]).length
        : hallazgosAnteriores,
    };
  }

  private contarPorSeveridad(hallazgos: QaSuiteHallazgo[]): Record<string, number> {
    const conteo: Record<string, number> = { info: 0, baja: 0, media: 0, alta: 0, critica: 0 };
    for (const h of hallazgos) conteo[h.severidad] = (conteo[h.severidad] ?? 0) + 1;
    return conteo;
  }

  private priorizar(hallazgos: QaSuiteHallazgo[]): QaSuiteHallazgo[] {
    const orden: Record<string, number> = { critica: 0, alta: 1, media: 2, baja: 3, info: 4 };
    return [...hallazgos].sort((a, b) => (orden[a.severidad] ?? 9) - (orden[b.severidad] ?? 9));
  }

  private async leerEvidencia(path: string): Promise<Record<string, unknown> | null> {
    if (!path || !existsSync(path)) return null;
    try {
      const contenido = await readFile(path, 'utf8');
      const parsed = JSON.parse(contenido) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private envRunner(aprendizajeId: string, modo: ModoQaSuite): NodeJS.ProcessEnv {
    const demo = modo === 'demo';
    return {
      ...process.env,
      AUDITORIA_QA_SUITE_APRENDIZAJE: aprendizajeId,
      AUDITORIA_PLAYWRIGHT_DEMO: demo ? 'true' : 'false',
      PLAYWRIGHT_HEADLESS: demo ? 'false' : 'true',
      PLAYWRIGHT_SLOWMO_MS: demo ? process.env.PLAYWRIGHT_SLOWMO_MS ?? '1800' : '0',
    };
  }

  private serializarCorrida(doc: QaSuiteCorridaLean): Record<string, unknown> {
    const { _id, ...resto } = doc;
    void _id;
    return resto as Record<string, unknown>;
  }

  /**
   * `doc.campos` trae `nombre` en vez de `clave` y no siempre trae
   * `restriccion`. La adapta a la forma que espera el motor de derivacion.
   */
  private mapearCampos(camposCrudos: unknown): CampoCatalogo[] {
    if (!Array.isArray(camposCrudos)) return [];
    return camposCrudos.map((c) => {
      const campo = this.objeto(c);
      return {
        clave: this.texto(campo['nombre'] ?? campo['clave']),
        etiqueta: this.texto(campo['etiqueta']),
        testid: this.texto(campo['testid']),
        tipo: (this.texto(campo['tipo']) || 'texto') as CampoCatalogo['tipo'],
        obligatorio: campo['obligatorio'] !== false,
        alias: [],
        restriccion: this.objeto(campo['restriccion']),
      };
    });
  }

  private hash(valor: unknown): string {
    return createHash('sha256').update(JSON.stringify(valor)).digest('hex');
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }

  private numero(valor: unknown): number | null {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }

  private tail(valor: string): string {
    return valor.slice(-8000);
  }
}
