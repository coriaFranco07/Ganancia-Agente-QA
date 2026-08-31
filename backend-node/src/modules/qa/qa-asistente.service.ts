import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { UsuarioSesion } from '../auth/auth.service';
import { QaCasosService } from './qa-casos.service';
import { QaCorreccionAsistidaService } from './qa-correccion-asistida.service';
import { QA_DEFINICION_TECNICA_DEFAULT } from './qa-definiciones-tecnicas.service';
import { DatasetQaResumen, QaDatasetsService } from './qa-datasets.service';
import { QaHallazgosService } from './qa-hallazgos.service';
import { QaRunnerService } from './qa-runner.service';
import {
  EstadoQaEjecucion,
  QaEjecucion,
  QaEjecucionDocument,
} from './schemas/qa-ejecucion.schema';
import {
  EstadoQaPlanAsistente,
  ModoQaPlanAsistente,
  QaPlanAsistente,
  QaPlanAsistenteDocument,
} from './schemas/qa-plan-asistente.schema';

type IntencionAsistente = 'diagnostico' | 'plan' | 'correccion' | 'importacion' | 'dataset' | 'evidencia' | 'resumen';
type TipoRespuestaAsistente = IntencionAsistente | 'guia' | 'aprobacion' | 'ejecucion' | 'recoleccion';
type TipoAccionAsistente = 'preguntar' | 'navegar' | 'aprobar_plan' | 'ejecutar_plan' | 'ver_evidencia';
type OrigenParametroTipo = 'dicho' | 'normalizado' | 'respondido' | 'inferido' | 'leido' | 'default_definicion' | 'heredado';

interface OrigenParametroPlan {
  origen: OrigenParametroTipo;
  origen_ref: string;
  requiere_confirmacion?: boolean;
  modificado?: boolean;
}

interface ParametroRecolectado {
  valor: unknown;
  origen: OrigenParametroPlan;
}

interface AccionAsistenteQa {
  tipo: TipoAccionAsistente;
  etiqueta: string;
  mensaje?: string;
  ruta?: string;
  plan_id?: string;
  hash_plan?: string;
}

interface RespuestaAsistenteQa extends Record<string, unknown> {
  id: string;
  rol: 'assistant';
  generado_en: string;
  tipo: TipoRespuestaAsistente;
  caso_id?: string;
  texto: string;
  acciones: AccionAsistenteQa[];
  plan?: Record<string, unknown>;
  politica_registro: string;
}

