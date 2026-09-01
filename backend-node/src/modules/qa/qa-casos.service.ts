import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as XLSX from 'xlsx';
import {
  QA_DEFINICION_TECNICA_DEFAULT,
  QaDefinicionesTecnicasService,
} from './qa-definiciones-tecnicas.service';
import { QaDatasetsService } from './qa-datasets.service';
import { QaCaso, QaCasoDocument } from './schemas/qa-caso.schema';
import {
  aplicarReglasCampos,
  buscarPantallaPorRuta,
  condicionesOrigenCasos,
  datosDesdeCaso,
  fuentesCasosDisponibles,
  pantallaPorOrigenCaso,
  validarDatosCampos,
} from './qa-catalogo-elementos';
import { QaReglasValidacionService } from './qa-reglas-validacion.service';

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
  definicion_tecnica_codigo: string;
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

interface FilaImportacionQa {
  fila: number;
  datos: Record<string, unknown>;
}

export interface ErrorImportacionQa {
  fila: number;
  id: string;
  error: string;
}

export interface ResultadoImportacionQa {
  archivo: string;
  formato: string;
  total_filas: number;
  importados: number;
  fallidos: number;
  casos: Record<string, unknown>[];
  errores: ErrorImportacionQa[];
  columnas_esperadas: string[];
}

