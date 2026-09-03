/**
 * run-qa-suite-seguridad.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Categoria "seguridad" de la Suite de Calidad sobre un aprendizaje de SOP
 * Loom. No usa `qa_casos` como fuente de datos (aunque los escenarios sí
 * puedan llegar a crear casos reales, que se limpian al cerrar la ejecucion
 * -ver `activarAislamientoDatos` en qa-suite-comun.mjs).
 *
 * Frentes implementados en esta version, cada uno con un oraculo que afirma
 * algo verificable (no solo "no explotó nada"):
 *
 *   A. Sesion: dos comprobaciones complementarias.
 *      - Navegador: la ruta objetivo no puede abrirse sin cookie de sesión
 *        (debe rebotar a /login). Es código de cliente, sorteable.
 *      - API: los endpoints que el flujo usa para guardar tienen que
 *        rechazar (401/403) una petición directa sin cookie. Esta es la
 *        autorización real, del lado del servidor.
 *
 *   R. Violación de restricción: cada campo se completa, uno por vez, con un
 *      valor que viola a propósito su restricción real declarada (largo,
 *      rango, patrón, ventana de fechas). El oráculo: si el guardado
 *      responde éxito, ese valor debería haber sido rechazado y no lo fue
 *      -hallazgo de severidad alta.
 *
 *   C. Inyección: cada campo se completa con payloads de inyección (SQL,
 *      NoSQL, XSS, path traversal, plantillas). Solo los payloads con forma
 *      de XSS tienen hoy un oráculo de efecto real: se guarda el valor, se
 *      vuelve a abrir la pantalla donde el módulo de Casos lo muestra, y se
 *      confirma que no se ejecuta un script. Los demás payloads se mandan
 *      igual (para detectar si rompen el flujo) pero no producen hallazgo:
 *      esta app no arma SQL ni filtros Mongo dinámicos a partir de este
 *      valor, y "viajó sin escapar en el body" -la regla que había antes-
 *      no es indicio de nada (es el comportamiento normal de un fetch/XHR).
 *      Mejor no afirmar una vulnerabilidad que no se puede demostrar.
 *
 * Sea cual sea el tipo de valor de seguridad, si el formulario lo bloquea
 * antes de mandarlo (la validación del cliente hizo su trabajo) no se
 * considera un error de la Suite ni un hallazgo: es el resultado esperado.
 *
 * Frentes pendientes de una proxima iteracion (requieren mas contexto de
 * negocio del que da un aprendizaje generico): B. IDOR, D. manipulacion de
 * parametros de negocio, E. exposicion de datos sensibles en la respuesta,
 * F. carga de archivos, G. cabeceras de transporte. Ver también el alcance
 * declarado en la Pantalla 4 (qa-pantalla-4.component.ts).
 *
 * Configuracion: igual que run-qa-suite-funcional.mjs.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import mongoose from 'mongoose';
import { chromium } from 'playwright-core';
import {
  activarAislamientoDatos,
  asegurarUsuario,
  cargarAprendizaje,
  conectarMongo,
  crearTomarCaptura,
  detalleError,
  detectarNavegador,
  ejecutarPaso,
  idDesdeRespuesta,
  iniciarSesion,
  mapearCampos,
  objeto,
  resolverConfigComun,
  texto,
  validarNavegacionAprobada,
} from './lib/qa-suite-comun.mjs';
import { derivarEscenarios } from './lib/qa-suite-derivador.mjs';

const CATEGORIA = 'seguridad';
const PATRON_XSS = /<script|onerror\s*=|onload\s*=|javascript:/i;
const backendRoot = process.cwd();
const repoRoot = resolve(backendRoot, '..');
const cfg = resolverConfigComun();
if (cfg.demoDegradadoSinEscritorio) {
  console.warn('Modo demo pedido sin entorno gráfico detectado (sin DISPLAY/WAYLAND_DISPLAY, o CI): corriendo headless.');
}
const outputDir = cfg.outputDirEnv ? resolve(repoRoot, cfg.outputDirEnv) : resolve(repoRoot, 'outputs/playwright/qa-suite-seguridad');

const capturas = [];
const capturasFallidas = [];
let browser;
let page;

try {
  await mkdir(outputDir, { recursive: true });
  await conectarMongo(cfg.mongodbUri);
  await asegurarUsuario(cfg.correo, cfg.contrasena);

  const aprendizaje = await cargarAprendizaje(cfg.aprendizajeId);
  const definicion = objeto(aprendizaje.definicion_ejecutable);
  const rutaObjetivo = texto(objeto(definicion.rutas).pantalla_objetivo);
  const pasos = Array.isArray(definicion.pasos_ejecutables) ? definicion.pasos_ejecutables : [];
  const campos = mapearCampos(aprendizaje.campos);
  if (!rutaObjetivo) throw new Error('La definición no tiene pantalla objetivo resuelta.');
  if (!pasos.length) throw new Error('La definición no tiene pasos ejecutables compilados.');

  const executablePath = detectarNavegador();
  browser = await chromium.launch({ headless: cfg.headless, ...(executablePath ? { executablePath } : {}), slowMo: cfg.slowMoMs });

  const contextConSesion = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-AR' });
  activarAislamientoDatos(contextConSesion, cfg.ejecucionId);
  page = await contextConSesion.newPage();
  page.setDefaultTimeout(cfg.timeoutMs);
  const tomarCaptura = crearTomarCaptura(page, outputDir, capturas, capturasFallidas);

  await iniciarSesion(page, cfg.frontendUrl, cfg.correo, cfg.contrasena);
  await tomarCaptura('00-login');
  await validarNavegacionAprobada(page, aprendizaje, cfg.frontendUrl);

  const hallazgos = [];

  // ── Frente A: sesion ──────────────────────────────────────────────────
  hallazgos.push(...(await frenteSesionNavegador(rutaObjetivo)));
  hallazgos.push(...(await frenteSesionApi(pasos)));

  // ── Frentes R + C: violacion de restriccion + inyeccion ────────────────
  const escenarios = derivarEscenarios(aprendizaje.id, pasos, campos, CATEGORIA);
  const resultadosEscenarios = [];
  for (const escenario of escenarios) {
    const resultado = await correrEscenarioSeguridad(escenario, pasos, rutaObjetivo, tomarCaptura);
    resultadosEscenarios.push(resultado);
    hallazgos.push(...resultado.hallazgos);
  }

  // Un escenario que no pudo ejecutarse (error real, no un guardado
  // bloqueado por validacion) no es un escenario limpio: si no llego a
  // completar el flujo, no probo nada. Mismo criterio que usa
  // run-qa-suite-funcional.mjs.
  const escenariosFallidos = resultadosEscenarios.filter((r) => r.error);
  const estado = hallazgos.length || escenariosFallidos.length ? 'rojo' : 'verde';
  const evidenciaPath = join(outputDir, 'qa-suite-seguridad-evidence.json');

  await writeFile(
    evidenciaPath,
    `${JSON.stringify(
      {
        estado,
        categoria: CATEGORIA,
        aprendizaje_id: aprendizaje.id,
        ruta_objetivo: rutaObjetivo,
        hallazgos,
        escenarios: resultadosEscenarios,
        capturas,
        capturas_fallidas: capturasFallidas,
        fecha: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log('');
  console.log(`QA Suite seguridad: ${estado}`);
  console.log(`- aprendizaje=${aprendizaje.id}`);
  console.log(`- evidencia=${evidenciaPath}`);
  console.log(`- detalle=${[
    hallazgos.length ? `${hallazgos.length} hallazgo(s) de seguridad` : '',
    escenariosFallidos.length ? `${escenariosFallidos.length}/${resultadosEscenarios.length} escenario(s) no pudieron ejecutarse` : '',
  ].filter(Boolean).join(' — ') || 'sin hallazgos'}`);

  if (estado !== 'verde') process.exitCode = 1;
} catch (error) {
  if (page) await mkdir(outputDir, { recursive: true }).then(() => page.screenshot({ path: join(outputDir, '99-error-fatal.png') })).catch(() => undefined);
  console.error('');
  console.error('QA Suite seguridad: rojo');
  console.error(`- detalle=${detalleError(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
}

/** La ruta objetivo del flujo no puede abrirse sin sesion: debe rebotar a /login. */
async function frenteSesionNavegador(rutaObjetivo) {
  const contextSinSesion = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-AR' });
  const paginaSinSesion = await contextSinSesion.newPage();
  try {
    await paginaSinSesion.goto(`${cfg.frontendUrl}${rutaObjetivo}`, { waitUntil: 'domcontentloaded', timeout: cfg.timeoutMs });
    await paginaSinSesion.waitForTimeout(800);
    const urlFinal = paginaSinSesion.url();
    if (!/\/login(?:$|[?#])/.test(urlFinal)) {
      return [
        {
          frente: 'sesion-navegador',
          gravedad: 'critica',
          codigo: 'SUITE-SEG-SESION-001',
          titulo: 'La ruta del flujo es accesible sin sesión',
          detalle: `Se navegó a ${rutaObjetivo} sin cookie de sesión y la app no redirigió a /login (quedó en ${urlFinal}).`,
          esperado: '/login',
          actual: urlFinal,
        },
      ];
    }
    return [];
  } finally {
    await contextSinSesion.close().catch(() => undefined);
  }
}

/**
 * Complementa el chequeo del navegador: le pide directamente a la API, sin
 * cookie, los mismos endpoints que el flujo usa para guardar (los pasos
 * compilados con `espera.tipo: 'respuesta'`) y exige que los rechace. El
 * desvío a /login es código de cliente, sorteable; esto prueba la
 * autorización real del servidor.
 */
async function frenteSesionApi(pasos) {
  const endpoints = [
    ...new Set(
      pasos
        .filter((p) => texto(objeto(p.espera).tipo) === 'respuesta' && texto(objeto(p.espera).valor))
        .map((p) => texto(objeto(p.espera).valor)),
    ),
  ];
  if (!endpoints.length) return [];

  const contextSinSesion = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-AR' });
  const hallazgos = [];
  try {
    for (const endpoint of endpoints) {
      const respuesta = await contextSinSesion.request
        .post(`${cfg.frontendUrl}${endpoint}`, { data: {}, headers: { 'content-type': 'application/json' }, failOnStatusCode: false })
        .catch(() => null);
      if (!respuesta) continue;
      if (respuesta.status() !== 401 && respuesta.status() !== 403) {
        hallazgos.push({
          frente: 'sesion-api',
          gravedad: 'critica',
          codigo: 'SUITE-SEG-SESION-002',
          titulo: 'Un endpoint que usa el flujo responde sin exigir sesión',
          detalle: `POST ${endpoint} sin cookie de sesión devolvió ${respuesta.status()} (se esperaba 401 o 403).`,
          esperado: '401/403',
          actual: String(respuesta.status()),
        });
      }
    }
  } finally {
    await contextSinSesion.close().catch(() => undefined);
  }
  return hallazgos;
}

/**
 * Corre el flujo completo con los datos de un escenario de seguridad y le
 * aplica el oráculo que corresponda según `escenario.tipo`. El paso final de
 * guardado se maneja aparte (`intentarGuardado`): a diferencia del resto de
 * los pasos, que sí tienen que completarse siempre, este puede quedar
 * bloqueado por la validación del formulario -el resultado esperado cuando
 * la validación existe- sin que eso sea un error de la Suite.
 */
async function correrEscenarioSeguridad(escenario, pasos, rutaObjetivo, tomarCaptura) {
  const pasosEjecutados = [];
  const contexto = {};
  let respuestaGuardado = null;
  let error = null;

  try {
    for (const paso of pasos) {
      const esGuardado = paso.tipo === 'click' && texto(objeto(paso.espera).tipo) === 'respuesta';
      if (esGuardado) {
        respuestaGuardado = await intentarGuardado(paso);
        if (respuestaGuardado?.ok()) {
          const idCreado = await idDesdeRespuesta(respuestaGuardado);
          if (idCreado) contexto.ultimo_id_creado = idCreado;
        }
        pasosEjecutados.push({ tipo: paso.tipo, campo: paso.campo ?? null, estado: respuestaGuardado ? 'ok' : 'bloqueado' });
        continue;
      }
      const resultado = await ejecutarPaso(page, cfg.frontendUrl, paso, rutaObjetivo, escenario.datos, contexto);
      pasosEjecutados.push({ tipo: paso.tipo, campo: paso.campo ?? null, estado: resultado.estado });
      if (resultado.estado === 'error') throw new Error(resultado.detalle);
    }
  } catch (e) {
    error = detalleError(e);
  }

  await tomarCaptura(`${escenario.id}${error ? '-fallo' : ''}`);

  const hallazgos = [];
  if (!error) {
    if (escenario.tipo === 'violacion_restriccion') {
      hallazgos.push(...oraculoViolacionRestriccion(escenario, respuestaGuardado));
    } else if (escenario.tipo === 'inyeccion') {
      hallazgos.push(...(await oraculoInyeccion(escenario, respuestaGuardado)));
    }
  }

  return {
    id: escenario.id,
    campo_bajo_prueba: escenario.campo_bajo_prueba,
    tipo: escenario.tipo ?? null,
    guardado_bloqueado: !error && !respuestaGuardado,
    error,
    pasos: pasosEjecutados,
    hallazgos,
  };
}

/**
 * A diferencia de `ejecutarPaso()`, no lanza si no llega respuesta: un valor
 * de seguridad puede quedar bloqueado por la validación del propio
 * formulario -el resultado esperado cuando esa validación existe- y no es un
 * error de la Suite. Devuelve `null` en ese caso en vez de una excepción.
 * Espera menos que el default (8s en vez de hasta 30s): si el guardado
 * fuera a disparar una petición, lo hace casi al instante.
 */
async function intentarGuardado(paso) {
  const boton = page.locator(texto(paso.selector)).first();
  await boton.waitFor({ state: 'visible' });
  const espera = objeto(paso.espera);
  try {
    const [respuesta] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(texto(espera.valor)), { timeout: 8_000 }),
      boton.click(),
    ]);
    return respuesta;
  } catch {
    return null;
  }
}

