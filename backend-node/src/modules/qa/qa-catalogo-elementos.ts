/**
 * Semántica de negocio conocida de las pantallas QA.
 *
 * Los `testid` de este catálogo sirven como referencia para asociar conceptos,
 * pero la autoridad técnica es la inspección real del sandbox. El aprendizaje
 * persiste siempre el selector observado por Playwright y su hash de navegación.
 *
 * El sistema tampoco inventa valores de prueba: los datos salen de los casos QA
 * cargados en la pantalla correspondiente, declarados en `fuente_casos`.
 */

export type TipoCampoCatalogo = 'texto' | 'numero' | 'fecha' | 'archivo' | 'select';

export interface EsperaCatalogo {
  tipo: 'elemento' | 'respuesta';
  valor: string;
  timeout_ms?: number;
}

export interface CampoCatalogo {
  clave: string;
  etiqueta: string;
  testid: string;
  tipo: TipoCampoCatalogo;
  obligatorio: boolean;
  alias: string[];
  ejemplo?: string;
  nota?: string;
}

export interface AccionCatalogo {
  clave: string;
  etiqueta: string;
  testid: string;
  alias: string[];
  escribe: boolean;
  espera?: EsperaCatalogo;
}

export interface VerificacionCatalogo {
  selector: string;
  patron_exito: string;
  clase_error: string;
}

/**
 * Como se identifican en `qa_casos` los casos de una pantalla. No todas las
 * pantallas los marcan igual: Pantalla 3 usa `origen.pantalla` y Pantalla 1
 * solo deja `origen.tipo`.
 */
export interface FiltroCasosCatalogo {
  origen_pantalla?: string;
  origen_tipos?: string[];
}

/**
 * De donde salen los datos con los que el agente opera la pantalla: los casos
 * QA que se cargaron a mano o por Excel masivo desde esa misma pantalla.
 */
export interface FuenteCasosCatalogo {
  /** Nombre legible de la fuente, para mostrarlo al elegirla. */
  etiqueta: string;
  /** Como reconocer los casos de esta pantalla. */
  filtro: FiltroCasosCatalogo;
  /** Contenedores donde buscar cada campo por su clave, en orden. */
  rutas_datos: string[];
  /**
   * Campos cuya clave no coincide con la del caso: `clave -> ruta absoluta`.
   * Ejemplo: el campo `empleado` vive en `contexto.empleado.nombre`.
   */
  mapeo?: Record<string, string>;
  /** Prefijo del testid de la fila que debe aparecer tras guardar. */
  prefijo_fila?: string;
  /** Reconstruye el id que la pantalla le va a asignar al caso guardado. */
  idEsperado?: (datos: Record<string, string>) => string;
  /**
   * Si sus casos se pueden correr individualmente con el runner genérico
   * (`POST /qa/casos/:id/ejecutar`, el de retención de ganancias). Pantalla 3
   * no: sus casos se ejecutan en lote vía SOP Loom, no uno por uno.
   */
  ejecutable?: boolean;
}

export interface PantallaCatalogo {
  codigo: string;
  ruta: string;
  nombre: string;
  modulo: string;
  instrumentada: boolean;
  selectores: Record<string, string>;
  campos: CampoCatalogo[];
  acciones: AccionCatalogo[];
  verificacion?: VerificacionCatalogo;
  fuente_casos?: FuenteCasosCatalogo;
  nota?: string;
}

