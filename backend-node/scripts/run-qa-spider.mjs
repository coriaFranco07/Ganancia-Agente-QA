/**
 * run-qa-spider.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Runner del QA Lab Spider: exploracion automatica y health-check de la UI.
 *
 * Este archivo solo orquesta. Que se prueba, sobre que rutas y con que datos
 * sale del catalogo declarativo (`scripts/qa-spider-casos.json` + fuentes
 * externas) y como se ejecuta cada paso sale del registro de acciones
 * (`scripts/lib/qa-spider-acciones.mjs`).
 *
 * Configuracion por entorno:
 *   QA_LAB_SECCIONES              ids de seccion, rutas, JSON o "todas"
 *   QA_LAB_AGRESIVIDAD            suave | media | extrema
 *   QA_SPIDER_CASO_UNICO_ID       id de un caso propio: lo ejecuta solo, sin
 *                                 recorrer secciones ni correr el resto del catalogo
 *   QA_SPIDER_CASOS_FILE          catalogo extra que se superpone al base
 *   QA_SPIDER_PERMITIR_SCRIPT     "false" desactiva las semillas de codigo
 *   QA_SPIDER_FALLAR_EN_HALLAZGOS "true" hace que la corrida salga con codigo 1
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import mongoose from 'mongoose';
import { chromium } from 'playwright-core';

import {
  cargarCasoUnicoDelOperador,
  cargarCasosDelOperador,
  cargarCatalogo,
  casosAplicables,
  resolverSecciones,
} from './lib/qa-spider-catalogo.mjs';
import { obtenerAccion } from './lib/qa-spider-acciones.mjs';

/* ── Configuracion ───────────────────────────────────────────────────────── */

const backendRoot = process.cwd();
const repoRoot = resolve(backendRoot, '..');
const outputDir = resolve(repoRoot, 'outputs/playwright/qa-lab-spider');

const frontendUrl = (process.env.AUDITORIA_FRONTEND_URL ?? 'http://localhost:4200').replace(/\/$/, '');
const correo = process.env.AUDITORIA_QA_CORREO ?? 'qa-local@auditoria.test';
const contrasena = process.env.AUDITORIA_QA_PASSWORD ?? 'qa-local-123456';

const mongodbUri = resolverMongoUri();
// Con QA_SPIDER_CASO_UNICO_ID seteado, el runner ignora secciones/catalogo y
// corre solo ese caso: el nivel no aplica, se etiqueta 'manual' en el reporte.
const idCasoUnico = process.env.QA_SPIDER_CASO_UNICO_ID || null;
const nivel = idCasoUnico ? 'manual' : process.env.QA_LAB_AGRESIVIDAD ?? 'suave';
const seleccionSecciones = parsearSeleccion(process.env.QA_LAB_SECCIONES ?? 'todas');
// Si viene vacio corren todos los casos activos del operador segun su nivel;
// si trae ids, se limita a esos y corren siempre.
const idsCasosOperador = parsearJson(process.env.QA_SPIDER_CASOS_OPERADOR, null);
const archivoExtra = process.env.QA_SPIDER_CASOS_FILE
  ? resolve(backendRoot, process.env.QA_SPIDER_CASOS_FILE)
  : null;

const timeoutMs = Number(process.env.AUDITORIA_PLAYWRIGHT_TIMEOUT_MS ?? 90_000);
const timeoutCampoMs = Number(process.env.QA_SPIDER_TIMEOUT_CAMPO_MS ?? 2_000);
// Tope por linea de un caso "script": si una linea se queda esperando (ej. un
// boton que la app dejo deshabilitado por validacion), no vale la pena
// esperar el timeout por defecto de Playwright (90s) antes de seguir con la
// linea siguiente.
const timeoutLineaScriptMs = Number(process.env.QA_SPIDER_TIMEOUT_LINEA_SCRIPT_MS ?? 8_000);
const esperaEstabilidadMs = Number(process.env.QA_SPIDER_ESTABILIDAD_MS ?? 4_000);
const permitirScript = process.env.QA_SPIDER_PERMITIR_SCRIPT !== 'false';
const fallarEnHallazgos = process.env.QA_SPIDER_FALLAR_EN_HALLAZGOS === 'true';