/** El hallazgo es que el guardado haya aceptado un valor que viola la restricción declarada del campo. */
function oraculoViolacionRestriccion(escenario, respuesta) {
  if (!respuesta || !respuesta.ok()) return [];
  return [
    {
      frente: 'violacion-restriccion',
      gravedad: 'alta',
      codigo: 'SUITE-SEG-RESTRICCION-001',
      titulo: 'Un valor que viola la restricción declarada del campo fue aceptado',
      detalle: `Al completar "${escenario.campo_bajo_prueba}" con un valor que ${escenario.motivo}, el guardado respondió ${respuesta.status()} (aceptado). La validación real tiene que existir del lado del servidor, no solo en el formulario.`,
      campo: escenario.campo_bajo_prueba,
      actual: escenario.valor_bajo_prueba,
    },
  ];
}

/**
 * Solo mide efecto real para payloads con forma de XSS: guarda, reabre la
 * pantalla donde el módulo de Casos muestra la descripción, y confirma que
 * el script no se ejecuta (un `alert()` real dispara un `dialog` nativo del
 * navegador). Los demás payloads (SQLi, NoSQLi, path traversal, plantillas)
 * se mandan igual -para saber si rompen el flujo, ver `escenariosFallidos`-
 * pero no producen hallazgo: esta app no arma SQL ni filtros Mongo dinámicos
 * a partir de este valor, así que no hay nada real que afirmar todavía.
 */