const PANTALLA_3: PantallaCatalogo = {
  codigo: 'QA-PANT-3',
  ruta: '/qa/pantalla-3',
  nombre: 'QA - Pantalla 3',
  modulo: 'QA',
  instrumentada: true,
  selectores: {
    pagina: '[data-testid="qa-screen3-page"]',
    tarjeta: '[data-testid="qa-screen3-card"]',
    formulario: '[data-testid="qa-screen3-form"]',
    mensaje: '[data-testid="qa-screen3-message"]',
    panel_casos: '[data-testid="qa-screen3-cases-panel"]',
  },
  campos: [
    {
      clave: 'cliente',
      etiqueta: 'Cliente',
      testid: 'qa-screen3-cliente-input',
      tipo: 'texto',
      obligatorio: true,
      alias: ['cliente', 'razon social', 'razón social', 'nombre del cliente'],
    },
    {
      clave: 'area_sector',
      etiqueta: 'Area / Sector',
      testid: 'qa-screen3-area-sector-input',
      tipo: 'texto',
      obligatorio: true,
      alias: ['area', 'área', 'sector', 'area sector', 'área / sector', 'area / sector'],
    },
    {
      clave: 'telefono',
      etiqueta: 'Telefono',
      testid: 'qa-screen3-telefono-input',
      tipo: 'texto',
      obligatorio: true,
      alias: ['telefono', 'teléfono', 'tel', 'contacto'],
      nota: 'Debe tener al menos 6 digitos.',
    },
    {
      clave: 'numero_documento',
      etiqueta: 'Numero de documento',
      testid: 'qa-screen3-documento-input',
      tipo: 'texto',
      obligatorio: true,
      alias: ['documento', 'numero de documento', 'número de documento', 'nro de documento', 'dni'],
    },
    {
      clave: 'cuil',
      etiqueta: 'CUIL',
      testid: 'qa-screen3-cuil-input',
      tipo: 'texto',
      obligatorio: true,
      alias: ['cuil', 'cuit'],
      nota: 'Debe tener exactamente 11 digitos.',
    },
    {
      clave: 'fecha_ingreso',
      etiqueta: 'Fecha de ingreso',
      testid: 'qa-screen3-fecha-ingreso-input',
      tipo: 'fecha',
      obligatorio: true,
      // Sin alias sueltos "ingreso" ni "alta": aparecen en frases como
      // "ingreso al menu" o "dar de alta" y generarian pasos falsos.
      alias: ['fecha de ingreso', 'fecha ingreso', 'fecha de alta'],
    },
    {
      clave: 'fecha_fin',
      etiqueta: 'Fecha de fin',
      testid: 'qa-screen3-fecha-fin-input',
      tipo: 'fecha',
      obligatorio: false,
      alias: ['fecha de fin', 'fecha fin', 'egreso', 'fecha de egreso', 'baja', 'fecha de baja'],
      nota: 'Opcional. Si se completa, no puede ser anterior a la fecha de ingreso.',
    },
  ],
  acciones: [
    {
      clave: 'guardar',
      etiqueta: 'Guardar caso',
      testid: 'qa-screen3-save-button',
      alias: ['guardar', 'guardo', 'grabar', 'dar de alta', 'guardar caso', 'confirmo el alta'],
      escribe: true,
      espera: { tipo: 'respuesta', valor: '/api/qa/casos', timeout_ms: 30000 },
    },
    {
      clave: 'importar',
      etiqueta: 'Importar Datos',
      testid: 'qa-screen3-import-button',
      alias: ['importar', 'importo', 'importacion', 'importación', 'carga masiva', 'subir archivo'],
      escribe: true,
    },
    {
      clave: 'actualizar',
      etiqueta: 'Actualizar',
      testid: 'qa-screen3-refresh-button',
      alias: ['actualizar', 'actualizo', 'refrescar', 'refresco', 'recargar'],
      escribe: false,
    },
    {
      clave: 'limpiar',
      etiqueta: 'Nuevo limpio',
      testid: 'qa-screen3-reset-button',
      alias: ['nuevo limpio', 'limpiar', 'limpio el formulario', 'vaciar'],
      escribe: false,
    },
  ],
  verificacion: {
    selector: '[data-testid="qa-screen3-message"]',
    patron_exito: 'guardado',
    clase_error: 'error',
  },
  fuente_casos: {
    etiqueta: 'Casos de QA - Pantalla 3 (alta básica de cliente)',
    filtro: { origen_pantalla: 'QA - Pantalla 3' },
    rutas_datos: ['contexto.contexto_complementario.pantalla_3', 'contexto.empleado'],
    prefijo_fila: 'qa-screen3-case-',
    // Misma formula que usa la pantalla al guardar, para poder aserir la fila.
    idEsperado: (datos) => {
      const documento = (datos['numero_documento'] ?? '').replace(/\D/g, '')
        || (datos['cuil'] ?? '').replace(/\D/g, '')
        || 'SINDOC';
      const fecha = (datos['fecha_ingreso'] ?? '').replace(/\D/g, '') || 'SINFECHA';
      return `QA-P3-ALTA-${documento}-${fecha}`;
    },
  },
};