const modoDemo = process.argv.includes('--demo') || process.env.AUDITORIA_PLAYWRIGHT_DEMO === 'true';
const forzarChrome = process.argv.includes('--chrome') || process.env.PLAYWRIGHT_BROWSER === 'chrome';
const headedFlag = process.argv.includes('--headed');
const headless = modoDemo || headedFlag ? false : process.env.PLAYWRIGHT_HEADLESS === 'true';
const slowMoMs = Number(process.env.PLAYWRIGHT_SLOWMO_MS ?? (modoDemo ? 900 : headless ? 0 : 50));

/* ── Estado de la corrida ────────────────────────────────────────────────── */

const erroresConsola = [];
const erroresRed = [];
const capturas = [];
const metricasCarga = [];
const snapshotsA11y = [];
const resultadosCasos = [];
const paginasVisitadas = [];

let marcaRuta = { consola: 0, red: 0 };
let browser;
let page;
let conexionMongo = null;
let expectPlaywright = null;

/* ── Ejecucion ───────────────────────────────────────────────────────────── */

try {
  await mkdir(outputDir, { recursive: true });

  const { catalogo, fuentes, descartados } = await cargarCatalogo({ archivoExtra });

  await conectarMongo();
  await asegurarUsuario();

  await abrirNavegador();
  await iniciarSesion();
  await tomarCaptura('00-inicio-spider');

  if (idCasoUnico) {
    await ejecutarModoCasoUnico({ catalogo, fuentes, descartados, id: idCasoUnico });
  } else {
    validarNivel(catalogo, nivel);

    const secciones = resolverSecciones(catalogo, seleccionSecciones);
    if (!secciones.length) throw new Error('No hay secciones para explorar con la seleccion recibida');

    // Casos que el operador cargo desde la pantalla del Spider.
    const delOperador = await cargarCasosDelOperador({
      conexion: conexionMongo,
      catalogo,
      soloIds: idsCasosOperador,
    });
    if (delOperador.casos.length) {
      fuentes.push({ tipo: 'operador', ruta: 'qa_spider_casos', casos: delOperador.casos.length });
    }
    descartados.push(...delOperador.invalidos);

    const casos = [...catalogo.casos, ...delOperador.casos];

    console.log(`\n▶ QA Spider — nivel ${nivel}`);
    console.log(`  Catalogo v${catalogo.version}: ${casos.length} caso(s) cargado(s) desde ${fuentes.length} fuente(s)`);
    console.log(`  Secciones: ${secciones.map((seccion) => seccion.ruta).join(', ')}`);
    if (descartados.length) console.log(`  ⚠️  ${descartados.length} caso(s) descartado(s) por definicion invalida`);

    // Casos globales (semillas y flujos que no dependen de una ruta puntual).
    const globales = casosAplicables(casos, { nivel, ambito: 'global' });
    if (globales.length) {
      console.log(`\n🌱 Ejecutando ${globales.length} caso(s) global(es)...`);
      for (const caso of globales) {
        await ejecutarCaso(caso, { ruta: null, etiquetaRuta: 'global', catalogo, metricas: null });
        await persistirUltimaEjecucion(caso);
      }
    }

    // Recorrido por ruta: una sola navegacion por ruta y todos sus casos encima.
    for (const seccion of secciones) {
      console.log(`\n🕸️  ${seccion.ruta}`);
      marcaRuta = { consola: erroresConsola.length, red: erroresRed.length };

      const metricas = await navegarA(seccion.ruta);
      if (!metricas.ok) {
        resultadosCasos.push({
          id: 'SPIDER-NAV-FALLIDA',
          nombre: 'Navegacion a la ruta',
          nivel,
          ambito: 'ruta',
          ruta: seccion.ruta,
          estado: 'error',
          duracion_ms: metricas.carga_ms,
          pasos: [],
          hallazgos: [
            {
              tipo: 'navegacion',
              gravedad: 'alta',
              detalle: `No se pudo abrir la ruta: ${metricas.error}`,
              datos: { ruta: seccion.ruta },
            },
          ],
        });
        continue;
      }

      paginasVisitadas.push(seccion.ruta);
      metricasCarga.push({ ruta: seccion.ruta, loadTimeMs: metricas.carga_ms });
      console.log(`  ✓ Cargada en ${metricas.carga_ms}ms`);

      const deRuta = casosAplicables(casos, { nivel, ruta: seccion.ruta, ambito: 'ruta' });
      if (!deRuta.length) {
        console.log('  · Sin casos aplicables para este nivel');
        continue;
      }

      for (const caso of deRuta) {
        await ejecutarCaso(caso, {
          ruta: seccion.ruta,
          etiquetaRuta: `spider-${seccion.ruta.replace(/\//g, '-')}`,
          catalogo,
          metricas,
        });
        await persistirUltimaEjecucion(caso);
      }
    }

    const reporte = armarReporte({ catalogo, fuentes, descartados, secciones });
    const evidenciaPath = join(outputDir, 'qa-lab-spider-report.json');
    await writeFile(evidenciaPath, JSON.stringify(reporte, null, 2), 'utf8');

    console.log('\n===JSON_REPORT_START===');
    console.log(JSON.stringify(reporte));
    console.log('===JSON_REPORT_END===\n');

    imprimirResumen(reporte.resumen);
    console.log(`\n✅ Spider completado. Informe en ${evidenciaPath}`);

    if (fallarEnHallazgos && reporte.resumen.estado === 'rojo') {
      process.exitCode = 1;
    }
  }
} catch (error) {
  if (page) await tomarCaptura('99-error-fatal').catch(() => undefined);
  console.error('\n❌ QA Lab Spider: error fatal');
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
}

