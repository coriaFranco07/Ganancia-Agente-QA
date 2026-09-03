/**
 * run-qa-suite-accesibilidad.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Categoria "accesibilidad" de la Suite de Calidad: reproduce el flujo del
 * aprendizaje sin variar ningun valor (usa el escenario base, con datos
 * funcionales seguros solo para poder avanzar) y audita cada pantalla que
 * visita contra pautas WCAG con axe-core -el motor de auditoria estandar de
 * la industria-, inyectado de cero para este script.
 *
 * Configuracion: igual que run-qa-suite-funcional.mjs.
 */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  iniciarSesion,
  mapearCampos,
  objeto,
  resolverConfigComun,
  texto,
  validarNavegacionAprobada,
} from './lib/qa-suite-comun.mjs';
import { derivarEscenarios } from './lib/qa-suite-derivador.mjs';

const CATEGORIA = 'accesibilidad';
const backendRoot = process.cwd();
const repoRoot = resolve(backendRoot, '..');
const cfg = resolverConfigComun();
if (cfg.demoDegradadoSinEscritorio) {
  console.warn('Modo demo pedido sin entorno gráfico detectado (sin DISPLAY/WAYLAND_DISPLAY, o CI): corriendo headless.');
}
const outputDir = cfg.outputDirEnv ? resolve(repoRoot, cfg.outputDirEnv) : resolve(repoRoot, 'outputs/playwright/qa-suite-accesibilidad');

const aca = dirname(fileURLToPath(import.meta.url));
const fuenteAxe = readFileSync(resolve(aca, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const IMPACTO_A_GRAVEDAD = { critical: 'alta', serious: 'alta', moderate: 'media', minor: 'media' };

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
  activarAislamientoDatos(context, cfg.ejecucionId);
  page = await context.newPage();
  page.setDefaultTimeout(cfg.timeoutMs);
  const tomarCaptura = crearTomarCaptura(page, outputDir, capturas, capturasFallidas);

  await iniciarSesion(page, cfg.frontendUrl, cfg.correo, cfg.contrasena);
  await tomarCaptura('00-login');
  await validarNavegacionAprobada(page, aprendizaje, cfg.frontendUrl);

  const [escenario] = derivarEscenarios(aprendizaje.id, pasos, campos, CATEGORIA);

  const auditorias = [];
  const contexto = {};
  for (const paso of pasos) {
    const resultado = await ejecutarPaso(page, cfg.frontendUrl, paso, rutaObjetivo, escenario.datos, contexto);
    if (paso.tipo === 'navegar') {
      auditorias.push(await auditarPagina(page.url()));
    }
    if (resultado.estado === 'error') {
      throw new Error(`El paso "${paso.nombre ?? paso.tipo}" falló antes de poder auditar: ${resultado.detalle}`);
    }
  }
  if (!auditorias.length) {
    // El aprendizaje no tuvo un paso "navegar" propio (arranca ya en la pantalla): audita el estado final igual.
    auditorias.push(await auditarPagina(page.url()));
  }
  await tomarCaptura('estado-final');

  const violacionesTotales = auditorias.flatMap((a) => a.violaciones);
  const estado = violacionesTotales.length ? 'rojo' : 'verde';
  const evidenciaPath = join(outputDir, 'qa-suite-accesibilidad-evidence.json');

  await writeFile(
    evidenciaPath,
    `${JSON.stringify(
      {
        estado,
        categoria: CATEGORIA,
        aprendizaje_id: aprendizaje.id,
        ruta_objetivo: rutaObjetivo,
        auditorias,
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
  console.log(`QA Suite accesibilidad: ${estado}`);
  console.log(`- aprendizaje=${aprendizaje.id}`);
  console.log(`- evidencia=${evidenciaPath}`);
  console.log(`- detalle=${violacionesTotales.length ? `${violacionesTotales.length} violacion(es) WCAG` : 'sin violaciones WCAG'}`);

  if (estado !== 'verde') process.exitCode = 1;
} catch (error) {
  if (page) await mkdir(outputDir, { recursive: true }).then(() => page.screenshot({ path: join(outputDir, '99-error-fatal.png') })).catch(() => undefined);
  console.error('');
  console.error('QA Suite accesibilidad: rojo');
  console.error(`- detalle=${detalleError(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
}

async function auditarPagina(url) {
  await page.addScriptTag({ content: fuenteAxe });
  const resultado = await page.evaluate(() =>
    axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }),
  );

  const violaciones = (resultado.violations ?? []).map((v) => ({
    regla: v.id,
    impacto: v.impact ?? 'menor',
    gravedad: IMPACTO_A_GRAVEDAD[v.impact] ?? 'media',
    ayuda: v.help,
    url_ayuda: v.helpUrl,
    nodos_afectados: v.nodes.length,
    ejemplos: v.nodes.slice(0, 3).map((n) => n.target?.join(' ') ?? ''),
  }));

  return { url, reglas_pasadas: resultado.passes?.length ?? 0, violaciones };
}
