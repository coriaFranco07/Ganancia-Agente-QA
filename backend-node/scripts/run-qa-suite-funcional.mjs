/**
 * run-qa-suite-funcional.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Categoria "funcional" de la Suite de Calidad: corre el flujo de un
 * aprendizaje de SOP Loom completando cada campo con valores VALIDOS en los
 * bordes de su restriccion real declarada (largo, rango, ventana de fechas).
 * No usa `qa_casos` en ningun punto.
 *
 * Configuracion por entorno:
 *   AUDITORIA_QA_SUITE_APRENDIZAJE   id del aprendizaje aprobado (obligatorio)
 *   AUDITORIA_QA_CORREO / _PASSWORD  credenciales del usuario QA
 *   AUDITORIA_FRONTEND_URL           default http://localhost:4200
 *   MONGODB_URI                      default mongodb://127.0.0.1:27017/auditoria_ganancias
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

const CATEGORIA = 'funcional';
const backendRoot = process.cwd();
const repoRoot = resolve(backendRoot, '..');
const outputDir = resolve(repoRoot, 'outputs/playwright/qa-suite-funcional');
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-AR' });
  page = await context.newPage();
  page.setDefaultTimeout(cfg.timeoutMs);
  const tomarCaptura = crearTomarCaptura(page, outputDir, capturas, capturasFallidas);

  await iniciarSesion(page, cfg.frontendUrl, cfg.correo, cfg.contrasena);
  await tomarCaptura('00-login');
  await validarNavegacionAprobada(page, aprendizaje, cfg.frontendUrl);

  const escenarios = derivarEscenarios(aprendizaje.id, pasos, campos, CATEGORIA);
  if (!escenarios.length) throw new Error('No se derivó ningún escenario funcional: revisá los campos del aprendizaje.');

  const resultados = [];
  for (const escenario of escenarios) {
    const resultado = await correrEscenario(escenario, pasos, rutaObjetivo, tomarCaptura);
    resultados.push(resultado);
  }

  const fallidos = resultados.filter((r) => r.estado !== 'ok');
  const estado = fallidos.length ? 'rojo' : 'verde';
  const evidenciaPath = join(outputDir, 'qa-suite-funcional-evidence.json');

  await writeFile(
    evidenciaPath,
    `${JSON.stringify(
      {
        estado,
        categoria: CATEGORIA,
        aprendizaje_id: aprendizaje.id,
        ruta_objetivo: rutaObjetivo,
        escenarios: resultados,
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
  console.log(`QA Suite funcional: ${estado}`);
  console.log(`- aprendizaje=${aprendizaje.id}`);
  console.log(`- evidencia=${evidenciaPath}`);
  console.log(`- detalle=${fallidos.length ? `${fallidos.length}/${resultados.length} escenario(s) con hallazgos` : `${resultados.length} escenario(s) verdes`}`);

  if (estado !== 'verde') process.exitCode = 1;
} catch (error) {
  if (page) await mkdir(outputDir, { recursive: true }).then(() => page.screenshot({ path: join(outputDir, '99-error-fatal.png') })).catch(() => undefined);
  console.error('');
  console.error('QA Suite funcional: rojo');
  console.error(`- detalle=${detalleError(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
}

/**
 * Corre los pasos completos del aprendizaje con los datos de un escenario.
 * Un paso que lanza corta el escenario (no toda la corrida); el resto de los
 * escenarios se siguen intentando para juntar toda la evidencia posible.
 */
async function correrEscenario(escenario, pasos, rutaObjetivo, tomarCaptura) {
  const pasosEjecutados = [];
  let estado = 'ok';
  let detalle = '';

  for (const paso of pasos) {
    try {
      const resultado = await ejecutarPaso(page, cfg.frontendUrl, paso, rutaObjetivo, escenario.datos);
      pasosEjecutados.push({ tipo: paso.tipo, campo: paso.campo ?? null, estado: resultado.estado, detalle: resultado.detalle });
      if (resultado.estado === 'hallazgo' && estado === 'ok') {
        estado = 'hallazgo';
        detalle = resultado.detalle;
      }
    } catch (error) {
      pasosEjecutados.push({ tipo: paso.tipo, campo: paso.campo ?? null, estado: 'error', detalle: detalleError(error) });
      estado = 'error';
      detalle = detalleError(error);
      break;
    }
  }

  await tomarCaptura(`${escenario.id}${estado !== 'ok' ? '-fallo' : ''}`);

  return {
    id: escenario.id,
    campo_bajo_prueba: escenario.campo_bajo_prueba,
    valor_bajo_prueba: escenario.valor_bajo_prueba,
    motivo: escenario.motivo,
    estado,
    detalle: detalle || `${pasosEjecutados.length} paso(s) ejecutados sin hallazgos`,
    pasos: pasosEjecutados,
  };
}