/* ── Ejecucion individual (boton "Ejecutar" de un caso propio) ──────────────── */

/**
 * Ejecuta UN solo caso del operador, ignorando secciones y el resto del
 * catalogo. Reutiliza `ejecutarCaso`/`navegarA`/`armarReporte` tal cual: la
 * unica diferencia con la corrida completa es que no hay bucle de secciones
 * ni casos de catalogo, y que el resultado se persiste en el propio caso.
 */
async function ejecutarModoCasoUnico({ catalogo, fuentes, descartados, id }) {
  const { caso, rutasObjetivo, motivo } = await cargarCasoUnicoDelOperador({
    conexion: conexionMongo,
    catalogo,
    id,
    ObjectId: mongoose.Types.ObjectId,
  });

  if (!caso) {
    throw new Error(`No se pudo ejecutar el caso: ${motivo}`);
  }

  fuentes.push({ tipo: 'operador', ruta: 'qa_spider_casos', casos: 1 });
  console.log(`\n▶ Ejecucion individual — ${caso.nombre} (${caso.id})`);

  // ambito 'global': corre una vez, sin navegar a ninguna ruta particular.
  // ambito 'ruta' sin aplica_a: se ejecuta sobre /inicio como destino por defecto.
  const rutas = caso.ambito === 'ruta' ? (rutasObjetivo.length ? rutasObjetivo : ['/inicio']) : [];
  const secciones = rutas.map((ruta) => ({ id: ruta, ruta, etiqueta: ruta }));

  if (!secciones.length) {
    await ejecutarCaso(caso, { ruta: null, etiquetaRuta: 'caso-unico', catalogo, metricas: null });
  } else {
    for (const seccion of secciones) {
      console.log(`\n🕸️  ${seccion.ruta}`);
      marcaRuta = { consola: erroresConsola.length, red: erroresRed.length };

      const metricas = await navegarA(seccion.ruta);
      if (metricas.ok) {
        paginasVisitadas.push(seccion.ruta);
        metricasCarga.push({ ruta: seccion.ruta, loadTimeMs: metricas.carga_ms });
        console.log(`  ✓ Cargada en ${metricas.carga_ms}ms`);
      }

      await ejecutarCaso(caso, {
        ruta: seccion.ruta,
        etiquetaRuta: `caso-unico-${seccion.ruta.replace(/\//g, '-')}`,
        catalogo,
        metricas,
      });
    }
  }

  await persistirUltimaEjecucion(caso);

  const reporte = armarReporte({ catalogo, fuentes, descartados, secciones });
  const evidenciaPath = join(outputDir, 'qa-lab-spider-report.json');
  await writeFile(evidenciaPath, JSON.stringify(reporte, null, 2), 'utf8');

  console.log('\n===JSON_REPORT_START===');
  console.log(JSON.stringify(reporte));
  console.log('===JSON_REPORT_END===\n');

  imprimirResumen(reporte.resumen);
  console.log(`\n✅ Ejecucion individual completada. Informe en ${evidenciaPath}`);

  if (fallarEnHallazgos && reporte.resumen.estado === 'rojo') {
    process.exitCode = 1;
  }
}

