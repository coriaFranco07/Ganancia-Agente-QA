/**
 * qa-suite-comun.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Helpers compartidos por los runners de la Suite de Calidad (funcional,
 * seguridad, accesibilidad). Opera sobre aprendizajes de SOP Loom, nunca sobre
 * `qa_casos`: los valores que se escriben en cada campo los calcula el motor
 * de derivacion (`qa-suite-derivador.mjs`) a partir de las restricciones
 * reales declaradas en el propio aprendizaje.
 *
 * El chequeo de deriva contra la pantalla real (`validarNavegacionAprobada`)
 * es el mismo que ya usa SOP Loom para su propia ejecucion: si la pantalla
 * cambio desde la aprobacion, la corrida se corta ahi, con el detalle de que
 * cambio, en vez de correr a ciegas.
 */
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import mongoose from 'mongoose';

export function resolverConfigComun() {
  const frontendUrl = (process.env.AUDITORIA_FRONTEND_URL ?? 'http://localhost:4200').replace(/\/$/, '');
  const mongodbUri =
    process.env.MONGODB_URI ?? process.env.AUDITORIA_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/auditoria_ganancias';
  const correo = process.env.AUDITORIA_QA_CORREO ?? 'qa-local@auditoria.test';
  const contrasena = process.env.AUDITORIA_QA_PASSWORD ?? 'qa-local-123456';
  const aprendizajeId = process.env.AUDITORIA_QA_SUITE_APRENDIZAJE;
  const timeoutMs = Number(process.env.AUDITORIA_PLAYWRIGHT_TIMEOUT_MS ?? 90_000);
  const modoDemo = process.argv.includes('--demo') || process.env.AUDITORIA_PLAYWRIGHT_DEMO === 'true';
  const headless = modoDemo ? false : process.env.PLAYWRIGHT_HEADLESS !== 'false';
  const slowMoMs = Number(process.env.PLAYWRIGHT_SLOWMO_MS ?? (modoDemo ? 1800 : 0));
  return { frontendUrl, mongodbUri, correo, contrasena, aprendizajeId, timeoutMs, modoDemo, headless, slowMoMs };
}

export async function conectarMongo(mongodbUri) {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(mongodbUri, { serverSelectionTimeoutMS: 5000 });
}