const PANTALLA_1: PantallaCatalogo = {
  codigo: 'QA-PANT-1',
  ruta: '/qa/pantalla-1',
  nombre: 'QA - Pantalla 1',
  modulo: 'QA',
  instrumentada: true,
  selectores: {
    pagina: '[data-testid="qa-pantalla1-page"]',
    formulario: '[data-testid="qa-case-form"]',
    mensaje: '[data-testid="qa-case-message"]',
    panel_operacion: '[data-testid="qa-operation-panel"]',
  },
  campos: [
    {
      clave: 'id',
      etiqueta: 'Id del caso',
      testid: 'qa-case-id-input',
      tipo: 'texto',
      obligatorio: false,
      alias: ['id del caso', 'identificador del caso', 'codigo del caso', 'código del caso'],
    },
    {
      clave: 'definicion_tecnica',
      etiqueta: 'Definicion tecnica',
      testid: 'qa-case-definicion-select',
      tipo: 'select',
      obligatorio: false,
      alias: ['definicion tecnica', 'definición técnica', 'definicion'],
      nota: 'Select: el valor debe salir del catalogo real, no se infiere.',
    },
    {
      clave: 'dataset',
      etiqueta: 'Dataset',
      testid: 'qa-case-dataset-select',
      tipo: 'select',
      obligatorio: false,
      alias: ['dataset', 'set de datos'],
      nota: 'Select: el valor debe salir del catalogo real, no se infiere.',
    },
    {
      clave: 'periodo',
      etiqueta: 'Periodo',
      testid: 'qa-case-periodo-input',
      tipo: 'texto',
      obligatorio: false,
      alias: ['periodo', 'período'],
    },
    {
      clave: 'descripcion',
      etiqueta: 'Descripcion',
      testid: 'qa-case-descripcion-input',
      tipo: 'texto',
      obligatorio: false,
      alias: ['descripcion', 'descripción'],
    },
    {
      clave: 'cliente',
      etiqueta: 'Cliente',
      testid: 'qa-case-cliente-input',
      tipo: 'texto',
      obligatorio: false,
      alias: ['cliente'],
    },
    {
      clave: 'legajo',
      etiqueta: 'Legajo',
      testid: 'qa-case-legajo-input',
      tipo: 'numero',
      obligatorio: false,
      alias: ['legajo'],
    },
    {
      clave: 'empleado',
      etiqueta: 'Empleado',
      testid: 'qa-case-empleado-input',
      tipo: 'texto',
      obligatorio: false,
      alias: ['empleado'],
    },
    {
      clave: 'cuil',
      etiqueta: 'CUIL',
      testid: 'qa-case-cuil-input',
      tipo: 'texto',
      obligatorio: false,
      alias: ['cuil', 'cuit'],
    },
    {
      clave: 'remuneracion_bruta',
      etiqueta: 'Remuneracion bruta',
      testid: 'qa-case-remuneracion-input',
      tipo: 'numero',
      obligatorio: false,
      alias: ['remuneracion', 'remuneración', 'remuneracion bruta', 'bruto'],
    },
    {
      clave: 'deducciones',
      etiqueta: 'Deducciones',
      testid: 'qa-case-deducciones-input',
      tipo: 'numero',
      obligatorio: false,
      alias: ['deduccion', 'deducción', 'deducciones'],
    },
    {
      clave: 'campo_a_validar',
      etiqueta: 'Campo a validar',
      testid: 'qa-case-campo-select',
      tipo: 'select',
      obligatorio: false,
      alias: ['campo a validar', 'campo validar'],
      nota: 'Select: el valor debe salir del catalogo real, no se infiere.',
    },
    {
      clave: 'valor_esperado',
      etiqueta: 'Valor esperado',
      testid: 'qa-case-valor-esperado-input',
      tipo: 'numero',
      obligatorio: false,
      alias: ['valor esperado', 'esperado'],
    },
    {
      clave: 'tolerancia',
      etiqueta: 'Tolerancia',
      testid: 'qa-case-tolerancia-input',
      tipo: 'numero',
      obligatorio: false,
      alias: ['tolerancia'],
    },
    {
      clave: 'modo_saldo_favor',
      etiqueta: 'Modo saldo a favor',
      testid: 'qa-case-modo-saldo-select',
      tipo: 'select',
      obligatorio: false,
      alias: ['modo saldo', 'saldo a favor'],
      nota: 'Select: el valor debe salir del catalogo real, no se infiere.',
    },
    {
      clave: 'excel',
      etiqueta: 'Excel de respaldo',
      testid: 'qa-case-excel-input',
      tipo: 'archivo',
      obligatorio: false,
      alias: ['excel', 'planilla', 'archivo de respaldo', 'excel de respaldo'],
      nota: 'Archivo: la ruta la aporta quien define el caso.',
    },
  ],
  acciones: [
    {
      clave: 'guardar',
      etiqueta: 'Guardar caso',
      testid: 'qa-case-save-button',
      alias: ['guardar', 'guardo', 'grabar', 'guardar caso'],
      escribe: true,
      espera: { tipo: 'respuesta', valor: '/api/qa/casos', timeout_ms: 30000 },
    },
    {
      clave: 'ejemplo',
      etiqueta: 'Cargar ejemplo',
      testid: 'qa-case-example-button',
      alias: ['ejemplo', 'cargar ejemplo', 'datos de ejemplo'],
      escribe: false,
    },
    {
      clave: 'limpiar',
      etiqueta: 'Limpiar',
      testid: 'qa-case-reset-button',
      alias: ['limpiar', 'nuevo limpio', 'vaciar'],
      escribe: false,
    },
    {
      clave: 'importar',
      etiqueta: 'Importar archivo',
      testid: 'qa-import-file-button',
      alias: ['importar', 'importo', 'carga masiva', 'subir archivo'],
      escribe: true,
    },
    {
      clave: 'actualizar',
      etiqueta: 'Actualizar operacion',
      testid: 'qa-operation-refresh-button',
      alias: ['actualizar', 'refrescar', 'recargar'],
      escribe: false,
    },
  ],
  verificacion: {
    selector: '[data-testid="qa-case-message"]',
    patron_exito: 'guardad',
    clase_error: 'error',
  },
  fuente_casos: {
    etiqueta: 'Casos de QA - Pantalla 1 (retención de ganancias)',
    // Pantalla 1 no marca `origen.pantalla`: se reconoce por el tipo de origen.
    filtro: { origen_tipos: ['formulario_qa_pantalla_1', 'importacion_qa_pantalla_1'] },
    rutas_datos: ['contexto.empleado', 'contexto.liquidacion'],
    // Claves que no coinciden con las del caso.
    mapeo: {
      empleado: 'contexto.empleado.nombre',
      dataset: 'dataset_codigo',
      periodo: 'periodo',
      descripcion: 'descripcion',
      id: 'id',
      definicion_tecnica: 'definicion_tecnica_codigo',
    },
    // Sus casos sí se pueden correr uno por uno con /qa/casos/:id/ejecutar.
    ejecutable: true,
  },
};