/**
 * Guarda en el propio documento de `qa_spider_casos` el resultado de su
 * ultima corrida, para que la lista lo muestre sin tener que abrir un reporte.
 * Solo aplica a casos con origen 'operador'; para casos de catalogo es un no-op.
 */
async function persistirUltimaEjecucion(caso) {
  if (caso?.origen !== 'operador' || !conexionMongo) return;

  const resultado = [...resultadosCasos].reverse().find((item) => item.id === caso.id);
  if (!resultado) return;

  try {
    await conexionMongo.collection('qa_spider_casos').updateOne(
      { _id: new mongoose.Types.ObjectId(caso.id) },
      {
        $set: {
          ultima_ejecucion: {
            estado: resultado.estado,
            fecha: new Date().toISOString(),
            duracion_ms: resultado.duracion_ms,
            hallazgos: resultado.hallazgos?.length ?? 0,
          },
        },
      },
    );
  } catch (error) {
    console.log(`  ⚠️  No se pudo guardar la ultima ejecucion del caso: ${error.message}`);
  }
}

/* ── Motor de casos ──────────────────────────────────────────────────────── */

/**
 * Ejecuta los pasos de un caso sobre la pagina ya posicionada.
 *
 * Un paso con hallazgo no corta el caso: se sigue para juntar toda la evidencia.
 * Un paso que lanza excepcion si lo corta, pero nunca detiene la corrida.
 */
async function ejecutarCaso(caso, { ruta, etiquetaRuta, catalogo, metricas }) {
  const inicio = Date.now();
  const marcaCaso = { consola: erroresConsola.length, red: erroresRed.length };
  const hallazgos = [];
  const pasos = [];

  const ctx = {
    page,
    ruta,
    etiquetaRuta,
    nivel,
    caso,
    catalogo,
    metricas,
    timeoutCampoMs,
    timeoutLineaScriptMs,
    permitirScript,
    expect: expectPlaywright,
    capturar: (nombre) => tomarCaptura(nombre),
    registrarA11y: (datos) => snapshotsA11y.push(datos),
    hallazgo: (item) => hallazgos.push(item),
    erroresDelCaso: () => ({
      consola: erroresConsola.slice(marcaCaso.consola),
      red: erroresRed.slice(marcaCaso.red),
    }),
    erroresDeLaRuta: () => ({
      consola: erroresConsola.slice(marcaRuta.consola),
      red: erroresRed.slice(marcaRuta.red),
    }),
  };

  let estado = 'pass';

  for (const paso of caso.pasos) {
    const inicioPaso = Date.now();
    try {
      const accion = obtenerAccion(paso.accion);
      const resultado = await accion(ctx, paso.params ?? {});
      pasos.push({
        accion: paso.accion,
        estado: resultado.estado,
        detalle: resultado.detalle ?? null,
        duracion_ms: Date.now() - inicioPaso,
        datos: resultado.datos ?? null,
      });
      if (resultado.estado === 'hallazgo' && estado === 'pass') estado = 'fail';
    } catch (error) {
      pasos.push({
        accion: paso.accion,
        estado: 'error',
        detalle: error.message.split('\n')[0],
        duracion_ms: Date.now() - inicioPaso,
        datos: null,
      });
      hallazgos.push({
        tipo: 'ejecucion',
        gravedad: 'alta',
        detalle: `El paso "${paso.accion}" fallo: ${error.message.split('\n')[0]}`,
        datos: { caso: caso.id },
      });
      estado = 'error';
      break;
    }
  }

  if (estado === 'pass' && pasos.every((paso) => paso.estado === 'omitido')) {
    estado = 'omitido';
  }

  resultadosCasos.push({
    id: caso.id,
    nombre: caso.nombre,
    descripcion: caso.descripcion ?? null,
    origen: caso.origen ?? 'catalogo',
    nivel,
    ambito: caso.ambito,
    ruta,
    estado,
    duracion_ms: Date.now() - inicio,
    pasos,
    hallazgos,
  });

  const icono = { pass: '✓', fail: '⚠', error: '✗', omitido: '·' }[estado] ?? '?';
  console.log(`  ${icono} ${caso.id} — ${caso.nombre}${hallazgos.length ? ` (${hallazgos.length} hallazgo/s)` : ''}`);
}

