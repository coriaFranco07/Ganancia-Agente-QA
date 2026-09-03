import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import mongoose from 'mongoose';
import { chromium } from 'playwright-core';

const backendRoot = process.cwd();
const repoRoot = resolve(backendRoot, '..');
const apiUrl = (process.env.AUDITORIA_API_URL ?? 'http://localhost:8001/api').replace(/\/$/, '');
let frontendUrl = (process.env.AUDITORIA_FRONTEND_URL ?? 'http://localhost:4200').replace(/\/$/, '');
const frontendUrlConfigurado = Boolean(process.env.AUDITORIA_FRONTEND_URL);
const mongodbUri = process.env.MONGODB_URI ?? process.env.AUDITORIA_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/auditoria_ganancias';
const correo = process.env.AUDITORIA_QA_CORREO ?? 'qa-local@auditoria.test';
const contrasena = process.env.AUDITORIA_QA_PASSWORD ?? 'qa-local-123456';
const aprendizajeId = process.env.AUDITORIA_QA_SOP_LEARNING;
const outputDir = resolve(repoRoot, process.env.AUDITORIA_QA_SOP_OUTPUT_DIR ?? 'outputs/playwright/qa-sop-loom');
const timeoutMs = Number(process.env.AUDITORIA_PLAYWRIGHT_TIMEOUT_MS ?? 90_000);
const modoDemo = process.argv.includes('--demo') || process.env.AUDITORIA_PLAYWRIGHT_DEMO === 'true';
const headless = modoDemo ? false : process.env.PLAYWRIGHT_HEADLESS !== 'false';
const slowMoMs = Number(process.env.PLAYWRIGHT_SLOWMO_MS ?? (modoDemo ? 1800 : 0));
const demoFinalPauseMs = Number(process.env.PLAYWRIGHT_DEMO_FINAL_PAUSE_MS ?? (modoDemo ? 15000 : 0));

const capturas = [];
const capturasFallidas = [];
let browser;
let page;