export async function asegurarUsuario(correo, contrasena) {
  await mongoose.connection.collection('usuarios').updateOne(
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

/**
 * Carga un aprendizaje de SOP Loom compilado. No exige que este aprobado: si
 * ya esta cargado en la base y tiene definicion ejecutable, alcanza para que
 * la Suite lo corra. Para los que si pasaron por aprobacion, ademas
 * re-verifica que la definicion y la navegacion no hayan cambiado desde que
 * se aprobaron -esa rigurosidad se mantiene solo para los ya aprobados. No
 * exige casos congelados: la Suite no los usa.
 */
export async function cargarAprendizaje(aprendizajeId) {
  if (!aprendizajeId) throw new Error('Definí AUDITORIA_QA_SUITE_APRENDIZAJE con el id del aprendizaje.');

  const doc = await mongoose.connection.collection('qa_sop_loom_aprendizajes').findOne({ id: aprendizajeId });
  if (!doc) throw new Error(`No existe aprendizaje SOP Loom ${aprendizajeId}.`);
  if (!doc.definicion_ejecutable) throw new Error(`El aprendizaje ${aprendizajeId} no tiene definición ejecutable.`);
  if (!doc.inspeccion_navegacion?.hash) throw new Error(`El aprendizaje ${aprendizajeId} no tiene navegación inspeccionada.`);

  if (doc.estado === 'aprobado') {
    const hashDefinicion = createHash('sha256').update(JSON.stringify(doc.definicion_ejecutable)).digest('hex');
    if (texto(doc.aprobacion?.hash_definicion) !== hashDefinicion) {
      throw new Error(`La definición de ${aprendizajeId} cambió después de la aprobación. Volvé a revisarla y aprobarla.`);
    }
    if (texto(doc.aprobacion?.hash_navegacion) !== texto(doc.inspeccion_navegacion.hash)) {
      throw new Error(`La navegación aprobada de ${aprendizajeId} no coincide con la aprobación técnica vigente.`);
    }
  }

  return JSON.parse(JSON.stringify(doc));
}

/**
 * Vuelve a inspeccionar la pantalla real y compara el hash contra el que se
 * aprobó. Si algo cambió (un control que ya no está, uno nuevo), corta con el
 * detalle de qué cambió en vez de seguir corriendo sobre algo desactualizado.
 */
export async function validarNavegacionAprobada(page, aprendizaje, frontendUrl) {
  const inspeccion = objeto(aprendizaje.inspeccion_navegacion);
  const ruta = texto(inspeccion.ruta);
  if (!ruta) throw new Error('La inspección aprobada no tiene ruta.');

  await page.goto(`${frontendUrl}${ruta}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const elementos = await inventarioPantalla(page);
  // Mismo subconjunto de campos, mismo orden, que `hashInventario()` en
  // qa-pantalla-inspector.service.ts: hay que reproducir el hash tal cual
  // se aprobó, no un resumen propio, o el chequeo nunca va a coincidir.
  const estable = elementos.map((item) => ({
    testid: item.testid,
    tag: item.tag,
    tipo: item.tipo,
    rol: item.rol,
    nombre: item.nombre,
    etiqueta: item.etiqueta,
    obligatorio: item.obligatorio,
    opciones: item.opciones,
  }));
  const hashActual = createHash('sha256').update(JSON.stringify({ ruta, elementos: estable })).digest('hex');
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
      `La pantalla cambió desde la aprobación (${cambios.join('; ') || 'cambió el contrato de un control'}). ` +
        'Volvé a inspeccionar, guardar y aprobar el flujo antes de correr la Suite.',
    );
  }

  return { ruta };
}

/**
 * Extrae los mismos campos, de la misma forma, que `extraerElementos()` en
 * qa-pantalla-inspector.service.ts (backend). Cualquier diferencia acá
 * produce un hash distinto al que se guardó en la aprobación aunque la
 * pantalla no haya cambiado en absoluto.
 */
async function inventarioPantalla(page) {
  const elementos = await page.locator('[data-testid]').evaluateAll((nodos) =>
    nodos.map((nodo) => {
      const elemento = nodo;
      const input = elemento;
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
        tipo: input.type || elemento.getAttribute('type') || '',
        rol: elemento.getAttribute('role') || '',
        nombre: elemento.getAttribute('name') || '',
        etiqueta,
        obligatorio: elemento.hasAttribute('required') || elemento.getAttribute('aria-required') === 'true',
        opciones,
      };
    }),
  );
  return elementos.filter((item) => item.testid).sort((a, b) => a.testid.localeCompare(b.testid));
}

export async function iniciarSesion(page, frontendUrl, correo, contrasena) {
  await page.goto(`${frontendUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="auth-email-input"]').fill(correo);
  await page.locator('[data-testid="auth-password-input"]').fill(contrasena);

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST'),
    page.locator('[data-testid="auth-submit-button"]').click(),
  ]);
  if (!response.ok()) {
    throw new Error(`Login UI falló ${response.status()}: ${await response.text()}`);
  }
  await page.waitForURL(/\/inicio(?:$|[?#])/, { timeout: 30_000 });
}

/**
 * Ejecuta un paso del aprendizaje contra la pantalla actual. `datos` viene
 * del motor de derivacion (clave -> valor), nunca de un caso congelado.
 * `verificar_fila` depende de un id de caso QA y no aplica a la Suite: se
 * reporta omitido en vez de fallar.
 */
export async function ejecutarPaso(page, frontendUrl, paso, rutaObjetivo, datos) {
  const tipo = texto(paso.tipo);
  const selectorPaso = texto(paso.selector);

  if (tipo === 'navegar') {
    const destino = texto(paso.valor) || rutaObjetivo;
    await page.goto(`${frontendUrl}${destino}`, { waitUntil: 'domcontentloaded' });
    await aplicarEspera(page, paso);
    return { estado: 'ok', detalle: `Navegó a ${destino}` };
  }

  if (tipo === 'completar') {
    if (!selectorPaso) throw new Error('Paso completar sin selector.');
    const clave = texto(paso.campo);
    const valor = texto(datos[clave]);
    const campo = page.locator(selectorPaso).first();
    await campo.waitFor({ state: 'visible' });
    await campo.fill(valor);
    await aplicarEspera(page, paso);
    return { estado: 'ok', detalle: `Completó ${clave || selectorPaso} = ${valor}` };
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
      return { estado: 'ok', detalle: `Click en ${selectorPaso} con respuesta ${response.status()}`, response };
    }
    await boton.click();
    await aplicarEspera(page, paso);
    return { estado: 'ok', detalle: `Click en ${selectorPaso}` };
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
      return { estado: 'hallazgo', detalle: `La pantalla devolvió un error: ${contenido}` };
    }
    const patron = texto(verificacion.patron_exito);
    if (patron && !new RegExp(patron, 'i').test(contenido)) {
      return { estado: 'hallazgo', detalle: `El mensaje "${contenido}" no coincide con el patrón de éxito.` };
    }
    return { estado: 'ok', detalle: `Mensaje verificado: ${contenido}` };
  }

  if (tipo === 'verificar_fila') {
    return { estado: 'omitido', detalle: 'verificar_fila depende de un caso QA congelado: no aplica a la Suite.' };
  }

  return { estado: 'omitido', detalle: `Tipo de paso no soportado por la Suite: ${tipo}` };
}

async function aplicarEspera(page, paso) {
  const espera = objeto(paso.espera);
  const tipo = texto(espera.tipo);
  if (!tipo) return;

  if (tipo === 'elemento') {
    const valor = texto(espera.valor);
    if (!valor) return;
    await page.locator(valor).first().waitFor({ state: 'visible', timeout: Number(espera.timeout_ms) || 30_000 });
    return;
  }
  if (tipo === 'respuesta') {
    await page.waitForResponse((r) => r.url().includes(texto(espera.valor)), {
      timeout: Number(espera.timeout_ms) || 30_000,
    });
  }
}

export function crearTomarCaptura(page, outputDir, capturas, capturasFallidas) {
  return async function tomarCaptura(nombre) {
    const destino = join(outputDir, `${nombreSeguro(nombre)}.png`);
    try {
      await page.screenshot({ path: destino, fullPage: false, animations: 'disabled', timeout: 20_000 });
      capturas.push(destino);
      return destino;
    } catch (error) {
      capturasFallidas.push({ nombre, destino, error: detalleError(error) });
      return null;
    }
  };
}

export function detectarNavegador() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const chrome = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    resolve(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  ];
  return chrome.find((candidato) => candidato && existsSync(candidato));
}

export function objeto(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
}

export function texto(valor) {
  return valor === undefined || valor === null ? '' : String(valor).trim();
}

export function nombreSeguro(valor) {
  return String(valor).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'captura';
}

export function detalleError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `doc.campos` (nivel raiz del aprendizaje, no `definicion_ejecutable.campos`
 * -ese no existe) trae `nombre` en vez de `clave` y no siempre trae
 * `restriccion`. La adapta a la forma que espera el motor de derivacion.
 */
export function mapearCampos(camposCrudos) {
  return (Array.isArray(camposCrudos) ? camposCrudos : []).map((c) => ({
    clave: texto(c.nombre ?? c.clave),
    etiqueta: texto(c.etiqueta),
    testid: texto(c.testid),
    tipo: texto(c.tipo) || 'texto',
    obligatorio: c.obligatorio !== false,
    alias: [],
    restriccion: objeto(c.restriccion),
  }));
}