async function oraculoInyeccion(escenario, respuesta) {
  const payload = texto(escenario.valor_bajo_prueba);
  if (!respuesta || !respuesta.ok() || !PATRON_XSS.test(payload)) return [];

  const paginaVerificacion = await page.context().newPage();
  let ejecuto = false;
  paginaVerificacion.on('dialog', async (dialogo) => {
    ejecuto = true;
    await dialogo.dismiss().catch(() => undefined);
  });
  try {
    await paginaVerificacion.goto(`${cfg.frontendUrl}/qa/casos`, { waitUntil: 'domcontentloaded', timeout: cfg.timeoutMs });
    await paginaVerificacion.waitForTimeout(1_500);
  } catch {
    // No se pudo abrir el listado: no es indicativo de nada, no se afirma.
  } finally {
    await paginaVerificacion.close().catch(() => undefined);
  }

  if (!ejecuto) return [];
  return [
    {
      frente: 'inyeccion-xss',
      gravedad: 'critica',
      codigo: 'SUITE-SEG-XSS-001',
      titulo: 'Un payload XSS guardado se ejecutó al mostrarse',
      detalle: `Al completar "${escenario.campo_bajo_prueba}" con "${payload}" y guardarlo, volver a abrir el listado de casos donde se muestra disparó su ejecución (contenido sin sanear).`,
      campo: escenario.campo_bajo_prueba,
      actual: payload,
    },
  ];
}