const SOP_LOOM: PantallaCatalogo = {
  codigo: 'QA-PANT-SOP-LOOM',
  ruta: '/qa/sop-loom',
  nombre: 'QA - SOP Loom',
  modulo: 'QA',
  instrumentada: true,
  selectores: {
    pagina: '[data-testid="qa-sop-loom-page"]',
    formulario: '[data-testid="qa-sop-loom-form"]',
    mensaje: '[data-testid="qa-sop-loom-message"]',
    resultado: '[data-testid="qa-sop-loom-result"]',
    panel_aprendidos: '[data-testid="qa-sop-loom-learned-panel"]',
  },
  campos: [
    {
      clave: 'texto_loom',
      etiqueta: 'Texto del Loom',
      testid: 'qa-sop-loom-text-input',
      tipo: 'texto',
      obligatorio: true,
      alias: ['texto del loom', 'transcripcion', 'transcripción', 'descripcion del video', 'descripción del video'],
      ejemplo: 'Texto de prueba del flujo operativo.',
    },
  ],
  acciones: [
    {
      clave: 'aprender',
      etiqueta: 'Aprender flujo',
      testid: 'qa-sop-loom-learn-button',
      alias: ['aprender', 'aprendo', 'analizar el texto'],
      escribe: false,
    },
    {
      clave: 'guardar',
      etiqueta: 'Guardar flujo',
      testid: 'qa-sop-loom-save-button',
      alias: ['guardar', 'guardo', 'grabar'],
      escribe: true,
      espera: { tipo: 'respuesta', valor: '/api/qa/sop-loom/aprendizajes', timeout_ms: 30000 },
    },
    {
      clave: 'actualizar',
      etiqueta: 'Actualizar',
      testid: 'qa-sop-loom-refresh-button',
      alias: ['actualizar', 'refrescar', 'recargar'],
      escribe: false,
    },
    {
      clave: 'limpiar',
      etiqueta: 'Nuevo limpio',
      testid: 'qa-sop-loom-reset-button',
      alias: ['nuevo limpio', 'limpiar', 'vaciar'],
      escribe: false,
    },
  ],
  verificacion: {
    selector: '[data-testid="qa-sop-loom-message"]',
    patron_exito: 'guardado',
    clase_error: 'error',
  },
};

