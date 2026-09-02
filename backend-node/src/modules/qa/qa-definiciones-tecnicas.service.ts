import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  QaDefinicionTecnica,
  QaDefinicionTecnicaDocument,
} from './schemas/qa-definicion-tecnica.schema';

export const QA_DEFINICION_TECNICA_DEFAULT = 'DEF-AUD-GAN-RETENCION-V1';
export const QA_CONTRATO_DEFINICION_TECNICA = 'QA_DEF_TEC_MIN_V1';

interface ReglaContratoQa {
  path: string;
  descripcion: string;
}

interface ErrorContratoQa {
  tipo: 'metadato' | 'ruta' | 'selector' | 'valor' | 'paso';
  path: string;
  mensaje: string;
  valor?: unknown;
}

interface EstadoContratoQa {
  contrato_version: string;
  valido: boolean;
  errores: ErrorContratoQa[];
  advertencias: ErrorContratoQa[];
  rutas_obligatorias: ReglaContratoQa[];
  selectores_obligatorios: ReglaContratoQa[];
  valores_obligatorios: ReglaContratoQa[];
  pasos_obligatorios: string[];
}

const RUTAS_OBLIGATORIAS: ReglaContratoQa[] = [
  { path: 'rutas.login', descripcion: 'Ruta de autenticación del operador QA.' },
  { path: 'rutas.pantalla_qa', descripcion: 'Ruta del formulario QA donde se carga el caso.' },
  { path: 'rutas.carga_excel', descripcion: 'Ruta de carga del Excel que se audita.' },
];

const SELECTORES_OBLIGATORIOS: ReglaContratoQa[] = [
  { path: 'selectores.login.correo_input', descripcion: 'Input de correo del login.' },
  { path: 'selectores.login.password_input', descripcion: 'Input de contraseña del login.' },
  { path: 'selectores.login.submit_button', descripcion: 'Botón para iniciar sesión.' },
  { path: 'selectores.formulario_qa.pagina', descripcion: 'Contenedor principal de Legajo de Ganancias.' },
  { path: 'selectores.formulario_qa.nuevo_boton', descripcion: 'Botón para limpiar el formulario QA.' },
  { path: 'selectores.formulario_qa.guardar_boton', descripcion: 'Botón para guardar el caso QA.' },
  { path: 'selectores.formulario_qa.guardado_ok', descripcion: 'Mensaje de guardado exitoso del caso QA.' },
  { path: 'selectores.formulario_qa.excel_input', descripcion: 'Input file del Excel asociado al caso QA.' },
  { path: 'selectores.formulario_qa.campos.idCaso', descripcion: 'Campo ID del caso QA.' },
  { path: 'selectores.formulario_qa.campos.definicionTecnicaCodigo', descripcion: 'Selector de definición técnica.' },
  { path: 'selectores.formulario_qa.campos.datasetCodigo', descripcion: 'Selector de dataset.' },
  { path: 'selectores.formulario_qa.campos.periodo', descripcion: 'Campo período del caso QA.' },
  { path: 'selectores.formulario_qa.campos.clienteNombre', descripcion: 'Campo cliente.' },
  { path: 'selectores.formulario_qa.campos.modoSaldoFavor', descripcion: 'Selector modo saldo a favor.' },
  { path: 'selectores.formulario_qa.campos.descripcion', descripcion: 'Campo descripción.' },
  { path: 'selectores.formulario_qa.campos.legajo', descripcion: 'Campo legajo.' },
  { path: 'selectores.formulario_qa.campos.empleadoNombre', descripcion: 'Campo empleado.' },
  { path: 'selectores.formulario_qa.campos.cuil', descripcion: 'Campo CUIL.' },
  { path: 'selectores.formulario_qa.campos.remuneracionBruta', descripcion: 'Campo remuneración bruta.' },
  { path: 'selectores.formulario_qa.campos.deducciones', descripcion: 'Campo deducciones.' },
  { path: 'selectores.formulario_qa.campos.estadoEsperado', descripcion: 'Selector estado esperado.' },
  { path: 'selectores.formulario_qa.campos.campoResultado', descripcion: 'Selector campo a validar.' },
  { path: 'selectores.formulario_qa.campos.valorEsperado', descripcion: 'Campo valor esperado.' },
  { path: 'selectores.formulario_qa.campos.tolerancia', descripcion: 'Campo tolerancia.' },
  { path: 'selectores.carga_excel.pagina', descripcion: 'Contenedor principal de Carga Excel.' },
  { path: 'selectores.carga_excel.excel_input', descripcion: 'Input file del Excel a auditar.' },
  { path: 'selectores.carga_excel.cliente_input', descripcion: 'Input cliente en Carga Excel.' },
  { path: 'selectores.carga_excel.legajo_input', descripcion: 'Input legajo en Carga Excel.' },
  { path: 'selectores.carga_excel.periodo_fiscal_input', descripcion: 'Input período fiscal en Carga Excel.' },
  { path: 'selectores.carga_excel.mes_liquidacion_select', descripcion: 'Selector mes de liquidación.' },
  { path: 'selectores.carga_excel.ejecutar_boton', descripcion: 'Botón que dispara el análisis.' },
];