try {
  if (!aprendizajeId) throw new Error('Definí AUDITORIA_QA_SOP_LEARNING con el id del aprendizaje aprobado.');

  await mkdir(outputDir, { recursive: true });
  await verificarServicios();
  await conectarMongo();
  await asegurarUsuario();
  const aprendizaje = await cargarAprendizaje(aprendizajeId);

  const executablePath = detectarNavegador();
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

  await iniciarSesion();
  await validarNavegacionAprobada(aprendizaje);
  const resultado = await ejecutarAprendizaje(aprendizaje);
  const estado = resultado.estado;
  const evidenciaPath = join(outputDir, 'qa-sop-loom-evidence.json');

  await writeFile(evidenciaPath, `${JSON.stringify({
    estado,
    sistema: 'auditoria-ganancias',
    tipo: 'sop_loom_aprendizaje',
    aprendizaje_id: aprendizaje.id,
    frontend_url: frontendUrl,
    api_url: apiUrl,
    mongodb_uri: ocultarMongo(mongodbUri),
    modo_demo: modoDemo,
    resultado,
    capturas,
    capturas_fallidas: capturasFallidas,
    fecha: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(`QA SOP Loom Playwright: ${estado}`);
  console.log(`- aprendizaje=${aprendizaje.id}`);
  console.log(`- evidencia=${evidenciaPath}`);
  console.log(`- detalle=${resultado.detalle}`);

  if (estado !== 'verde') process.exitCode = 1;
} catch (error) {
  if (page) await tomarCaptura('99-error').catch(() => undefined);
  console.error('');
  console.error('QA SOP Loom Playwright: rojo');
  console.error(`- detalle=${detalleError(error)}`);
  console.error(`- Backend esperado: ${apiUrl}`);
  console.error(`- Frontend esperado: ${frontendUrl}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
}

async function ejecutarAprendizaje(aprendizaje) {
  const definicion = objeto(aprendizaje.definicion_ejecutable);
  const rutas = objeto(definicion.rutas);
  const rutaObjetivo = texto(rutas.pantalla_objetivo);
  const pasos = Array.isArray(definicion.pasos_ejecutables) ? definicion.pasos_ejecutables : [];
  const casos = Array.isArray(definicion.casos) ? definicion.casos.map(objeto) : [];

  if (!rutaObjetivo) throw new Error('La definición no tiene pantalla objetivo resuelta.');
  if (pasos.length === 0) throw new Error('La definición no tiene pasos ejecutables compilados.');
  if (casos.length === 0) throw new Error('La definición no tiene casos QA con los que operar la pantalla.');

  // El plan se aprobó sobre un set de datos concreto. Si los casos cambiaron
  // desde la aprobación, se aborta antes de escribir.
  await revalidarCasos(casos);

  const corridas = [];

  for (const caso of casos) {
    const corrida = await ejecutarCaso(caso, pasos, rutaObjetivo);
    corridas.push(corrida);
    if (corrida.estado === 'rojo') {
      return {
        estado: 'rojo',
        aprendizaje_id: aprendizaje.id,
        ruta_objetivo: rutaObjetivo,
        casos: corridas,
        detalle: `Falló el caso ${corrida.caso_id}: ${corrida.detalle}`,
      };
    }
  }

  await mostrarResultadoDemo(aprendizaje, rutaObjetivo, corridas.length);
  if (demoFinalPauseMs > 0) await page.waitForTimeout(demoFinalPauseMs);

  return {
    estado: 'verde',
    aprendizaje_id: aprendizaje.id,
    ruta_objetivo: rutaObjetivo,
    flujo: {
      nombre: texto(aprendizaje.nombre),
      ruta: texto(aprendizaje.ruta),
      pasos_aprendidos: Array.isArray(aprendizaje.pasos) ? aprendizaje.pasos.length : 0,
    },
    casos: corridas,
    assertions: [
      { campo: 'ruta_objetivo', esperado: rutaObjetivo, actual: rutaObjetivo, estado: 'ok' },
      { campo: 'casos_ejecutados', esperado: casos.length, actual: corridas.length, estado: 'ok' },
    ],
    detalle: `El agente operó ${rutaObjetivo} con ${corridas.length} caso(s) reales de Pantalla 3.`,
  };
}

async function ejecutarCaso(caso, pasos, rutaObjetivo) {
  const casoId = texto(caso.id);
  const datos = objeto(caso.datos);
  const ejecutados = [];

  for (const pasoCrudo of pasos) {
    const paso = objeto(pasoCrudo);
    const orden = Number(paso.orden) || ejecutados.length + 1;
    const tipo = texto(paso.tipo);
    const nombre = texto(paso.nombre) || `${tipo} ${orden}`;
    const inicio = Date.now();
    const prefijoCaptura = `${nombreSeguro(casoId)}-${String(orden).padStart(2, '0')}`;

    try {
      const detalle = await ejecutarPaso(paso, rutaObjetivo, caso, datos);
      ejecutados.push({ orden, tipo, nombre, estado: 'ok', detalle, duracion_ms: Date.now() - inicio });
      await tomarCaptura(`${prefijoCaptura}-${nombre}`);
    } catch (error) {
      await tomarCaptura(`${prefijoCaptura}-fallo-${nombre}`);
      ejecutados.push({
        orden,
        tipo,
        nombre,
        estado: 'fallido',
        detalle: detalleError(error),
        duracion_ms: Date.now() - inicio,
      });
      return {
        estado: 'rojo',
        caso_id: casoId,
        id_esperado: texto(caso.id_esperado),
        datos,
        pasos: ejecutados,
        detalle: `paso ${orden} (${nombre}): ${detalleError(error)}`,
      };
    }
  }

  return {
    estado: 'verde',
    caso_id: casoId,
    id_esperado: texto(caso.id_esperado),
    descripcion: texto(caso.descripcion),
    datos,
    pasos: ejecutados,
    detalle: `${ejecutados.length} paso(s) ejecutados`,
  };
}

/** Compara los casos congelados en el plan contra lo que hay hoy en Mongo. */
async function revalidarCasos(casos) {
  const coleccion = mongoose.connection.collection('qa_casos');
  const desvios = [];

  for (const caso of casos) {
    const id = texto(caso.id);
    const actual = await coleccion.findOne({ id });
    if (!actual) {
      desvios.push(`el caso ${id} ya no existe`);
      continue;
    }
    if (actual.activo === false) {
      desvios.push(`el caso ${id} fue desactivado`);
      continue;
    }

    const datosActuales = datosDeCaso(actual);
    for (const [campo, esperado] of Object.entries(objeto(caso.datos))) {
      const ahora = texto(datosActuales[campo]);
      if (ahora !== texto(esperado)) {
        desvios.push(`el caso ${id} cambió ${campo}: "${texto(esperado)}" -> "${ahora}"`);
      }
    }
  }

  if (desvios.length > 0) {
    throw new Error(
      `Los casos cambiaron desde la aprobación, se aborta antes de escribir. ${desvios.join('; ')}. Volvé a guardar y aprobar el aprendizaje.`,
    );
  }
}

function datosDeCaso(caso) {
  const contexto = objeto(caso.contexto);
  const complementario = objeto(contexto.contexto_complementario);
  const pantalla3 = objeto(complementario.pantalla_3);
  const empleado = objeto(contexto.empleado);
  return { ...empleado, ...pantalla3 };
}

async function ejecutarPaso(paso, rutaObjetivo, caso, datos) {
  const tipo = texto(paso.tipo);
  const selectorPaso = texto(paso.selector);

  if (tipo === 'navegar') {
    const destino = texto(paso.valor) || rutaObjetivo;
    await page.goto(`${frontendUrl}${destino}`, { waitUntil: 'domcontentloaded' });
    await aplicarEspera(paso);
    return `Navegó a ${destino}`;
  }

  if (tipo === 'completar') {
    if (!selectorPaso) throw new Error('Paso completar sin selector.');
    // El valor sale del caso QA de esta vuelta, no del plan.
    const clave = texto(paso.campo);
    const valor = texto(datos[clave]);
    const campo = page.locator(selectorPaso).first();
    await campo.waitFor({ state: 'visible' });

    // Un <select> no se completa escribiendo: hay que elegir una opción. Si el
    // valor del caso no está entre las opciones se dice cuáles hay, en vez de
    // dejar el campo con otro valor y fallar recién en la verificación.
    const etiqueta = await campo.evaluate((el) => el.tagName.toLowerCase());
    if (etiqueta === 'select') {
      try {
        await campo.selectOption(valor);
      } catch {
        const opciones = (await campo.locator('option').allTextContents())
          .map((opcion) => opcion.trim())
          .filter(Boolean);
        throw new Error(`El campo ${clave} no tiene la opción "${valor}". Opciones disponibles: ${opciones.join(' | ')}`);
      }
      await aplicarEspera(paso);
      return `Eligió ${clave || selectorPaso} = ${valor}`;
    }

    await campo.fill(valor);
    const escrito = await campo.inputValue();
    if (escrito !== valor) {
      throw new Error(`El campo ${clave} quedó en "${escrito}" y se esperaba "${valor}".`);
    }
    await aplicarEspera(paso);
    return `Completó ${clave || selectorPaso} = ${valor}`;
  }

  if (tipo === 'verificar_fila') {
    const idEsperado = texto(caso.id_esperado);
    if (!idEsperado) throw new Error('El caso no tiene id esperado para verificar la fila.');
    const selectorFila = `[data-testid="${texto(paso.prefijo_fila)}${idEsperado}"]`;
    await page.locator(selectorFila).first().waitFor({ state: 'visible', timeout: 30_000 });
    return `El caso ${idEsperado} aparece en el listado`;
  }

  if (tipo === 'click') {
    if (!selectorPaso) throw new Error('Paso click sin selector.');
    const boton = page.locator(selectorPaso).first();
    await boton.waitFor({ state: 'visible' });
    const espera = objeto(paso.espera);
    if (texto(espera.tipo) === 'respuesta') {
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes(texto(espera.valor)), {
          timeout: Number(espera.timeout_ms) || 30_000,
        }),
        boton.click(),
      ]);
      if (!response.ok()) {
        throw new Error(`${texto(espera.valor)} respondió ${response.status()}: ${await response.text()}`);
      }
      return `Click en ${selectorPaso} con respuesta ${response.status()} de ${texto(espera.valor)}`;
    }
    await boton.click();
    await aplicarEspera(paso);
    return `Click en ${selectorPaso}`;
  }

  if (tipo === 'verificar') {
    if (!selectorPaso) throw new Error('Paso verificar sin selector.');
    const verificacion = objeto(paso.verificacion);
    const mensaje = page.locator(selectorPaso).first();
    await mensaje.waitFor({ state: 'visible' });
    const contenido = (await mensaje.innerText()).trim();
    const clase = texto(await mensaje.getAttribute('class'));
    const claseError = texto(verificacion.clase_error);

    if (claseError && clase.split(/\s+/).includes(claseError)) {
      throw new Error(`La pantalla devolvió un error: ${contenido}`);
    }
    const patron = texto(verificacion.patron_exito);
    if (patron && !new RegExp(patron, 'i').test(contenido)) {
      throw new Error(`El mensaje "${contenido}" no coincide con el patrón de éxito "${patron}".`);
    }
    return `Mensaje verificado: ${contenido}`;
  }

  throw new Error(`Tipo de paso no soportado: ${tipo}`);
}