type QaEjecucionLean = QaEjecucion & {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

type QaPlanLean = QaPlanAsistente & {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

interface ContextoCasoQa {
  caso: Record<string, unknown>;
  ejecucion: QaEjecucionLean | null;
}

interface HallazgoDiagnostico {
  codigo: string;
  motivo: string;
  explicacion: string;
  revision: string;
}

interface PlanConstruido {
  parametros: Record<string, unknown>;
  parametros_pendientes: string[];
  plan: Record<string, unknown>;
  hash_plan: string;
  vence_en: string;
}

interface DiferenciaPlan {
  campo: string;
  aprobado: unknown;
  actual: unknown;
}

@Injectable()
export class QaAsistenteService {
  private readonly politicaRegistro = 'No se guarda la conversación completa; se persisten pedido original, parámetros, plan aprobado, aprobación, ejecución y evidencia.';
  private readonly planTtlMs = this.msDesdeEnv('AUDITORIA_QA_PLAN_TTL_MS', 15 * 60 * 1000);
  private readonly ejecutorVersion = 'qa-copilot@1.0.0';
  private readonly runnerScriptVersion = 'run-qa-cases-playwright@1';
  private readonly parametrosObligatoriosPlan = [
    'caso_id',
    'definicion_tecnica_codigo',
    'dataset_codigo',
    'periodo',
    'excel',
    'legajo',
    'campo',
    'esperado',
  ];

  constructor(
    private readonly casos: QaCasosService,
    private readonly datasets: QaDatasetsService,
    private readonly runner: QaRunnerService,
    private readonly correcciones: QaCorreccionAsistidaService,
    private readonly hallazgos: QaHallazgosService,
    @InjectModel(QaEjecucion.name) private readonly ejecuciones: Model<QaEjecucionDocument>,
    @InjectModel(QaPlanAsistente.name) private readonly planes: Model<QaPlanAsistenteDocument>,
  ) {}

  async contexto(): Promise<Record<string, unknown>> {
    await this.sincronizarPlanes();
    const [casos, datasets, ejecuciones, planes] = await Promise.all([
      this.casos.listar(true),
      this.datasets.listar().catch((): DatasetQaResumen[] => []),
      this.listarUltimasEjecuciones(),
      this.listarUltimosPlanes(),
    ]);

    return {
      generado_en: new Date().toISOString(),
      politica_registro: this.politicaRegistro,
      resumen: {
        casos_activos: casos.length,
        datasets_validos: datasets.length,
        ejecuciones_verdes: ejecuciones.filter((ejecucion) => ejecucion.estado === 'verde').length,
        ejecuciones_rojas: ejecuciones.filter((ejecucion) => ejecucion.estado === 'rojo').length,
        ejecuciones_corriendo: ejecuciones.filter((ejecucion) => ejecucion.estado === 'corriendo').length,
        planes_pendientes: planes.filter((plan) => plan.estado === 'plan_propuesto').length,
        planes_aprobados: planes.filter((plan) => plan.estado === 'aprobado').length,
      },
      casos: casos.map((caso) => {
        const casoId = this.texto(caso['id']);
        return {
          ...this.resumenCaso(caso),
          ultima_ejecucion: this.resumenEjecucion(ejecuciones.find((ejecucion) => ejecucion.caso_id === casoId) ?? null),
          ultimo_plan: this.resumenPlan(planes.find((plan) => plan.caso_id === casoId) ?? null),
        };
      }),
      sugerencias: [
        'Pedí un plan antes de ejecutar un caso.',
        'Aprobá explícitamente el plan si los datos son correctos.',
        'Ejecutá desde el plan aprobado, no desde una instrucción ambigua.',
        'Consultá diagnóstico y evidencia de las corridas rojas.',
      ],
    };
  }

  async responder(entrada: unknown, usuario?: UsuarioSesion): Promise<RespuestaAsistenteQa> {
    const body = this.objeto(entrada);
    const mensaje = this.texto(body['mensaje']);
    const intencion = this.detectarIntencion(mensaje);
    const planId = this.extraerPlanId(mensaje);
    if (planId) return this.responderPlanGuardado(planId);

    const casoId = this.texto(body['caso_id']) || this.extraerCasoId(mensaje);
    const recoleccionActiva = mensaje
      ? await this.buscarRecoleccionActiva(usuario, casoId)
      : null;
    if (recoleccionActiva && this.debeProcesarRecoleccion(mensaje, recoleccionActiva, casoId, intencion)) {
      return this.procesarRecoleccion(recoleccionActiva, mensaje, usuario, casoId);
    }

    if (!mensaje) {
      return this.respuesta('guia', undefined, this.textoBienvenida(), this.accionesGenerales());
    }

    const contextoCaso = casoId ? await this.contextoCaso(casoId) : null;
    if (casoId && !contextoCaso) {
      return this.respuesta(
        'guia',
        casoId,
        `No encontré el caso ${casoId} entre los casos QA activos. Revisá que esté guardado en Pantalla 1 o importalo nuevamente.`,
        [
          { tipo: 'navegar', etiqueta: 'Abrir Pantalla 1', ruta: '/qa/pantalla-1' },
          { tipo: 'preguntar', etiqueta: 'Ver resumen', mensaje: 'Mostrame el resumen de casos QA activos.' },
        ],
      );
    }

    if (!contextoCaso) {
      if (intencion === 'plan') return this.iniciarRecoleccionSinCaso(mensaje, usuario);
      return this.responderGeneral(intencion);
    }
    if (intencion === 'evidencia') return this.responderEvidencia(contextoCaso);
    if (intencion === 'diagnostico') return this.responderDiagnostico(contextoCaso);
    if (intencion === 'plan') return this.responderPlan(contextoCaso, mensaje, usuario);
    if (intencion === 'correccion') return this.responderCorreccion(contextoCaso);
    if (intencion === 'importacion') return this.responderImportacion(contextoCaso);
    if (intencion === 'dataset') return this.responderDataset(contextoCaso);

    const ejecucion = contextoCaso.ejecucion;
    if (ejecucion?.estado === 'rojo') return this.responderDiagnostico(contextoCaso);
    return this.responderPlan(contextoCaso, mensaje, usuario);
  }

  async crearPlan(entrada: unknown, usuario?: UsuarioSesion): Promise<Record<string, unknown>> {
    const body = this.objeto(entrada);
    const casoId = this.texto(body['caso_id']);
    if (!casoId) throw new BadRequestException('Para proponer un plan se requiere caso_id.');

    const contexto = await this.contextoCaso(casoId);
    if (!contexto) throw new NotFoundException(`Caso QA inexistente: ${casoId}`);

    const modo = this.normalizarModo(body['modo']);
    const pedido = this.texto(body['pedido']) || `Ejecutar QA ${modo} para ${casoId}`;
    const casoActual = await this.casoConDatasetActual(contexto.caso);
    const construido = this.construirPlan(casoActual, modo);
    if (construido.parametros_pendientes.length) {
      throw new BadRequestException({
        message: 'No se puede proponer plan porque faltan parámetros obligatorios.',
        parametros_pendientes: construido.parametros_pendientes,
      });
    }

    const doc = await this.persistirPlan(casoActual, construido, modo, pedido, usuario);
    return this.serializarPlan(doc);
  }

  async obtenerPlan(id: string): Promise<Record<string, unknown>> {
    const doc = await this.obtenerPlanDoc(id);
    return this.serializarPlan(doc);
  }

  async aprobarPlan(id: string, entrada: unknown, usuario?: UsuarioSesion): Promise<Record<string, unknown>> {
    const doc = await this.obtenerPlanDoc(id);
    this.validarPlanAprobable(doc);

    const hashConfirmado = this.texto(this.objeto(entrada)['hash_plan']);
    if (hashConfirmado && hashConfirmado !== doc.hash_plan) {
      throw new ConflictException('El hash confirmado no coincide con el plan vigente.');
    }

    const caso = await this.casoConDatasetActual(await this.casos.obtener(doc.caso_id));
    const reconstruido = this.construirPlan(caso, doc.modo, this.origenesDesdePlan(doc), false);
    if (reconstruido.hash_plan !== doc.hash_plan) {
      const diferencias = this.diferenciasPlan(doc, reconstruido);
      const motivo = `El caso cambió después de proponer el plan. Diferencias: ${this.textoDiferencias(diferencias)}.`;
      await this.marcarPlanAbortado(doc.id, motivo);
      throw new ConflictException(`${motivo} Generá un plan nuevo.`);
    }

    const actualizado = await this.planes.findOneAndUpdate(
      { id: doc.id },
      {
        $set: {
          estado: 'aprobado',
          aprobacion: {
            por: usuario?.id ?? 'usuario-desconocido',
            correo: usuario?.correo ?? 'desconocido',
            rol: 'usuario',
            en: new Date().toISOString(),
            hash_plan: doc.hash_plan,
          },
        },
      },
      { new: true },
    ).lean<QaPlanLean>();

    if (!actualizado) throw new BadRequestException('No se pudo aprobar el plan QA.');
    return this.serializarPlan(actualizado);
  }

  async ejecutarPlan(id: string, usuario?: UsuarioSesion): Promise<Record<string, unknown>> {
    const doc = await this.obtenerPlanDoc(id);
    this.validarPlanEjecutable(doc);

    const caso = await this.casoConDatasetActual(await this.casos.obtener(doc.caso_id));
    const reconstruido = this.construirPlan(caso, doc.modo, this.origenesDesdePlan(doc), false);
    if (reconstruido.hash_plan !== doc.hash_plan) {
      const diferencias = this.diferenciasPlan(doc, reconstruido);
      const motivo = `El caso cambió entre la aprobación y la ejecución. Diferencias: ${this.textoDiferencias(diferencias)}.`;
      await this.marcarPlanAbortado(doc.id, motivo);
      throw new ConflictException(`${motivo} Se abortó sin ejecutar.`);
    }

    const ejecucion = await this.runner.ejecutarCaso(doc.caso_id, doc.modo);
    const actualizado = await this.planes.findOneAndUpdate(
      { id: doc.id },
      {
        $set: {
          estado: 'ejecutando',
          ejecucion_id: this.texto(ejecucion['id']),
          verificacion: {
            iniciada_en: new Date().toISOString(),
            ejecutado_por: usuario?.correo ?? 'desconocido',
            ejecutor: this.ejecutorAgente(),
            version_script: this.runnerScriptVersion,
            ejecucion,
          },
        },
      },
      { new: true },
    ).lean<QaPlanLean>();

    if (!actualizado) throw new BadRequestException('No se pudo registrar la ejecución del plan QA.');
    return this.serializarPlan(actualizado);
  }

  private async responderGeneral(intencion: IntencionAsistente): Promise<RespuestaAsistenteQa> {
    const contexto = await this.contexto();
    const casos = Array.isArray(contexto['casos']) ? contexto['casos'] as Record<string, unknown>[] : [];
    const resumen = this.objeto(contexto['resumen']);

    if (intencion === 'importacion') return this.respuesta('importacion', undefined, this.textoImportacion(), this.accionesGenerales());
    if (intencion === 'dataset') {
      return this.respuesta(
        'dataset',
        undefined,
        'El dataset representa la regla o marco normativo que va a usar el caso QA. Debe coincidir con el período del caso, estar validado y tener fuente normativa completa.',
        this.accionesGenerales(),
      );
    }

    const visibles = casos.slice(0, 6).map((caso) => {
      const ejecucion = this.objeto(caso['ultima_ejecucion']);
      const plan = this.objeto(caso['ultimo_plan']);
      return `- ${this.texto(caso['id'])}: ${this.texto(caso['periodo']) || 'sin período'}, ejecución ${this.texto(ejecucion['estado']) || 'sin correr'}, plan ${this.texto(plan['estado']) || 'sin plan'}`;
    });
    const texto = [
      `Hoy veo ${this.numero(resumen['casos_activos']) ?? casos.length} caso(s) QA activo(s).`,
      `Corridas: ${this.numero(resumen['ejecuciones_verdes']) ?? 0} verdes, ${this.numero(resumen['ejecuciones_rojas']) ?? 0} rojas y ${this.numero(resumen['ejecuciones_corriendo']) ?? 0} corriendo.`,
      `Planes: ${this.numero(resumen['planes_pendientes']) ?? 0} propuestos y ${this.numero(resumen['planes_aprobados']) ?? 0} aprobados.`,
      visibles.length ? `Casos visibles:\n${visibles.join('\n')}` : 'Todavía no hay casos activos para analizar.',
      'Para ejecutar según la documentación, pedime un plan para un caso y después aprobalo explícitamente.',
    ].join('\n\n');

    return this.respuesta('resumen', undefined, texto, this.accionesGenerales());
  }

  private responderDiagnostico(contexto: ContextoCasoQa): RespuestaAsistenteQa {
    const { caso, ejecucion } = contexto;
    const casoId = this.texto(caso['id']);
    const casoResumen = this.resumenCaso(caso);

    if (!ejecucion) {
      return this.respuesta(
        'diagnostico',
        casoId,
        `El caso ${casoId} todavía no tiene corridas registradas. Para ejecutarlo según documentación, primero generá un plan, aprobalo y recién después ejecutá.`,
        this.accionesCaso(casoId),
        { caso: casoResumen, ultima_ejecucion: null },
      );
    }

    if (ejecucion.estado === 'corriendo') {
      return this.respuesta(
        'diagnostico',
        casoId,
        `El caso ${casoId} sigue corriendo. Todavía no se verifica como verde o rojo; esperá el cierre de la ejecución.`,
        this.accionesCaso(casoId),
        { caso: casoResumen, ultima_ejecucion: this.resumenEjecucion(ejecucion) },
      );
    }

    if (ejecucion.estado === 'verde') {
      return this.respuesta(
        'diagnostico',
        casoId,
        `El caso ${casoId} está verde. Se pudo cargar el Excel, validar período/legajo y comparar el campo esperado dentro de tolerancia. Detalle: ${this.texto(ejecucion.detalle) || 'sin detalle adicional'}.`,
        this.accionesCaso(casoId, ejecucion),
        { caso: casoResumen, ultima_ejecucion: this.resumenEjecucion(ejecucion) },
      );
    }

    const detalle = this.texto(ejecucion.detalle);
    const hallazgo = this.hallazgoDesdeDetalle(detalle);
    const texto = [
      `El caso ${casoId} está rojo.`,
      `Motivo principal: ${hallazgo.motivo}`,
      `Qué significa: ${hallazgo.explicacion}`,
      `Qué revisar: ${hallazgo.revision}`,
      detalle ? `Detalle técnico: ${detalle}` : '',
    ].filter(Boolean).join('\n\n');

    return this.respuesta('diagnostico', casoId, texto, this.accionesCaso(casoId, ejecucion), {
      caso: casoResumen,
      ultima_ejecucion: this.resumenEjecucion(ejecucion),
      hallazgo,
    });
  }

  private async responderPlan(contexto: ContextoCasoQa, pedido: string, usuario?: UsuarioSesion): Promise<RespuestaAsistenteQa> {
    const casoId = this.texto(contexto.caso['id']);
    const modo = this.modoDesdeMensaje(pedido);
    let caso: Record<string, unknown>;
    try {
      caso = await this.casoConDatasetActual(contexto.caso);
    } catch (error) {
      return this.respuesta(
        'dataset',
        casoId,
        [
          `No puedo proponer un plan ejecutable para ${casoId} porque falló la revalidación del dataset.`,
          this.mensajeExcepcion(error),
          'Elegí un dataset validado y vigente para el período del caso, y después pedime el plan de nuevo.',
        ].join('\n\n'),
        [
          { tipo: 'navegar', etiqueta: 'Abrir Pantalla 1', ruta: '/qa/pantalla-1' },
          { tipo: 'preguntar', etiqueta: 'Qué valida el dataset', mensaje: `Qué valida el dataset del caso ${casoId}` },
        ],
      );
    }
    const construido = this.construirPlan(caso, modo);

    if (construido.parametros_pendientes.length) {
      const doc = await this.persistirRecoleccion(casoId, construido, modo, pedido, usuario);
      return this.respuesta(
        'recoleccion',
        casoId,
        this.textoRecoleccion(doc),
        this.accionesRecoleccion(doc),
        this.serializarPlan(doc),
      );
    }

    const doc = await this.persistirPlan(caso, construido, modo, pedido, usuario);
    const plan = this.serializarPlan(doc);
    const texto = [
      `Plan propuesto para ${casoId}.`,
      `Modo: ${modo === 'demo' ? 'Demo visible' : 'Rápido'}.`,
      `Impacto: no modifica datos de negocio; ejecuta Playwright y registra evidencia QA.`,
      `Verificación: ${this.texto(this.objeto(doc.plan)['verificacion'])}.`,
      `Vence: ${this.formatearFecha(doc.vence_en)}.`,
      `Hash: ${doc.hash_plan.slice(0, 12)}.`,
      'Para seguir, aprobá explícitamente este plan. Si cambiás el caso antes de ejecutar, el plan se invalida.',
    ].join('\n\n');

    return this.respuesta('plan', casoId, texto, this.accionesPlanPropuesto(doc), plan);
  }

  private async responderCorreccion(contexto: ContextoCasoQa): Promise<RespuestaAsistenteQa> {
    const casoId = this.texto(contexto.caso['id']);
    const detalle = this.texto(contexto.ejecucion?.detalle);
    const hallazgo = this.hallazgoDesdeDetalle(detalle);
    const correccion = await this.correcciones.generar({
      caso: contexto.caso,
      ejecucion: contexto.ejecucion ? this.resumenEjecucion(contexto.ejecucion) : null,
      hallazgo: { ...hallazgo },
    });
    const texto = [
      this.texto(correccion['resumen']),
      `Causa probable: ${this.texto(correccion['causa_probable'])}.`,
      `Acción recomendada: ${this.texto(correccion['accion_recomendada'])}.`,
      'La corrección no modifica nada sola: después de ajustar datos hay que generar un plan nuevo y aprobarlo.',
    ].filter(Boolean).join('\n\n');

    return {
      ...this.respuesta('correccion', casoId, texto, this.accionesCaso(casoId, contexto.ejecucion), {
        caso: this.resumenCaso(contexto.caso),
        hallazgo,
      }),
      correccion,
    };
  }

  private responderImportacion(contexto: ContextoCasoQa): RespuestaAsistenteQa {
    const casoId = this.texto(contexto.caso['id']);
    return this.respuesta('importacion', casoId, this.textoImportacion(), this.accionesCaso(casoId), {
      caso: this.resumenCaso(contexto.caso),
    });
  }

  private responderDataset(contexto: ContextoCasoQa): RespuestaAsistenteQa {
    const caso = contexto.caso;
    const casoId = this.texto(caso['id']);
    const dataset = this.objeto(caso['dataset']);
    const fuente = this.objeto(dataset['fuente_normativa']);
    const texto = [
      `El caso ${casoId} usa el dataset ${this.texto(caso['dataset_codigo'])}.`,
      `Período: ${this.texto(dataset['periodo']) || this.texto(caso['periodo']) || 'sin período'}.`,
      `Convenio: ${this.texto(dataset['convenio']) || 'sin convenio informado'}.`,
      `Fuente normativa: ${this.texto(fuente['ref']) || 'sin referencia informada'}.`,
      `Estado: ${this.texto(dataset['estado']) || 'validado'}.`,
      'El dataset habilita el marco normativo del caso; el resultado concreto se verifica con las assertions del caso QA.',
    ].join('\n\n');

    return this.respuesta('dataset', casoId, texto, this.accionesCaso(casoId), {
      caso: this.resumenCaso(caso),
      dataset,
    });
  }

  private async responderPlanGuardado(planId: string): Promise<RespuestaAsistenteQa> {
    const plan = await this.obtenerPlanDoc(planId);
    const serializado = this.serializarPlan(plan);
    const verificacion = this.objeto(plan.verificacion);
    const texto = [
      `Este es el plan ${plan.id} del caso ${plan.caso_id}.`,
      `Estado: ${this.estadoPlanLegible(plan.estado)}.`,
      `Modo: ${plan.modo === 'demo' ? 'Demo visible' : 'Rápido'}.`,
      `Hash: ${plan.hash_plan.slice(0, 12)}.`,
      `Vence: ${this.formatearFecha(plan.vence_en)}.`,
      plan.aprobacion
        ? `Aprobación: registrada por ${this.texto(plan.aprobacion['correo']) || 'usuario'} con hash coincidente.`
        : 'Aprobación: pendiente.',
      verificacion['estado']
        ? `Verificación: ${this.texto(verificacion['estado'])}; ${this.texto(verificacion['detalle']) || 'sin detalle adicional'}.`
        : 'Verificación: todavía no ejecutada.',
      plan.abortado_motivo ? `Motivo de cierre: ${plan.abortado_motivo}.` : '',
    ].filter(Boolean).join('\n\n');

    return this.respuesta('plan', plan.caso_id, texto, this.accionesSegunPlan(plan), serializado);
  }

  private async responderEvidencia(contexto: ContextoCasoQa): Promise<RespuestaAsistenteQa> {
    const casoId = this.texto(contexto.caso['id']);
    const ejecucion = contexto.ejecucion;
    if (!ejecucion) {
      return this.respuesta(
        'evidencia',
        casoId,
        `El caso ${casoId} todavía no tiene evidencia porque no registra corridas. Primero generá y aprobá un plan, y luego ejecutalo.`,
        this.accionesCaso(casoId),
      );
    }

    const evidencia = this.objeto(ejecucion.evidencia);
    const dataset = this.objeto(evidencia['dataset']);
    const excel = this.objeto(evidencia['excel']);
    const empleado = this.objeto(evidencia['empleado']);
    const periodo = this.objeto(evidencia['periodo']);
    const validaciones = this.arrayObjetos(evidencia['validaciones']);
    const capturas = Array.isArray(evidencia['capturas'])
      ? evidencia['capturas'].map((item) => this.texto(item)).filter(Boolean)
      : [];
    const hallazgos = ejecucion.id ? await this.hallazgos.listarPorEjecucion(ejecucion.id) : [];
    const resumenHallazgos = this.hallazgos.resumen(hallazgos);
    const hallazgosTexto = hallazgos.slice(0, 4).map((hallazgo) =>
      `- ${this.texto(hallazgo['codigo'])}: ${this.texto(hallazgo['titulo'])} (${this.texto(hallazgo['tipo'])}, ${this.texto(hallazgo['estado'])}).`,
    );
    const texto = [
      `Evidencia disponible para ${casoId}.`,
      `Ejecución: ${ejecucion.id}.`,
      `Estado: ${ejecucion.estado}.`,
      this.texto(dataset['codigo']) ? `Dataset: ${this.texto(dataset['codigo'])} (${this.texto(dataset['periodo']) || 'sin período'}).` : '',
      this.texto(excel['nombre']) ? `Excel: ${this.texto(excel['nombre'])}.` : '',
      this.texto(periodo['esperado']) || this.texto(periodo['detectado'])
        ? `Período esperado/detectado: ${this.texto(periodo['esperado']) || '-'} / ${this.texto(periodo['detectado']) || '-'}.`
        : '',
      this.texto(empleado['legajo_esperado']) || this.texto(empleado['legajo_detectado'])
        ? `Legajo esperado/detectado: ${this.texto(empleado['legajo_esperado']) || '-'} / ${this.texto(empleado['legajo_detectado']) || '-'}.`
        : '',
      validaciones.length
        ? `Validaciones:\n${validaciones.map((validacion) => this.lineaValidacionEvidencia(validacion)).join('\n')}`
        : '',
      hallazgos.length
        ? `Hallazgos: ${this.numero(resumenHallazgos['total']) ?? hallazgos.length}, abiertos ${this.numero(resumenHallazgos['abiertos']) ?? 0}.\n${hallazgosTexto.join('\n')}`
        : 'Hallazgos: sin hallazgos abiertos para esta ejecución.',
      `Capturas registradas: ${capturas.length}.`,
      `Archivo de evidencia: ${this.texto(ejecucion.evidencia_path) || 'sin path registrado'}.`,
      this.texto(ejecucion.detalle) ? `Detalle: ${this.texto(ejecucion.detalle)}.` : '',
    ].filter(Boolean).join('\n\n');

    return this.respuesta('evidencia', casoId, texto, this.accionesCaso(casoId, ejecucion), {
      caso: this.resumenCaso(contexto.caso),
      ultima_ejecucion: this.resumenEjecucion(ejecucion),
      evidencia,
      hallazgos,
      resumen_hallazgos: resumenHallazgos,
    });
  }

  private async persistirPlan(
    caso: Record<string, unknown>,
    construido: PlanConstruido,
    modo: ModoQaPlanAsistente,
    pedido: string,
    usuario?: UsuarioSesion,
  ): Promise<QaPlanLean> {
    const doc = await this.planes.create({
      id: this.nuevoPlanId(),
      caso_id: this.texto(caso['id']),
      modo,
      estado: 'plan_propuesto',
      pedido_original: {
        texto: pedido,
        canal: 'chat',
        recibido_en: new Date().toISOString(),
        usuario: usuario ? { id: usuario.id, correo: usuario.correo } : null,
      },
      actor: this.actorDesdeUsuario(usuario),
      ejecutor: this.ejecutorAgente(),
      versiones: this.versionesPlan(construido.plan),
      parametros: construido.parametros,
      parametros_pendientes: construido.parametros_pendientes,
      plan: construido.plan,
      texto_mostrado: this.textoMostradoPlan(construido.plan, construido.hash_plan, construido.vence_en),
      hash_plan: construido.hash_plan,
      vence_en: construido.vence_en,
      aprobacion: null,
      verificacion: null,
    });
    return doc.toObject() as QaPlanLean;
  }

  private async iniciarRecoleccionSinCaso(pedido: string, usuario?: UsuarioSesion): Promise<RespuestaAsistenteQa> {
    const modo = this.modoDesdeMensaje(pedido);
    const construido = this.construirBorradorRecoleccion(
      { modo },
      modo,
      ['caso_id'],
      pedido,
      {
        modo: {
          origen: this.normalizarTexto(pedido).includes('rapido') || this.normalizarTexto(pedido).includes('start') ? 'normalizado' : 'default_definicion',
          origen_ref: 'pedido_original.texto',
        },
      },
    );
    const doc = await this.persistirRecoleccion('', construido, modo, pedido, usuario);
    return this.respuesta(
      'recoleccion',
      undefined,
      this.textoRecoleccion(doc),
      this.accionesRecoleccion(doc),
      this.serializarPlan(doc),
    );
  }

  private async procesarRecoleccion(
    doc: QaPlanLean,
    mensaje: string,
    usuario: UsuarioSesion | undefined,
    casoIdEntrada?: string,
  ): Promise<RespuestaAsistenteQa> {
    if (this.planVencido(doc)) {
      await this.marcarPlanVencido(doc.id);
      return this.respuesta(
        'recoleccion',
        this.texto(doc.caso_id) || undefined,
        'La recolección anterior venció. Pedime el plan de nuevo y abro una recolección limpia.',
        this.accionesGenerales(),
      );
    }

    const parametrosBase = this.parametrosSinMetadata(doc.parametros);
    const origenes = {
      ...this.origenesDesdeParametros(doc.parametros),
      ...this.origenesDesdePlan(doc),
    };
    const recolectados = this.extraerParametrosRecoleccion(mensaje, doc.parametros_pendientes ?? [], parametrosBase);
    if (Object.keys(recolectados).length === 0) {
      return this.respuesta(
        'recoleccion',
        this.texto(doc.caso_id) || undefined,
        [
          'No pude tomar ese mensaje como un dato del plan.',
          this.textoRecoleccion(doc),
        ].join('\n\n'),
        this.accionesRecoleccion(doc),
        this.serializarPlan(doc),
      );
    }

    const parametrosActualizados = { ...parametrosBase };
    for (const [nombre, recolectado] of Object.entries(recolectados)) {
      const anterior = parametrosActualizados[nombre];
      parametrosActualizados[nombre] = recolectado.valor;
      origenes[nombre] = {
        ...recolectado.origen,
        modificado: this.valorDefinido(anterior) && this.stableStringify(anterior) !== this.stableStringify(recolectado.valor),
      };
    }

    const casoId = this.texto(parametrosActualizados['caso_id']) || this.texto(casoIdEntrada) || this.texto(doc.caso_id);
    if (!casoId) {
      const borrador = this.construirBorradorRecoleccion(parametrosActualizados, doc.modo, ['caso_id'], this.texto(this.objeto(doc.pedido_original)['texto']), origenes);
      const actualizado = await this.actualizarRecoleccion(doc.id, '', borrador, doc.modo, origenes);
      return this.respuesta('recoleccion', undefined, this.textoRecoleccion(actualizado), this.accionesRecoleccion(actualizado), this.serializarPlan(actualizado));
    }

    const contexto = await this.contextoCaso(casoId);
    if (!contexto) {
      const borrador = this.construirBorradorRecoleccion(
        { ...parametrosActualizados, caso_id: casoId },
        doc.modo,
        ['caso_id'],
        this.texto(this.objeto(doc.pedido_original)['texto']),
        origenes,
      );
      const actualizado = await this.actualizarRecoleccion(doc.id, casoId, borrador, doc.modo, origenes);
      return this.respuesta(
        'recoleccion',
        casoId,
        [
          `No encontré el caso ${casoId} entre los casos QA activos.`,
          'Pasame un ID de caso guardado o importá el caso desde Pantalla 1.',
        ].join('\n\n'),
        this.accionesRecoleccion(actualizado),
        this.serializarPlan(actualizado),
      );
    }

    try {
      const casoGuardado = await this.guardarMetadataRecoleccion(contexto.caso, parametrosActualizados, origenes);
      const casoActual = await this.casoConDatasetActual(casoGuardado);
      const construido = this.construirPlan(casoActual, doc.modo, origenes);

      if (construido.parametros_pendientes.length) {
        const borrador = this.construirBorradorRecoleccion(
          { ...construido.parametros, ...parametrosActualizados },
          doc.modo,
          construido.parametros_pendientes,
          this.texto(this.objeto(doc.pedido_original)['texto']),
          origenes,
          casoId,
        );
        const actualizado = await this.actualizarRecoleccion(doc.id, casoId, borrador, doc.modo, origenes);
        return this.respuesta('recoleccion', casoId, this.textoRecoleccion(actualizado), this.accionesRecoleccion(actualizado), this.serializarPlan(actualizado));
      }

      const actualizado = await this.planes.findOneAndUpdate(
        { id: doc.id, estado: 'recolectando' },
        {
          $set: {
            caso_id: casoId,
            estado: 'plan_propuesto',
            parametros: this.parametrosConOrigenes(construido.parametros, origenes),
            parametros_pendientes: [],
            plan: construido.plan,
            versiones: this.versionesPlan(construido.plan),
            texto_mostrado: this.textoMostradoPlan(construido.plan, construido.hash_plan, construido.vence_en),
            hash_plan: construido.hash_plan,
            vence_en: construido.vence_en,
            abortado_motivo: '',
          },
        },
        { new: true },
      ).lean<QaPlanLean>();

      if (!actualizado) throw new BadRequestException('No se pudo convertir la recolección en plan QA.');

      const texto = [
        `Ya tengo todos los datos obligatorios para ${casoId}.`,
        'Revalidé el caso y el dataset reales antes de armar el plan.',
        `Plan propuesto: ${actualizado.id}.`,
        `Hash: ${actualizado.hash_plan.slice(0, 12)}.`,
        'Revisá los parámetros resueltos y aprobalo explícitamente si está correcto.',
      ].join('\n\n');

      return this.respuesta('plan', casoId, texto, this.accionesPlanPropuesto(actualizado), this.serializarPlan(actualizado));
    } catch (error) {
      const pendientes = this.parametrosPendientes(parametrosActualizados);
      const borrador = this.construirBorradorRecoleccion(
        { ...parametrosActualizados, caso_id: casoId },
        doc.modo,
        pendientes.length ? pendientes : ['dataset_codigo'],
        this.texto(this.objeto(doc.pedido_original)['texto']),
        origenes,
        casoId,
      );
      const actualizado = await this.actualizarRecoleccion(doc.id, casoId, borrador, doc.modo, origenes);
      return this.respuesta(
        'recoleccion',
        casoId,
        [
          `Tomé el dato, pero todavía no puedo proponer el plan para ${casoId}.`,
          this.mensajeExcepcion(error),
          this.textoRecoleccion(actualizado),
        ].join('\n\n'),
        this.accionesRecoleccion(actualizado),
        this.serializarPlan(actualizado),
      );
    }
  }

  private async persistirRecoleccion(
    casoId: string,
    construido: PlanConstruido,
    modo: ModoQaPlanAsistente,
    pedido: string,
    usuario?: UsuarioSesion,
  ): Promise<QaPlanLean> {
    const filtro: Record<string, unknown> = {
      estado: 'recolectando',
      caso_id: this.texto(casoId),
      ...this.filtroActor(usuario),
    };
    const update = {
      $set: {
        caso_id: this.texto(casoId),
        modo,
        estado: 'recolectando',
        pedido_original: {
          texto: pedido,
          canal: 'chat',
          recibido_en: new Date().toISOString(),
          usuario: usuario ? { id: usuario.id, correo: usuario.correo } : null,
        },
        actor: this.actorDesdeUsuario(usuario),
        ejecutor: this.ejecutorAgente(),
        versiones: this.versionesPlan(construido.plan),
        parametros: construido.parametros,
        parametros_pendientes: construido.parametros_pendientes,
        plan: construido.plan,
        texto_mostrado: this.textoMostradoPlan(construido.plan, construido.hash_plan, construido.vence_en),
        hash_plan: construido.hash_plan,
        vence_en: construido.vence_en,
        aprobacion: null,
        ejecucion_id: '',
        verificacion: null,
        abortado_motivo: '',
      },
      $setOnInsert: {
        id: this.nuevoPlanId(),
      },
    };

    const doc = await this.planes.findOneAndUpdate(filtro, update, { upsert: true, new: true, setDefaultsOnInsert: true }).lean<QaPlanLean>();
    if (!doc) throw new BadRequestException('No se pudo iniciar la recolección de parámetros QA.');
    return doc;
  }

  private async actualizarRecoleccion(
    id: string,
    casoId: string,
    construido: PlanConstruido,
    modo: ModoQaPlanAsistente,
    origenes: Record<string, OrigenParametroPlan>,
  ): Promise<QaPlanLean> {
    const actualizado = await this.planes.findOneAndUpdate(
      { id, estado: 'recolectando' },
      {
        $set: {
          caso_id: this.texto(casoId),
          modo,
          parametros: this.parametrosConOrigenes(construido.parametros, origenes),
          parametros_pendientes: construido.parametros_pendientes,
          plan: construido.plan,
          versiones: this.versionesPlan(construido.plan),
          texto_mostrado: this.textoMostradoPlan(construido.plan, construido.hash_plan, construido.vence_en),
          hash_plan: construido.hash_plan,
          vence_en: construido.vence_en,
        },
      },
      { new: true },
    ).lean<QaPlanLean>();
    if (!actualizado) throw new BadRequestException('No se pudo actualizar la recolección QA.');
    return actualizado;
  }

  private async buscarRecoleccionActiva(usuario?: UsuarioSesion, casoId?: string): Promise<QaPlanLean | null> {
    await this.sincronizarPlanes();
    const filtros: Record<string, unknown>[] = [];
    const actor = this.filtroActor(usuario);
    const caso = this.texto(casoId);
    if (caso) filtros.push({ estado: 'recolectando', caso_id: caso, ...actor });
    filtros.push({ estado: 'recolectando', caso_id: '', ...actor });
    return this.planes.findOne({ $or: filtros }).sort({ createdAt: -1 }).lean<QaPlanLean>();
  }

  private debeProcesarRecoleccion(
    mensaje: string,
    doc: QaPlanLean,
    casoIdEntrada: string | undefined,
    intencion: IntencionAsistente,
  ): boolean {
    if (!this.texto(mensaje)) return false;
    const normalizado = this.normalizarTexto(mensaje);
    if (this.contiene(normalizado, ['cancelar', 'descartar', 'olvidar'])) return false;
    const pendientes = doc.parametros_pendientes ?? [];
    const extraidos = this.extraerParametrosRecoleccion(mensaje, pendientes, this.parametrosSinMetadata(doc.parametros));
    if (Object.keys(extraidos).length > 0) return true;
    if (casoIdEntrada && pendientes.includes('caso_id')) return true;
    return intencion === 'plan' && pendientes.length > 0;
  }

  private construirBorradorRecoleccion(
    parametrosEntrada: Record<string, unknown>,
    modo: ModoQaPlanAsistente,
    pendientesEntrada: string[],
    pedido: string,
    origenesEntrada: Record<string, OrigenParametroPlan> = {},
    casoId?: string,
  ): PlanConstruido {
    const parametros = this.parametrosConOrigenes(
      {
        ...parametrosEntrada,
        ...(casoId ? { caso_id: casoId } : {}),
        modo,
      },
      origenesEntrada,
    );
    const pendientes = pendientesEntrada.length
      ? pendientesEntrada
      : this.parametrosPendientes(parametros);
    const venceEn = new Date(Date.now() + this.planTtlMs).toISOString();
    const resueltos = this.parametrosResueltosParciales(parametros, origenesEntrada);
    const plan = {
      tarea: {
        codigo: 'qa.auditoria_ganancias.recolectar_parametros',
        nombre: 'Recolectar parámetros para plan QA',
        definicion: {
          codigo: this.texto(parametrosEntrada['definicion_tecnica_codigo']) || QA_DEFINICION_TECNICA_DEFAULT,
          version: 1,
        },
      },
      objetivo: 'Completar los datos obligatorios antes de proponer un plan ejecutable.',
      alcance: this.texto(casoId) ? `Caso QA ${casoId}` : 'Caso QA pendiente de seleccionar',
      parametros_resueltos: resueltos,
      precondiciones: this.parametrosObligatoriosPlan.map((nombre) => {
        const meta = this.origenParametro(origenesEntrada, nombre, 'leido', `qa_casos.${nombre}`);
        return this.precondicion(
          `parametro_${nombre}`,
          `Parámetro obligatorio: ${nombre}`,
          parametros[nombre],
          meta.origen,
          meta.origen_ref,
        );
      }),
      impacto_real: 'No ejecuta Playwright ni modifica liquidaciones; solo prepara datos de la tarea QA.',
      pasos: [
        { orden: 1, descripcion: 'Registrar el dato respondido por el usuario con su origen.', escribe: true, irreversible: false },
        { orden: 2, descripcion: 'Revalidar caso, dataset, Excel y assertion contra el estado real del sistema.', escribe: false, irreversible: false },
        { orden: 3, descripcion: 'Proponer un plan con hash únicamente si no quedan parámetros pendientes.', escribe: false, irreversible: false },
      ],
      verificacion: `Parámetros pendientes: ${pendientes.join(', ') || 'ninguno'}`,
      riesgo: 'sin ejecución',
      requiere_aprobacion: false,
      gate_aprobacion: {
        tipo: 'bloqueo_por_parametros',
        motivo: 'La aprobación se habilita recién cuando existe un plan propuesto sin parámetros pendientes.',
      },
      politica_registro: this.politicaRegistro,
      pedido_original: pedido,
      vence_en: venceEn,
    };
    const hash = this.hashPlan({ estado: 'recolectando', parametros: this.parametrosSinMetadata(parametros), pendientes, modo });
    return {
      parametros,
      parametros_pendientes: pendientes,
      plan,
      hash_plan: hash,
      vence_en: venceEn,
    };
  }

  private textoRecoleccion(plan: QaPlanLean): string {
    const pendientes = plan.parametros_pendientes ?? [];
    const resueltos = this.parametrosResueltosParciales(plan.parametros, this.origenesDesdeParametros(plan.parametros));
    const siguiente = pendientes[0];
    return [
      `Estoy recolectando datos para armar un plan ejecutable${this.texto(plan.caso_id) ? ` del caso ${plan.caso_id}` : ''}.`,
      resueltos.length
        ? `Ya tengo: ${resueltos.map((parametro) => `${this.texto(parametro['nombre'])}=${this.texto(parametro['valor_display'])}`).join(', ')}.`
        : 'Todavía no tengo datos suficientes para identificar el caso.',
      pendientes.length ? `Faltan: ${pendientes.join(', ')}.` : 'No quedan parámetros pendientes.',
      siguiente ? this.preguntaParametro(siguiente) : 'Puedo proponer el plan con hash para aprobación.',
      'No ejecuto nada hasta que el plan quede completo y aprobado.',
    ].join('\n\n');
  }

  private preguntaParametro(nombre: string): string {
    const preguntas: Record<string, string> = {
      caso_id: 'Decime el ID del caso QA, por ejemplo: QA-GAN-IMP-010.',
      definicion_tecnica_codigo: 'Decime la definición técnica que debe usar el caso.',
      dataset_codigo: 'Decime el código dataset que corresponde al caso.',
      periodo: 'Decime el período del caso en formato MM/AAAA.',
      excel: 'Decime el nombre del Excel que debe cargar Playwright.',
      legajo: 'Decime el legajo esperado para validar contra el Excel.',
      campo: 'Decime el campo que debe validar la assertion.',
      esperado: 'Decime el valor esperado para comparar.',
    };
    return preguntas[nombre] ?? `Decime el valor para ${nombre}.`;
  }

  private accionesRecoleccion(plan: QaPlanLean): AccionAsistenteQa[] {
    const pendiente = (plan.parametros_pendientes ?? [])[0];
    return [
      ...(pendiente ? [{ tipo: 'preguntar' as const, etiqueta: 'Qué falta', mensaje: this.preguntaParametro(pendiente) }] : []),
      { tipo: 'navegar', etiqueta: 'Abrir Pantalla 1', ruta: '/qa/pantalla-1' },
      { tipo: 'preguntar', etiqueta: 'Importar datos', mensaje: 'Cómo importo datos masivos para QA.' },
    ];
  }

  private extraerParametrosRecoleccion(
    mensaje: string,
    pendientes: string[],
    parametrosActuales: Record<string, unknown>,
  ): Record<string, ParametroRecolectado> {
    const resultado: Record<string, ParametroRecolectado> = {};
    const candidatos = Array.from(new Set([...pendientes, 'modo']));
    for (const nombre of candidatos) {
      const directo = pendientes.length === 1 && pendientes[0] === nombre;
      const valor = this.extraerParametroDesdeMensaje(mensaje, nombre, directo);
      if (!valor) continue;
      const anterior = parametrosActuales[nombre];
      resultado[nombre] = {
        valor: valor.valor,
        origen: {
          origen: valor.origen,
          origen_ref: 'mensaje_usuario',
          modificado: this.valorDefinido(anterior) && this.stableStringify(anterior) !== this.stableStringify(valor.valor),
        },
      };
    }
    return resultado;
  }

  private extraerParametroDesdeMensaje(
    mensaje: string,
    nombre: string,
    permitirDirecto: boolean,
  ): { valor: unknown; origen: OrigenParametroTipo } | null {
    const texto = this.texto(mensaje);
    const normalizado = this.normalizarTexto(texto);
    if (!texto) return null;

    if (nombre === 'caso_id') {
      const caso = this.extraerCasoId(texto) || (permitirDirecto && /^QA-[A-Z0-9_-]+$/i.test(texto) ? texto.toUpperCase() : '');
      return caso ? { valor: caso, origen: 'respondido' } : null;
    }

    if (nombre === 'modo') {
      if (this.contiene(normalizado, ['rapido', 'start'])) return { valor: 'rapido', origen: 'normalizado' };
      if (this.contiene(normalizado, ['demo', 'visible', 'lento'])) return { valor: 'demo', origen: 'normalizado' };
      return null;
    }

    if (nombre === 'dataset_codigo') {
      const match = /\b(DS-[A-Z0-9_-]+)\b/i.exec(texto);
      return match ? { valor: match[1].toUpperCase(), origen: 'respondido' } : null;
    }

    if (nombre === 'definicion_tecnica_codigo') {
      const match = /\b(DEF-[A-Z0-9_-]+)\b/i.exec(texto);
      return match ? { valor: match[1].toUpperCase(), origen: 'respondido' } : null;
    }

    if (nombre === 'periodo') {
      const match = /\b((?:0?[1-9]|1[0-2])\/20\d{2}|20\d{2}-(?:0?[1-9]|1[0-2]))\b/.exec(texto);
      const periodo = match ? this.normalizarPeriodoRespuesta(match[1]) : permitirDirecto ? this.normalizarPeriodoRespuesta(texto) : '';
      return periodo ? { valor: periodo, origen: 'normalizado' } : null;
    }

    if (nombre === 'excel') {
      const match = /([^\s"'<>|]+\.xlsx?)/i.exec(texto);
      const valor = match ? this.nombreArchivo(match[1]) : permitirDirecto && /\.xlsx?$/i.test(texto) ? this.nombreArchivo(texto) : '';
      return valor ? { valor, origen: match?.[1] === valor ? 'respondido' : 'normalizado' } : null;
    }

    if (nombre === 'legajo') {
      const match = /\blegajo\s*(?:es|:|=)?\s*([A-Za-z0-9_-]+)/i.exec(texto);
      const valor = match?.[1] || (permitirDirecto && /^[A-Za-z0-9_-]{1,20}$/.test(texto) ? texto : '');
      return valor ? { valor, origen: 'respondido' } : null;
    }

    if (nombre === 'campo') {
      const explicit = /\bcampo\s*(?:es|:|=)?\s*([A-Za-z0-9_.-]+)/i.exec(texto)?.[1];
      const valor = explicit || this.campoDesdeLenguaje(normalizado) || (permitirDirecto && /^[A-Za-z0-9_.-]{3,80}$/.test(texto) ? texto : '');
      return valor ? { valor, origen: explicit ? 'respondido' : 'normalizado' } : null;
    }

    if (nombre === 'esperado') {
      const explicit = /\b(?:esperado|valor)\s*(?:es|:|=)?\s*(-?\$?\s*\d+(?:[.,]\d+)?)/i.exec(texto)?.[1];
      const valor = this.numeroRespuesta(explicit || (permitirDirecto ? texto : ''));
      return valor !== null ? { valor, origen: 'normalizado' } : null;
    }

    return null;
  }

  private async guardarMetadataRecoleccion(
    caso: Record<string, unknown>,
    parametros: Record<string, unknown>,
    origenes: Record<string, OrigenParametroPlan>,
  ): Promise<Record<string, unknown>> {
    const payload = this.payloadCasoConParametros(caso, parametros, origenes);
    return this.casos.guardar(payload);
  }

  private payloadCasoConParametros(
    caso: Record<string, unknown>,
    parametros: Record<string, unknown>,
    origenes: Record<string, OrigenParametroPlan>,
  ): Record<string, unknown> {
    const resumen = this.resumenCaso(caso);
    const archivo = this.objeto(caso['archivo']);
    const contexto = this.objeto(caso['contexto']);
    const empleado = this.objeto(contexto['empleado']);
    const liquidacion = this.objeto(contexto['liquidacion']);
    const resultado = this.objeto(caso['resultado_esperado']);
    const origen = this.objeto(caso['origen']);
    const asistenteQa = this.objeto(origen['asistente_qa']);

    const valor = (nombre: string, fallback: unknown): unknown =>
      this.valorDefinido(parametros[nombre]) ? parametros[nombre] : fallback;
    const excel = this.texto(valor('excel', resumen['excel']));
    const campo = this.texto(valor('campo', resumen['campo']));
    const esperado = valor('esperado', resumen['esperado']);
    const tolerancia = valor('tolerancia', resumen['tolerancia'] ?? 0.05);

    return {
      id: this.texto(valor('caso_id', resumen['id'])),
      definicion_tecnica_codigo: this.texto(valor('definicion_tecnica_codigo', resumen['definicion_tecnica_codigo'])) || QA_DEFINICION_TECNICA_DEFAULT,
      dataset_codigo: this.texto(valor('dataset_codigo', resumen['dataset_codigo'])),
      periodo: this.texto(valor('periodo', resumen['periodo'])),
      descripcion: this.texto(caso['descripcion']),
      archivo: excel
        ? {
            ...archivo,
            nombre: excel,
            mime: this.texto(archivo['mime']) || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            seleccionado_en: this.texto(archivo['seleccionado_en']) || new Date().toISOString(),
          }
        : archivo,
      contexto: {
        ...contexto,
        empleado: {
          ...empleado,
          legajo: this.texto(valor('legajo', this.texto(empleado['legajo']) || resumen['legajo'])),
          nombre: this.texto(valor('empleado', this.texto(empleado['nombre']) || resumen['empleado'])),
        },
        liquidacion,
      },
      resultado_esperado: {
        ...resultado,
        campo,
        valor: esperado,
        tolerancia,
        estado: this.texto(resultado['estado']) || this.texto(resumen['estado_esperado']) || 'validado',
      },
      assertions: [
        {
          campo,
          operador: 'igual',
          esperado,
          tolerancia,
        },
      ],
      origen: {
        ...origen,
        asistente_qa: {
          ...asistenteQa,
          parametros_origenes: this.serializarOrigenes(origenes),
          actualizado_en: new Date().toISOString(),
          politica_registro: this.politicaRegistro,
        },
      },
      activo: caso['activo'] === false ? false : true,
    };
  }

  private parametrosConOrigenes(
    parametros: Record<string, unknown>,
    origenes: Record<string, OrigenParametroPlan>,
  ): Record<string, unknown> {
    return {
      ...this.parametrosSinMetadata(parametros),
      __origenes: this.serializarOrigenes(origenes),
    };
  }

  private parametrosSinMetadata(parametros: unknown): Record<string, unknown> {
    const limpio = this.objeto(parametros);
    delete limpio['__origenes'];
    return limpio;
  }

  private origenesDesdeParametros(parametros: unknown): Record<string, OrigenParametroPlan> {
    return this.normalizarOrigenes(this.objeto(this.objeto(parametros)['__origenes']));
  }

  private origenesDesdePlan(plan: QaPlanLean): Record<string, OrigenParametroPlan> {
    const desdeParametros = this.normalizarOrigenes(this.objeto(this.objeto(plan.parametros)['__origenes']));
    const datosPlan = this.objeto(plan.plan);
    const parametrosResueltos = Array.isArray(datosPlan['parametros_resueltos'])
      ? datosPlan['parametros_resueltos'] as Record<string, unknown>[]
      : [];
    const desdePlan = parametrosResueltos.reduce<Record<string, OrigenParametroPlan>>((origenes, parametro) => {
      const nombre = this.texto(parametro['nombre']);
      const tipo = this.origenParametroValido(this.texto(parametro['origen']));
      if (!nombre || !tipo) return origenes;
      origenes[nombre] = {
        origen: tipo,
        origen_ref: this.texto(parametro['origen_ref']) || 'plan.parametros_resueltos',
        requiere_confirmacion: parametro['requiere_confirmacion'] === true,
        modificado: parametro['modificado'] === true,
      };
      return origenes;
    }, {});
    return {
      ...desdePlan,
      ...desdeParametros,
    };
  }

  private origenesParametrosDesdeCaso(caso: Record<string, unknown>): Record<string, OrigenParametroPlan> {
    const origen = this.objeto(caso['origen']);
    const asistenteQa = this.objeto(origen['asistente_qa']);
    return this.normalizarOrigenes(this.objeto(asistenteQa['parametros_origenes']));
  }

  private normalizarOrigenes(valor: Record<string, unknown>): Record<string, OrigenParametroPlan> {
    return Object.entries(valor).reduce<Record<string, OrigenParametroPlan>>((normalizados, [nombre, entrada]) => {
      const origen = this.objeto(entrada);
      const tipo = this.origenParametroValido(this.texto(origen['origen'])) || this.origenParametroValido(this.texto(origen['tipo']));
      if (!tipo) return normalizados;
      normalizados[nombre] = {
        origen: tipo,
        origen_ref: this.texto(origen['origen_ref']) || this.texto(origen['ref']) || 'metadata',
        requiere_confirmacion: origen['requiere_confirmacion'] === true,
        modificado: origen['modificado'] === true,
      };
      return normalizados;
    }, {});
  }

  private serializarOrigenes(origenes: Record<string, OrigenParametroPlan>): Record<string, unknown> {
    return Object.entries(origenes).reduce<Record<string, unknown>>((salida, [nombre, origen]) => {
      salida[nombre] = {
        origen: origen.origen,
        origen_ref: origen.origen_ref,
        requiere_confirmacion: origen.requiere_confirmacion === true,
        modificado: origen.modificado === true,
      };
      return salida;
    }, {});
  }

  private origenParametroValido(valor: string): OrigenParametroTipo | null {
    const permitidos: OrigenParametroTipo[] = ['dicho', 'normalizado', 'respondido', 'inferido', 'leido', 'default_definicion', 'heredado'];
    return permitidos.includes(valor as OrigenParametroTipo) ? valor as OrigenParametroTipo : null;
  }

  private origenParametro(
    origenes: Record<string, OrigenParametroPlan>,
    nombre: string,
    origenDefault: OrigenParametroTipo,
    refDefault: string,
  ): OrigenParametroPlan {
    return origenes[nombre] ?? {
      origen: origenDefault,
      origen_ref: refDefault,
      requiere_confirmacion: false,
      modificado: false,
    };
  }

  private parametrosResueltosParciales(
    parametrosEntrada: Record<string, unknown>,
    origenesEntrada: Record<string, OrigenParametroPlan>,
  ): Record<string, unknown>[] {
    const parametros = this.parametrosSinMetadata(parametrosEntrada);
    return Object.entries(parametros)
      .filter(([nombre, valor]) => !nombre.startsWith('__') && this.valorDefinido(valor))
      .map(([nombre, valor]) => {
        const meta = this.origenParametro(origenesEntrada, nombre, nombre === 'modo' ? 'dicho' : 'respondido', 'recoleccion_chat');
        return this.parametroResuelto(nombre, valor, meta.origen, meta.origen_ref, meta.requiere_confirmacion === true, meta.modificado === true);
      });
  }

  private normalizarPeriodoRespuesta(valor: string): string {
    const texto = this.texto(valor);
    const mesAnio = /^(0?[1-9]|1[0-2])\/(20\d{2})$/.exec(texto);
    if (mesAnio) return `${mesAnio[1].padStart(2, '0')}/${mesAnio[2]}`;
    const anioMes = /^(20\d{2})-(0?[1-9]|1[0-2])$/.exec(texto);
    if (anioMes) return `${anioMes[2].padStart(2, '0')}/${anioMes[1]}`;
    return '';
  }

  private nombreArchivo(valor: string): string {
    return this.texto(valor).split(/[\\/]/).filter(Boolean).pop() ?? '';
  }

  private campoDesdeLenguaje(normalizado: string): string {
    if (this.contiene(normalizado, ['retencion calculada', 'calculada por motor', 'calculo retencion calculada'])) {
      return 'calculo.retencion_calculada';
    }
    if (this.contiene(normalizado, ['retencion informada', 'retencion liquidada', 'retencion excel'])) {
      return 'calculo.retencion_excel';
    }
    return '';
  }

  private numeroRespuesta(valor: string): number | null {
    const texto = this.texto(valor).replace(/\$/g, '').replace(/\s/g, '').replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(texto)) return null;
    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : null;
  }

  private filtroActor(usuario?: UsuarioSesion): Record<string, unknown> {
    return usuario?.correo ? { 'actor.correo': usuario.correo } : {};
  }

  private nuevoPlanId(): string {
    return `QA-PLAN-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  }

  private actorDesdeUsuario(usuario?: UsuarioSesion): Record<string, unknown> {
    return {
      usuario_id: usuario?.id ?? 'usuario-desconocido',
      correo: usuario?.correo ?? 'desconocido',
      rol: 'usuario',
      empresa_id: 'sandbox-local',
    };
  }

  private ejecutorAgente(): Record<string, unknown> {
    return {
      tipo: 'agente',
      nombre: 'Asistente QA',
      version: this.ejecutorVersion,
    };
  }

  private versionesPlan(plan: Record<string, unknown>): Record<string, unknown> {
    const tarea = this.objeto(plan['tarea']);
    const definicion = this.objeto(tarea['definicion']);
    return {
      definicion: {
        codigo: this.texto(definicion['codigo']) || QA_DEFINICION_TECNICA_DEFAULT,
        version: this.numero(definicion['version']) ?? 1,
      },
      script: this.runnerScriptVersion,
      asistente: this.ejecutorVersion,
    };
  }

  private textoMostradoPlan(plan: Record<string, unknown>, hashPlan: string, venceEn: string): string {
    const tarea = this.objeto(plan['tarea']);
    const definicion = this.objeto(tarea['definicion']);
    const parametros = Array.isArray(plan['parametros_resueltos']) ? plan['parametros_resueltos'] as Record<string, unknown>[] : [];
    const precondiciones = Array.isArray(plan['precondiciones']) ? plan['precondiciones'] as Record<string, unknown>[] : [];
    const pasos = Array.isArray(plan['pasos']) ? plan['pasos'] as Record<string, unknown>[] : [];

    return [
      `Tarea: ${this.texto(tarea['nombre']) || this.texto(plan['objetivo'])}.`,
      `Definición: ${this.texto(definicion['codigo']) || QA_DEFINICION_TECNICA_DEFAULT} v${this.numero(definicion['version']) ?? 1}.`,
      'Parámetros resueltos:',
      ...parametros.map((parametro) => `- ${this.texto(parametro['nombre'])}: ${this.texto(parametro['valor_display']) || this.valorLegible(parametro['valor'])} (${this.texto(parametro['origen'])}).`),
      'Precondiciones verificadas:',
      ...precondiciones.map((precondicion) => `- ${this.texto(precondicion['texto'])}: ${this.texto(precondicion['estado'])}.`),
      'Pasos:',
      ...pasos.map((paso) => `- ${this.numero(paso['orden']) ?? '-'}: ${this.texto(paso['descripcion'])}${paso['escribe'] ? ' [escribe registro]' : ''}${paso['irreversible'] ? ' [irreversible]' : ''}.`),
      `Impacto real: ${this.texto(plan['impacto_real'])}.`,
      `Riesgo: ${this.texto(plan['riesgo'])}.`,
      `Verificación: ${this.texto(plan['verificacion'])}.`,
      `Hash: ${hashPlan}.`,
      `Vence: ${venceEn}.`,
    ].filter((linea) => this.texto(linea)).join('\n');
  }

  private construirPlan(
    caso: Record<string, unknown>,
    modo: ModoQaPlanAsistente,
    origenesEntrada: Record<string, OrigenParametroPlan> = {},
    usarOrigenesCaso = true,
  ): PlanConstruido {
    const resumen = this.resumenCaso(caso);
    const dataset = this.objeto(caso['dataset']);
    const fuente = this.objeto(dataset['fuente_normativa']);
    const origenes = {
      ...(usarOrigenesCaso ? this.origenesParametrosDesdeCaso(caso) : {}),
      ...origenesEntrada,
    };
    const campo = this.texto(resumen['campo']);
    const esperado = resumen['esperado'];
    const tolerancia = resumen['tolerancia'] ?? 0.05;
    const definicionTecnicaCodigo = this.texto(resumen['definicion_tecnica_codigo']) || QA_DEFINICION_TECNICA_DEFAULT;
    const parametros = {
      caso_id: this.texto(resumen['id']),
      definicion_tecnica_codigo: definicionTecnicaCodigo,
      dataset_codigo: this.texto(resumen['dataset_codigo']),
      periodo: this.texto(resumen['periodo']),
      excel: this.texto(resumen['excel']),
      legajo: this.texto(resumen['legajo']),
      empleado: this.texto(resumen['empleado']),
      campo,
      esperado,
      tolerancia,
      modo,
    };
    const pendientes = this.parametrosPendientes(parametros);
    const parametrosResueltos = this.parametrosResueltos(parametros, dataset, origenes);
    const precondiciones = [
      this.precondicion('caso_activo', 'Caso QA guardado y activo', parametros.caso_id, 'leido', 'qa_casos.id'),
      this.precondicion('definicion_tecnica', 'Definición técnica asociada al caso', definicionTecnicaCodigo, definicionTecnicaCodigo === QA_DEFINICION_TECNICA_DEFAULT ? 'default_definicion' : 'leido', 'qa_casos.definicion_tecnica_codigo'),
      this.precondicion('dataset_validado', 'Dataset validado', this.texto(dataset['estado']) === 'validado', 'leido', 'datasets.estado'),
      this.precondicion('periodo_dataset', 'Período del caso coincide con el dataset', this.texto(dataset['periodo']) === parametros.periodo, 'leido', 'datasets.periodo'),
      this.precondicion('fuente_normativa', 'Fuente normativa disponible', this.texto(fuente['ref']), 'leido', 'datasets.fuente_normativa.ref'),
      this.precondicion('excel_referenciado', 'Excel referenciado para Playwright', parametros.excel, 'leido', 'qa_casos.archivo.nombre'),
      this.precondicion('assertion_definida', 'Campo y valor esperado definidos', this.valorDefinido(parametros.esperado) && Boolean(parametros.campo), 'leido', 'qa_casos.resultado_esperado'),
    ];
    const venceEn = new Date(Date.now() + this.planTtlMs).toISOString();
    const plan = {
      tarea: {
        codigo: 'qa.auditoria_ganancias.ejecutar_caso',
        nombre: 'Ejecutar caso QA de auditoría de ganancias',
        definicion: {
          codigo: definicionTecnicaCodigo,
          version: this.numero(this.objeto(caso['definicion_tecnica'])['version']) ?? 1,
        },
      },
      objetivo: `Ejecutar control QA del caso ${parametros.caso_id}`,
      alcance: `Un caso QA, período ${parametros.periodo}, legajo ${parametros.legajo}`,
      parametros_resueltos: parametrosResueltos,
      precondiciones,
      impacto_real: 'No modifica liquidaciones ni datos productivos; corre Playwright y registra evidencia de QA.',
      pasos: [
        { orden: 1, descripcion: `Usar definición técnica ${parametros.definicion_tecnica_codigo}.`, escribe: false, irreversible: false },
        { orden: 2, descripcion: `Usar dataset ${parametros.dataset_codigo}.`, escribe: false, irreversible: false },
        { orden: 3, descripcion: `Cargar Excel ${parametros.excel}.`, escribe: false, irreversible: false },
        { orden: 4, descripcion: `Validar período ${parametros.periodo} y legajo ${parametros.legajo}.`, escribe: false, irreversible: false },
        { orden: 5, descripcion: 'Ejecutar análisis de ganancias en la pantalla objetivo.', escribe: false, irreversible: false },
        { orden: 6, descripcion: `Comparar ${campo} contra ${this.texto(esperado)} con tolerancia ${this.texto(tolerancia)}.`, escribe: false, irreversible: false },
        { orden: 7, descripcion: 'Registrar resultado, traza y evidencia de QA.', escribe: true, irreversible: false },
      ],
      verificacion: `${campo} igual a ${this.texto(esperado)} con tolerancia ${this.texto(tolerancia)}`,
      riesgo: 'reversible',
      requiere_aprobacion: true,
      gate_aprobacion: {
        tipo: 'confirmacion_simple',
        motivo: 'Aunque es reversible y no toca datos productivos, la documentación exige aprobación explícita antes de ejecutar.',
      },
      politica_registro: this.politicaRegistro,
      vence_en: venceEn,
    };
    const { vence_en, ...planParaHash } = plan;
    void vence_en;
    const hash = this.hashPlan(this.valorHashPlan(parametros, planParaHash));
    return {
      parametros,
      parametros_pendientes: pendientes,
      plan,
      hash_plan: hash,
      vence_en: venceEn,
    };
  }

  private parametrosPendientes(parametros: Record<string, unknown>): string[] {
    return this.parametrosObligatoriosPlan.filter((nombre) => !this.valorDefinido(parametros[nombre]));
  }

  private parametrosResueltos(
    parametros: Record<string, unknown>,
    dataset: Record<string, unknown>,
    origenes: Record<string, OrigenParametroPlan> = {},
  ): Record<string, unknown>[] {
    const origenCaso = this.origenParametro(origenes, 'caso_id', 'leido', 'qa_casos.id');
    const origenDefinicion = this.origenParametro(
      origenes,
      'definicion_tecnica_codigo',
      this.texto(parametros['definicion_tecnica_codigo']) === QA_DEFINICION_TECNICA_DEFAULT ? 'default_definicion' : 'leido',
      'qa_casos.definicion_tecnica_codigo',
    );
    const origenDataset = this.origenParametro(origenes, 'dataset_codigo', 'leido', 'qa_casos.dataset_codigo');
    const origenPeriodo = this.origenParametro(origenes, 'periodo', 'leido', 'qa_casos.periodo');
    const origenExcel = this.origenParametro(origenes, 'excel', 'leido', 'qa_casos.archivo.nombre');
    const origenLegajo = this.origenParametro(origenes, 'legajo', 'leido', 'qa_casos.contexto.empleado.legajo');
    const origenEmpleado = this.origenParametro(origenes, 'empleado', 'leido', 'qa_casos.contexto.empleado.nombre');
    const origenCampo = this.origenParametro(origenes, 'campo', 'leido', 'qa_casos.resultado_esperado.campo');
    const origenEsperado = this.origenParametro(origenes, 'esperado', 'leido', 'qa_casos.resultado_esperado.valor');
    const origenTolerancia = this.origenParametro(origenes, 'tolerancia', 'leido', 'qa_casos.resultado_esperado.tolerancia');
    const origenModo = this.origenParametro(origenes, 'modo', 'dicho', 'pedido_original.texto');
    return [
      this.parametroResuelto('caso_id', parametros['caso_id'], origenCaso.origen, origenCaso.origen_ref, origenCaso.requiere_confirmacion, origenCaso.modificado),
      this.parametroResuelto(
        'definicion_tecnica_codigo',
        parametros['definicion_tecnica_codigo'],
        origenDefinicion.origen,
        origenDefinicion.origen_ref,
        origenDefinicion.requiere_confirmacion ?? this.texto(parametros['definicion_tecnica_codigo']) === QA_DEFINICION_TECNICA_DEFAULT,
        origenDefinicion.modificado,
      ),
      this.parametroResuelto('dataset_codigo', parametros['dataset_codigo'], origenDataset.origen, origenDataset.origen_ref, origenDataset.requiere_confirmacion, origenDataset.modificado),
      this.parametroResuelto('periodo', parametros['periodo'], origenPeriodo.origen, origenPeriodo.origen_ref, origenPeriodo.requiere_confirmacion, origenPeriodo.modificado),
      this.parametroResuelto('periodo_dataset', dataset['periodo'], 'leido', 'datasets.periodo'),
      this.parametroResuelto('excel', parametros['excel'], origenExcel.origen, origenExcel.origen_ref, origenExcel.requiere_confirmacion, origenExcel.modificado),
      this.parametroResuelto('legajo', parametros['legajo'], origenLegajo.origen, origenLegajo.origen_ref, origenLegajo.requiere_confirmacion, origenLegajo.modificado),
      this.parametroResuelto('empleado', parametros['empleado'], origenEmpleado.origen, origenEmpleado.origen_ref, origenEmpleado.requiere_confirmacion, origenEmpleado.modificado),
      this.parametroResuelto('campo', parametros['campo'], origenCampo.origen, origenCampo.origen_ref, origenCampo.requiere_confirmacion, origenCampo.modificado),
      this.parametroResuelto('esperado', parametros['esperado'], origenEsperado.origen, origenEsperado.origen_ref, origenEsperado.requiere_confirmacion, origenEsperado.modificado),
      this.parametroResuelto('tolerancia', parametros['tolerancia'], origenTolerancia.origen, origenTolerancia.origen_ref, origenTolerancia.requiere_confirmacion, origenTolerancia.modificado),
      this.parametroResuelto('modo', parametros['modo'], origenModo.origen, origenModo.origen_ref, origenModo.requiere_confirmacion, origenModo.modificado),
    ];
  }

  private parametroResuelto(
    nombre: string,
    valor: unknown,
    origen: OrigenParametroTipo,
    origenRef: string,
    requiereConfirmacion = false,
    modificado = false,
  ): Record<string, unknown> {
    return {
      nombre,
      valor,
      valor_display: this.texto(valor) || '-',
      origen,
      origen_ref: origenRef,
      requiere_confirmacion: requiereConfirmacion,
      resuelto_en: new Date().toISOString(),
      modificado,
    };
  }

  private precondicion(
    codigo: string,
    texto: string,
    valor: unknown,
    origen: OrigenParametroTipo,
    origenRef: string,
  ): Record<string, unknown> {
    const verificada = typeof valor === 'boolean' ? valor : this.valorDefinido(valor);
    return {
      codigo,
      texto,
      estado: verificada ? 'verificado' : 'pendiente',
      origen,
      origen_ref: origenRef,
      valor,
    };
  }

  private validarPlanAprobable(plan: QaPlanLean): void {
    if (this.planVencido(plan)) {
      void this.marcarPlanVencido(plan.id);
      throw new ConflictException('El plan venció. Generá un plan nuevo.');
    }
    if (plan.parametros_pendientes.length) {
      throw new BadRequestException('No se puede aprobar un plan con parámetros pendientes.');
    }
    if (plan.estado !== 'plan_propuesto') {
      throw new ConflictException(`El plan no está en estado plan_propuesto; estado actual=${plan.estado}.`);
    }
  }

  private validarPlanEjecutable(plan: QaPlanLean): void {
    if (this.planVencido(plan)) {
      void this.marcarPlanVencido(plan.id);
      throw new ConflictException('El plan aprobado venció. Generá un plan nuevo.');
    }
    if (plan.estado !== 'aprobado') {
      throw new ConflictException(`El plan debe estar aprobado antes de ejecutar; estado actual=${plan.estado}.`);
    }
    if (!plan.aprobacion || this.texto(plan.aprobacion['hash_plan']) !== plan.hash_plan) {
      throw new ConflictException('El plan no tiene aprobación válida con hash coincidente.');
    }
  }

  private async sincronizarPlanes(): Promise<void> {
    const ejecutando = await this.planes.find({ estado: 'ejecutando', ejecucion_id: { $exists: true, $ne: '' } }).lean<QaPlanLean[]>();
    for (const plan of ejecutando) {
      const ejecucion = await this.ejecuciones.findOne({ id: plan.ejecucion_id }).lean<QaEjecucionLean>();
      if (!ejecucion || ejecucion.estado === 'corriendo') continue;
      await this.planes.updateOne(
        { id: plan.id, estado: 'ejecutando' },
        {
          $set: {
            estado: ejecucion.estado === 'verde' ? 'verificado' : 'fallido',
            verificacion: {
              ...(this.objeto(plan.verificacion)),
              finalizada_en: new Date().toISOString(),
              estado: ejecucion.estado,
              detalle: ejecucion.detalle,
              evidencia_path: ejecucion.evidencia_path,
              resultado: ejecucion.resultado ?? null,
              evidencia: ejecucion.evidencia ?? null,
              capturas: ejecucion.capturas ?? [],
              ejecucion: this.resumenEjecucion(ejecucion),
            },
          },
        },
      );
    }

    await this.planes.updateMany(
      { estado: { $in: ['recolectando', 'plan_propuesto', 'aprobado'] }, vence_en: { $lt: new Date().toISOString() } },
      { $set: { estado: 'vencido', abortado_motivo: 'El plan o recolección venció antes de ejecutarse.' } },
    );
  }

  private async listarUltimosPlanes(): Promise<QaPlanLean[]> {
    await this.sincronizarPlanes();
    return this.planes
      .aggregate<QaPlanLean>([
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$caso_id', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { createdAt: -1 } },
      ])
      .exec();
  }

  private async listarUltimasEjecuciones(): Promise<QaEjecucionLean[]> {
    return this.ejecuciones
      .aggregate<QaEjecucionLean>([
        { $sort: { iniciado_en: -1 } },
        { $group: { _id: '$caso_id', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { iniciado_en: -1 } },
      ])
      .exec();
  }

  private async contextoCaso(casoId: string): Promise<ContextoCasoQa | null> {
    try {
      const caso = await this.casos.obtener(casoId);
      return {
        caso,
        ejecucion: await this.ultimaEjecucion(casoId),
      };
    } catch {
      return null;
    }
  }

  private async casoConDatasetActual(caso: Record<string, unknown>): Promise<Record<string, unknown>> {
    const dataset = await this.datasets.resolverParaCaso(
      this.texto(caso['dataset_codigo']),
      this.texto(caso['periodo']),
    );
    return {
      ...caso,
      dataset,
      dataset_codigo: dataset.codigo,
      periodo: this.texto(caso['periodo']) || dataset.periodo,
    };
  }

  private async ultimaEjecucion(casoId: string): Promise<QaEjecucionLean | null> {
    return this.ejecuciones.findOne({ caso_id: casoId }).sort({ iniciado_en: -1 }).lean<QaEjecucionLean>();
  }

  private async obtenerPlanDoc(id: string): Promise<QaPlanLean> {
    await this.sincronizarPlanes();
    const doc = await this.planes.findOne({ id: this.texto(id) }).lean<QaPlanLean>();
    if (!doc) throw new NotFoundException('Plan QA inexistente.');
    return doc;
  }

  private async marcarPlanAbortado(id: string, motivo: string): Promise<void> {
    await this.planes.updateOne({ id }, { $set: { estado: 'abortado', abortado_motivo: motivo } });
  }

  private async marcarPlanVencido(id: string): Promise<void> {
    await this.planes.updateOne({ id }, { $set: { estado: 'vencido', abortado_motivo: 'El plan venció antes de ejecutarse.' } });
  }

  private planVencido(plan: QaPlanLean): boolean {
    return Date.parse(plan.vence_en) <= Date.now();
  }

  private detectarIntencion(mensaje: string): IntencionAsistente {
    const normalizado = this.normalizarTexto(mensaje);
    if (this.contiene(normalizado, ['importar', 'importacion', 'masivo', 'excel de casos', 'plantilla'])) return 'importacion';
    if (this.contiene(normalizado, ['evidencia', 'captura', 'capturas', 'video', 'trace', 'traza'])) return 'evidencia';
    if (this.contiene(normalizado, ['dataset', 'regla', 'normativa', 'vigencia'])) return 'dataset';
    if (this.contiene(normalizado, ['corregir', 'arreglar', 'cambiar', 'solucion', 'reparar'])) return 'correccion';
    if (this.contiene(normalizado, ['plan', 'ejecutar', 'start', 'demo', 'correr', 'probar', 'aprobar'])) return 'plan';
    if (this.contiene(normalizado, ['fallo', 'falla', 'rojo', 'error', 'porque', 'por que', 'advertencia'])) return 'diagnostico';
    return 'resumen';
  }

  private hallazgoDesdeDetalle(detalle: string): HallazgoDiagnostico {
    const texto = this.texto(detalle);
    if (!texto) {
      return {
        codigo: 'sin_detalle',
        motivo: 'La ejecución no dejó un detalle técnico claro.',
        explicacion: 'El runner marcó el resultado, pero no dejó suficiente información para clasificar la causa.',
        revision: 'Abrí la evidencia de la corrida o repetí en modo Demo para capturar más contexto.',
      };
    }

    const legajo = /legajo del caso QA:\s*esperado\s+([^,]+),\s*detectado\s+([^.]+)/i.exec(texto);
    if (legajo) {
      return {
        codigo: 'excel_legajo',
        motivo: `El Excel es de otro legajo: el caso esperaba ${legajo[1].trim()} y el archivo mostró ${legajo[2].trim()}.`,
        explicacion: 'Playwright bloqueó la corrida porque el archivo cargado no corresponde al empleado que el caso dice validar.',
        revision: 'Revisá el legajo del caso y el nombre/contenido del Excel. Ambos tienen que coincidir con el mismo empleado.',
      };
    }

    const periodo = /per[ií]odo del caso QA:\s*esperado\s+([^,]+),\s*detectado\s+([^(.\n]+)/i.exec(texto);
    if (periodo) {
      return {
        codigo: 'excel_periodo',
        motivo: `El Excel es de otro período: el caso esperaba ${periodo[1].trim()} y el archivo mostró ${periodo[2].trim()}.`,
        explicacion: 'El caso y el Excel no están hablando del mismo mes de liquidación.',
        revision: 'Usá un Excel del período correcto o creá un caso QA para el período real del archivo.',
      };
    }

    const dataset = /periodo caso=([^ ]+)\s+distinto de dataset=([^ ]+)/i.exec(texto);
    if (dataset || /dataset .*no puede usarse/i.test(texto)) {
      return {
        codigo: 'dataset',
        motivo: 'El dataset no cumple las condiciones para el caso QA.',
        explicacion: 'El backend evita mezclar reglas normativas de un período con casos de otro período o datasets incompletos.',
        revision: 'Elegí un dataset validado del mismo período del caso y con fuente normativa completa.',
      };
    }

    const assertion = /([^:]+):\s*esperado\s+([^,]+),\s*actual\s+([^,]+),\s*diferencia\s+([^,]+),\s*tolerancia\s+([^\n]+)/i.exec(texto);
    if (assertion) {
      return {
        codigo: 'assertion',
        motivo: `${assertion[1].trim()} no coincide: esperado ${assertion[2].trim()}, actual ${assertion[3].trim()}.`,
        explicacion: `La diferencia fue ${assertion[4].trim()} y la tolerancia permitida era ${assertion[5].trim()}.`,
        revision: 'Confirmá si el esperado está bien cargado. Si lo está, el fallo indica una diferencia real del cálculo.',
      };
    }

    if (/no encontr|enoent|no existe|archivo|excel/i.test(texto)) {
      return {
        codigo: 'archivo',
        motivo: 'El runner tuvo un problema para encontrar o cargar el Excel.',
        explicacion: 'El caso guarda una referencia al archivo, pero Playwright necesita que el Excel exista en la carpeta configurada.',
        revision: 'Verificá que el archivo esté disponible en la carpeta de Excels esperada y que el nombre coincida exactamente.',
      };
    }

    if (/strict mode violation|locator|timeout|waiting for/i.test(texto)) {
      return {
        codigo: 'pantalla',
        motivo: 'Playwright falló interactuando con la pantalla.',
        explicacion: 'No parece un fallo de negocio sino de automatización, selector o estado visual de la UI.',
        revision: 'Revisá si cambió la pantalla, si hay dos controles iguales o si la app no terminó de renderizar.',
      };
    }

    return {
      codigo: 'generico',
      motivo: 'La ejecución terminó en rojo.',
      explicacion: 'No pude clasificar el error con una regla conocida, pero el detalle técnico trae la pista principal.',
      revision: 'Miraría primero el detalle técnico, luego el Excel usado, el dataset y la assertion del caso.',
    };
  }

  private textoImportacion(): string {
    return [
      'Para importar muchos casos, conviene usar Excel o CSV con una fila por caso QA.',
      'Columnas esperadas: id_caso, dataset_codigo, periodo, archivo_excel, cliente, modo_saldo_favor, legajo, empleado, cuil, remuneracion_bruta, deducciones, campo_validar, valor_esperado, tolerancia, estado_esperado.',
      'Cada fila crea un caso. El Excel indicado en archivo_excel no se copia al sistema: queda como referencia para Playwright.',
      'Después de importar, cada caso igualmente debe tener plan aprobado antes de ejecutarse desde el chat.',
    ].join('\n\n');
  }

  private lineaValidacionEvidencia(validacion: Record<string, unknown>): string {
    const estado = this.texto(validacion['estado']) === 'ok' ? 'OK' : 'FALLO';
    const campo = this.texto(validacion['campo']) || 'validación';
    const esperado = this.valorLegible(validacion['esperado']);
    const actual = this.valorLegible(validacion['actual']);
    const tolerancia = validacion['tolerancia'] === null || validacion['tolerancia'] === undefined
      ? '-'
      : this.valorLegible(validacion['tolerancia']);
    return `- ${estado} ${campo}: esperado ${esperado}, actual ${actual}, tolerancia ${tolerancia}.`;
  }

  private textoBienvenida(): string {
    return [
      'Soy el asistente QA de Auditoría de Ganancias.',
      'Puedo diagnosticar, proponer planes, pedir aprobación y disparar ejecuciones controladas.',
      'La regla central es simple: sin datos completos y sin plan aprobado, no ejecuto.',
    ].join('\n\n');
  }

  private accionesCaso(casoId: string, ejecucion?: QaEjecucionLean | null): AccionAsistenteQa[] {
    const acciones: AccionAsistenteQa[] = [
      { tipo: 'preguntar', etiqueta: 'Por qué falló', mensaje: `Por qué falló ${casoId}` },
      { tipo: 'preguntar', etiqueta: 'Plan de ejecución', mensaje: `Armame el plan de ejecución para ${casoId}` },
      { tipo: 'preguntar', etiqueta: 'Cómo corregir', mensaje: `Cómo corregir ${casoId}` },
      { tipo: 'navegar', etiqueta: 'Abrir Pantalla 1', ruta: '/qa/pantalla-1' },
    ];
    if (ejecucion?.evidencia_path) acciones.push({ tipo: 'ver_evidencia', etiqueta: 'Ver evidencia', mensaje: ejecucion.evidencia_path });
    return acciones;
  }

  private accionesPlanPropuesto(plan: QaPlanLean): AccionAsistenteQa[] {
    return [
      { tipo: 'aprobar_plan', etiqueta: 'Aprobar plan', plan_id: plan.id, hash_plan: plan.hash_plan },
      { tipo: 'preguntar', etiqueta: 'Qué valida', mensaje: `Qué valida el dataset del caso ${plan.caso_id}` },
      { tipo: 'navegar', etiqueta: 'Abrir Pantalla 1', ruta: '/qa/pantalla-1' },
    ];
  }

  private accionesPlanAprobado(plan: QaPlanLean): AccionAsistenteQa[] {
    return [
      { tipo: 'ejecutar_plan', etiqueta: plan.modo === 'demo' ? 'Ejecutar Demo' : 'Ejecutar Start', plan_id: plan.id, hash_plan: plan.hash_plan },
      { tipo: 'preguntar', etiqueta: 'Ver plan', mensaje: `Mostrame el plan ${plan.id}` },
    ];
  }

  private accionesSegunPlan(plan: QaPlanLean): AccionAsistenteQa[] {
    if (plan.estado === 'recolectando') return this.accionesRecoleccion(plan);
    if (plan.estado === 'plan_propuesto') return this.accionesPlanPropuesto(plan);
    if (plan.estado === 'aprobado') return this.accionesPlanAprobado(plan);
    const acciones: AccionAsistenteQa[] = [
      { tipo: 'preguntar', etiqueta: 'Diagnóstico', mensaje: `Por qué falló ${plan.caso_id}` },
      { tipo: 'navegar', etiqueta: 'Abrir Pantalla 1', ruta: '/qa/pantalla-1' },
    ];
    const evidenciaPath = this.texto(this.objeto(plan.verificacion)['evidencia_path']);
    if (evidenciaPath) acciones.unshift({ tipo: 'ver_evidencia', etiqueta: 'Ver evidencia', mensaje: evidenciaPath });
    return acciones;
  }

  private accionesGenerales(): AccionAsistenteQa[] {
    return [
      { tipo: 'preguntar', etiqueta: 'Resumen de casos', mensaje: 'Mostrame el resumen de casos QA activos.' },
      { tipo: 'preguntar', etiqueta: 'Importar datos', mensaje: 'Cómo importo datos masivos para QA.' },
      { tipo: 'navegar', etiqueta: 'Abrir Pantalla 1', ruta: '/qa/pantalla-1' },
    ];
  }

  private respuesta(
    tipo: TipoRespuestaAsistente,
    casoId: string | undefined,
    texto: string,
    acciones: AccionAsistenteQa[],
    plan?: Record<string, unknown>,
  ): RespuestaAsistenteQa {
    return {
      id: `ASIS-QA-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`,
      rol: 'assistant',
      generado_en: new Date().toISOString(),
      tipo,
      ...(casoId ? { caso_id: casoId } : {}),
      texto,
      acciones,
      ...(plan ? { plan } : {}),
      politica_registro: this.politicaRegistro,
    };
  }

  private resumenCaso(caso: Record<string, unknown>): Record<string, unknown> {
    const contexto = this.objeto(caso['contexto']);
    const empleado = this.objeto(contexto['empleado']);
    const archivo = this.objeto(caso['archivo']);
    const resultado = this.objeto(caso['resultado_esperado']);

    return {
      id: this.texto(caso['id']),
      definicion_tecnica_codigo: this.texto(caso['definicion_tecnica_codigo']) || QA_DEFINICION_TECNICA_DEFAULT,
      dataset_codigo: this.texto(caso['dataset_codigo']),
      periodo: this.texto(caso['periodo']),
      descripcion: this.texto(caso['descripcion']),
      excel: this.texto(archivo['nombre']),
      legajo: this.texto(empleado['legajo']),
      empleado: this.texto(empleado['nombre']),
      campo: this.texto(resultado['campo']),
      esperado: resultado['valor'] ?? resultado['retencion_ganancias'] ?? null,
      tolerancia: resultado['tolerancia'] ?? null,
      estado_esperado: this.texto(resultado['estado']),
    };
  }

  private resumenEjecucion(ejecucion: QaEjecucionLean | null): Record<string, unknown> | null {
    if (!ejecucion) return null;
    return {
      id: ejecucion.id,
      caso_id: ejecucion.caso_id,
      modo: ejecucion.modo,
      estado: ejecucion.estado,
      iniciado_en: ejecucion.iniciado_en,
      finalizado_en: ejecucion.finalizado_en,
      detalle: ejecucion.detalle,
      evidencia_path: ejecucion.evidencia_path,
      evidencia: ejecucion.evidencia ?? null,
      capturas: ejecucion.capturas ?? [],
    };
  }

  private resumenPlan(plan: QaPlanLean | null): Record<string, unknown> | null {
    if (!plan) return null;
    return {
      id: plan.id,
      caso_id: plan.caso_id,
      modo: plan.modo,
      estado: plan.estado,
      hash_plan: plan.hash_plan,
      vence_en: plan.vence_en,
      aprobacion: plan.aprobacion ?? null,
      parametros_pendientes: plan.parametros_pendientes ?? [],
      ejecucion_id: plan.ejecucion_id,
      verificacion: plan.verificacion ?? null,
      abortado_motivo: plan.abortado_motivo,
    };
  }

  private serializarPlan(plan: QaPlanLean): Record<string, unknown> {
    const { _id, ...resto } = plan;
    void _id;
    return resto as Record<string, unknown>;
  }

  private hashPlan(valor: unknown): string {
    return createHash('sha256').update(this.stableStringify(valor)).digest('hex');
  }

  private valorHashPlan(parametros: Record<string, unknown>, plan: Record<string, unknown>): Record<string, unknown> {
    return {
      parametros,
      plan: {
        tarea: plan['tarea'],
        objetivo: plan['objetivo'],
        alcance: plan['alcance'],
        parametros_resueltos: this.omitirCamposVolatiles(plan['parametros_resueltos']),
        precondiciones: plan['precondiciones'],
        impacto_real: plan['impacto_real'],
        pasos: plan['pasos'],
        verificacion: plan['verificacion'],
        riesgo: plan['riesgo'],
        requiere_aprobacion: plan['requiere_aprobacion'],
        gate_aprobacion: plan['gate_aprobacion'],
        politica_registro: plan['politica_registro'],
      },
    };
  }

  private diferenciasPlan(planAprobado: QaPlanLean, reconstruido: PlanConstruido): DiferenciaPlan[] {
    const diferencias: DiferenciaPlan[] = [];
    const actual = reconstruido.parametros;
    for (const [campo, aprobado] of Object.entries(planAprobado.parametros ?? {})) {
      if (campo.startsWith('__')) continue;
      const valorActual = actual[campo];
      if (this.stableStringify(aprobado) !== this.stableStringify(valorActual)) {
        diferencias.push({ campo, aprobado, actual: valorActual });
      }
    }
    return diferencias;
  }

  private textoDiferencias(diferencias: DiferenciaPlan[]): string {
    if (!diferencias.length) return 'hash de plan distinto sin diferencia de parámetros visible';
    return diferencias
      .slice(0, 6)
      .map((diferencia) => `${diferencia.campo}: aprobado=${this.valorLegible(diferencia.aprobado)}, actual=${this.valorLegible(diferencia.actual)}`)
      .join('; ');
  }

  private omitirCamposVolatiles(valor: unknown): unknown {
    if (Array.isArray(valor)) return valor.map((item) => this.omitirCamposVolatiles(item));
    if (!valor || typeof valor !== 'object') return valor;

    const objeto = valor as Record<string, unknown>;
    return Object.keys(objeto).reduce<Record<string, unknown>>((normalizado, key) => {
      if (key === 'resuelto_en') return normalizado;
      normalizado[key] = this.omitirCamposVolatiles(objeto[key]);
      return normalizado;
    }, {});
  }

  private valorLegible(valor: unknown): string {
    if (valor === undefined) return 'sin dato';
    if (valor === null) return 'null';
    if (typeof valor === 'object') return this.stableStringify(valor);
    return String(valor);
  }

  private stableStringify(valor: unknown): string {
    if (Array.isArray(valor)) return `[${valor.map((item) => this.stableStringify(item)).join(',')}]`;
    if (valor && typeof valor === 'object') {
      const objeto = valor as Record<string, unknown>;
      return `{${Object.keys(objeto).sort().map((key) => `${JSON.stringify(key)}:${this.stableStringify(objeto[key])}`).join(',')}}`;
    }
    return JSON.stringify(valor);
  }

  private normalizarModo(valor: unknown): ModoQaPlanAsistente {
    return this.texto(valor) === 'rapido' ? 'rapido' : 'demo';
  }

  private modoDesdeMensaje(mensaje: string): ModoQaPlanAsistente {
    return this.normalizarTexto(mensaje).includes('rapido') || this.normalizarTexto(mensaje).includes('start')
      ? 'rapido'
      : 'demo';
  }

  private extraerCasoId(mensaje: string): string {
    return /\b(QA-(?!PLAN\b)[A-Z0-9_-]+)/i.exec(mensaje)?.[1]?.toUpperCase() ?? '';
  }

  private extraerPlanId(mensaje: string): string {
    return /\b(QA-PLAN-[A-Z0-9_-]+)/i.exec(mensaje)?.[1]?.toUpperCase() ?? '';
  }

  private contiene(texto: string, palabras: string[]): boolean {
    return palabras.some((palabra) => texto.includes(palabra));
  }

  private normalizarTexto(valor: string): string {
    return this.texto(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private formatearFecha(valor: string): string {
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return valor;
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(fecha);
  }

  private estadoPlanLegible(estado: EstadoQaPlanAsistente): string {
    const textos: Record<EstadoQaPlanAsistente, string> = {
      recolectando: 'recolectando parámetros',
      plan_propuesto: 'propuesto, pendiente de aprobación',
      aprobado: 'aprobado, listo para ejecutar',
      ejecutando: 'ejecutando',
      verificado: 'verificado',
      fallido: 'fallido',
      abortado: 'abortado',
      vencido: 'vencido',
    };
    return textos[estado] ?? estado;
  }

  private valorDefinido(valor: unknown): boolean {
    return valor !== undefined && valor !== null && String(valor).trim() !== '';
  }

  private mensajeExcepcion(error: unknown): string {
    const maybe = error as { getResponse?: () => unknown; message?: string; response?: unknown };
    const response = typeof maybe.getResponse === 'function'
      ? maybe.getResponse()
      : maybe.response;
    const body = this.objeto(response);
    const message = body['message'];
    const errores = Array.isArray(body['errores'])
      ? body['errores'].map((item) => this.texto(item)).filter(Boolean)
      : [];
    const mensajes = Array.isArray(message)
      ? message.map((item) => this.texto(item)).filter(Boolean)
      : [this.texto(message)].filter(Boolean);
    return [...mensajes, ...errores].join(' ') || maybe.message || 'Error no clasificado.';
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

  private numero(valor: unknown): number | null {
    if (valor === undefined || valor === null || valor === '') return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }

  private msDesdeEnv(nombre: string, fallback: number): number {
    const valor = Number(process.env[nombre]);
    return Number.isFinite(valor) && valor > 0 ? valor : fallback;
  }
}