type QaCasoLean = QaCaso & {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

@Injectable()
export class QaCasosService {
  private readonly columnasImportacion = [
    'id_caso',
    'definicion_tecnica_codigo',
    'dataset_codigo',
    'periodo',
    'archivo_excel',
    'cliente',
    'area_sector',
    'telefono',
    'numero_documento',
    'fecha_ingreso',
    'fecha_fin',
    'modo_saldo_favor',
    'legajo',
    'empleado',
    'cuil',
    'remuneracion_bruta',
    'deducciones',
    'campo_validar',
    'valor_esperado',
    'tolerancia',
    'estado_esperado',
    'flujo_sop_id',
    'nombre_caso',
    'ruta_objetivo',
    'accion_principal',
    'selector_objetivo',
    'dato_entrada',
    'resultado_visible_esperado',
    'evidencia_requerida',
    'prioridad',
    'precondiciones',
    'observaciones',
  ];

  constructor(
    @InjectModel(QaCaso.name) private readonly casos: Model<QaCasoDocument>,
    private readonly datasets: QaDatasetsService,
    private readonly definicionesTecnicas: QaDefinicionesTecnicasService,
    @Optional() private readonly reglasValidacion?: QaReglasValidacionService,
  ) {}

  async listar(activo = true, pantallaOrigenEntrada?: unknown): Promise<Record<string, unknown>[]> {
    const filtro: Record<string, unknown> = activo ? { activo: { $ne: false } } : {};
    const pantallaOrigen = this.texto(pantallaOrigenEntrada);
    if (pantallaOrigen) {
      filtro['$or'] = [
        { 'origen.pantalla': pantallaOrigen },
        { 'contexto.contexto_complementario.origen.pantalla': pantallaOrigen },
      ];
    }
    const docs = await this.casos.find(filtro).sort({ updatedAt: -1 }).lean<QaCasoLean[]>();
    return docs.map((doc) => this.serializar(doc));
  }

  /**
   * Pantallas con fuente de casos declarada en el catálogo, con sus campos,
   * para que el módulo de Casos pueda armar la tabla sin conocer de antemano
   * la forma de cada pantalla.
   */
  fuentes(): Array<Record<string, unknown>> {
    return fuentesCasosDisponibles().map(({ ruta, codigo, fuente }) => {
      const pantalla = buscarPantallaPorRuta(ruta);
      return {
        ruta,
        codigo,
        nombre: pantalla?.nombre ?? codigo,
        etiqueta: fuente.etiqueta,
        ejecutable: Boolean(fuente.ejecutable),
        // `id` queda afuera: la tabla de Casos ya muestra el id como columna propia.
        campos: (pantalla?.campos ?? [])
          .filter((campo) => campo.clave !== 'id')
          .map((campo) => ({
            clave: campo.clave,
            etiqueta: campo.etiqueta,
            tipo: campo.tipo,
            obligatorio: campo.obligatorio,
          })),
      };
    });
  }

  /**
   * Casos de una pantalla declarada en el catálogo, con sus campos ya
   * resueltos a valores planos (`datos`) para que el frontend los muestre sin
   * tener que conocer la estructura real de `contexto`.
   */
  async listarPorPantalla(rutaEntrada: unknown, activo = true): Promise<Record<string, unknown>[]> {
    const ruta = this.texto(rutaEntrada);
    const pantalla = buscarPantallaPorRuta(ruta);
    if (!pantalla?.fuente_casos) {
      throw new BadRequestException(`La pantalla ${ruta || '(sin ruta)'} no tiene fuente de casos declarada.`);
    }

    const condiciones = condicionesOrigenCasos(pantalla.fuente_casos);
    const filtro: Record<string, unknown> = activo ? { activo: { $ne: false } } : {};
    if (condiciones.length > 0) filtro['$or'] = condiciones;

    const docs = await this.casos.find(filtro).sort({ updatedAt: -1 }).lean<QaCasoLean[]>();
    return docs.map((doc) => {
      const { datos } = datosDesdeCaso(pantalla, doc as unknown as Record<string, unknown>);
      return { ...this.serializar(doc), datos };
    });
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

  async importarDatos(archivo?: Express.Multer.File, opcionesEntrada?: unknown): Promise<ResultadoImportacionQa> {
    if (!archivo) throw new BadRequestException('Adjuntá un archivo Excel, CSV o JSON para importar casos QA.');

    const filas = this.leerFilasImportacion(archivo);
    if (filas.length === 0) throw new BadRequestException('El archivo de importación no tiene filas de casos QA.');

    const casos: Record<string, unknown>[] = [];
    const errores: ErrorImportacionQa[] = [];
    const opciones = this.opcionesImportacion(opcionesEntrada);

    for (const fila of filas) {
      const idFila = this.texto(this.valorFila(fila.datos, ['id_caso', 'id', 'caso']));
      try {
        const payload = await this.payloadDesdeFilaImportada(fila, archivo.originalname, opciones);
        const caso = await this.guardar(payload);
        casos.push(caso);
      } catch (error) {
        errores.push({
          fila: fila.fila,
          id: idFila,
          error: this.mensajeExcepcion(error),
        });
      }
    }

    return {
      archivo: archivo.originalname,
      formato: this.formatoArchivo(archivo.originalname),
      total_filas: filas.length,
      importados: casos.length,
      fallidos: errores.length,
      casos,
      errores,
      columnas_esperadas: this.columnasImportacion,
    };
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
    const origen = this.objeto(body['origen']);
    const contexto = this.objeto(body['contexto']);
    const contextoComplementario = this.objeto(contexto['contexto_complementario']);
    const origenContexto = this.objeto(contextoComplementario['origen']);
    const pantallaOrigen = this.texto(origen['pantalla']) || this.texto(origenContexto['pantalla']);
    const permiteCasoSinDataset = pantallaOrigen === 'QA - Pantalla 3';
    const definicionTecnica = await this.definicionesTecnicas.obtenerParaUso(
      this.texto(body['definicion_tecnica_codigo']) || this.texto(body['definicion_codigo']) || QA_DEFINICION_TECNICA_DEFAULT,
    );
    const datasetCodigo = this.texto(body['dataset_codigo']);
    let periodo = this.normalizarPeriodo(this.texto(body['periodo'])) || this.texto(body['periodo']);
    if (!periodo && datasetCodigo) {
      const datasetBase = await this.datasets.obtener(datasetCodigo);
      periodo = datasetBase.periodo;
    }
    const dataset = datasetCodigo || !permiteCasoSinDataset
      ? await this.datasets.resolverParaCaso(datasetCodigo, periodo)
      : null;

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

    const caso: CasoNormalizado = {
      id,
      dataset_codigo: dataset?.codigo ?? datasetCodigo,
      definicion_tecnica_codigo: this.texto(definicionTecnica['codigo']) || QA_DEFINICION_TECNICA_DEFAULT,
      dataset,
      periodo,
      descripcion: this.texto(body['descripcion']),
      archivo: this.normalizarArchivo(body['archivo']),
      contexto,
      resultado_esperado,
      assertions,
      origen,
      activo: body['activo'] === false ? false : true,
    };

    await this.validarContraReglas(caso);
    return caso;
  }

  /**
   * Bloquea el guardado (formulario o importación, ambos pasan por acá) si el
   * caso no cumple las reglas de validación activas para su pantalla de
   * origen: obligatoriedad y formato (largo, patrón), catálogo + ajustes
   * manuales combinados con `aplicarReglasCampos`.
   */
  private async validarContraReglas(caso: CasoNormalizado): Promise<void> {
    const pantalla = pantallaPorOrigenCaso(caso as unknown as Record<string, unknown>);
    if (!pantalla) return;

    const reglas = this.reglasValidacion ? await this.reglasValidacion.listarResueltas() : [];
    const pantallaConReglas = aplicarReglasCampos(pantalla, reglas);
    const { datos } = datosDesdeCaso(pantallaConReglas, caso as unknown as Record<string, unknown>);
    const errores = validarDatosCampos(pantallaConReglas, datos);
    if (errores.length > 0) {
      throw new BadRequestException({
        message: `El caso no cumple las reglas de validación de ${pantalla.nombre}.`,
        errores,
      });
    }
  }

  private async payloadDesdeFilaImportada(
    fila: FilaImportacionQa,
    archivoImportacion: string,
    opciones: { pantalla_origen: string; tipo_origen: string },
  ): Promise<Record<string, unknown>> {
    if (fila.datos['__error']) throw new BadRequestException(this.texto(fila.datos['__error']));
    if (opciones.pantalla_origen === 'QA - Pantalla 3') {
      return this.payloadPantalla3DesdeFilaImportada(fila, archivoImportacion, opciones);
    }

    const datasetCodigo = this.texto(this.valorFila(fila.datos, ['dataset_codigo', 'codigo_dataset', 'dataset']));
    if (!datasetCodigo) throw new BadRequestException('La fila requiere dataset_codigo.');
    const definicionTecnicaCodigo = this.texto(this.valorFila(fila.datos, [
      'definicion_tecnica_codigo',
      'definicion_codigo',
      'mapa_tecnico',
    ])) || QA_DEFINICION_TECNICA_DEFAULT;

    let periodo = this.normalizarPeriodo(this.valorFila(fila.datos, ['periodo', 'periodo_caso']));
    if (!periodo) {
      const dataset = await this.datasets.obtener(datasetCodigo);
      periodo = dataset.periodo;
    }

    const id = this.texto(this.valorFila(fila.datos, ['id_caso', 'id', 'caso'])) ||
      this.generarIdImportado(datasetCodigo, periodo, this.texto(this.valorFila(fila.datos, ['legajo', 'empleado_legajo', 'legajo_numero'])), fila.fila);
    const campo = this.campoResultadoValido(this.valorFila(fila.datos, ['campo_validar', 'campo_resultado', 'campo'])) || 'calculo.retencion_excel';
    const esperado = this.numero(this.valorFila(fila.datos, ['valor_esperado', 'esperado', 'resultado_esperado']));
    const tolerancia = this.numero(this.valorFila(fila.datos, ['tolerancia'])) ?? 0.05;
    const estado = this.estadoEsperadoValido(this.valorFila(fila.datos, ['estado_esperado', 'estado']));
    const legajo = this.texto(this.valorFila(fila.datos, ['legajo', 'empleado_legajo', 'legajo_numero']));
    const cuil = this.texto(this.valorFila(fila.datos, ['cuil', 'empleado_cuil']));
    const periodoParseado = this.parsearPeriodo(periodo);
    const modoSaldoFavor = this.texto(this.valorFila(fila.datos, ['modo_saldo_favor', 'saldo_favor']));
    const cliente = this.texto(this.valorFila(fila.datos, ['cliente', 'cliente_nombre', 'empresa']));

    return {
      id,
      definicion_tecnica_codigo: definicionTecnicaCodigo,
      dataset_codigo: datasetCodigo,
      periodo,
      descripcion: this.texto(this.valorFila(fila.datos, ['descripcion', 'detalle'])),
      archivo: this.archivoDesdeFilaImportada(fila.datos),
      contexto: {
        empleado: {
          legajo,
          nombre: this.texto(this.valorFila(fila.datos, ['empleado', 'empleado_nombre', 'nombre_empleado'])),
          cuil,
        },
        liquidacion: {
          remuneracion_bruta: this.numero(this.valorFila(fila.datos, ['remuneracion_bruta', 'remuneracion', 'bruto'])),
          deducciones: this.numero(this.valorFila(fila.datos, ['deducciones', 'deduccion'])),
        },
        contexto_complementario: {
          datos_cliente: {
            ...(cliente ? { cliente_nombre: cliente } : {}),
            ...(modoSaldoFavor ? { modo_saldo_favor: modoSaldoFavor } : {}),
          },
          datos_legajo: {
            ...(legajo ? { legajo_numero: legajo } : {}),
            ...(cuil ? { empleado_cuil: cuil } : {}),
          },
          datos_contexto: {
            fuente_datos: opciones.tipo_origen,
            ...(periodoParseado.anio ? { periodo_fiscal: periodoParseado.anio } : {}),
            ...(periodoParseado.mes ? { mes_liquidacion: periodoParseado.mes } : {}),
          },
          origen: {
            tipo: opciones.tipo_origen,
            ...(opciones.pantalla_origen ? { pantalla: opciones.pantalla_origen } : {}),
          },
        },
      },
      resultado_esperado: {
        campo,
        valor: esperado,
        tolerancia,
        estado,
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
        tipo: opciones.tipo_origen,
        ...(opciones.pantalla_origen ? { pantalla: opciones.pantalla_origen } : {}),
        archivo: archivoImportacion,
        fila: fila.fila,
        generado_en: new Date().toISOString(),
      },
    };
  }

  private async payloadPantalla3DesdeFilaImportada(
    fila: FilaImportacionQa,
    archivoImportacion: string,
    opciones: { pantalla_origen: string; tipo_origen: string },
  ): Promise<Record<string, unknown>> {
    const cliente = this.texto(this.valorFila(fila.datos, ['cliente', 'cliente_nombre', 'razon_social']));
    const areaSector = this.texto(this.valorFila(fila.datos, ['area_sector', 'area', 'sector']));
    const telefono = this.texto(this.valorFila(fila.datos, ['telefono', 'telefono_contacto', 'celular']));
    const numeroDocumento = this.texto(this.valorFila(fila.datos, ['numero_documento', 'documento', 'dni']));
    const cuil = this.texto(this.valorFila(fila.datos, ['cuil', 'empleado_cuil']));
    const fechaIngreso = this.normalizarFecha(this.valorFila(fila.datos, ['fecha_ingreso', 'ingreso', 'fecha_alta']));
    const fechaFin = this.normalizarFecha(this.valorFila(fila.datos, ['fecha_fin', 'fin', 'fecha_baja']));
    const errores: string[] = [];

    if (!cliente) errores.push('La fila requiere cliente.');
    if (!areaSector) errores.push('La fila requiere area_sector.');
    if (!telefono) errores.push('La fila requiere telefono.');
    if (!numeroDocumento) errores.push('La fila requiere numero_documento.');
    if (!cuil) errores.push('La fila requiere cuil.');
    if (!fechaIngreso) errores.push('La fila requiere fecha_ingreso.');
    // El formato (largo de teléfono/CUIL) lo valida `validarContraReglas` al
    // guardar, usando las reglas activas: catálogo + ajustes por pantalla/global.
    if (fechaFin && fechaIngreso && fechaFin < fechaIngreso) errores.push('fecha_fin no puede ser anterior a fecha_ingreso.');
    if (errores.length > 0) throw new BadRequestException(errores.join(' '));

    const id = this.texto(this.valorFila(fila.datos, ['id_caso', 'id', 'caso'])) ||
      this.generarIdPantalla3(numeroDocumento, cuil, fechaIngreso, fila.fila);

    return {
      id,
      definicion_tecnica_codigo: QA_DEFINICION_TECNICA_DEFAULT,
      dataset_codigo: '',
      periodo: '',
      descripcion: `Alta Pantalla 3 - ${cliente}`,
      archivo: null,
      contexto: {
        empleado: {
          cliente,
          area_sector: areaSector,
          telefono,
          numero_documento: numeroDocumento,
          cuil,
          fecha_ingreso: fechaIngreso,
          fecha_fin: fechaFin || null,
        },
        liquidacion: {},
        contexto_complementario: {
          pantalla_3: {
            cliente,
            area_sector: areaSector,
            telefono,
            numero_documento: numeroDocumento,
            cuil,
            fecha_ingreso: fechaIngreso,
            fecha_fin: fechaFin || null,
          },
          origen: {
            tipo: opciones.tipo_origen,
            pantalla: opciones.pantalla_origen,
          },
        },
      },
      resultado_esperado: {
        campo: 'pantalla_3.registro',
        valor: 'registrado',
        tolerancia: 0,
        estado: 'registrado',
      },
      assertions: [
        {
          campo: 'pantalla_3.registro',
          operador: 'igual',
          esperado: 'registrado',
          tolerancia: 0,
        },
      ],
      origen: {
        tipo: opciones.tipo_origen,
        pantalla: opciones.pantalla_origen,
        archivo_importacion: archivoImportacion,
        fila: fila.fila,
        generado_en: new Date().toISOString(),
      },
    };
  }

  private normalizarFecha(valor: unknown): string {
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
      return this.fechaIso(valor.getUTCFullYear(), valor.getUTCMonth() + 1, valor.getUTCDate());
    }

    const texto = this.texto(valor);
    if (!texto) return '';

    const iso = /^(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])/.exec(texto);
    if (iso) return this.fechaIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

    const local = /^(0?[1-9]|[12]\d|3[01])[-/](0?[1-9]|1[0-2])[-/](\d{2}|20\d{2})$/.exec(texto);
    if (local) {
      const anio = local[3].length === 2 ? Number(`20${local[3]}`) : Number(local[3]);
      return this.fechaIso(anio, Number(local[2]), Number(local[1]));
    }

    const serial = Number(texto);
    if (Number.isFinite(serial) && serial > 20000 && serial < 60000) {
      const fecha = new Date(Date.UTC(1899, 11, 30));
      fecha.setUTCDate(fecha.getUTCDate() + Math.floor(serial));
      return this.fechaIso(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, fecha.getUTCDate());
    }

    return '';
  }

  private fechaIso(anio: number, mes: number, dia: number): string {
    return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }

  private archivoDesdeFilaImportada(fila: Record<string, unknown>): Record<string, unknown> {
    const nombre = this.texto(this.valorFila(fila, ['archivo_excel', 'excel', 'nombre_excel', 'archivo']));
    if (!nombre) throw new BadRequestException('La fila requiere archivo_excel para que Playwright sepa qué Excel cargar.');
    if (!/\.(xlsx|xls)$/i.test(nombre)) throw new BadRequestException(`archivo_excel debe ser .xlsx o .xls: ${nombre}`);

    return {
      nombre,
      size_bytes: this.numero(this.valorFila(fila, ['archivo_size_bytes', 'size_bytes', 'tamano_bytes'])),
      mime: this.texto(this.valorFila(fila, ['archivo_mime', 'mime'])) || this.mimePorNombre(nombre),
      seleccionado_en: new Date().toISOString(),
    };
  }

  private leerFilasImportacion(archivo: Express.Multer.File): FilaImportacionQa[] {
    const extension = this.extensionArchivo(archivo.originalname);
    if (extension === '.json') return this.leerFilasJson(archivo.buffer);
    if (!['.xlsx', '.xls', '.csv'].includes(extension)) {
      throw new BadRequestException('El archivo de importación debe ser .xlsx, .xls, .csv o .json.');
    }

    const workbook = XLSX.read(archivo.buffer, { type: 'buffer', cellDates: false, raw: false });
    const hoja = workbook.SheetNames[0];
    if (!hoja) throw new BadRequestException('El Excel de importación no tiene hojas.');

    const registros = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[hoja], {
      defval: '',
      raw: false,
    });
    return this.filasDesdeRegistros(registros, 2);
  }

  private leerFilasJson(buffer: Buffer): FilaImportacionQa[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new BadRequestException('El JSON de importación no es válido.');
    }

    const contenedor = this.objeto(parsed);
    const registros = Array.isArray(parsed)
      ? parsed
      : Array.isArray(contenedor['casos'])
        ? contenedor['casos']
        : Array.isArray(contenedor['datos'])
          ? contenedor['datos']
          : [];

    if (registros.length === 0) throw new BadRequestException('El JSON debe ser un array o tener una propiedad casos/datos.');
    return this.filasDesdeRegistros(registros, 1);
  }

  private filasDesdeRegistros(registros: unknown[], offsetFila: number): FilaImportacionQa[] {
    return registros
      .map((registro, index) => {
        if (!registro || typeof registro !== 'object' || Array.isArray(registro)) {
          return {
            fila: index + offsetFila,
            datos: { __error: 'Cada fila de importación debe ser un objeto con columnas de caso QA.' },
          };
        }
        return {
          fila: index + offsetFila,
          datos: this.normalizarClavesFila(registro as Record<string, unknown>),
        };
      })
      .filter((fila) => fila.datos['__error'] || Object.values(fila.datos).some((valor) => this.texto(valor)));
  }

  private normalizarClavesFila(fila: Record<string, unknown>): Record<string, unknown> {
    const normalizada: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(fila)) {
      const claveNormalizada = this.normalizarClave(clave);
      if (!claveNormalizada) continue;
      normalizada[claveNormalizada] = valor;
    }
    return normalizada;
  }

  private valorFila(fila: Record<string, unknown>, aliases: string[]): unknown {
    for (const alias of aliases) {
      const clave = this.normalizarClave(alias);
      if (Object.prototype.hasOwnProperty.call(fila, clave)) return fila[clave];
    }
    return undefined;
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
    const texto = String(valor).trim();
    const normalizado = texto.includes(',')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto;
    const n = Number(normalizado);
    return Number.isFinite(n) ? n : null;
  }

  private normalizarPeriodo(valor: unknown): string {
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
      return `${String(valor.getMonth() + 1).padStart(2, '0')}/${valor.getFullYear()}`;
    }

    const texto = this.texto(valor);
    const formatoLocal = /^(0?[1-9]|1[0-2])\/(20\d{2})$/.exec(texto);
    if (formatoLocal) return `${formatoLocal[1].padStart(2, '0')}/${formatoLocal[2]}`;

    const formatoIso = /^(20\d{2})[-/](0?[1-9]|1[0-2])$/.exec(texto);
    if (formatoIso) return `${formatoIso[2].padStart(2, '0')}/${formatoIso[1]}`;

    return '';
  }

  private parsearPeriodo(periodo: string): { mes: number | null; anio: number | null } {
    const match = /^(0?[1-9]|1[0-2])\/(20\d{2})$/.exec(this.texto(periodo));
    if (!match) return { mes: null, anio: null };
    return { mes: Number(match[1]), anio: Number(match[2]) };
  }

  private normalizarClave(valor: string): string {
    return this.texto(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private opcionesImportacion(entrada: unknown): { pantalla_origen: string; tipo_origen: string } {
    const body = this.objeto(entrada);
    const pantalla = this.texto(body['pantalla_origen'] ?? body['pantallaOrigen']);
    const tipo = this.texto(body['tipo_origen'] ?? body['tipoOrigen']);
    return {
      pantalla_origen: pantalla,
      tipo_origen: tipo || (pantalla ? `importacion_${this.normalizarClave(pantalla)}` : 'importacion_qa_pantalla_1'),
    };
  }

  private campoResultadoValido(valor: unknown): string {
    const campo = this.texto(valor);
    const permitidos = new Set([
      'calculo.retencion_excel',
      'calculo.retencion_calculada',
      'calculo.diferencia_retencion',
      'validaciones.V10_RETENCION.retencion_efectiva_esperada',
    ]);
    return permitidos.has(campo) ? campo : '';
  }

  private estadoEsperadoValido(valor: unknown): string {
    const estado = this.texto(valor);
    return ['validado', 'observado', 'pendiente'].includes(estado) ? estado : 'validado';
  }

  private generarIdImportado(datasetCodigo: string, periodo: string, legajo: string, fila: number): string {
    const periodoId = this.texto(periodo).replace(/\D/g, '') || 'SIN-PERIODO';
    const legajoId = this.sanitizarSegmentoId(legajo || `FILA-${fila}`);
    const datasetId = this.sanitizarSegmentoId(datasetCodigo.replace(/^DS-/i, '')).slice(0, 16) || 'DATASET';
    return `QA-GAN-IMP-${datasetId}-${periodoId}-${legajoId}-${fila}`;
  }

  private generarIdPantalla3(numeroDocumento: string, cuil: string, fechaIngreso: string, fila: number): string {
    const documentoId = this.sanitizarSegmentoId(numeroDocumento || cuil || `FILA-${fila}`).slice(0, 18);
    const fechaId = this.texto(fechaIngreso).replace(/\D/g, '') || 'SIN-FECHA';
    return `QA-P3-ALTA-${documentoId}-${fechaId}-${fila}`;
  }

  private generarIdFlujoPantalla3(datasetCodigo: string, periodo: string, ruta: string, fila: number): string {
    const periodoId = this.texto(periodo).replace(/\D/g, '') || 'SIN-PERIODO';
    const rutaId = this.sanitizarSegmentoId(ruta).slice(0, 18) || 'FLUJO';
    const datasetId = this.sanitizarSegmentoId(datasetCodigo.replace(/^DS-/i, '')).slice(0, 12) || 'DATASET';
    return `QA-FLUJO-P3-${datasetId}-${periodoId}-${rutaId}-${fila}`;
  }

  private accionFlujoValida(valor: unknown): string {
    const accion = this.texto(valor);
    return ['navegar', 'abrir', 'completar', 'importar', 'guardar', 'validar'].includes(accion) ? accion : '';
  }

  private prioridadFlujoValida(valor: unknown): string {
    const prioridad = this.texto(valor);
    return ['baja', 'media', 'alta', 'critica'].includes(prioridad) ? prioridad : '';
  }

  private evidenciaFlujoValida(valor: unknown): string {
    const evidencia = this.texto(valor);
    return ['captura_final', 'captura_paso_a_paso', 'json_y_captura'].includes(evidencia) ? evidencia : '';
  }

  private sanitizarSegmentoId(valor: string): string {
    return this.texto(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'SIN-DATO';
  }

  private extensionArchivo(nombre: string): string {
    const match = /\.[^.]+$/.exec(this.texto(nombre).toLowerCase());
    return match ? match[0] : '';
  }

  private formatoArchivo(nombre: string): string {
    return this.extensionArchivo(nombre).replace('.', '') || 'desconocido';
  }

  private mimePorNombre(nombre: string): string {
    return /\.xls$/i.test(nombre)
      ? 'application/vnd.ms-excel'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  private mensajeExcepcion(error: unknown): string {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      const body = this.objeto(response);
      const message = body['message'];
      const errores = Array.isArray(body['errores'])
        ? body['errores'].map((item) => this.texto(item)).filter(Boolean)
        : [];
      const mensajes = Array.isArray(message)
        ? message.map((item) => this.texto(item)).filter(Boolean)
        : [this.texto(message)].filter(Boolean);
      return [...mensajes, ...errores].join(' ') || error.message;
    }
    return error instanceof Error ? error.message : 'No se pudo importar la fila.';
  }

  private serializar(doc: QaCasoLean): Record<string, unknown> {
    const { _id, ...resto } = doc;
    void _id;
    const serializado = resto as Record<string, unknown>;
    return {
      ...serializado,
      definicion_tecnica_codigo: this.texto(serializado['definicion_tecnica_codigo']) || QA_DEFINICION_TECNICA_DEFAULT,
    };
  }
}