async function aplicarEspera(paso) {
  const espera = objeto(paso.espera);
  const tipo = texto(espera.tipo);
  if (!tipo) return;

  if (tipo === 'elemento') {
    const valor = texto(espera.valor);
    if (!valor) return;
    await page.locator(valor).first().waitFor({
      state: 'visible',
      timeout: Number(espera.timeout_ms) || 30_000,
    });
    return;
  }

  if (tipo === 'respuesta') {
    await page.waitForResponse((r) => r.url().includes(texto(espera.valor)), {
      timeout: Number(espera.timeout_ms) || 30_000,
    });
  }
}

async function verificarServicios() {
  const salud = await requestJson(`${apiUrl}/salud`, 'Backend Auditoria no responde');
  assert.equal(salud.estado, 'ok');
  await verificarFrontend();
}

async function verificarFrontend() {
  const candidatos = frontendUrlConfigurado
    ? [frontendUrl]
    : Array.from(new Set([frontendUrl, 'http://localhost:4300']));

  const errores = [];
  for (const candidato of candidatos) {
    try {
      const response = await fetchConTimeout(candidato);
      if (!response.ok) {
        errores.push(`${candidato}: HTTP ${response.status}`);
        continue;
      }
      const html = await response.text();
      if (!/<app-root><\/app-root>/i.test(html)) {
        errores.push(`${candidato}: no parece un frontend Angular de Auditoria`);
        continue;
      }
      frontendUrl = candidato;
      return;
    } catch (error) {
      errores.push(`${candidato}: ${detalleError(error)}`);
    }
  }

  throw new Error(`Frontend Auditoria no responde. Intentos: ${errores.join(' | ')}`);
}