const VALORES_OBLIGATORIOS: ReglaContratoQa[] = [
  { path: 'selectores.formulario_qa.titulo_texto', descripcion: 'Texto visible esperado del formulario QA.' },
  { path: 'selectores.formulario_qa.guardado_ok_texto', descripcion: 'Texto visible esperado al guardar el caso QA.' },
  { path: 'selectores.carga_excel.titulo_texto', descripcion: 'Texto visible esperado en Carga Excel.' },
  { path: 'selectores.carga_excel.resultado_texto', descripcion: 'Texto visible esperado al finalizar el análisis.' },
];

const PASOS_OBLIGATORIOS = [
  'navegar',
  'completar_formulario_qa',
  'subir_archivo',
  'guardar_caso',
  'ejecutar_analisis',
  'validar_snapshot',
];

type QaDefinicionTecnicaLean = QaDefinicionTecnica & {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

@Injectable()
export class QaDefinicionesTecnicasService {
  constructor(
    @InjectModel(QaDefinicionTecnica.name)
    private readonly definiciones: Model<QaDefinicionTecnicaDocument>,
  ) {}

  async listar(): Promise<Record<string, unknown>[]> {
    await this.asegurarDefinicionesBase();
    const docs = await this.definiciones
      .find({ estado: { $ne: 'deprecado' } })
      .sort({ sistema: 1, codigo: 1 })
      .lean<QaDefinicionTecnicaLean[]>();
    return docs.map((doc) => this.serializar(doc));
  }

  async obtener(codigoEntrada?: unknown): Promise<Record<string, unknown>> {
    await this.asegurarDefinicionesBase();
    const codigo = this.texto(codigoEntrada) || QA_DEFINICION_TECNICA_DEFAULT;
    const doc = await this.definiciones
      .findOne({ codigo, estado: { $ne: 'deprecado' } })
      .lean<QaDefinicionTecnicaLean>();

    if (!doc) throw new NotFoundException(`Definición técnica QA inexistente: ${codigo}.`);
    return this.serializar(doc);
  }

  async obtenerParaUso(codigoEntrada?: unknown): Promise<Record<string, unknown>> {
    const definicion = await this.obtener(codigoEntrada);
    const contrato = this.validarContrato(definicion);
    if (!contrato.valido) {
      throw new BadRequestException({
        message: `Definición técnica QA incompleta: ${this.texto(definicion['codigo']) || QA_DEFINICION_TECNICA_DEFAULT}.`,
        errores: contrato.errores,
      });
    }
    return definicion;
  }

  async estado(codigoEntrada?: unknown): Promise<Record<string, unknown>> {
    const definicion = await this.obtener(codigoEntrada);
    return {
      codigo: definicion['codigo'],
      version: definicion['version'],
      nombre: definicion['nombre'],
      estado: definicion['estado'],
      contrato: this.validarContrato(definicion),
    };
  }

  async guardar(entrada: unknown): Promise<Record<string, unknown>> {
    const definicion = this.normalizarDefinicion(entrada);
    const contrato = this.validarContrato(definicion);
    if (!contrato.valido) {
      throw new BadRequestException({
        message: `No se pudo guardar la definición técnica QA ${definicion.codigo}: el contrato mínimo está incompleto.`,
        errores: contrato.errores,
      });
    }
    const doc = await this.definiciones
      .findOneAndUpdate(
        { codigo: definicion.codigo },
        { $set: definicion },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<QaDefinicionTecnicaLean>();

    if (!doc) throw new BadRequestException('No se pudo guardar la definición técnica QA.');
    return this.serializar(doc);
  }

  validarContrato(entrada: unknown): EstadoContratoQa {
    const definicion = this.objeto(entrada);
    const errores: ErrorContratoQa[] = [];
    const advertencias: ErrorContratoQa[] = [];

    if (!this.texto(definicion['codigo'])) {
      errores.push(this.errorContrato('metadato', 'codigo', 'La definición técnica requiere código.'));
    }

    const version = this.numero(definicion['version']);
    if (!version || version < 1) {
      errores.push(this.errorContrato('metadato', 'version', 'La definición técnica requiere una versión mayor a cero.', definicion['version']));
    }

    for (const regla of RUTAS_OBLIGATORIAS) {
      const valor = this.texto(this.valorPath(definicion, regla.path));
      if (!valor) {
        errores.push(this.errorContrato('ruta', regla.path, `Falta ruta obligatoria: ${regla.descripcion}`));
        continue;
      }
      if (!valor.startsWith('/')) {
        advertencias.push(this.errorContrato('ruta', regla.path, 'Se recomienda declarar rutas absolutas que comiencen con "/".', valor));
      }
    }

    for (const regla of SELECTORES_OBLIGATORIOS) {
      const valor = this.texto(this.valorPath(definicion, regla.path));
      if (!valor) {
        errores.push(this.errorContrato('selector', regla.path, `Falta selector obligatorio: ${regla.descripcion}`));
        continue;
      }
      if (!this.esDataTestId(valor)) {
        errores.push(this.errorContrato('selector', regla.path, 'El selector obligatorio debe usar data-testid estable.', valor));
      }
    }

    for (const regla of VALORES_OBLIGATORIOS) {
      const valor = this.texto(this.valorPath(definicion, regla.path));
      if (!valor) {
        errores.push(this.errorContrato('valor', regla.path, `Falta valor técnico obligatorio: ${regla.descripcion}`));
      }
    }

    const pasos = Array.isArray(definicion['pasos'])
      ? definicion['pasos'].map((paso) => this.texto(this.objeto(paso)['accion'])).filter(Boolean)
      : [];
    for (const accion of PASOS_OBLIGATORIOS) {
      if (!pasos.includes(accion)) {
        errores.push(this.errorContrato('paso', `pasos.${accion}`, `Falta paso obligatorio para ejecución Playwright: ${accion}.`));
      }
    }

    return {
      contrato_version: QA_CONTRATO_DEFINICION_TECNICA,
      valido: errores.length === 0,
      errores,
      advertencias,
      rutas_obligatorias: RUTAS_OBLIGATORIAS,
      selectores_obligatorios: SELECTORES_OBLIGATORIOS,
      valores_obligatorios: VALORES_OBLIGATORIOS,
      pasos_obligatorios: PASOS_OBLIGATORIOS,
    };
  }

  private async asegurarDefinicionesBase(): Promise<void> {
    const base = this.definicionGananciasRetencion();
    const { codigo, ...camposBase } = base;
    await this.definiciones.updateOne(
      { codigo },
      { $set: camposBase, $setOnInsert: { codigo } },
      { upsert: true },
    );
  }

  private normalizarDefinicion(entrada: unknown): QaDefinicionTecnica {
    const body = this.objeto(entrada);
    const codigo = this.texto(body['codigo']);
    if (!codigo) throw new BadRequestException('La definición técnica requiere código.');

    const version = this.numero(body['version']) ?? 1;
    if (version < 1) throw new BadRequestException('La versión de la definición técnica debe ser mayor a cero.');

    return {
      codigo,
      version,
      nombre: this.texto(body['nombre']) || codigo,
      descripcion: this.texto(body['descripcion']),
      sistema: this.texto(body['sistema']) || 'auditoria-ganancias',
      modulo: this.texto(body['modulo']) || 'qa',
      estado: this.estadoValido(body['estado']),
      rutas: this.objeto(body['rutas']),
      selectores: this.objeto(body['selectores']),
      pasos: Array.isArray(body['pasos'])
        ? body['pasos'].map((paso) => this.objeto(paso)).filter((paso) => Object.keys(paso).length > 0)
        : [],
      esperas: this.objeto(body['esperas']),
      origen: this.objeto(body['origen']),
    };
  }

  private definicionGananciasRetencion(): QaDefinicionTecnica {
    return {
      codigo: QA_DEFINICION_TECNICA_DEFAULT,
      version: 1,
      nombre: 'Auditoría Ganancias - Retención por Excel',
      descripcion: 'Mapa técnico reusable para cargar un caso QA, subir Excel, ejecutar análisis y validar retención.',
      sistema: 'auditoria-ganancias',
      modulo: 'qa',
      estado: 'vigente',
      rutas: {
        login: '/login',
        inicio: '/inicio',
        pantalla_qa: '/qa/pantalla-1',
        asistente_qa: '/qa/asistente',
        carga_excel: '/cargar-excel',
        analisis: '/analisis',
      },
      selectores: {
        login: {
          correo_input: '[data-testid="auth-email-input"]',
          password_input: '[data-testid="auth-password-input"]',
          submit_button: '[data-testid="auth-submit-button"]',
        },
        formulario_qa: {
          titulo_texto: 'Legajo de Ganancias',
          pagina: '[data-testid="qa-pantalla1-page"]',
          nuevo_boton: '[data-testid="qa-case-reset-button"]',
          nuevo_boton_nombre: 'Nuevo limpio',
          guardar_boton: '[data-testid="qa-case-save-button"]',
          guardar_boton_nombre: 'Guardar caso',
          guardado_ok: '[data-testid="qa-case-message"]',
          guardado_ok_texto: 'Caso guardado en MongoDB para Playwright.',
          excel_input: '[data-testid="qa-case-excel-input"]',
          campos: {
            idCaso: '[data-testid="qa-case-id-input"]',
            definicionTecnicaCodigo: '[data-testid="qa-case-definicion-select"]',
            datasetCodigo: '[data-testid="qa-case-dataset-select"]',
            periodo: '[data-testid="qa-case-periodo-input"]',
            clienteNombre: '[data-testid="qa-case-cliente-input"]',
            modoSaldoFavor: '[data-testid="qa-case-modo-saldo-select"]',
            descripcion: '[data-testid="qa-case-descripcion-input"]',
            legajo: '[data-testid="qa-case-legajo-input"]',
            empleadoNombre: '[data-testid="qa-case-empleado-input"]',
            cuil: '[data-testid="qa-case-cuil-input"]',
            remuneracionBruta: '[data-testid="qa-case-remuneracion-input"]',
            deducciones: '[data-testid="qa-case-deducciones-input"]',
            estadoEsperado: '[data-testid="qa-case-estado-select"]',
            campoResultado: '[data-testid="qa-case-campo-select"]',
            valorEsperado: '[data-testid="qa-case-valor-esperado-input"]',
            tolerancia: '[data-testid="qa-case-tolerancia-input"]',
          },
        },
        asistente_qa: {
          pagina: '[data-testid="qa-chat-page"]',
          casos_lista: '[data-testid="qa-chat-cases-list"]',
          mensajes: '[data-testid="qa-chat-messages"]',
          buscar_caso_input: '[data-testid="qa-chat-case-search-input"]',
          pregunta_input: '[data-testid="qa-chat-input"]',
          enviar_boton: '[data-testid="qa-chat-send-button"]',
          aprobar_plan_boton: '[data-testid="qa-chat-plan-approve-button"]',
          ejecutar_plan_boton: '[data-testid="qa-chat-plan-run-button"]',
        },
        carga_excel: {
          titulo_texto: 'Iniciar Auditoría',
          pagina: '[data-testid="carga-excel-page"]',
          excel_input: '[data-testid="carga-excel-file-input"]',
          cliente_input: '[data-testid="carga-excel-cliente-input"]',
          legajo_input: '[data-testid="carga-excel-legajo-input"]',
          periodo_fiscal_input: '[data-testid="carga-excel-periodo-fiscal-input"]',
          mes_liquidacion_select: '[data-testid="carga-excel-mes-liquidacion-select"]',
          ejecutar_boton: '[data-testid="carga-excel-run-button"]',
          resultado_texto: 'Resultado del Análisis',
        },
      },
      pasos: [
        { orden: 1, accion: 'navegar', ruta: 'pantalla_qa', escribe: false, reversible: true },
        { orden: 2, accion: 'completar_formulario_qa', escribe: true, reversible: true },
        { orden: 3, accion: 'subir_archivo', destino: 'formulario_qa.excel_input', escribe: true, reversible: true },
        { orden: 4, accion: 'guardar_caso', escribe: true, reversible: true },
        { orden: 5, accion: 'navegar', ruta: 'carga_excel', escribe: false, reversible: true },
        { orden: 6, accion: 'subir_archivo', destino: 'carga_excel.excel_input', escribe: true, reversible: true },
        { orden: 7, accion: 'ejecutar_analisis', escribe: true, reversible: true },
        { orden: 8, accion: 'validar_snapshot', escribe: false, reversible: true },
      ],
      esperas: {
        guardado_caso: { tipo: 'respuesta_http', metodo: 'POST', url_incluye: '/api/qa/casos' },
        analisis_excel: { tipo: 'respuesta_http', metodo: 'POST', url_incluye: '/api/analisis/excel', timeout_ms: 150000 },
        resultado: { tipo: 'texto_visible', texto: 'Resultado del Análisis' },
      },
      origen: {
        tipo: 'definicion_base_sistema',
        generado_en: '2026-08-25T00:00:00.000Z',
      },
    };
  }

  private estadoValido(valor: unknown): string {
    const estado = this.texto(valor);
    return ['borrador', 'vigente', 'deprecado'].includes(estado) ? estado : 'vigente';
  }

  private serializar(doc: QaDefinicionTecnicaLean): Record<string, unknown> {
    const { _id, ...resto } = doc;
    void _id;
    return {
      ...(resto as Record<string, unknown>),
      contrato: this.validarContrato(resto),
    };
  }

  private valorPath(origen: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((actual, parte) => {
      if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return undefined;
      return (actual as Record<string, unknown>)[parte];
    }, origen);
  }

  private esDataTestId(selector: string): boolean {
    return /\[data-testid\s*=/i.test(selector);
  }

  private errorContrato(tipo: ErrorContratoQa['tipo'], path: string, mensaje: string, valor?: unknown): ErrorContratoQa {
    const error: ErrorContratoQa = { tipo, path, mensaje };
    if (valor !== undefined) error.valor = valor;
    return error;
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
}
