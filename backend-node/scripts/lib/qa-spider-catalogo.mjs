/**
 * qa-spider-catalogo.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Cargador de casos del QA Spider.
 *
 * El runner no define rutas, payloads ni niveles: los toma de aca. Las fuentes
 * se combinan en este orden y la ultima gana ante ids repetidos:
 *
 *   1. catalogo base            scripts/qa-spider-casos.json (versionado)
 *   2. archivo local opcional   scripts/qa-spider-casos.local.json
 *   3. archivo por entorno      QA_SPIDER_CASOS_FILE
 *
 * Todo caso invalido se descarta con motivo y viaja en el reporte final: el
 * Spider nunca ejecuta un caso a medias ni lo omite en silencio.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aca = dirname(fileURLToPath(import.meta.url));
export const RUTA_CATALOGO_BASE = resolve(aca, '..', 'qa-spider-casos.json');
const RUTA_CATALOGO_LOCAL = resolve(aca, '..', 'qa-spider-casos.local.json');

const AMBITOS = new Set(['ruta', 'global']);

/** Acciones que el ejecutor sabe resolver. Se valida contra esto al cargar. */
export const ACCIONES_CONOCIDAS = new Set([
  'capturar',
  'esperar',
  'auditar_accesibilidad',
  'verificar_carga',
  'verificar_sin_errores',
  'verificar_elemento',
  'verificar_url',
  'fuzz_formularios',
  'enviar_formulario',
  'click_elemento',
  'script',
]);

/* ── Carga del catalogo ──────────────────────────────────────────────────── */

async function leerJson(ruta) {
  const crudo = await readFile(ruta, 'utf8');
  return JSON.parse(crudo);
}

/**
 * Lee el catalogo base y le superpone los archivos opcionales.
 * Devuelve { catalogo, fuentes, descartados }.
 */
export async function cargarCatalogo({ archivoExtra } = {}) {
  const fuentes = [];
  const descartados = [];

  const base = await leerJson(RUTA_CATALOGO_BASE);
  fuentes.push({ tipo: 'archivo', ruta: RUTA_CATALOGO_BASE, casos: base.casos?.length ?? 0 });

  const extras = [RUTA_CATALOGO_LOCAL, archivoExtra].filter(
    (ruta) => ruta && existsSync(ruta),
  );

  for (const ruta of extras) {
    try {
      const parche = await leerJson(ruta);
      aplicarParche(base, parche);
      fuentes.push({ tipo: 'archivo', ruta, casos: parche.casos?.length ?? 0 });
    } catch (error) {
      descartados.push({ id: ruta, motivo: `No se pudo leer el catalogo extra: ${error.message}` });
    }
  }

  const { casos, invalidos } = normalizarCasos(base.casos ?? [], base, 'catalogo');
  base.casos = casos;
  descartados.push(...invalidos);

  return { catalogo: base, fuentes, descartados };
}

/**
 * Superpone un catalogo parcial sobre el base.
 * Los casos con id repetido reemplazan al original; el resto se agrega.
 */
function aplicarParche(base, parche) {
  for (const clave of ['niveles', 'secciones']) {
    if (!Array.isArray(parche[clave])) continue;
    const porId = new Map(base[clave].map((item) => [item.id, item]));
    for (const item of parche[clave]) porId.set(item.id, { ...porId.get(item.id), ...item });
    base[clave] = [...porId.values()];
  }

  if (parche.payloads) {
    base.payloads = { ...base.payloads, ...parche.payloads };
  }
  if (parche.umbrales) {
    base.umbrales = { ...base.umbrales, ...parche.umbrales };
  }
  if (Array.isArray(parche.casos)) {
    const porId = new Map((base.casos ?? []).map((caso) => [caso.id, caso]));
    for (const caso of parche.casos) porId.set(caso.id, caso);
    base.casos = [...porId.values()];
  }
}

/* ── Validacion ──────────────────────────────────────────────────────────── */

/**
 * Valida un caso contra el catalogo. Devuelve null si esta bien, o el motivo
 * del descarte. Es deliberadamente estricta: un caso mal escrito que se
 * ejecuta a medias produce un reporte que miente.
 */