const PANTALLA_2: PantallaCatalogo = {
  codigo: 'QA-PANT-2',
  ruta: '/qa/pantalla-2',
  nombre: 'QA - Pantalla 2',
  modulo: 'QA',
  instrumentada: false,
  selectores: {},
  campos: [],
  acciones: [],
  nota: 'La pantalla no expone data-testid todavia. Hay que instrumentarla antes de poder automatizarla.',
};

const CATALOGO: PantallaCatalogo[] = [PANTALLA_1, PANTALLA_2, PANTALLA_3, SOP_LOOM];

export function normalizarTexto(valor: unknown): string {
  return (valor === undefined || valor === null ? '' : String(valor))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizarRuta(valor: unknown): string {
  const ruta = String(valor ?? '').trim();
  if (!ruta) return '';
  const conBarra = ruta.startsWith('/') ? ruta : `/${ruta}`;
  return conBarra.replace(/\/+$/, '').toLowerCase() || '/';
}

export function buscarPantallaPorRuta(ruta: unknown): PantallaCatalogo | null {
  const objetivo = normalizarRuta(ruta);
  if (!objetivo) return null;
  return CATALOGO.find((pantalla) => normalizarRuta(pantalla.ruta) === objetivo) ?? null;
}

export function rutasCatalogadas(): string[] {
  return CATALOGO.filter((pantalla) => pantalla.instrumentada).map((pantalla) => pantalla.ruta);
}

/** Coincidencia por palabra completa para evitar que "fin" matchee "definir". */
export function mencionaAlias(texto: string, alias: string[]): string {
  const normalizado = normalizarTexto(texto);
  if (!normalizado) return '';
  for (const item of alias) {
    const termino = normalizarTexto(item);
    if (!termino) continue;
    const patron = new RegExp(`(^|[^a-z0-9])${escaparRegex(termino)}([^a-z0-9]|$)`, 'i');
    if (patron.test(normalizado)) return item;
  }
  return '';
}

export function camposMencionados(pantalla: PantallaCatalogo, texto: string): Array<{ campo: CampoCatalogo; alias: string }> {
  return pantalla.campos
    .map((campo) => ({ campo, alias: mencionaAlias(texto, campo.alias) }))
    .filter((item) => item.alias !== '');
}

export function accionesMencionadas(pantalla: PantallaCatalogo, texto: string): Array<{ accion: AccionCatalogo; alias: string }> {
  return pantalla.acciones
    .map((accion) => ({ accion, alias: mencionaAlias(texto, accion.alias) }))
    .filter((item) => item.alias !== '');
}

function escaparRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function leerRuta(origen: unknown, ruta: string): Record<string, unknown> {
  if (!ruta) {
    return origen && typeof origen === 'object' && !Array.isArray(origen)
      ? origen as Record<string, unknown>
      : {};
  }
  let actual: unknown = origen;
  for (const tramo of ruta.split('.')) {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return {};
    actual = (actual as Record<string, unknown>)[tramo];
  }
  return actual && typeof actual === 'object' && !Array.isArray(actual)
    ? actual as Record<string, unknown>
    : {};
}

/** Lee un valor escalar por ruta absoluta con puntos: `contexto.empleado.nombre`. */
function leerValor(origen: unknown, ruta: string): string {
  const tramos = ruta.split('.');
  const hoja = tramos.pop() ?? '';
  const contenedor = leerRuta(origen, tramos.join('.'));
  const bruto = contenedor[hoja];
  return bruto === undefined || bruto === null ? '' : String(bruto).trim();
}

/** Las condiciones `$or` que identifican los casos de una pantalla, sin el filtro de `activo`. */
export function condicionesOrigenCasos(fuente: FuenteCasosCatalogo): Record<string, unknown>[] {
  const condiciones: Record<string, unknown>[] = [];

  if (fuente.filtro.origen_pantalla) {
    condiciones.push(
      { 'origen.pantalla': fuente.filtro.origen_pantalla },
      { 'contexto.contexto_complementario.origen.pantalla': fuente.filtro.origen_pantalla },
    );
  }
  if (fuente.filtro.origen_tipos?.length) {
    condiciones.push(
      { 'origen.tipo': { $in: fuente.filtro.origen_tipos } },
      { 'contexto.contexto_complementario.origen.tipo': { $in: fuente.filtro.origen_tipos } },
    );
  }
  return condiciones;
}

/** Traduce el filtro declarado del catálogo a una query de Mongo, solo casos activos. */
export function filtroCasosMongo(fuente: FuenteCasosCatalogo): Record<string, unknown> {
  const filtro: Record<string, unknown> = { activo: { $ne: false } };
  const condiciones = condicionesOrigenCasos(fuente);
  if (condiciones.length > 0) filtro['$or'] = condiciones;
  return filtro;
}

/** Fuentes de casos declaradas, para poder ofrecerlas al elicitar. */
export function fuentesCasosDisponibles(): Array<{ ruta: string; codigo: string; fuente: FuenteCasosCatalogo }> {
  return CATALOGO
    .filter((pantalla) => pantalla.fuente_casos)
    .map((pantalla) => ({
      ruta: pantalla.ruta,
      codigo: pantalla.codigo,
      fuente: pantalla.fuente_casos as FuenteCasosCatalogo,
    }));
}

/**
 * Extrae de un caso QA los valores de los campos de la pantalla. Recorre las
 * rutas declaradas en orden y se queda con el primer valor no vacio de cada
 * campo, asi un caso viejo que solo tenga `contexto.empleado` sigue sirviendo.
 */
export function datosDesdeCaso(
  pantalla: PantallaCatalogo,
  caso: Record<string, unknown>,
): { datos: Record<string, string>; faltantes: string[] } {
  const fuenteCasos = pantalla.fuente_casos;
  const rutas = fuenteCasos?.rutas_datos ?? [];
  const mapeo = fuenteCasos?.mapeo ?? {};
  const fuentes = rutas.map((ruta) => leerRuta(caso, ruta));
  const datos: Record<string, string> = {};

  for (const campo of pantalla.campos) {
    // Un mapeo explícito gana: es para claves que no coinciden con el caso.
    const rutaMapeada = mapeo[campo.clave];
    if (rutaMapeada) {
      const valor = leerValor(caso, rutaMapeada);
      if (valor) {
        datos[campo.clave] = valor;
        continue;
      }
    }
    for (const fuente of fuentes) {
      const bruto = fuente[campo.clave];
      const valor = bruto === undefined || bruto === null ? '' : String(bruto).trim();
      if (valor) {
        datos[campo.clave] = valor;
        break;
      }
    }
  }

  const faltantes = pantalla.campos
    .filter((campo) => campo.obligatorio && !datos[campo.clave])
    .map((campo) => campo.etiqueta);

  return { datos, faltantes };
}