async function conectarMongo() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(mongodbUri, { serverSelectionTimeoutMS: 5000 });
}

async function asegurarUsuario() {
  await mongoose.connection.collection('usuarios').updateOne(
    { correo },
    {
      $set: {
        correo,
        password_hash: crearPasswordHash(contrasena),
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

async function cargarAprendizaje(id) {
  const doc = await mongoose.connection.collection('qa_sop_loom_aprendizajes').findOne({ id });
  if (!doc) throw new Error(`No existe aprendizaje SOP Loom ${id}.`);
  if (doc.estado !== 'aprobado') throw new Error(`El aprendizaje ${id} no está aprobado.`);
  if (!doc.definicion_ejecutable) throw new Error(`El aprendizaje ${id} no tiene definición ejecutable.`);
  if (!doc.inspeccion_navegacion?.hash) throw new Error(`El aprendizaje ${id} no tiene navegación aprobada.`);
  const hashDefinicion = createHash('sha256').update(JSON.stringify(doc.definicion_ejecutable)).digest('hex');
  if (texto(doc.aprobacion?.hash_definicion) !== hashDefinicion) {
    throw new Error(`La definición ${id} cambió después de la aprobación.`);
  }
  if (texto(doc.aprobacion?.hash_navegacion) !== texto(doc.inspeccion_navegacion.hash)) {
    throw new Error(`La navegación ${id} no coincide con la aprobación técnica.`);
  }
  return JSON.parse(JSON.stringify(doc));
}

async function validarNavegacionAprobada(aprendizaje) {
  const inspeccion = objeto(aprendizaje.inspeccion_navegacion);
  const ruta = texto(inspeccion.ruta);
  if (!ruta) throw new Error('La inspección aprobada no tiene ruta.');

  await page.goto(`${frontendUrl}${ruta}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const elementos = await inventarioPantalla();
  const hashActual = hashInventario(ruta, elementos);
  const hashAprobado = texto(inspeccion.hash);
  if (hashActual !== hashAprobado) {
    const anteriores = Array.isArray(inspeccion.elementos)
      ? inspeccion.elementos.map((item) => texto(objeto(item).testid)).filter(Boolean)
      : [];
    const actuales = elementos.map((item) => item.testid);
    const cambios = [
      ...anteriores.filter((testid) => !actuales.includes(testid)).map((testid) => `ya no existe ${testid}`),
      ...actuales.filter((testid) => !anteriores.includes(testid)).map((testid) => `apareció ${testid}`),
    ];
    throw new Error(
      `La pantalla cambió desde la aprobación (${cambios.join('; ') || 'cambió el contrato de un control'}). `
      + 'Volvé a inspeccionar, guardar y aprobar el flujo.',
    );
  }
  await tomarCaptura('01-navegacion-revalidada');
}

async function inventarioPantalla() {
  const elementos = await page.locator('[data-testid]').evaluateAll((nodos) => nodos.map((nodo) => {
    const elemento = nodo;
    const testid = elemento.getAttribute('data-testid') ?? '';
    const id = elemento.getAttribute('id') ?? '';
    const labelFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const labelContenedor = elemento.closest('label');
    const etiqueta = (
      elemento.getAttribute('aria-label')
      || labelFor?.textContent
      || labelContenedor?.querySelector('span')?.textContent
      || (['BUTTON', 'A'].includes(elemento.tagName) ? elemento.textContent : '')
      || elemento.getAttribute('placeholder')
      || elemento.getAttribute('name')
      || ''
    ).replace(/\s+/g, ' ').trim();
    const opciones = elemento instanceof HTMLSelectElement
      ? Array.from(elemento.options).map((opcion) => opcion.text.trim()).filter(Boolean)
      : [];
    return {
      testid,
      tag: elemento.tagName.toLowerCase(),
      tipo: elemento.type || elemento.getAttribute('type') || '',
      rol: elemento.getAttribute('role') || '',
      nombre: elemento.getAttribute('name') || '',
      etiqueta,
      obligatorio: elemento.hasAttribute('required') || elemento.getAttribute('aria-required') === 'true',
      opciones,
    };
  }));
  return elementos.filter((item) => item.testid).sort((a, b) => a.testid.localeCompare(b.testid));
}

function hashInventario(ruta, elementos) {
  return createHash('sha256').update(JSON.stringify({ ruta, elementos })).digest('hex');
}

async function iniciarSesion() {
  await page.goto(`${frontendUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="auth-email-input"]').fill(correo);
  await page.locator('[data-testid="auth-password-input"]').fill(contrasena);
  await tomarCaptura('00-login');

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST'),
    page.locator('[data-testid="auth-submit-button"]').click(),
  ]);
  if (!response.ok()) {
    throw new Error(`Login UI falló ${response.status()}: ${await response.text()}`);
  }
  await page.waitForURL(/\/inicio(?:$|[?#])/, { timeout: 30_000 });
}

async function tomarCaptura(nombre) {
  const destino = join(outputDir, `${nombreSeguro(nombre)}.png`);
  try {
    await page.screenshot({ path: destino, fullPage: false, animations: 'disabled', timeout: 20_000 });
    capturas.push(destino);
    return destino;
  } catch (error) {
    capturasFallidas.push({ nombre, destino, error: detalleError(error) });
    return null;
  }
}

async function mostrarResultadoDemo(aprendizaje, rutaObjetivo, casosEjecutados) {
  if (!modoDemo && demoFinalPauseMs <= 0) return;

  await page.evaluate((data) => {
    document.getElementById('qa-sop-final-overlay')?.remove();

    const overlay = document.createElement('section');
    overlay.id = 'qa-sop-final-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '24px';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'grid';
    overlay.style.placeItems = 'center';
    overlay.style.pointerEvents = 'none';
    overlay.style.fontFamily = 'Inter, Arial, sans-serif';

    const card = document.createElement('div');
    card.style.width = 'min(760px, calc(100vw - 48px))';
    card.style.border = '3px solid #22c55e';
    card.style.borderRadius = '16px';
    card.style.background = 'rgba(255,255,255,0.98)';
    card.style.boxShadow = '0 28px 90px rgba(15, 23, 42, 0.28)';
    card.style.padding = '26px';
    card.style.color = '#0f172a';

    const pill = document.createElement('div');
    pill.textContent = 'SOP LOOM VERDE';
    pill.style.display = 'inline-flex';
    pill.style.alignItems = 'center';
    pill.style.height = '34px';
    pill.style.padding = '0 14px';
    pill.style.borderRadius = '999px';
    pill.style.background = '#dcfce7';
    pill.style.color = '#166534';
    pill.style.fontSize = '14px';
    pill.style.fontWeight = '900';
    card.appendChild(pill);

    const titulo = document.createElement('h2');
    titulo.textContent = 'El agente ejecutó el flujo aprendido';
    titulo.style.margin = '16px 0 6px';
    titulo.style.fontSize = '30px';
    titulo.style.lineHeight = '1.1';
    titulo.style.fontWeight = '950';
    card.appendChild(titulo);

    const descripcion = document.createElement('p');
    descripcion.textContent = `Aprendizaje ${data.aprendizajeId}: ${data.casos} caso(s) reales operados sobre la pantalla.`;
    descripcion.style.margin = '0 0 18px';
    descripcion.style.fontSize = '15px';
    descripcion.style.color = '#475569';
    descripcion.style.fontWeight = '750';
    card.appendChild(descripcion);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
    grid.style.gap = '10px';
    for (const item of [
      ['Flujo', data.nombre],
      ['Pantalla operada', data.ruta],
      ['Casos ejecutados', String(data.casos)],
    ]) {
      const box = document.createElement('div');
      box.style.border = '1px solid #dbeafe';
      box.style.borderRadius = '10px';
      box.style.padding = '10px 12px';
      box.style.background = '#f8fbff';

      const label = document.createElement('div');
      label.textContent = item[0];
      label.style.fontSize = '11px';
      label.style.fontWeight = '900';
      label.style.color = '#64748b';
      label.style.textTransform = 'uppercase';
      box.appendChild(label);

      const value = document.createElement('div');
      value.textContent = item[1] || '-';
      value.style.marginTop = '4px';
      value.style.fontSize = '13px';
      value.style.fontWeight = '900';
      value.style.overflowWrap = 'anywhere';
      box.appendChild(value);
      grid.appendChild(box);
    }
    card.appendChild(grid);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }, {
    aprendizajeId: aprendizaje.id,
    nombre: texto(aprendizaje.nombre),
    ruta: texto(rutaObjetivo) || 'Ruta pendiente',
    casos: Number(casosEjecutados) || 0,
  });
}

async function requestJson(url, mensaje) {
  const response = await fetchConTimeout(url);
  if (!response.ok) {
    throw new Error(`${mensaje}: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function fetchConTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function crearPasswordHash(valor) {
  const iteraciones = 210_000;
  const salt = randomBytes(16).toString('base64url');
  const hash = pbkdf2Sync(valor, salt, iteraciones, 32, 'sha256').toString('base64url');
  return `pbkdf2$${iteraciones}$${salt}$${hash}`;
}

function detectarNavegador() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

  const chrome = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    resolve(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  ];
  const chromePath = chrome.find((candidato) => candidato && existsSync(candidato));
  if (chromePath) return chromePath;

  const edge = [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    resolve(process.env.LOCALAPPDATA ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  return edge.find((candidato) => candidato && existsSync(candidato));
}

function objeto(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
}

function texto(valor) {
  return valor === undefined || valor === null ? '' : String(valor).trim();
}

function nombreSeguro(valor) {
  return String(valor).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'captura';
}

function ocultarMongo(uri) {
  return uri.replace(/\/\/([^:/@]+):([^@]+)@/, '//***:***@');
}

function detalleError(error) {
  return error instanceof Error ? error.message : String(error);
}