export function validarCaso(caso, catalogo) {
  if (!caso || typeof caso !== 'object') return 'El caso no es un objeto';
  if (!caso.id || typeof caso.id !== 'string') return 'Falta el id del caso';
  if (!caso.nombre || typeof caso.nombre !== 'string') return 'Falta el nombre del caso';

  const ambito = caso.ambito ?? 'ruta';
  if (!AMBITOS.has(ambito)) return `Ambito desconocido: ${ambito}`;

  const nivelesValidos = new Set((catalogo.niveles ?? []).map((nivel) => nivel.id));
  if (!Array.isArray(caso.niveles) || !caso.niveles.length) {
    return 'El caso debe declarar al menos un nivel';
  }
  const nivelInvalido = caso.niveles.find((nivel) => !nivelesValidos.has(nivel));
  if (nivelInvalido) return `Nivel desconocido: ${nivelInvalido}`;

  if (!Array.isArray(caso.pasos) || !caso.pasos.length) {
    return 'El caso no declara pasos';
  }
  for (const paso of caso.pasos) {
    if (!paso || typeof paso.accion !== 'string') return 'Hay un paso sin accion';
    if (!ACCIONES_CONOCIDAS.has(paso.accion)) return `Accion desconocida: ${paso.accion}`;
  }

  if (caso.aplica_a !== undefined && caso.aplica_a !== '*' && !Array.isArray(caso.aplica_a)) {
    return 'aplica_a debe ser "*" o un arreglo de rutas';
  }

  return null;
}

function normalizarCasos(casos, catalogo, origen) {
  const validos = [];
  const invalidos = [];

  for (const caso of casos) {
    const motivo = validarCaso(caso, catalogo);
    if (motivo) {
      invalidos.push({ id: caso?.id ?? '(sin id)', origen, motivo });
      continue;
    }
    validos.push({
      ...caso,
      ambito: caso.ambito ?? 'ruta',
      aplica_a: caso.aplica_a ?? '*',
      excluye: caso.excluye ?? [],
      origen,
      activo: caso.activo !== false,
    });
  }

  return { casos: validos, invalidos };
}

/* ── Secciones ───────────────────────────────────────────────────────────── */

/**
 * Resuelve la seleccion recibida (ids de seccion, rutas, "todas" o vacio) a la
 * lista de secciones del catalogo. Acepta rutas libres no catalogadas para no
 * bloquear exploraciones puntuales, pero las marca como tales.
 */
export function resolverSecciones(catalogo, seleccion) {
  const secciones = catalogo.secciones ?? [];
  const porId = new Map(secciones.map((seccion) => [seccion.id, seccion]));
  const porRuta = new Map(secciones.map((seccion) => [seccion.ruta, seccion]));

  const esTodas =
    !seleccion ||
    seleccion === 'todas' ||
    (Array.isArray(seleccion) && !seleccion.length);

  if (esTodas) {
    const porDefecto = secciones.filter((seccion) => seccion.por_defecto !== false);
    return porDefecto.length ? porDefecto : secciones;
  }

  const entradas = Array.isArray(seleccion)
    ? seleccion
    : String(seleccion).split(',').map((item) => item.trim());

  const resueltas = [];
  for (const entrada of entradas) {
    if (!entrada) continue;
    const seccion = porId.get(entrada) ?? porRuta.get(entrada);
    if (seccion) {
      resueltas.push(seccion);
      continue;
    }
    if (entrada.startsWith('/')) {
      resueltas.push({ id: entrada, ruta: entrada, etiqueta: entrada, fuera_de_catalogo: true });
    }
  }

  // Deduplica conservando el orden de seleccion.
  const vistas = new Set();
  return resueltas.filter((seccion) => {
    if (vistas.has(seccion.ruta)) return false;
    vistas.add(seccion.ruta);
    return true;
  });
}

/**
 * Arma los pasos de un caso propio a partir de su codigo Playwright.
 *
 * Un caso generado bajo la categoria "accesibilidad" no fuzzea nada -repite el
 * flujo tal cual se grabo, para llegar al mismo estado que exploro el
 * operador- asi que el paso util no es el codigo en si, sino la auditoria WCAG
 * que corre despues sobre la pantalla resultante.
 */
function pasosDelCaso(codigo, niveles) {
  const pasos = [{ accion: 'script', params: { codigo } }];
  if (niveles?.length === 1 && niveles[0] === 'accesibilidad') {
    pasos.push({ accion: 'auditar_accesibilidad', params: {} });
  }
  return pasos;
}

/* ── Casos desde MongoDB ─────────────────────────────────────────────────── */

/**
 * Trae los casos que el operador cargo desde la pantalla del Spider
 * (coleccion `qa_spider_casos`).
 *
 * Cada documento guarda el codigo Playwright de la pasada y su transcripcion.
 * Se convierte a la forma de caso del catalogo con un unico paso `script`, asi
 * el motor de ejecucion no distingue entre un caso propio y uno del catalogo.
 *
 * A diferencia de las semillas por id, estos casos NO se marcan `seleccionado`:
 * corren segun los niveles que declararon, igual que cualquier caso del catalogo.
 */
