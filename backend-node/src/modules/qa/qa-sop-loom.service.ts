import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { Model } from 'mongoose';
import {
  EstadoQaSopLoom,
  QaSopLoomAprendizaje,
  QaSopLoomAprendizajeDocument,
} from './schemas/qa-sop-loom-aprendizaje.schema';
import {
  QaSopLoomEjecucion,
  QaSopLoomEjecucionDocument,
} from './schemas/qa-sop-loom-ejecucion.schema';
import { QaCaso, QaCasoDocument } from './schemas/qa-caso.schema';
import {
  AccionCatalogo,
  CampoCatalogo,
  PantallaCatalogo,
  accionesMencionadas,
  aplicarReglasCampos,
  buscarPantallaPorRuta,
  camposMencionados,
  datosDesdeCaso,
  filtroCasosMongo,
  mencionaAlias,
  pantallasMencionadas,
} from './qa-catalogo-elementos';
import {
  ElementoNavegado,
  InspeccionPantalla,
  QaPantallaInspectorService,
} from './qa-pantalla-inspector.service';
import { QaReglasValidacionService } from './qa-reglas-validacion.service';

type QaSopLoomLean = QaSopLoomAprendizaje & {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

/**
 * Plantilla de un paso. Los `completar` no llevan valor fijo: el valor sale del
 * caso QA que se este ejecutando en esa vuelta.
 */
export interface PasoEjecutable {
  orden: number;
  tipo: 'navegar' | 'completar' | 'click' | 'verificar' | 'verificar_fila';
  nombre: string;
  escribe: boolean;
  selector?: string;
  campo?: string;
  valor?: string;
  prefijo_fila?: string;
  espera?: { tipo: string; valor: string; timeout_ms?: number };
  verificacion?: { patron_exito: string; clase_error: string };
  origen: {
    tipo: 'navegacion';
    ref: string;
    fuente_paso?: 'sop_loom' | 'sistema';
    paso_aprendido?: number;
    alias?: string;
  };
}

/** Caso QA congelado: los datos con los que el agente va a operar la pantalla. */
interface CasoCongelado {
  id: string;
  descripcion: string;
  datos: Record<string, string>;
  id_esperado: string;
}

/**
 * Advertencia del SOP ("no marcar como activo sin confirmar...").
 * Mientras nadie decida si es una regla evaluable o un juicio del operador,
 * el aprendizaje no se puede aprobar.
 */
interface Consideracion {
  id: string;
  texto: string;
  /** null = todavia no lo decidio una persona. */
  testeable: boolean | null;
  control: 'automatico' | 'humano' | 'sin_definir';
  fuente: { tipo: 'sop_loom'; paso_aprendido?: number };
}

/**
 * Una pantalla que el SOP nombra. `cubierta` distingue la que el plan
 * ejecutable realmente opera de las que el texto menciona pero todavia no se
 * automatizan: hoy el motor compila una sola pantalla por flujo.
 */
interface PantallaRecorrida {
  orden: number;
  codigo: string;
  ruta: string;
  nombre: string;
  instrumentada: boolean;
  cubierta: boolean;
  pasos: number;
  campos: number;
  /** Id de inspección con la que pedir la foto de esta pantalla (`GET .../captura`), o '' si no hay ninguna. */
  inspeccion_id: string;
}

interface Compilacion {
  pantalla: PantallaCatalogo | null;
  campos: Record<string, unknown>[];
  acciones: string[];
  pasos_ejecutables: PasoEjecutable[];
  casos: CasoCongelado[];
  consideraciones: Consideracion[];
  pendientes: string[];
  inspeccion: InspeccionPantalla | null;
  recorrido: PantallaRecorrida[];
}

/**
 * Frases del SOP que suenan a precaucion. El agente no decide si son
 * automatizables: las marca y una persona resuelve cada una.
 */
const PATRONES_GUARDA = [
  /\bno\s+(?:marcar|marques|olvides|cierres|confirmes|apruebes|elimines)\b/i,
  /\bnunca\b/i,
  /\bcuidado\b/i,
  /\bprecauci[oó]n\b/i,
  /\batenci[oó]n\b/i,
  /\bimportante\b/i,
  /\bverific[aá]\s+antes\b/i,
  /\basegur[aá]te\s+de\b/i,
  /\bsolo\s+(?:si|cuando)\b/i,
  /\búnicamente\s+(?:si|cuando)\b/i,
  /\bsiempre\s+que\b/i,
  /\brevis[aá]\s+(?:manualmente|con)\b/i,
];

@Injectable()
export class QaSopLoomService {
  private readonly procesos = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(
    @InjectModel(QaSopLoomAprendizaje.name) private readonly aprendizajes: Model<QaSopLoomAprendizajeDocument>,
    @InjectModel(QaCaso.name) private readonly casos: Model<QaCasoDocument>,
    @Optional() private readonly inspector?: QaPantallaInspectorService,
    @Optional() private readonly reglasValidacion?: QaReglasValidacionService,
    @Optional() @InjectModel(QaSopLoomEjecucion.name) private readonly ejecucionesHistorial?: Model<QaSopLoomEjecucionDocument>,
  ) {}

  async listar(): Promise<Record<string, unknown>[]> {
    await this.reconciliarEjecucionesInterrumpidas();
    const docs = await this.aprendizajes
      .find({ activo: { $ne: false } })
      .sort({ updatedAt: -1 })
      .lean<QaSopLoomLean[]>();
    return docs.map((doc) => this.serializar(doc));
  }

  /**
   * Baja logica, como el resto del sistema: el aprendizaje sale del listado
   * pero queda el registro de lo que se aprobo y ejecuto. Volver a guardarlo
   * con el mismo id lo reactiva.
   */
  async eliminar(idEntrada: string): Promise<{ id: string; activo: false }> {
    const id = this.texto(idEntrada);
    const enCurso = this.procesos.get(id);
    if (enCurso && !enCurso.killed) {
      throw new ConflictException(`El aprendizaje ${id} se está ejecutando: esperá a que termine para eliminarlo.`);
    }

    const doc = await this.aprendizajes
      .findOneAndUpdate({ id, activo: { $ne: false } }, { $set: { activo: false } }, { new: true })
      .lean<QaSopLoomLean>();
    if (!doc) throw new NotFoundException('Aprendizaje SOP Loom inexistente.');
    return { id, activo: false };
  }

  async obtener(id: string): Promise<Record<string, unknown>> {
    const doc = await this.buscar(id);
    return this.serializar(doc);
  }

  async guardar(body: unknown): Promise<Record<string, unknown>> {
    const entrada = this.objeto(body);
    const descripcion = this.texto(entrada['descripcionVideo'] ?? entrada['descripcion_video']);
    const nombre = this.texto(entrada['nombre'] ?? entrada['nombrePantalla']);
    const ruta = this.normalizarRuta(this.texto(entrada['ruta']));
    const modulo = this.texto(entrada['modulo']) || 'QA';
    const objetivo = this.texto(entrada['objetivo']);
    const criterio = this.texto(entrada['criterioAceptacion'] ?? entrada['criterio_aceptacion']);
    const pasos = this.arrayObjetos(entrada['pasos']);
    const casosSeleccionados = this.arrayTexto(entrada['casosSeleccionados'] ?? entrada['casos_seleccionados']);
    const ordenManualPasos = this.arrayTexto(entrada['ordenManualPasos'] ?? entrada['orden_manual_pasos']);
    if (!this.inspector) throw new InternalServerErrorException('El inspector de pantallas no está disponible.');
    const inspeccion = await this.inspector.resolver(
      entrada['inspeccionId'] ?? entrada['inspeccion_id'],
      ruta,
    );

    // Los selectores nacen de una navegación real. El catálogo conserva solo
    // semántica de negocio y la fuente de datos de cada pantalla.
    const compilacion = await this.compilar({
      ruta,
      descripcion,
      pasos,
      casosSeleccionados,
      inspeccion,
      consideracionesDecididas: this.arrayObjetos(entrada['consideraciones']),
      ordenManualPasos,
    });
    const pasosResueltos = pasos.map((paso, indice) => {
      const orden = Number(paso['orden']) || indice + 1;
      const ejecutable = compilacion.pasos_ejecutables.find(
        (item) => item.origen.paso_aprendido === orden && item.selector,
      );
      const selector = ejecutable?.selector
        ?? (orden === 1 ? compilacion.pantalla?.selectores['pagina'] : undefined);

      return {
        ...paso,
        ruta,
        selectorSugerido: selector || 'resuelto por navegación',
        fuente_selector: {
          tipo: 'navegacion',
          ref: inspeccion.id,
          hash: inspeccion.hash,
        },
      };
    });

    const pendientes = [
      ...this.pendientesBase({
        nombre,
        ruta,
        objetivo,
        criterio,
        descripcion,
        pasos,
        loomRef: this.texto(entrada['loomRef'] ?? entrada['loom_ref']),
      }),
      ...compilacion.pendientes,
    ];
    const estado = this.estadoDesdeEntrada(entrada['estado'], pendientes);
    const id = this.texto(entrada['id']) || this.idDesde(nombre || ruta || 'pantalla');
    const creadoEn = this.texto(entrada['creadoEn'] ?? entrada['creado_en']) || new Date().toISOString();
    const base = {
      id,
      nombre,
      modulo,
      ruta,
      rol: this.texto(entrada['rol']) || 'qa',
      entorno: this.texto(entrada['entorno']) || 'sandbox',
      estado,
      creado_en: creadoEn,
      loom_ref: this.texto(entrada['loomRef'] ?? entrada['loom_ref']),
      objetivo,
      criterio_aceptacion: criterio,
      descripcion_video: descripcion,
      pasos: pasosResueltos,
      campos: compilacion.campos,
      acciones: compilacion.acciones,
      consideraciones: compilacion.consideraciones,
      pendientes,
      casos_seleccionados: casosSeleccionados,
      orden_manual_pasos: ordenManualPasos,
      inspeccion_navegacion: inspeccion,
      // Guardar de nuevo un aprendizaje dado de baja lo reactiva.
      activo: true,
    };
    const definicion = this.definicionEjecutable(base, compilacion);

    // Se conserva solo la firma cuya mitad no cambió al recompilar: un ajuste
    // de selector no invalida la firma de negocio, y viceversa.
    const previo = await this.aprendizajes.findOne({ id }).lean<QaSopLoomLean>();
    const firmas = previo
      ? this.firmasVigentes({ ...previo, definicion_ejecutable: definicion })
      : { negocio: null, tecnica: null };
    const aprobado = Boolean(firmas['negocio'] && firmas['tecnica']);
    const estadoFinal = pendientes.length > 0 ? 'revisar' : aprobado ? 'aprobado' : estado;

    // `id` ya viaja dentro de `base`. Repetirlo en `$setOnInsert` hace que Mongo
    // rechace el update con "would create a conflict at 'id'".
    const doc = await this.aprendizajes.findOneAndUpdate(
      { id },
      {
        $set: {
          ...base,
          estado: estadoFinal,
          definicion_ejecutable: definicion,
          firmas,
          ...(aprobado ? {} : { aprobacion: null }),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean<QaSopLoomLean>();

    if (!doc) throw new InternalServerErrorException('No pude guardar el aprendizaje SOP Loom.');
    return this.serializar(doc);
  }

  /**
   * Firma una de las dos mitades. Un cambio en la mitad técnica invalida solo
   * la firma técnica y uno de negocio solo la de negocio, así un ajuste de
   * selector no obliga a molestar a consultoría (arquitectura §8).
   */
  async firmar(idEntrada: string, tipoEntrada: unknown, usuario: unknown): Promise<Record<string, unknown>> {
    const tipo = this.texto(tipoEntrada).toLowerCase();
    if (tipo !== 'negocio' && tipo !== 'tecnica') {
      throw new BadRequestException('La firma debe ser "negocio" o "tecnica".');
    }

    const doc = await this.buscar(idEntrada);
    const pendientes = this.arrayTexto(doc.pendientes);
    if (pendientes.length > 0) {
      throw new BadRequestException({
        message: 'No se puede firmar un aprendizaje con pendientes.',
        pendientes,
      });
    }

    const definicion = this.objeto(doc.definicion_ejecutable);
    const inspeccion = this.objeto(doc.inspeccion_navegacion);
    const faltantes = this.requisitosParaFirmar(tipo, definicion, inspeccion);
    if (faltantes.length > 0) {
      throw new BadRequestException({
        message: `No se puede firmar la mitad ${tipo} todavía.`,
        pendientes: faltantes,
      });
    }

    const firmas = this.firmasVigentes(doc);
    firmas[tipo] = {
      por: this.usuarioTexto(usuario),
      rol: this.usuarioRol(usuario),
      en: new Date().toISOString(),
      hash: this.hashMitad(tipo, definicion),
      alcance: tipo === 'tecnica'
        ? ['ruta', 'selectores', 'pasos', 'inspeccion']
        : ['objetivo', 'criterio_aceptacion', 'casos', 'consideraciones'],
      ...(tipo === 'tecnica'
        ? {
          inspeccion_id: this.texto(inspeccion['id']),
          hash_navegacion: this.texto(inspeccion['hash']),
        }
        : {}),
    };

    const completa = Boolean(firmas['negocio'] && firmas['tecnica']);
    const actualizado = await this.aprendizajes.findOneAndUpdate(
      { id: doc.id },
      {
        $set: {
          firmas,
          estado: completa ? 'aprobado' : 'listo',
          // Compat: el runner y las corridas viejas leen `aprobacion`.
          aprobacion: completa
            ? {
              por: this.texto(this.objeto(firmas['tecnica'])['por']),
              rol: this.texto(this.objeto(firmas['tecnica'])['rol']),
              en: new Date().toISOString(),
              hash_definicion: this.hash(definicion),
              tipo: 'doble_firma',
              inspeccion_id: this.texto(inspeccion['id']),
              hash_navegacion: this.texto(inspeccion['hash']),
              alcance: ['negocio', 'tecnica'],
            }
            : null,
        },
      },
      { new: true },
    ).lean<QaSopLoomLean>();
    if (!actualizado) throw new InternalServerErrorException('No pude firmar el aprendizaje SOP Loom.');
    return this.serializar(actualizado);
  }

  private requisitosParaFirmar(
    tipo: 'negocio' | 'tecnica',
    definicion: Record<string, unknown>,
    inspeccion: Record<string, unknown>,
  ): string[] {
    const faltantes: string[] = [];

    if (tipo === 'tecnica') {
      if (!this.texto(inspeccion['id']) || !this.texto(inspeccion['hash'])) {
        faltantes.push('Falta una inspección real del sandbox.');
      }
      const pasos = Array.isArray(definicion['pasos_ejecutables']) ? definicion['pasos_ejecutables'] : [];
      if (pasos.length === 0) faltantes.push('No hay pasos ejecutables compilados.');
      if (!this.texto(this.objeto(definicion['rutas'])['pantalla_objetivo'])) {
        faltantes.push('No hay pantalla objetivo resuelta.');
      }
      return faltantes;
    }

    const casos = Array.isArray(definicion['casos']) ? definicion['casos'] : [];
    if (casos.length === 0) faltantes.push('No hay casos QA con los que operar la pantalla.');
    if (!this.texto(this.objeto(definicion['valores'])['criterio_aceptacion'])) {
      faltantes.push('Falta el criterio de aceptación.');
    }
    const sinDefinir = this.arrayObjetos(definicion['consideraciones'])
      .filter((item) => this.texto(item['control']) === 'sin_definir');
    if (sinDefinir.length > 0) {
      faltantes.push('Hay guardas del SOP sin decidir si son testeables.');
    }
    return faltantes;
  }

  /** Firmas actuales, descartando las que ya no corresponden a la definición. */
  private firmasVigentes(doc: QaSopLoomLean): Record<string, Record<string, unknown> | null> {
    const definicion = this.objeto(doc.definicion_ejecutable);
    const guardadas = this.objeto(doc.firmas);
    const resultado: Record<string, Record<string, unknown> | null> = { negocio: null, tecnica: null };

    for (const tipo of ['negocio', 'tecnica'] as const) {
      const firma = this.objeto(guardadas[tipo]);
      if (!this.texto(firma['por'])) continue;
      if (this.texto(firma['hash']) !== this.hashMitad(tipo, definicion)) continue;
      resultado[tipo] = firma;
    }

    // Migración: una aprobación previa al modelo de doble firma vale como técnica.
    const legado = this.objeto(doc.aprobacion);
    if (!resultado['tecnica'] && this.texto(legado['por']) && this.texto(legado['tipo']) === 'tecnica') {
      if (this.texto(legado['hash_definicion']) === this.hash(definicion)) {
        resultado['tecnica'] = {
          ...legado,
          hash: this.hashMitad('tecnica', definicion),
          migrada_de: 'aprobacion_v3',
        };
      }
    }

    return resultado;
  }

  /**
   * Hash de la mitad que firma cada rol. Separarlos es lo que permite que un
   * ajuste de selector no invalide la firma de negocio, y viceversa.
   */
  private hashMitad(tipo: 'negocio' | 'tecnica', definicion: Record<string, unknown>): string {
    const valores = this.objeto(definicion['valores']);
    const contenido = tipo === 'tecnica'
      ? {
        rutas: definicion['rutas'],
        selectores: definicion['selectores'],
        pasos_ejecutables: definicion['pasos_ejecutables'],
        navegacion: this.objeto(this.objeto(definicion['fuentes'])['navegacion'])['hash'] ?? '',
      }
      : {
        objetivo: valores['objetivo'] ?? '',
        criterio_aceptacion: valores['criterio_aceptacion'] ?? '',
        casos: definicion['casos'],
        consideraciones: definicion['consideraciones'],
        fuente_datos: definicion['fuente_datos'],
      };
    return this.hash(contenido);
  }

  async ejecutar(
    idEntrada: string,
    modoEntrada: unknown,
    cookieHeader?: string,
  ): Promise<Record<string, unknown>> {
    const doc = await this.buscar(idEntrada);
    if (doc.estado !== 'aprobado') {
      throw new BadRequestException('El aprendizaje SOP Loom debe estar aprobado antes de ejecutar el agente.');
    }
    const aprobacion = this.objeto(doc.aprobacion);
    const hashDefinicion = this.hash(this.objeto(doc.definicion_ejecutable));
    if (this.texto(aprobacion['hash_definicion']) !== hashDefinicion) {
      throw new BadRequestException('La definición cambió después de aprobarse. Volvé a revisarla y aprobarla.');
    }
    const inspeccionAprobada = this.objeto(doc.inspeccion_navegacion);
    if (this.texto(aprobacion['hash_navegacion']) !== this.texto(inspeccionAprobada['hash'])) {
      throw new BadRequestException('La inspección navegada no coincide con la aprobación técnica vigente.');
    }

    const activo = this.procesos.get(doc.id);
    if (activo && !activo.killed) {
      throw new ConflictException(`El aprendizaje ${doc.id} ya se está ejecutando.`);
    }

    if (!this.inspector) throw new InternalServerErrorException('El inspector de pantallas no está disponible.');
    const revalidacion = await this.inspector.revalidar(doc.inspeccion_navegacion, cookieHeader);
    if (!revalidacion.coincide) {
      throw new BadRequestException({
        message: 'La pantalla cambió desde la aprobación. Inspeccioná, guardá y aprobá nuevamente el flujo.',
        cambios: revalidacion.cambios,
        hash_anterior: revalidacion.hash_anterior,
        hash_actual: revalidacion.hash_actual,
      });
    }

    // Antes de abrir un navegador: el set de casos aprobado tiene que seguir
    // siendo el que hay hoy. Falla rapido y con la causa, no despues de spawnear.
    const desvios = await this.revalidarCasosCongelados(doc);
    if (desvios.length > 0) {
      throw new BadRequestException({
        message: 'Los casos cambiaron desde la aprobación. Volvé a guardar y aprobar el aprendizaje.',
        desvios,
      });
    }

    const scriptPath = join(process.cwd(), 'scripts', 'run-qa-sop-loom-playwright.mjs');
    if (!existsSync(scriptPath)) {
      throw new InternalServerErrorException(`No encontré el runner SOP Loom en ${scriptPath}.`);
    }

    const modo = this.texto(modoEntrada) === 'demo' ? 'demo' : 'rapido';
    const ejecucionId = `QA-SOP-RUN-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const args = modo === 'demo' ? [scriptPath, '--demo'] : [scriptPath];
    const comando = {
      binario: process.execPath,
      script: scriptPath,
      version_script: 'run-qa-sop-loom-playwright@2',
      args: args.slice(1),
      cwd: process.cwd(),
    };

    const iniciadaEn = new Date().toISOString();
    await this.aprendizajes.updateOne(
      { id: doc.id },
      {
        $set: {
          ultima_ejecucion: {
            id: ejecucionId,
            estado: 'corriendo',
            modo,
            iniciada_en: iniciadaEn,
            comando,
          },
        },
      },
    );

    // `ultima_ejecucion` se pisa en cada corrida: este registro aparte es lo
    // que permite despues contar cuantas veces se corrio cada pantalla.
    const definicion = this.objeto(doc.definicion_ejecutable);
    await this.ejecucionesHistorial?.create({
      id: ejecucionId,
      aprendizaje_id: doc.id,
      ruta: doc.ruta,
      pantalla_nombre: buscarPantallaPorRuta(doc.ruta)?.nombre || doc.nombre,
      modo,
      estado: 'corriendo',
      iniciada_en: iniciadaEn,
      casos_count: this.arrayObjetos(definicion['casos']).length,
    }).catch(() => undefined);

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: this.envRunner(doc.id, modo),
      windowsHide: true,
    });

    this.procesos.set(doc.id, child);
    this.observarProceso(child, doc.id, ejecucionId, modo);

    const actualizado = await this.buscar(doc.id);
    return this.serializar(actualizado);
  }

  private observarProceso(child: ChildProcessWithoutNullStreams, aprendizajeId: string, ejecucionId: string, modo: string): void {
    let stdout = '';
    let stderr = '';
    let finalizado = false;
    const maxMs = modo === 'demo' ? 10 * 60 * 1000 : 4 * 60 * 1000;
    const timer = setTimeout(() => {
      child.kill();
      finalizar(null, new Error('El runner SOP Loom excedió el tiempo máximo.'));
    }, maxMs);
    timer.unref?.();

    const finalizar = (code: number | null, error: Error | null) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer);
      this.procesos.delete(aprendizajeId);
      void this.finalizarEjecucion(aprendizajeId, ejecucionId, stdout, stderr, code, error);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = this.tail(`${stdout}${chunk}`);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = this.tail(`${stderr}${chunk}`);
    });
    child.on('error', (error) => finalizar(null, error));
    child.on('close', (code) => finalizar(code, null));
  }

  private async finalizarEjecucion(
    aprendizajeId: string,
    ejecucionId: string,
    stdout: string,
    stderr: string,
    exitCode: number | null,
    error: Error | null,
  ): Promise<void> {
    const salida = `${stdout}\n${stderr}`;
    const verde = /QA SOP Loom Playwright:\s*verde/i.test(salida) && exitCode === 0;
    const evidenciaPath = /-\s*evidencia=(.+)/i.exec(salida)?.[1]?.trim() ?? '';
    // El runner emite `- detalle=...` tanto al terminar bien como al fallar, asi
    // la causa real llega a la UI en vez de un generico "codigo 1".
    const detalle = /-\s*detalle=(.+)$/im.exec(salida)?.[1]?.trim()
      || /-\s*(?:VERDE|ROJO)\s+[^:]+:\s+(.+)$/im.exec(salida)?.[1]?.trim()
      || error?.message
      || (verde ? 'Aprendizaje ejecutado correctamente.' : `Runner finalizó con código ${exitCode ?? 'sin código'}.`);

    const finalizadaEn = new Date().toISOString();
    await this.aprendizajes.updateOne(
      { id: aprendizajeId, 'ultima_ejecucion.id': ejecucionId },
      {
        $set: {
          ultima_ejecucion: {
            id: ejecucionId,
            estado: verde ? 'verde' : 'rojo',
            finalizada_en: finalizadaEn,
            exit_code: exitCode,
            detalle,
            evidencia_path: evidenciaPath,
            stdout_tail: this.tail(stdout),
            stderr_tail: this.tail(stderr),
          },
        },
      },
    );

    await this.ejecucionesHistorial?.updateOne(
      { id: ejecucionId },
      {
        $set: {
          estado: verde ? 'verde' : 'rojo',
          finalizada_en: finalizadaEn,
          exit_code: exitCode,
          detalle,
          evidencia_path: evidenciaPath,
        },
      },
    ).catch(() => undefined);
  }

  private async buscar(id: string): Promise<QaSopLoomLean> {
    await this.reconciliarEjecucionesInterrumpidas();
    // Un aprendizaje dado de baja no se puede abrir, aprobar ni ejecutar.
    const doc = await this.aprendizajes
      .findOne({ id: this.texto(id), activo: { $ne: false } })
      .lean<QaSopLoomLean>();
    if (!doc) throw new NotFoundException('Aprendizaje SOP Loom inexistente.');
    return doc;
  }

  /**
   * En desarrollo el watcher puede reiniciar Nest mientras un Playwright hijo
   * sigue o termina por su cuenta. El nuevo proceso ya no puede observarlo, por
   * lo que una corrida sin proceso local se cierra como interrumpida en vez de
   * quedar eternamente en estado `corriendo`.
   */
  private async reconciliarEjecucionesInterrumpidas(): Promise<void> {
    const idsActivos = Array.from(this.procesos.entries())
      .filter(([, proceso]) => !proceso.killed)
      .map(([id]) => id);
    const filtro: Record<string, unknown> = { 'ultima_ejecucion.estado': 'corriendo' };
    if (idsActivos.length > 0) filtro['id'] = { $nin: idsActivos };

    const detalleInterrupcion = 'Ejecución interrumpida porque el backend se reinició o perdió el proceso Playwright.';
    const finalizadaEn = new Date().toISOString();
    await this.aprendizajes.updateMany(
      filtro,
      {
        $set: {
          'ultima_ejecucion.estado': 'rojo',
          'ultima_ejecucion.finalizada_en': finalizadaEn,
          'ultima_ejecucion.detalle': detalleInterrupcion,
          'ultima_ejecucion.exit_code': null,
        },
      },
    );

    const filtroHistorial: Record<string, unknown> = { estado: 'corriendo' };
    if (idsActivos.length > 0) filtroHistorial['aprendizaje_id'] = { $nin: idsActivos };
    await this.ejecucionesHistorial?.updateMany(
      filtroHistorial,
      { $set: { estado: 'rojo', finalizada_en: finalizadaEn, detalle: detalleInterrupcion, exit_code: null } },
    ).catch(() => undefined);
  }

  /**
   * Convierte el flujo aprendido en prosa a pasos ejecutables contra la pantalla
   * real. El orden lo manda el SOP: se recorren los pasos aprendidos y por cada
   * uno se emiten los `completar` y `click` que ese paso menciona.
   */
  private async compilar(entrada: {
    ruta: string;
    descripcion: string;
    pasos: Record<string, unknown>[];
    casosSeleccionados: string[];
    inspeccion: InspeccionPantalla | null;
    consideracionesDecididas?: Record<string, unknown>[];
    ordenManualPasos?: string[];
  }): Promise<Compilacion> {
    const guardas = this.detectarConsideraciones(
      entrada.descripcion,
      entrada.pasos,
      entrada.consideracionesDecididas ?? [],
    );
    // El recorrido sale del texto completo del SOP (descripcion + pasos), no de
    // la ruta inspeccionada: es lo que deja ver que un flujo nombra mas de una
    // pantalla aunque el plan todavia compile una sola.
    const mencionadas = pantallasMencionadas(this.textoDelSop(entrada.descripcion, entrada.pasos));
    const vacia: Compilacion = {
      pantalla: null,
      campos: [],
      acciones: [],
      pasos_ejecutables: [],
      casos: [],
      consideraciones: guardas.consideraciones,
      pendientes: [],
      inspeccion: entrada.inspeccion,
      recorrido: await this.recorridoDePantallas(mencionadas, null, 0, 0),
    };

    if (!entrada.ruta) {
      return { ...vacia, pendientes: ['No se pudo determinar la ruta de la pantalla.'] };
    }
    if (!entrada.inspeccion) {
      return {
        ...vacia,
        pendientes: ['Primero inspeccioná la pantalla real del sandbox para obtener rutas y selectores.'],
      };
    }
    const inspeccion = entrada.inspeccion;
    const resolucion = this.pantallaDesdeNavegacion(entrada.ruta, inspeccion);
    const pantallaBase = resolucion.pantalla;
    if (!pantallaBase) {
      return {
        ...vacia,
        pendientes: resolucion.pendientes,
      };
    }
    // Las reglas de validación (obligatorio/formato) que una persona haya
    // ajustado pisan el default del catálogo, por pantalla o global (§ reglas).
    const reglas = this.reglasValidacion ? await this.reglasValidacion.listarResueltas() : [];
    const pantalla = aplicarReglasCampos(pantallaBase, reglas);

    const pendientes: string[] = [...resolucion.pendientes, ...guardas.pendientes];
    const pasosEjecutables: PasoEjecutable[] = [];
    const camposCubiertos = new Map<string, CampoCatalogo>();
    const accionesUsadas = new Set<string>();

    // Los datos salen de los casos QA cargados en la propia pantalla.
    const { casos, pendientes: pendientesCasos } = await this.casosDeLaPantalla(
      pantalla,
      entrada.casosSeleccionados,
    );
    pendientes.push(...pendientesCasos);

    pasosEjecutables.push({
      orden: 1,
      tipo: 'navegar',
      nombre: `Abrir ${pantalla.nombre}`,
      escribe: false,
      valor: pantalla.ruta,
      espera: { tipo: 'elemento', valor: pantalla.selectores['pagina'], timeout_ms: 30000 },
      origen: {
        tipo: 'navegacion',
        ref: inspeccion.id,
        fuente_paso: 'sistema',
      },
    });

    const emitirCampo = (campo: CampoCatalogo, origenPaso: number | undefined, alias: string): void => {
      if (camposCubiertos.has(campo.clave)) return;
      camposCubiertos.set(campo.clave, campo);
      pasosEjecutables.push({
        orden: pasosEjecutables.length + 1,
        tipo: 'completar',
        nombre: `Completar ${campo.etiqueta}`,
        escribe: false,
        selector: `[data-testid="${campo.testid}"]`,
        campo: campo.clave,
        origen: {
          tipo: 'navegacion',
          ref: inspeccion.id,
          fuente_paso: 'sop_loom',
          paso_aprendido: origenPaso,
          alias,
        },
      });
    };

    const emitirAccion = (accion: AccionCatalogo, origenPaso: number | undefined, alias: string): void => {
      if (accionesUsadas.has(accion.clave)) return;
      accionesUsadas.add(accion.clave);
      pasosEjecutables.push({
        orden: pasosEjecutables.length + 1,
        tipo: 'click',
        nombre: accion.etiqueta,
        escribe: accion.escribe,
        selector: `[data-testid="${accion.testid}"]`,
        espera: accion.espera,
        origen: {
          tipo: 'navegacion',
          ref: inspeccion.id,
          fuente_paso: 'sop_loom',
          paso_aprendido: origenPaso,
          alias,
        },
      });
    };

    for (const paso of entrada.pasos) {
      const texto = this.texto(paso['accion'] ?? paso['texto'] ?? paso['nombre']);
      if (!texto) continue;
      const orden = Number(paso['orden']) || undefined;

      for (const { campo, alias } of camposMencionados(pantalla, texto)) {
        emitirCampo(campo, orden, alias);
      }
      for (const { accion, alias } of accionesMencionadas(pantalla, texto)) {
        // "Importar" abre un selector de archivo del sistema operativo: se
        // registra como aprendido pero no se automatiza sin ruta de archivo.
        if (accion.clave === 'importar') {
          pendientes.push(
            'El flujo menciona importar un archivo. Ese paso necesita una ruta de archivo real antes de automatizarse.',
          );
          continue;
        }
        emitirAccion(accion, orden, alias);
      }
    }

    // Un campo obligatorio que el SOP no nombro igual hay que completarlo, y
    // siempre antes del primer paso que escribe.
    const faltantesObligatorios = pantalla.campos.filter(
      (campo) => campo.obligatorio && !camposCubiertos.has(campo.clave),
    );
    if (faltantesObligatorios.length > 0) {
      const antesDe = pasosEjecutables.findIndex((paso) => paso.tipo === 'click' && paso.escribe);
      const insertados: PasoEjecutable[] = faltantesObligatorios.map((campo) => {
        camposCubiertos.set(campo.clave, campo);
        return {
          orden: 0,
          tipo: 'completar' as const,
          nombre: `Completar ${campo.etiqueta}`,
          escribe: false,
          selector: `[data-testid="${campo.testid}"]`,
          campo: campo.clave,
          origen: {
            tipo: 'navegacion' as const,
            ref: inspeccion.id,
            fuente_paso: 'sistema' as const,
          },
        };
      });
      const posicion = antesDe >= 0 ? antesDe : pasosEjecutables.length;
      pasosEjecutables.splice(posicion, 0, ...insertados);
    }

    const escribeAlgo = pasosEjecutables.some((paso) => paso.tipo === 'click' && paso.escribe);
    if (escribeAlgo && pantalla.verificacion) {
      pasosEjecutables.push({
        orden: 0,
        tipo: 'verificar',
        nombre: 'Verificar mensaje de resultado',
        escribe: false,
        selector: pantalla.verificacion.selector,
        verificacion: {
          patron_exito: pantalla.verificacion.patron_exito,
          clase_error: pantalla.verificacion.clase_error,
        },
        origen: {
          tipo: 'navegacion',
          ref: inspeccion.id,
          fuente_paso: 'sistema',
        },
      });
    }
    if (escribeAlgo && pantalla.fuente_casos?.prefijo_fila) {
      pasosEjecutables.push({
        orden: 0,
        tipo: 'verificar_fila',
        nombre: 'Verificar que el caso aparezca en el listado',
        escribe: false,
        prefijo_fila: pantalla.fuente_casos.prefijo_fila,
        origen: {
          tipo: 'navegacion',
          ref: inspeccion.id,
          fuente_paso: 'sistema',
        },
      });
    }

    // Reordena solo los pasos `completar` según lo que una persona haya
    // arrastrado en el Plan ejecutable (ej: CUIL antes que DNI). Los demás
    // pasos (navegar, click, verificar) conservan su posición.
    const pasosOrdenados = this.aplicarOrdenManual(pasosEjecutables, entrada.ordenManualPasos ?? []);
    pasosOrdenados.forEach((paso, indice) => {
      paso.orden = indice + 1;
    });

    if (!escribeAlgo) {
      pendientes.push(
        'El flujo no incluye ninguna accion que guarde. Indicá en el texto qué botón cierra la operación.',
      );
    }

    // `restriccion` es la que declara el catalogo (mas lo que haya pisado una
    // regla de validacion via aplicarReglasCampos, unas lineas arriba): sin
    // ella, la Suite de Calidad deriva valores de prueba genericos que no
    // pasan la validacion real del formulario (ver Fase 6 del plan de la
    // Suite en docs/plan_suite_calidad.md).
    const campos = Array.from(camposCubiertos.values()).map((campo) => ({
      nombre: campo.clave,
      etiqueta: campo.etiqueta,
      tipo: campo.tipo,
      obligatorio: campo.obligatorio,
      testid: campo.testid,
      alias: campo.alias,
      restriccion: campo.restriccion ?? null,
      fuente: {
        tipo: 'navegacion',
        ref: inspeccion.id,
        hash: inspeccion.hash,
      },
    }));

    const recorrido = await this.recorridoDePantallas(
      mencionadas,
      pantalla,
      pasosOrdenados.length,
      campos.length,
      inspeccion.id,
    );
    pendientes.push(...this.pendientesDeRecorrido(recorrido));

    return {
      pantalla,
      campos,
      acciones: Array.from(accionesUsadas),
      pasos_ejecutables: pasosOrdenados,
      casos,
      consideraciones: guardas.consideraciones,
      pendientes,
      inspeccion,
      recorrido,
    };
  }

  /** Texto completo del SOP: la descripcion mas la prosa de cada paso. */
  private textoDelSop(descripcion: string, pasos: Record<string, unknown>[]): string {
    return [
      descripcion,
      ...pasos.map((paso) => this.texto(paso['accion'] ?? paso['texto'] ?? paso['nombre'])),
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Arma el recorrido de pantallas del flujo. La pantalla que el plan compila
   * va primera aunque el texto no la nombre (puede venir de la ruta elegida a
   * mano) y queda marcada como cubierta; el resto son pantallas que el SOP
   * nombra pero que todavia no se automatizan.
   */
  private async recorridoDePantallas(
    mencionadas: Array<{ pantalla: PantallaCatalogo }>,
    compilada: PantallaCatalogo | null,
    pasos: number,
    campos: number,
    inspeccionIdCompilada = '',
  ): Promise<PantallaRecorrida[]> {
    const rutaCompilada = compilada ? this.normalizarRuta(compilada.ruta) : '';
    const pantallas = mencionadas.map((item) => item.pantalla);
    if (compilada && !pantallas.some((item) => this.normalizarRuta(item.ruta) === rutaCompilada)) {
      pantallas.unshift(compilada);
    }

    return Promise.all(pantallas.map(async (pantalla, indice) => {
      const cubierta = rutaCompilada !== '' && this.normalizarRuta(pantalla.ruta) === rutaCompilada;
      // La pantalla que el plan cubre ya trae su propia inspección recién
      // resuelta; el resto, si alguna vez se inspeccionó, presta prestada la
      // última foto que quedó en disco. Sin ninguna de las dos, no hay imagen.
      const inspeccionId = cubierta
        ? inspeccionIdCompilada
        : (await this.inspector?.ultimaConCaptura(pantalla.ruta).catch(() => null)) ?? '';
      return {
        orden: indice + 1,
        codigo: pantalla.codigo,
        ruta: pantalla.ruta,
        nombre: pantalla.nombre,
        instrumentada: pantalla.instrumentada,
        cubierta,
        pasos: cubierta ? pasos : 0,
        campos: cubierta ? campos : 0,
        inspeccion_id: inspeccionId,
      };
    }));
  }

  /**
   * Una pantalla nombrada que el plan no cubre no es un error del SOP: es un
   * limite del motor, que hoy compila una sola pantalla por flujo. Se avisa
   * para que nadie asuma que el salto entre pantallas ya se automatiza.
   */
  private pendientesDeRecorrido(recorrido: PantallaRecorrida[]): string[] {
    const cubierta = recorrido.find((pantalla) => pantalla.cubierta);
    return recorrido
      .filter((pantalla) => !pantalla.cubierta)
      .map((pantalla) => (pantalla.instrumentada
        ? `El SOP también nombra ${pantalla.nombre} (${pantalla.ruta}), pero el plan ejecutable cubre una sola pantalla${cubierta ? ` (${cubierta.nombre})` : ''}. El salto entre pantallas todavía no se automatiza.`
        : `El SOP nombra ${pantalla.nombre} (${pantalla.ruta}), que todavía no expone data-testid. Hay que instrumentarla antes de poder automatizarla.`));
  }

  /**
   * Reordena los pasos `completar` según `ordenManual` (claves
   * `completar:<campo>`), conservando la posición exacta de los demás pasos
   * (navegar, click, verificar). Los `completar` no mencionados en el orden
   * manual se agregan al final del grupo, en su orden original, para no
   * perder campos nuevos que el SOP haya sumado después.
   */
  private aplicarOrdenManual(pasos: PasoEjecutable[], ordenManual: string[]): PasoEjecutable[] {
    if (ordenManual.length === 0) return pasos;

    const claveDe = (paso: PasoEjecutable): string | null =>
      paso.tipo === 'completar' && paso.campo ? `completar:${paso.campo}` : null;

    const porClave = new Map<string, PasoEjecutable>();
    for (const paso of pasos) {
      const clave = claveDe(paso);
      if (clave) porClave.set(clave, paso);
    }

    const enOrdenManual = ordenManual
      .map((clave) => porClave.get(clave))
      .filter((paso): paso is PasoEjecutable => Boolean(paso));
    const restantes = pasos.filter((paso) => {
      const clave = claveDe(paso);
      return clave !== null && !ordenManual.includes(clave);
    });
    const cola = [...enOrdenManual, ...restantes];

    let cursor = 0;
    return pasos.map((paso) => (claveDe(paso) === null ? paso : cola[cursor++] ?? paso));
  }

  /**
   * La navegación es la autoridad técnica. El catálogo aporta únicamente la
   * semántica conocida (clave de negocio, obligatoriedad y fuente de casos).
   * Si un testid cambia, se asocia por etiqueta/nombre observado y se conserva
   * el selector realmente leído por Playwright.
   */
  private pantallaDesdeNavegacion(
    ruta: string,
    inspeccion: InspeccionPantalla,
  ): { pantalla: PantallaCatalogo | null; pendientes: string[] } {
    const pendientes: string[] = [];
    if (this.normalizarRuta(inspeccion.ruta) !== this.normalizarRuta(ruta)) {
      return {
        pantalla: null,
        pendientes: [`La inspección ${inspeccion.id} corresponde a ${inspeccion.ruta}, no a ${ruta}.`],
      };
    }

    const elementos = inspeccion.elementos.filter((elemento) => elemento.visible && elemento.testid);
    if (elementos.length === 0) {
      return { pantalla: null, pendientes: [`La inspección ${inspeccion.id} no encontró data-testid visibles.`] };
    }

    const catalogada = buscarPantallaPorRuta(ruta);
    if (!catalogada) {
      const generica = this.pantallaGenericaDesdeNavegacion(ruta, inspeccion, elementos);
      pendientes.push(
        `La ruta ${ruta} fue descubierta, pero todavía no tiene una fuente de casos QA registrada para aportar datos de ejecución.`,
      );
      return { pantalla: generica, pendientes };
    }

    const campos: CampoCatalogo[] = [];
    for (const campo of catalogada.campos) {
      const elemento = this.elementoParaCampo(campo, elementos);
      if (!elemento) {
        if (campo.obligatorio) pendientes.push(`No se encontró en pantalla el campo obligatorio ${campo.etiqueta}.`);
        continue;
      }
      campos.push({
        ...campo,
        testid: elemento.testid,
        etiqueta: elemento.etiqueta || campo.etiqueta,
        alias: Array.from(new Set([
          ...campo.alias,
          elemento.etiqueta,
          elemento.nombre,
          elemento.placeholder,
        ].filter(Boolean))),
      });
    }

    const acciones: AccionCatalogo[] = [];
    for (const accion of catalogada.acciones) {
      const elemento = this.elementoParaAccion(accion, elementos);
      if (!elemento) continue;
      acciones.push({
        ...accion,
        testid: elemento.testid,
        etiqueta: elemento.etiqueta || accion.etiqueta,
        alias: Array.from(new Set([...accion.alias, elemento.etiqueta].filter(Boolean))),
      });
    }

    const selectores = this.selectoresNavegados(catalogada, elementos);
    if (!selectores['pagina']) {
      pendientes.push(`La ruta ${ruta} no expone un data-testid estable para identificar la página.`);
    }

    const elementoVerificacion = catalogada.verificacion
      ? this.elementoPorSelector(catalogada.verificacion.selector, elementos)
        ?? elementos.find((elemento) => /mensaje|message|status|alert/i.test(elemento.testid))
      : undefined;

    return {
      pantalla: {
        ...catalogada,
        ruta: inspeccion.ruta,
        instrumentada: Boolean(selectores['pagina']),
        selectores,
        campos,
        acciones,
        verificacion: catalogada.verificacion && elementoVerificacion
          ? { ...catalogada.verificacion, selector: elementoVerificacion.selector }
          : undefined,
      },
      pendientes,
    };
  }

  private pantallaGenericaDesdeNavegacion(
    ruta: string,
    inspeccion: InspeccionPantalla,
    elementos: ElementoNavegado[],
  ): PantallaCatalogo {
    const campos = elementos
      .filter((elemento) => ['input', 'select', 'textarea'].includes(elemento.tag))
      .map((elemento): CampoCatalogo => ({
        clave: this.claveCampo(elemento.nombre || elemento.etiqueta || elemento.testid),
        etiqueta: elemento.etiqueta || elemento.nombre || elemento.testid,
        testid: elemento.testid,
        tipo: elemento.tag === 'select'
          ? 'select'
          : elemento.tipo === 'file'
            ? 'archivo'
            : elemento.tipo === 'date'
              ? 'fecha'
              : elemento.tipo === 'number'
                ? 'numero'
                : 'texto',
        obligatorio: elemento.obligatorio,
        alias: [elemento.etiqueta, elemento.nombre, elemento.placeholder].filter(Boolean),
      }));
    const acciones = elementos
      .filter((elemento) => elemento.tag === 'button' || elemento.rol === 'button')
      .map((elemento): AccionCatalogo => ({
        clave: this.claveCampo(elemento.nombre || elemento.etiqueta || elemento.testid),
        etiqueta: elemento.etiqueta || elemento.testid,
        testid: elemento.testid,
        alias: [elemento.etiqueta, elemento.nombre].filter(Boolean),
        escribe: /guardar|crear|confirmar|eliminar|importar|enviar|aprobar/i.test(elemento.etiqueta),
      }));
    const pagina = elementos.find((elemento) => elemento.tag === 'main' || /(?:^|-)page$/.test(elemento.testid));
    const mensaje = elementos.find((elemento) => /mensaje|message|status|alert/i.test(elemento.testid));

    return {
      codigo: `QA-NAV-${this.slug(ruta).toUpperCase()}`,
      ruta,
      nombre: inspeccion.encabezado || inspeccion.titulo || ruta,
      modulo: ruta.split('/').filter(Boolean)[0]?.toUpperCase() || 'QA',
      instrumentada: Boolean(pagina),
      selectores: {
        ...(pagina ? { pagina: pagina.selector } : {}),
        ...(mensaje ? { mensaje: mensaje.selector } : {}),
      },
      campos,
      acciones,
      verificacion: mensaje
        ? { selector: mensaje.selector, patron_exito: 'guardad|cread|registrad|completad', clase_error: 'error' }
        : undefined,
      nota: `Elementos descubiertos por ${inspeccion.id}.`,
    };
  }

  private selectoresNavegados(
    pantalla: PantallaCatalogo,
    elementos: ElementoNavegado[],
  ): Record<string, string> {
    const selectores: Record<string, string> = {};
    for (const [clave, selector] of Object.entries(pantalla.selectores)) {
      const exacto = this.elementoPorSelector(selector, elementos);
      const semantico = exacto ?? elementos.find((elemento) => {
        if (clave === 'pagina') return elemento.tag === 'main' || /(?:^|-)page$/.test(elemento.testid);
        if (clave === 'formulario') return elemento.tag === 'form';
        if (clave === 'mensaje') return /mensaje|message|status|alert/i.test(elemento.testid);
        return this.textoNormalizado(elemento.testid).includes(this.textoNormalizado(clave));
      });
      if (semantico) selectores[clave] = semantico.selector;
    }
    return selectores;
  }

  private elementoParaCampo(campo: CampoCatalogo, elementos: ElementoNavegado[]): ElementoNavegado | undefined {
    const exacto = elementos.find((elemento) => elemento.testid === campo.testid);
    if (exacto) return exacto;
    return elementos.find((elemento) => {
      if (!['input', 'select', 'textarea'].includes(elemento.tag)) return false;
      const contexto = `${elemento.etiqueta} ${elemento.nombre} ${elemento.placeholder}`;
      return Boolean(mencionaAlias(contexto, [campo.etiqueta, ...campo.alias]));
    });
  }

  private elementoParaAccion(accion: AccionCatalogo, elementos: ElementoNavegado[]): ElementoNavegado | undefined {
    const exacto = elementos.find((elemento) => elemento.testid === accion.testid);
    if (exacto) return exacto;
    return elementos.find((elemento) => {
      if (elemento.tag !== 'button' && elemento.rol !== 'button') return false;
      return Boolean(mencionaAlias(elemento.etiqueta, [accion.etiqueta, ...accion.alias]));
    });
  }

  private elementoPorSelector(selector: string, elementos: ElementoNavegado[]): ElementoNavegado | undefined {
    const testid = /\[data-testid=["']([^"']+)["']\]/i.exec(selector)?.[1] ?? '';
    return testid ? elementos.find((elemento) => elemento.testid === testid) : undefined;
  }

  private claveCampo(valor: unknown): string {
    return this.texto(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'campo';
  }

  private textoNormalizado(valor: unknown): string {
    return this.claveCampo(valor).replace(/_/g, '');
  }

  /**
   * Detecta en el SOP las frases de precaución y las cruza con las decisiones
   * que ya haya tomado una persona. Lo que el agente no puede deducir —si una
   * regla escrita en lenguaje humano es evaluable o es juicio del operador— no
   * lo inventa: queda `sin_definir` y bloquea la aprobación.
   */
  private detectarConsideraciones(
    descripcion: string,
    pasos: Record<string, unknown>[],
    decisionesEntrada: Record<string, unknown>[],
  ): { consideraciones: Consideracion[]; pendientes: string[] } {
    const decisiones = new Map<string, Record<string, unknown>>();
    for (const decision of decisionesEntrada) {
      const clave = this.texto(decision['id']) || this.slug(this.texto(decision['texto']));
      if (clave) decisiones.set(clave, decision);
    }

    const vistas = new Set<string>();
    const consideraciones: Consideracion[] = [];
    const candidatas: Array<{ texto: string; paso?: number }> = [];

    for (const paso of pasos) {
      const texto = this.texto(paso['accion'] ?? paso['texto'] ?? paso['nombre']);
      if (texto) candidatas.push({ texto, paso: Number(paso['orden']) || undefined });
    }
    for (const linea of descripcion.split(/\r?\n/)) {
      const texto = linea.trim();
      if (texto) candidatas.push({ texto });
    }

    for (const candidata of candidatas) {
      if (!PATRONES_GUARDA.some((patron) => patron.test(candidata.texto))) continue;
      const id = this.slug(candidata.texto).slice(0, 60);
      if (!id || vistas.has(id)) continue;
      vistas.add(id);

      const decision = decisiones.get(id);
      const testeable = decision && decision['testeable'] !== null && decision['testeable'] !== undefined
        ? Boolean(decision['testeable'])
        : null;

      consideraciones.push({
        id,
        texto: candidata.texto,
        testeable,
        control: testeable === null ? 'sin_definir' : testeable ? 'automatico' : 'humano',
        fuente: { tipo: 'sop_loom', paso_aprendido: candidata.paso },
      });
    }

    const sinDefinir = consideraciones.filter((item) => item.control === 'sin_definir');
    const pendientes = sinDefinir.map(
      (item) => `Definí si es una regla evaluable por el test o un control humano: "${this.recortar(item.texto)}"`,
    );

    return { consideraciones, pendientes };
  }

  private recortar(valor: string, largo = 90): string {
    const texto = this.texto(valor);
    return texto.length > largo ? `${texto.slice(0, largo - 1)}…` : texto;
  }

  /**
   * Compara el set de casos congelado al aprobar contra lo que hay hoy en
   * Mongo. Devuelve los desvios en lenguaje accionable, vacio si nada cambio.
   */
  private async revalidarCasosCongelados(doc: QaSopLoomLean): Promise<string[]> {
    const definicion = this.objeto(doc.definicion_ejecutable);
    const congelados = this.arrayObjetos(definicion['casos']);
    if (congelados.length === 0) {
      return ['El aprendizaje no tiene casos congelados con los que operar la pantalla.'];
    }

    const pantalla = buscarPantallaPorRuta(this.texto(this.objeto(definicion['rutas'])['pantalla_objetivo']));
    if (!pantalla?.fuente_casos) {
      return ['La pantalla objetivo ya no tiene fuente de casos configurada.'];
    }

    const actuales = await this.casos
      .find(filtroCasosMongo(pantalla.fuente_casos))
      .lean<Record<string, unknown>[]>();
    const porId = new Map(actuales.map((caso) => [this.texto(caso['id']), caso]));

    // Si no quedo ninguno, el mensaje util es "carga casos", no "faltan 3 ids".
    if (actuales.length === 0) {
      return [
        `Ya no hay casos en ${pantalla.fuente_casos.etiqueta}. Cargá al menos uno, a mano o importando un Excel, y volvé a guardar y aprobar el aprendizaje.`,
      ];
    }

    const desvios: string[] = [];
    const congeladosIds = new Set<string>();

    for (const congelado of congelados) {
      const id = this.texto(congelado['id']);
      congeladosIds.add(id);
      const actual = porId.get(id);
      if (!actual) {
        desvios.push(`el caso ${id} ya no está disponible (se borró o se desactivó)`);
        continue;
      }
      const { datos } = datosDesdeCaso(pantalla, actual);
      for (const [campo, esperado] of Object.entries(this.objeto(congelado['datos']))) {
        const ahora = this.texto(datos[campo]);
        if (ahora !== this.texto(esperado)) {
          desvios.push(`el caso ${id} cambió ${campo}: "${this.texto(esperado)}" -> "${ahora}"`);
        }
      }
    }

    const nuevos = actuales
      .map((caso) => this.texto(caso['id']))
      .filter((id) => !congeladosIds.has(id));
    if (nuevos.length > 0) {
      desvios.push(
        `hay ${nuevos.length} caso(s) cargados después de aprobar que no se van a ejecutar: ${nuevos.join(', ')}`,
      );
    }

    return desvios;
  }

  /**
   * Trae los casos QA que la propia pantalla tiene cargados (a mano o por Excel
   * masivo) y los congela como set de datos del aprendizaje.
   */
  private async casosDeLaPantalla(
    pantalla: PantallaCatalogo,
    seleccionados: string[],
  ): Promise<{ casos: CasoCongelado[]; pendientes: string[] }> {
    const fuente = pantalla.fuente_casos;
    if (!fuente) {
      return {
        casos: [],
        pendientes: [
          `La pantalla ${pantalla.nombre} no tiene fuente de casos configurada, asi que no hay datos con los que operarla.`,
        ],
      };
    }

    const filtro: Record<string, unknown> = filtroCasosMongo(fuente);
    if (seleccionados.length > 0) {
      filtro['id'] = { $in: seleccionados };
    }

    const docs = await this.casos.find(filtro).sort({ updatedAt: -1 }).lean<Record<string, unknown>[]>();
    if (docs.length === 0) {
      return {
        casos: [],
        pendientes: [
          seleccionados.length > 0
            ? `No encontre los casos seleccionados (${seleccionados.join(', ')}) en ${fuente.etiqueta}.`
            : `No hay casos en ${fuente.etiqueta}. Carga al menos uno a mano o importa un Excel antes de aprobar.`,
        ],
      };
    }

    const casos: CasoCongelado[] = [];
    const pendientes: string[] = [];

    for (const doc of docs) {
      const id = this.texto(doc['id']);
      const { datos, faltantes } = datosDesdeCaso(pantalla, doc);
      if (faltantes.length > 0) {
        pendientes.push(`El caso ${id} no tiene ${faltantes.join(', ')}. Completalo o desactivalo.`);
        continue;
      }
      casos.push({
        id,
        descripcion: this.texto(doc['descripcion']),
        datos,
        id_esperado: fuente.idEsperado ? fuente.idEsperado(datos) : id,
      });
    }

    return { casos, pendientes };
  }

  private definicionEjecutable(
    base: {
      id: string;
      nombre: string;
      modulo: string;
      ruta: string;
      rol: string;
      entorno: string;
      loom_ref: string;
      objetivo: string;
      criterio_aceptacion: string;
      descripcion_video: string;
    },
    compilacion: Compilacion,
  ): Record<string, unknown> {
    const pantalla = compilacion.pantalla;
    return {
      codigo: `DEF-SOP-${this.slug(base.nombre || base.id).toUpperCase()}`,
      version: 3,
      tipo: 'pantalla_qa',
      fuente: {
        tipo: 'sop_loom',
        aprendizaje_id: base.id,
        loom_ref: base.loom_ref,
      },
      fuentes: {
        sop: {
          tipo: 'sop_loom',
          aprendizaje_id: base.id,
          loom_ref: base.loom_ref,
        },
        navegacion: compilacion.inspeccion ? {
          tipo: 'navegacion',
          inspeccion_id: compilacion.inspeccion.id,
          ref: `${compilacion.inspeccion.frontend_url}${compilacion.inspeccion.ruta}`,
          inspeccionada_en: compilacion.inspeccion.inspeccionada_en,
          hash: compilacion.inspeccion.hash,
          captura_path: compilacion.inspeccion.captura_path,
        } : null,
      },
      rutas: {
        login: '/login',
        // La pantalla objetivo es la que el SOP describe, no la de SOP Loom.
        pantalla_objetivo: pantalla?.ruta ?? base.ruta,
        // Todas las pantallas que el SOP nombra, en orden. Hoy solo una queda
        // `cubierta` por el plan; el resto avisa que el salto no se automatiza.
        recorrido: compilacion.recorrido,
      },
      selectores: {
        ...(pantalla?.selectores ?? {}),
        // Se mantiene para poder auditar el aprendizaje desde la propia pantalla.
        aprendizaje_en_sop_loom: `[data-testid="qa-sop-loom-learned-${base.id}"]`,
      },
      valores: {
        codigo: pantalla?.codigo ?? this.codigoPantalla(base),
        nombre: base.nombre,
        modulo: base.modulo,
        ruta: pantalla?.ruta ?? base.ruta,
        rol: base.rol,
        entorno: base.entorno,
        objetivo: base.objetivo,
        criterio_aceptacion: base.criterio_aceptacion,
      },
      fuente_datos: {
        tipo: 'casos_qa',
        etiqueta: pantalla?.fuente_casos?.etiqueta ?? '',
        filtro: pantalla?.fuente_casos?.filtro ?? null,
        seleccion: compilacion.casos.length > 0 ? 'casos_cargados_en_la_pantalla' : 'sin_casos',
      },
      // Set de datos congelado: una vuelta del plan por cada caso.
      casos: compilacion.casos,
      pasos_ejecutables: compilacion.pasos_ejecutables,
      consideraciones: compilacion.consideraciones,
      // Una guarda que una persona marcó como juicio del operador impide dar
      // el flujo por automatizable sin supervisión, aunque la corrida sea verde.
      control_humano: {
        requerido: compilacion.consideraciones.some((item) => item.control === 'humano'),
        guardas: compilacion.consideraciones
          .filter((item) => item.control === 'humano')
          .map((item) => item.texto),
      },
      aserciones: [
        { campo: 'pantalla_abierta', esperado: pantalla?.selectores['pagina'] ?? '' },
        { campo: 'ruta_objetivo', esperado: pantalla?.ruta ?? base.ruta },
        { campo: 'pasos_por_caso', esperado: compilacion.pasos_ejecutables.length },
        { campo: 'casos_a_ejecutar', esperado: compilacion.casos.length },
      ],
    };
  }

  private codigoPantalla(base: { descripcion_video: string; ruta: string; nombre: string }): string {
    const match = /\bQA-PANT-[A-Z0-9_-]+\b/i.exec(`${base.descripcion_video} ${base.nombre}`);
    if (match) return match[0].toUpperCase();
    const slug = this.slug(base.ruta || base.nombre).toUpperCase().replace(/^QA-?/, '');
    return `QA-PANT-${slug.slice(0, 18) || 'NUEVA'}`;
  }

  private pendientesBase(entrada: {
    nombre: string;
    ruta: string;
    objetivo: string;
    criterio: string;
    descripcion: string;
    pasos: Record<string, unknown>[];
    loomRef: string;
  }): string[] {
    const pendientes: string[] = [];
    if (!entrada.nombre) pendientes.push('Completar nombre de la pantalla.');
    if (!entrada.ruta) pendientes.push('Definir ruta de la pantalla.');
    if (!entrada.descripcion) pendientes.push('Pegar la descripcion o transcripcion del Loom.');
    if (!entrada.objetivo) pendientes.push('Definir objetivo del aprendizaje.');
    if (!entrada.criterio) pendientes.push('Definir criterio de aceptacion.');
    if (!entrada.pasos.length) pendientes.push('No se detectaron pasos operativos.');
    if (entrada.loomRef && !/^https?:\/\/(www\.)?loom\.com\//i.test(entrada.loomRef)) {
      pendientes.push('Confirmar que el link de Loom sea valido.');
    }
    if (/produccion|productivo/i.test(entrada.descripcion)) {
      pendientes.push('El texto menciona produccion: validar que la fuente sea sandbox antes de usarla.');
    }
    return pendientes;
  }

  /**
   * Los pendientes que calcula el backend mandan sobre el estado que haya
   * mandado el frontend. Guardar nunca deja un aprendizaje en `aprobado`: si se
   * vuelve a guardar, la definicion se recompila y la aprobacion previa queda
   * invalidada (la limpia `guardar`).
   */
  private estadoDesdeEntrada(valor: unknown, pendientes: string[]): EstadoQaSopLoom {
    if (pendientes.length > 0) return 'revisar';
    return this.texto(valor) === 'borrador' ? 'borrador' : 'listo';
  }

  private envRunner(aprendizajeId: string, modo: string): NodeJS.ProcessEnv {
    const demo = modo === 'demo';
    return {
      ...process.env,
      AUDITORIA_QA_SOP_LEARNING: aprendizajeId,
      AUDITORIA_PLAYWRIGHT_DEMO: demo ? 'true' : 'false',
      PLAYWRIGHT_HEADLESS: demo ? 'false' : 'true',
      PLAYWRIGHT_SLOWMO_MS: demo ? process.env.PLAYWRIGHT_SLOWMO_MS ?? '1800' : '0',
      PLAYWRIGHT_DEMO_FINAL_PAUSE_MS: demo ? process.env.PLAYWRIGHT_DEMO_FINAL_PAUSE_MS ?? '15000' : '0',
    };
  }

  private serializar(doc: QaSopLoomLean): Record<string, unknown> {
    const { _id, ...resto } = doc;
    void _id;
    return resto as Record<string, unknown>;
  }

  private usuarioTexto(usuario: unknown): string {
    const u = this.objeto(usuario);
    return this.texto(u['correo'] ?? u['nombre']) || 'usuario_actual';
  }

  private usuarioRol(usuario: unknown): string {
    return this.texto(this.objeto(usuario)['rol']) || 'qa';
  }

  private hash(valor: unknown): string {
    return createHash('sha256').update(JSON.stringify(valor)).digest('hex');
  }

  private idDesde(valor: string): string {
    return `sop-loom-${this.slug(valor)}-${Date.now()}`;
  }

  private slug(valor: string): string {
    return this.texto(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'pantalla';
  }

  private normalizarRuta(valor: string): string {
    const ruta = this.texto(valor);
    if (!ruta) return '';
    return ruta.startsWith('/') ? ruta : `/${ruta}`;
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

  private arrayTexto(valor: unknown): string[] {
    return Array.isArray(valor)
      ? valor.map((item) => this.texto(item)).filter(Boolean)
      : [];
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }

  private tail(valor: string): string {
    return valor.slice(-8000);
  }
}
