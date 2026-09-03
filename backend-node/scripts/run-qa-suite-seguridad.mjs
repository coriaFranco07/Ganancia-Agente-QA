/**
 * run-qa-suite-seguridad.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Categoria "seguridad" de la Suite de Calidad sobre un aprendizaje de SOP
 * Loom. No usa `qa_casos`.
 *
 * Frentes implementados en esta version:
 *   A. Sesion:    la ruta objetivo del flujo no puede ser accesible sin
 *                 cookie de sesion valida.
 *   C. Inyeccion: cada campo se completa, uno por vez, con los payloads que
 *                 deriva `qa-suite-derivador.mjs` (inyeccion + violaciones de
 *                 la restriccion real declarada), escuchando la red durante
 *                 el envio para detectar si el payload llega sin escapar al
 *                 backend.
 *
 * Frentes pendientes de una proxima iteracion (requieren mas contexto de
 * negocio del que da un aprendizaje generico): B. IDOR, D. manipulacion de
 * parametros de negocio, E. exposicion de datos sensibles en la respuesta,
 * F. carga de archivos, G. cabeceras de transporte.
 *
 * Configuracion: igual que run-qa-suite-funcional.mjs.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import mongoose from 'mongoose';
import { chromium } from 'playwright-core';
import {
  asegurarUsuario,
  cargarAprendizaje,
  conectarMongo,
  crearTomarCaptura,
  detalleError,
  detectarNavegador,
  ejecutarPaso,
  iniciarSesion,
  mapearCampos,
  objeto,
  resolverConfigComun,
  texto,
  validarNavegacionAprobada,
} from './lib/qa-suite-comun.mjs';
import { derivarEscenarios } from './lib/qa-suite-derivador.mjs';

const CATEGORIA = 'seguridad';
const backendRoot = process.cwd();
const repoRoot = resolve(backendRoot, '..');
const outputDir = resolve(repoRoot, 'outputs/playwright/qa-suite-seguridad');
const cfg = resolverConfigComun();

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
  page = await contextConSesion.newPage();
  page.setDefaultTimeout(cfg.timeoutMs);
  const tomarCaptura = crearTomarCaptura(page, outputDir, capturas, capturasFallidas);

  await iniciarSesion(page, cfg.frontendUrl, cfg.correo, cfg.contrasena);
  await tomarCaptura('00-login');
  await validarNavegacionAprobada(page, aprendizaje, cfg.frontendUrl);

  const hallazgos = [];

  // ── Frente A: sesion ──────────────────────────────────────────────────
  hallazgos.push(...(await frenteSesion(rutaObjetivo, tomarCaptura)));

  // ── Frente C: inyeccion + sanitizacion ───────────────────────────────
  const escenarios = derivarEscenarios(aprendizaje.id, pasos, campos, CATEGORIA);
  const resultadosInyeccion = [];
  for (const escenario of escenarios) {
    const resultado = await correrEscenarioInyeccion(escenario, pasos, rutaObjetivo, tomarCaptura);
    resultadosInyeccion.push(resultado);
    hallazgos.push(...resultado.hallazgos);
  }

  const estado = hallazgos.length ? 'rojo' : 'verde';
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
        escenarios_inyeccion: resultadosInyeccion,
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
  console.log(`- detalle=${hallazgos.length ? `${hallazgos.length} hallazgo(s) de seguridad` : 'sin hallazgos'}`);

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
async function frenteSesion(rutaObjetivo, tomarCaptura) {
  const contextSinSesion = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-AR' });
  const paginaSinSesion = await contextSinSesion.newPage();
  try {
    await paginaSinSesion.goto(`${cfg.frontendUrl}${rutaObjetivo}`, { waitUntil: 'domcontentloaded', timeout: cfg.timeoutMs });
    await paginaSinSesion.waitForTimeout(800);
    const urlFinal = paginaSinSesion.url();
    if (!/\/login(?:$|[?#])/.test(urlFinal)) {
      return [
        {
          frente: 'sesion',
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
 * Corre el flujo completo con un escenario de inyeccion y escucha la red
 * durante toda la corrida: si el payload viaja sin escapar en algun request,
 * es un hallazgo (el frontend no filtra nada antes de enviarlo; la
 * validacion real tiene que existir del lado del servidor).
 */
async function correrEscenarioInyeccion(escenario, pasos, rutaObjetivo, tomarCaptura) {
  const requestsCapturadas = [];
  const onRequest = (request) => {
    const metodo = request.method();
    if (metodo === 'GET' || metodo === 'HEAD') return;
    requestsCapturadas.push(request.postData() ?? '');
  };
  page.on('request', onRequest);

  const pasosEjecutados = [];
  let error = null;
  try {
    for (const paso of pasos) {
      const resultado = await ejecutarPaso(page, cfg.frontendUrl, paso, rutaObjetivo, escenario.datos);
      pasosEjecutados.push({ tipo: paso.tipo, campo: paso.campo ?? null, estado: resultado.estado });
      if (resultado.estado === 'error') throw new Error(resultado.detalle);
    }
  } catch (e) {
    error = detalleError(e);
  } finally {
    page.off('request', onRequest);
  }

  await tomarCaptura(`${escenario.id}${error ? '-fallo' : ''}`);

  const hallazgos = [];
  const payload = texto(escenario.valor_bajo_prueba);
  if (payload.length >= 3) {
    const sinEscapar = requestsCapturadas.some((body) => body && body.includes(payload));
    if (sinEscapar) {
      hallazgos.push({
        frente: 'inyeccion',
        gravedad: payload.length > 500 ? 'media' : 'alta',
        codigo: 'SUITE-SEG-INYECCION-001',
        titulo: 'Un payload de seguridad llegó sin escapar al backend',
        detalle: `Al completar "${escenario.campo_bajo_prueba}" con un valor que ${escenario.motivo}, el payload "${payload}" viajó tal cual en el body de un request. El frontend no lo filtra antes de mandarlo; la validación real debe existir del lado del servidor.`,
        campo: escenario.campo_bajo_prueba,
        actual: payload,
      });
    }
  }

  return { id: escenario.id, campo_bajo_prueba: escenario.campo_bajo_prueba, error, pasos: pasosEjecutados, hallazgos };
}