export async function cargarCasosDelOperador({ conexion, catalogo, soloIds = null }) {
  if (!conexion) return { casos: [], invalidos: [] };

  const filtro = { activo: { $ne: false } };
  const documentos = await conexion.collection('qa_spider_casos').find(filtro).toArray();

  const crudos = [];
  const invalidos = [];

  for (const documento of documentos) {
    const id = String(documento._id);
    if (soloIds?.length && !soloIds.includes(id)) continue;

    const codigo = documento.codigo_playwright;
    if (typeof codigo !== 'string' || !codigo.trim()) {
      invalidos.push({ id, origen: 'operador', motivo: 'El caso no tiene codigo Playwright' });
      continue;
    }

    const ambito = documento.ambito === 'ruta' ? 'ruta' : 'global';
    const aplicaA = ambito === 'ruta' && documento.aplica_a?.length ? documento.aplica_a : '*';
    const niveles = documento.niveles?.length
      ? documento.niveles
      : (catalogo.niveles ?? []).map((nivel) => nivel.id);

    crudos.push({
      id,
      nombre: documento.nombre ?? `Caso ${id}`,
      descripcion: documento.descripcion || documento.transcripcion || 'Caso cargado por el operador.',
      transcripcion: documento.transcripcion ?? '',
      ambito,
      aplica_a: aplicaA,
      niveles,
      seleccionado: Boolean(soloIds?.length),
      pasos: pasosDelCaso(codigo, niveles),
    });
  }

  const { casos, invalidos: malFormados } = normalizarCasos(crudos, catalogo, 'operador');
  return { casos, invalidos: [...invalidos, ...malFormados] };
}

/**
 * Trae UN caso puntual del operador por id, para el boton "Ejecutar" individual.
 *
 * A diferencia de `cargarCasosDelOperador`, NO filtra por `activo`: el
 * operador pidio expresamente correr este caso ahora, asi que corre sin
 * importar su estado o los niveles que declaro.
 */
export async function cargarCasoUnicoDelOperador({ conexion, catalogo, id, ObjectId }) {
  if (!conexion) return { caso: null, motivo: 'Sin conexion a MongoDB' };

  let objectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return { caso: null, motivo: 'Id de caso invalido' };
  }

  const documento = await conexion.collection('qa_spider_casos').findOne({ _id: objectId });
  if (!documento) return { caso: null, motivo: 'El caso no existe o fue eliminado' };

  const codigo = documento.codigo_playwright;
  if (typeof codigo !== 'string' || !codigo.trim()) {
    return { caso: null, motivo: 'El caso no tiene codigo Playwright' };
  }

  const ambito = documento.ambito === 'ruta' ? 'ruta' : 'global';
  const rutasObjetivo = ambito === 'ruta' && documento.aplica_a?.length ? documento.aplica_a : [];
  const niveles = documento.niveles?.length
    ? documento.niveles
    : (catalogo.niveles ?? []).map((nivel) => nivel.id);

  const crudo = {
    id: String(documento._id),
    nombre: documento.nombre ?? `Caso ${id}`,
    descripcion: documento.descripcion || documento.transcripcion || 'Caso cargado por el operador.',
    transcripcion: documento.transcripcion ?? '',
    ambito,
    aplica_a: '*',
    niveles,
    seleccionado: true,
    pasos: pasosDelCaso(codigo, niveles),
  };

  const { casos, invalidos } = normalizarCasos([crudo], catalogo, 'operador');
  if (!casos.length) return { caso: null, motivo: invalidos[0]?.motivo ?? 'Caso invalido' };

  return { caso: casos[0], rutasObjetivo };
}

/* ── Seleccion final ─────────────────────────────────────────────────────── */

/**
 * Filtra los casos aplicables a un nivel y a una ruta.
 *
 * Reglas:
 *  - un caso corre si declara el nivel elegido;
 *  - los casos marcados `seleccionado` (elegidos a mano en la UI) corren siempre;
 *  - `aplica_a` acepta "*" o una lista de rutas; `excluye` descarta rutas puntuales.
 */
export function casosAplicables(casos, { nivel, ruta, ambito }) {
  return casos.filter((caso) => {
    if (!caso.activo) return false;
    if ((caso.ambito ?? 'ruta') !== ambito) return false;
    if (!caso.seleccionado && !caso.niveles.includes(nivel)) return false;

    if (ambito === 'global') return true;

    if (Array.isArray(caso.excluye) && caso.excluye.includes(ruta)) return false;
    if (caso.aplica_a === '*') return true;
    return Array.isArray(caso.aplica_a) && caso.aplica_a.includes(ruta);
  });
}

/**
 * Resumen del catalogo para exponerlo por API sin filtrar detalles internos.
 */
export function resumirCatalogo(catalogo) {
  return {
    version: catalogo.version,
    niveles: catalogo.niveles,
    secciones: catalogo.secciones,
    umbrales: catalogo.umbrales,
    casos: (catalogo.casos ?? []).map((caso) => ({
      id: caso.id,
      nombre: caso.nombre,
      descripcion: caso.descripcion,
      ambito: caso.ambito,
      niveles: caso.niveles,
      aplica_a: caso.aplica_a,
      pasos: caso.pasos.map((paso) => paso.accion),
    })),
  };
}
