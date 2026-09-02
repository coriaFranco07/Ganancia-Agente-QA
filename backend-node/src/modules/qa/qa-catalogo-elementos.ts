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

/**
 * Restricción de formato sobre el valor de un campo. Qué atributos aplican
 * depende del `tipo` del campo (`validarValorCampo` decide cuáles mirar):
 *  - texto: largo_exacto/minimo/maximo (sobre los dígitos del valor, igual
 *    que ya se hacía a mano para CUIL/Teléfono) y patron.
 *  - numero: valor_minimo/valor_maximo, sobre el valor numérico en sí.
 *  - fecha: dias_atras_max/dias_adelante_max, sobre la distancia en días
 *    entre el valor y la fecha de hoy.
 *  - select/archivo: sin restricción de formato, solo obligatoriedad.
 */
export interface RestriccionCampo {
  largo_exacto?: number | null;
  largo_minimo?: number | null;
  largo_maximo?: number | null;
  patron?: string;
  patron_mensaje?: string;
  valor_minimo?: number | null;
  valor_maximo?: number | null;
  /** Cuántos días antes de hoy se permite la fecha. 0 = no permite fechas pasadas. */
  dias_atras_max?: number | null;
  /** Cuántos días después de hoy se permite la fecha. 0 = no permite fechas futuras. */
  dias_adelante_max?: number | null;
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
  /** Default de fábrica. Una regla de validación lo puede ajustar por pantalla o global. */
  restriccion?: RestriccionCampo;
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
  nombre: 'Legajo de Cliente',
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
      restriccion: { largo_minimo: 6 },
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
      restriccion: { largo_exacto: 11 },
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
    etiqueta: 'Casos de Legajo de Cliente',
    // 'origen_pantalla' queda por compatibilidad con casos guardados antes de
    // este nombre; 'formulario_cliente_basico' es el que manda de acá en más.
    filtro: { origen_pantalla: 'QA - Pantalla 3', origen_tipos: ['formulario_cliente_basico'] },
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
  nombre: 'Legajo de Ganancias',
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
      restriccion: { largo_exacto: 11 },
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
    etiqueta: 'Casos de Legajo de Ganancias',
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
      // El formulario guarda estos campos en contexto_complementario y en
      // resultado_esperado, no en contexto.empleado/liquidacion.
      cliente: 'contexto.contexto_complementario.datos_cliente.cliente_nombre',
      modo_saldo_favor: 'contexto.contexto_complementario.datos_cliente.modo_saldo_favor',
      campo_a_validar: 'resultado_esperado.campo',
      valor_esperado: 'resultado_esperado.valor',
      tolerancia: 'resultado_esperado.tolerancia',
      excel: 'archivo.nombre',
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

const CATALOGO: PantallaCatalogo[] = [PANTALLA_1, PANTALLA_3, SOP_LOOM];

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

/**
 * Nombres por los que un SOP puede referirse a una pantalla: su ruta, su
 * nombre, su codigo y la forma corta que se deduce de la ruta
 * (`/qa/pantalla-3` -> "pantalla 3"). No se hardcodea ninguna pantalla: sumar
 * una al catalogo alcanza para que el detector la reconozca.
 */
function aliasDePantalla(pantalla: PantallaCatalogo): string[] {
  const ultimoTramo = pantalla.ruta.split('/').filter(Boolean).pop() ?? '';
  const legible = ultimoTramo.replace(/[-_]+/g, ' ').trim();
  return Array.from(new Set([
    pantalla.ruta,
    pantalla.nombre,
    pantalla.codigo,
    legible,
    legible.replace(/\s+/g, ''),
  ].filter(Boolean)));
}

/** Posicion de la primera mencion de `alias` como palabra completa, o -1. */
function posicionDeAlias(textoNormalizado: string, alias: string): number {
  const termino = normalizarTexto(alias);
  if (!termino) return -1;
  const patron = new RegExp(`(^|[^a-z0-9])${escaparRegex(termino)}([^a-z0-9]|$)`, 'i');
  const coincidencia = patron.exec(textoNormalizado);
  return coincidencia ? coincidencia.index + coincidencia[1].length : -1;
}

/**
 * Pantallas del catalogo nombradas en un texto, en orden de aparicion y sin
 * repetir. Es lo que permite leer un SOP que salta de una pantalla a otra
 * ("...tocas Siguiente y eso te lleva a Pantalla 3...") como un recorrido y no
 * como una sola pantalla.
 */
export function pantallasMencionadas(texto: unknown): Array<{ pantalla: PantallaCatalogo; alias: string }> {
  const normalizado = normalizarTexto(texto);
  if (!normalizado) return [];

  const encontradas: Array<{ pantalla: PantallaCatalogo; alias: string; posicion: number }> = [];
  for (const pantalla of CATALOGO) {
    let mejor: { alias: string; posicion: number } | null = null;
    for (const alias of aliasDePantalla(pantalla)) {
      const posicion = posicionDeAlias(normalizado, alias);
      if (posicion < 0) continue;
      if (!mejor || posicion < mejor.posicion) mejor = { alias, posicion };
    }
    if (mejor) encontradas.push({ pantalla, alias: mejor.alias, posicion: mejor.posicion });
  }

  return encontradas
    .sort((a, b) => a.posicion - b.posicion)
    .map(({ pantalla, alias }) => ({ pantalla, alias }));
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
export function fuentesCasosDisponibles(): Array<{ ruta: string; codigo: string; nombre: string; fuente: FuenteCasosCatalogo }> {
  return CATALOGO
    .filter((pantalla) => pantalla.fuente_casos)
    .map((pantalla) => ({
      ruta: pantalla.ruta,
      codigo: pantalla.codigo,
      nombre: pantalla.nombre,
      fuente: pantalla.fuente_casos as FuenteCasosCatalogo,
    }));
}

/** Pantallas con campos catalogados, para armar el selector de reglas de validación. */
export function pantallasConCampos(): PantallaCatalogo[] {
  return CATALOGO.filter((pantalla) => pantalla.instrumentada && pantalla.campos.length > 0);
}

/**
 * Tipo de dato de un campo por su clave (ej: "fecha_ingreso" -> "fecha"), para
 * poder validar que una regla solo pida restricciones que tengan sentido para
 * ese tipo. Si se pasa `ruta`, busca solo en esa pantalla; si no, en todo el
 * catálogo (la clave tiene el mismo tipo en todas las pantallas donde vive).
 */
export function tipoDeCampo(clave: string, ruta?: string): TipoCampoCatalogo | null {
  const pantallas = ruta
    ? [buscarPantallaPorRuta(ruta)].filter((item): item is PantallaCatalogo => Boolean(item))
    : pantallasConCampos();
  for (const pantalla of pantallas) {
    const campo = pantalla.campos.find((item) => item.clave === clave);
    if (campo) return campo.tipo;
  }
  return null;
}

/**
 * A qué pantalla pertenece un caso QA, mirando su `origen` igual que
 * `condicionesOrigenCasos`, pero contra un objeto en memoria en vez de contra
 * una query de Mongo. Se usa para validar un caso recién armado, antes de
 * guardarlo.
 */
export function pantallaPorOrigenCaso(caso: Record<string, unknown>): PantallaCatalogo | null {
  const origen = objetoAnidado(caso['origen']);
  const complementario = objetoAnidado(objetoAnidado(caso['contexto'])['contexto_complementario']);
  const origenComplementario = objetoAnidado(complementario['origen']);
  const pantallaTxt = normalizarTexto(origen['pantalla'] ?? origenComplementario['pantalla']);
  const tipoTxt = normalizarTexto(origen['tipo'] ?? origenComplementario['tipo']);

  for (const pantalla of CATALOGO) {
    const filtro = pantalla.fuente_casos?.filtro;
    if (!filtro) continue;
    if (filtro.origen_pantalla && normalizarTexto(filtro.origen_pantalla) === pantallaTxt) return pantalla;
    if (filtro.origen_tipos?.some((tipo) => normalizarTexto(tipo) === tipoTxt)) return pantalla;
  }
  return null;
}

function objetoAnidado(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === 'object' && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : {};
}

/**
 * Ajuste manual sobre un campo: obligatoriedad y/o restricción de formato,
 * por pantalla puntual o para todas. Cada atributo es independiente — dejar
 * uno en `null`/vacío no lo borra, hereda lo que haya debajo (regla global o
 * default del catálogo). Es la forma "resuelta" de `QaReglaValidacion`.
 */
export interface ReglaValidacionResuelta {
  campo: string;
  alcance: 'global' | 'pantalla';
  ruta?: string;
  obligatorio: boolean | null;
  largo_exacto?: number | null;
  largo_minimo?: number | null;
  largo_maximo?: number | null;
  patron?: string;
  patron_mensaje?: string;
  valor_minimo?: number | null;
  valor_maximo?: number | null;
  dias_atras_max?: number | null;
  dias_adelante_max?: number | null;
}

/**
 * Devuelve la pantalla con `campos` ajustado según las reglas activas.
 * Precedencia por atributo (no por regla completa): pantalla puntual > global
 * > default del catálogo. No muta la pantalla original.
 */
export function aplicarReglasCampos(
  pantalla: PantallaCatalogo,
  reglas: ReglaValidacionResuelta[],
): PantallaCatalogo {
  if (reglas.length === 0) return pantalla;

  const combinar = (base: ReglaValidacionResuelta | undefined, regla: ReglaValidacionResuelta): ReglaValidacionResuelta => ({
    campo: regla.campo,
    alcance: regla.alcance,
    ruta: regla.ruta,
    obligatorio: regla.obligatorio ?? base?.obligatorio ?? null,
    largo_exacto: regla.largo_exacto ?? base?.largo_exacto ?? null,
    largo_minimo: regla.largo_minimo ?? base?.largo_minimo ?? null,
    largo_maximo: regla.largo_maximo ?? base?.largo_maximo ?? null,
    patron: regla.patron || base?.patron || '',
    patron_mensaje: regla.patron_mensaje || base?.patron_mensaje || '',
    valor_minimo: regla.valor_minimo ?? base?.valor_minimo ?? null,
    valor_maximo: regla.valor_maximo ?? base?.valor_maximo ?? null,
    dias_atras_max: regla.dias_atras_max ?? base?.dias_atras_max ?? null,
    dias_adelante_max: regla.dias_adelante_max ?? base?.dias_adelante_max ?? null,
  });

  const resuelto = new Map<string, ReglaValidacionResuelta>();
  for (const regla of reglas) {
    if (regla.alcance !== 'global') continue;
    resuelto.set(regla.campo, combinar(resuelto.get(regla.campo), regla));
  }
  for (const regla of reglas) {
    if (regla.alcance !== 'pantalla' || normalizarRuta(regla.ruta) !== normalizarRuta(pantalla.ruta)) continue;
    resuelto.set(regla.campo, combinar(resuelto.get(regla.campo), regla));
  }
  if (resuelto.size === 0) return pantalla;

  return {
    ...pantalla,
    campos: pantalla.campos.map((campo) => {
      const ajuste = resuelto.get(campo.clave);
      if (!ajuste) return campo;
      return {
        ...campo,
        obligatorio: ajuste.obligatorio ?? campo.obligatorio,
        restriccion: {
          largo_exacto: ajuste.largo_exacto ?? campo.restriccion?.largo_exacto ?? null,
          largo_minimo: ajuste.largo_minimo ?? campo.restriccion?.largo_minimo ?? null,
          largo_maximo: ajuste.largo_maximo ?? campo.restriccion?.largo_maximo ?? null,
          patron: ajuste.patron || campo.restriccion?.patron || '',
          patron_mensaje: ajuste.patron_mensaje || campo.restriccion?.patron_mensaje || '',
          valor_minimo: ajuste.valor_minimo ?? campo.restriccion?.valor_minimo ?? null,
          valor_maximo: ajuste.valor_maximo ?? campo.restriccion?.valor_maximo ?? null,
          dias_atras_max: ajuste.dias_atras_max ?? campo.restriccion?.dias_atras_max ?? null,
          dias_adelante_max: ajuste.dias_adelante_max ?? campo.restriccion?.dias_adelante_max ?? null,
        },
      };
    }),
  };
}

/**
 * Valida un valor contra la obligatoriedad y restricción ya resueltas de un
 * campo (después de `aplicarReglasCampos`). Un campo vacío y opcional no se
 * valida en formato: no tiene sentido exigirle forma a algo que no se cargó.
 */
export function validarValorCampo(campo: CampoCatalogo, valor: string): string[] {
  const texto = (valor ?? '').trim();

  if (campo.obligatorio && !texto) {
    return [`Falta ${campo.etiqueta}.`];
  }
  if (!texto) return [];

  const restriccion = campo.restriccion;
  if (!restriccion) return [];

  // Qué restricciones tienen sentido depende del tipo de dato del campo: a
  // una fecha no se le pide "largo en dígitos", se le pide una ventana de
  // días respecto de hoy. select/archivo no tienen restricción de formato.
  if (campo.tipo === 'numero') return validarRestriccionNumero(campo, texto, restriccion);
  if (campo.tipo === 'fecha') return validarRestriccionFecha(campo, texto, restriccion);
  if (campo.tipo === 'select' || campo.tipo === 'archivo') return [];
  return validarRestriccionTexto(campo, texto, restriccion);
}

function validarRestriccionTexto(campo: CampoCatalogo, texto: string, restriccion: RestriccionCampo): string[] {
  const errores: string[] = [];
  const digitos = texto.replace(/\D/g, '');
  if (restriccion.largo_exacto != null && digitos.length !== restriccion.largo_exacto) {
    errores.push(`${campo.etiqueta} debe tener exactamente ${restriccion.largo_exacto} dígitos.`);
  }
  if (restriccion.largo_minimo != null && digitos.length < restriccion.largo_minimo) {
    errores.push(`${campo.etiqueta} debe tener al menos ${restriccion.largo_minimo} dígitos.`);
  }
  if (restriccion.largo_maximo != null && digitos.length > restriccion.largo_maximo) {
    errores.push(`${campo.etiqueta} debe tener como máximo ${restriccion.largo_maximo} dígitos.`);
  }
  if (restriccion.patron) {
    let coincide = true;
    try {
      coincide = new RegExp(restriccion.patron).test(texto);
    } catch {
      coincide = true; // un patrón mal escrito no debe bloquear al usuario.
    }
    if (!coincide) errores.push(restriccion.patron_mensaje || `${campo.etiqueta} no cumple el formato esperado.`);
  }
  return errores;
}

function validarRestriccionNumero(campo: CampoCatalogo, texto: string, restriccion: RestriccionCampo): string[] {
  const numero = Number(texto.replace(',', '.'));
  // Un valor que no llegó a ser un número válido no es un problema de rango:
  // que lo reporte quien valida el tipo de dato, no esta regla.
  if (!Number.isFinite(numero)) return [];

  const errores: string[] = [];
  if (restriccion.valor_minimo != null && numero < restriccion.valor_minimo) {
    errores.push(`${campo.etiqueta} debe ser mayor o igual a ${restriccion.valor_minimo}.`);
  }
  if (restriccion.valor_maximo != null && numero > restriccion.valor_maximo) {
    errores.push(`${campo.etiqueta} debe ser menor o igual a ${restriccion.valor_maximo}.`);
  }
  return errores;
}

/** Distancia en días calendario entre `texto` (fecha YYYY-MM-DD) y hoy: negativo = pasado, positivo = futuro. */
function diasDesdeHoy(texto: string): number | null {
  const fecha = new Date(`${texto}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) return null;
  const hoy = new Date();
  const hoyUtc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return Math.round((fecha.getTime() - hoyUtc) / 86400000);
}

function validarRestriccionFecha(campo: CampoCatalogo, texto: string, restriccion: RestriccionCampo): string[] {
  const dias = diasDesdeHoy(texto);
  // Una fecha que no se pudo parsear no es un problema de ventana permitida.
  if (dias === null) return [];

  const errores: string[] = [];
  if (dias < 0 && restriccion.dias_atras_max != null && Math.abs(dias) > restriccion.dias_atras_max) {
    errores.push(
      restriccion.dias_atras_max === 0
        ? `${campo.etiqueta} no puede ser anterior a hoy.`
        : `${campo.etiqueta} no puede ser más de ${restriccion.dias_atras_max} día(s) anterior a hoy.`,
    );
  }
  if (dias > 0 && restriccion.dias_adelante_max != null && dias > restriccion.dias_adelante_max) {
    errores.push(
      restriccion.dias_adelante_max === 0
        ? `${campo.etiqueta} no puede ser posterior a hoy.`
        : `${campo.etiqueta} no puede ser más de ${restriccion.dias_adelante_max} día(s) posterior a hoy.`,
    );
  }
  return errores;
}

/** Valida todos los campos de una pantalla contra los datos resueltos de un caso. */
export function validarDatosCampos(pantalla: PantallaCatalogo, datos: Record<string, string>): string[] {
  const errores: string[] = [];
  for (const campo of pantalla.campos) {
    errores.push(...validarValorCampo(campo, datos[campo.clave] ?? ''));
  }
  return errores;
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