/* ── Navegacion y navegador ──────────────────────────────────────────────── */

/**
 * Navega a una ruta y mide el tiempo hasta que la app se estabiliza.
 *
 * Se espera `domcontentloaded` y luego `networkidle` con timeout acotado: en
 * una SPA con polling, esperar `networkidle` como condicion principal puede
 * colgar la corrida hasta el timeout global.
 */
async function navegarA(ruta) {
  const inicio = Date.now();
  try {
    await page.goto(`${frontendUrl}${ruta}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: esperaEstabilidadMs }).catch(() => undefined);
    return { ok: true, carga_ms: Date.now() - inicio };
  } catch (error) {
    const detalle = error.message.split('\n')[0];
    console.log(`  ❌ No se pudo abrir ${ruta}: ${detalle}`);
    return { ok: false, carga_ms: Date.now() - inicio, error: detalle };
  }
}

async function abrirNavegador() {
  const executablePath = detectarNavegador({ forzarChrome });
  browser = await chromium.launch({
    headless,
    ...(executablePath ? { executablePath } : {}),
    slowMo: slowMoMs,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'es-AR',
  });
  page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  page.on('console', (mensaje) => {
    if (mensaje.type() !== 'error') return;
    erroresConsola.push({ mensaje: mensaje.text(), url: page.url(), momento: new Date().toISOString() });
  });

  page.on('pageerror', (error) => {
    erroresConsola.push({ mensaje: `[PAGE_ERROR] ${error.message}`, url: page.url(), momento: new Date().toISOString() });
  });

  page.on('response', (respuesta) => {
    const estado = respuesta.status();
    if (estado < 400) return;
    erroresRed.push({ estado, url: respuesta.url(), momento: new Date().toISOString() });
  });

  if (permitirScript) {
    try {
      ({ expect: expectPlaywright } = await import('@playwright/test'));
    } catch {
      console.log('  ⚠️  @playwright/test no disponible: las semillas no tendran "expect".');
    }
  }
}

async function iniciarSesion() {
  await page.goto(`${frontendUrl}/login`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.locator('input[aria-label="Correo electrónico"]').fill(correo);
  await page.locator('input[aria-label="Contraseña"]').fill(contrasena);

  const [respuesta] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST'),
    page.locator('button[type="submit"]').click(),
  ]);

  if (!respuesta.ok()) throw new Error(`Login fallo con HTTP ${respuesta.status()}`);
  await page.waitForURL(/\/inicio(?:$|[?#])/, { timeout: 30_000 });
}

/**
 * Resuelve el ejecutable del navegador.
 *
 * Por defecto se usa el Chromium que trae Playwright (devolviendo null), que es
 * la combinacion soportada. El Chrome del sistema solo se usa si se pide
 * explicitamente con --chrome o PLAYWRIGHT_CHROMIUM_EXECUTABLE, y nunca en
 * headless: Playwright 1.46 lo lanza con `--headless=old`, un modo que Chrome
 * ya no soporta y que hace fallar el arranque.
 */
function detectarNavegador({ forzarChrome: soloChrome = false } = {}) {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (!soloChrome) return null;

  if (headless) {
    console.log('  ⚠️  Se pidio Chrome del sistema en modo headless; se usa el Chromium de Playwright.');
    return null;
  }

  const candidatos = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ],
  };

  const encontrado = (candidatos[process.platform] ?? []).find((ruta) => existsSync(ruta));
  if (!encontrado) {
    console.log('  ⚠️  No se encontro Chrome del sistema; se usa el Chromium de Playwright.');
  }
  return encontrado ?? null;
}

async function tomarCaptura(nombre) {
  const seguro = nombre.replace(/[^a-z0-9._-]+/gi, '-');
  const destino = join(outputDir, `${seguro}.png`);
  await page.screenshot({ path: destino, fullPage: true });
  capturas.push(destino);
  return destino;
}

/* ── MongoDB ─────────────────────────────────────────────────────────────── */

function resolverMongoUri() {
  let uri =
    process.env.MONGODB_URI ??
    process.env.AUDITORIA_MONGODB_URI ??
    'mongodb://127.0.0.1:27017/auditoria_ganancias';

  const memoria = resolve(process.cwd(), '.memory-db-uri');
  const sinUriExplicita = !process.env.MONGODB_URI && !process.env.AUDITORIA_MONGODB_URI;

  if ((uri === 'memory' || sinUriExplicita) && existsSync(memoria)) {
    uri = readFileSync(memoria, 'utf8').trim();
  }
  return uri;
}

async function conectarMongo() {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongodbUri, { serverSelectionTimeoutMS: 5000 });
  }
  conexionMongo = mongoose.connection;
}

async function asegurarUsuario() {
  await conexionMongo.collection('usuarios').updateOne(
    { correo },
    {
      $set: { correo, password_hash: crearPasswordHash(contrasena), updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}

function crearPasswordHash(valor) {
  const iteraciones = 210_000;
  const salt = randomBytes(16).toString('base64url');
  const hash = pbkdf2Sync(valor, salt, iteraciones, 32, 'sha256').toString('base64url');
  return `pbkdf2$${iteraciones}$${salt}$${hash}`;
}

/* ── Reporte ─────────────────────────────────────────────────────────────── */

function armarReporte({ catalogo, fuentes, descartados, secciones }) {
  const rutas = secciones.map((seccion) => seccion.ruta);
  const hallazgos = resultadosCasos.flatMap((caso) =>
    caso.hallazgos.map((hallazgo) => ({ ...hallazgo, caso: caso.id, ruta: caso.ruta })),
  );

  const conteo = (estado) => resultadosCasos.filter((caso) => caso.estado === estado).length;
  const fallidos = conteo('fail') + conteo('error');

  const resumen = {
    estado: fallidos > 0 ? 'rojo' : 'verde',
    casos_total: resultadosCasos.length,
    casos_pass: conteo('pass'),
    casos_fail: conteo('fail'),
    casos_error: conteo('error'),
    casos_omitidos: conteo('omitido'),
    hallazgos_total: hallazgos.length,
    hallazgos_altos: hallazgos.filter((hallazgo) => hallazgo.gravedad === 'alta').length,
    rutas_ok: paginasVisitadas.length,
    rutas_total: rutas.length,
  };

  return {
    agresividad: nivel,
    rutas_evaluadas: rutas,
    paginas_visitadas: paginasVisitadas,
    metricas_performance: metricasCarga,
    // Se conservan como texto plano por compatibilidad con el reporte anterior.
    errores_consola: erroresConsola.map((error) => `[error] ${error.mensaje} en ${error.url}`),
    errores_red: erroresRed.map((error) => `HTTP ${error.estado} - ${error.url}`),
    a11y_snapshots: snapshotsA11y,
    capturas,
    fecha: new Date().toISOString(),
    resumen,
    casos: resultadosCasos,
    hallazgos,
    catalogo: {
      version: catalogo.version,
      nivel_ejecutado: nivel,
      fuentes,
      casos_descartados: descartados,
    },
  };
}

function imprimirResumen(resumen) {
  console.log('\n── Resumen ───────────────────────────────');
  console.log(`  Estado:    ${resumen.estado === 'verde' ? '🟢 verde' : '🔴 rojo'}`);
  console.log(`  Casos:     ${resumen.casos_pass} ok · ${resumen.casos_fail} con hallazgos · ${resumen.casos_error} con error · ${resumen.casos_omitidos} omitidos`);
  console.log(`  Hallazgos: ${resumen.hallazgos_total} (${resumen.hallazgos_altos} de gravedad alta)`);
  console.log(`  Rutas:     ${resumen.rutas_ok}/${resumen.rutas_total} abiertas`);
}

/* ── Helpers de configuracion ────────────────────────────────────────────── */

function parsearJson(valor, porDefecto) {
  if (!valor) return porDefecto;
  try {
    return JSON.parse(valor);
  } catch {
    return porDefecto;
  }
}

function parsearSeleccion(valor) {
  if (!valor || valor === 'todas') return 'todas';
  const parseado = parsearJson(valor, null);
  return Array.isArray(parseado) ? parseado : valor;
}

function validarNivel(catalogo, id) {
  const validos = (catalogo.niveles ?? []).map((item) => item.id);
  if (!validos.includes(id)) {
    throw new Error(`Nivel de agresividad desconocido: "${id}". Validos: ${validos.join(', ')}`);
  }
}
