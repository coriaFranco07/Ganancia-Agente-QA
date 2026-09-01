/**
 * qa-spider-acciones.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Registro de acciones ejecutables del QA Spider.
 *
 * Cada paso de un caso del catalogo nombra una accion de este registro. Agregar
 * una prueba nueva es agregar una entrada aca y referenciarla desde el JSON: no
 * se toca el runner ni se agrega una rama de `if` por nivel de agresividad.
 *
 * Contrato de una accion:
 *   async (ctx, params) => { estado, detalle?, datos? }
 *
 *   estado 'ok'       → el paso paso.
 *   estado 'hallazgo' → el paso encontro algo reportable (no aborta el caso).
 *   estado 'omitido'  → no habia nada que probar en esta ruta.
 *
 * Un throw dentro de una accion marca el caso como 'error' y corta sus pasos
 * restantes, pero nunca detiene el resto de la corrida.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aca = dirname(fileURLToPath(import.meta.url));

/** Fuente de axe-core, leida una sola vez e inyectada en cada pagina auditada. */
let fuenteAxe = null;
function leerFuenteAxe() {
  if (fuenteAxe === null) {
    fuenteAxe = readFileSync(resolve(aca, '..', '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
  }
  return fuenteAxe;
}

const SELECTOR_CAMPOS =
  'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])';

/* ── Utilidades ──────────────────────────────────────────────────────────── */

/** Elige un payload del conjunto pedido segun el tipo de campo. */
function elegirPayload(catalogo, conjunto, tipoCampo, indice) {
  const grupo = catalogo.payloads?.[conjunto] ?? {};
  const porTipo =
    grupo[tipoCampo] ??
    grupo[tipoCampo === 'tel' || tipoCampo === 'range' ? 'numero' : 'generico'] ??
    grupo.generico ??
    ['dato'];
  return String(porTipo[indice % porTipo.length]);
}

/** Normaliza el `type` del input a una de las familias de payload. */
function familiaCampo(tipo) {
  if (['number', 'range', 'tel'].includes(tipo)) return 'numero';
  if (['email'].includes(tipo)) return 'email';
  if (['date', 'datetime-local', 'month'].includes(tipo)) return 'fecha';
  return 'texto';
}

/* ── Acciones ────────────────────────────────────────────────────────────── */

/**
 * Screenshot full-page como evidencia.
 */
async function capturar(ctx, params) {
  const sufijo = params?.sufijo ? `-${params.sufijo}` : '';
  const destino = await ctx.capturar(`${ctx.etiquetaRuta}${sufijo}`);
  return { estado: 'ok', detalle: 'Captura generada', datos: { archivo: destino } };
}

/**
 * Pausa explicita. Util para dejar que Angular estabilice antes de medir.
 */
async function esperar(ctx, params) {
  const ms = Number(params?.ms ?? 500);
  await ctx.page.waitForTimeout(ms);
  return { estado: 'ok', detalle: `Espera de ${ms}ms` };
}

const IMPACTO_A_GRAVEDAD = { critical: 'alta', serious: 'alta', moderate: 'media', minor: 'media' };
const ORDEN_IMPACTO = { critical: 0, serious: 1, moderate: 2, minor: 3 };

/**
 * Corre axe-core sobre la pagina actual y reporta violaciones WCAG por impacto.
 *
 * axe-core es el motor de auditoria de accesibilidad estandar de la industria
 * (Playwright, Cypress, Lighthouse y las herramientas de accesibilidad de los
 * navegadores lo usan). Se inyecta como script plano -no depende de Playwright
 * Test- y corre contra las reglas WCAG 2.0/2.1 nivel A y AA.
 */
async function auditarAccesibilidad(ctx, params) {
  await ctx.page.addScriptTag({ content: leerFuenteAxe() });

  const resultado = await ctx.page.evaluate(() =>
    axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    }),
  );

  const impactoPedido = params?.impacto_minimo ?? ctx.catalogo.umbrales?.a11y_impacto_minimo ?? 'moderate';
  const umbralOrden = ORDEN_IMPACTO[impactoPedido] ?? ORDEN_IMPACTO.moderate;

  const todasLasViolaciones = (resultado.violations ?? []).map((v) => ({
    regla: v.id,
    impacto: v.impact ?? 'menor',
    ayuda: v.help,
    url_ayuda: v.helpUrl,
    nodos_afectados: v.nodes.length,
    ejemplos: v.nodes.slice(0, 3).map((n) => n.target?.join(' ') ?? n.html?.slice(0, 120) ?? ''),
  }));

  const reportables = todasLasViolaciones.filter((v) => (ORDEN_IMPACTO[v.impacto] ?? 99) <= umbralOrden);

  const datos = {
    ruta: ctx.ruta,
    reglas_pasadas: resultado.passes?.length ?? 0,
    violaciones_total: todasLasViolaciones.length,
    violaciones_reportables: reportables.length,
    detalle: todasLasViolaciones.slice(0, 20),
  };
  ctx.registrarA11y(datos);

  if (!reportables.length) {
    return {
      estado: 'ok',
      detalle: `Sin violaciones WCAG de impacto >= ${impactoPedido} (${todasLasViolaciones.length} de impacto menor omitidas).`,
      datos,
    };
  }

  for (const violacion of reportables.slice(0, 15)) {
    ctx.hallazgo({
      tipo: 'accesibilidad',
      gravedad: IMPACTO_A_GRAVEDAD[violacion.impacto] ?? 'media',
      detalle: `[WCAG] ${violacion.ayuda} (regla "${violacion.regla}", impacto ${violacion.impacto}, ${violacion.nodos_afectados} elemento(s)).`,
      datos: { regla: violacion.regla, url_ayuda: violacion.url_ayuda, ejemplos: violacion.ejemplos },
    });
  }

  return {
    estado: 'hallazgo',
    detalle: `${reportables.length} violacion(es) WCAG de impacto >= ${impactoPedido}`,
    datos,
  };
}

/**
 * Compara el tiempo de carga medido durante la navegacion contra el presupuesto.
 */
async function verificarCarga(ctx, params) {
  const medido = ctx.metricas?.carga_ms;
  if (medido == null) {
    return { estado: 'omitido', detalle: 'No hay metrica de carga para esta ruta' };
  }

  const presupuesto = Number(params?.presupuesto_ms ?? ctx.catalogo.umbrales?.carga_ms ?? 3000);
  if (medido > presupuesto) {
    ctx.hallazgo({
      tipo: 'rendimiento',
      gravedad: 'media',
      detalle: `La ruta tardo ${medido}ms en cargar (presupuesto ${presupuesto}ms).`,
      datos: { carga_ms: medido, presupuesto_ms: presupuesto },
    });
    return { estado: 'hallazgo', detalle: `${medido}ms > ${presupuesto}ms` };
  }

  return { estado: 'ok', detalle: `${medido}ms dentro del presupuesto` };
}

/**
 * Falla si se acumularon errores de consola o de red en el alcance pedido.
 *
 * `origen: "ruta"` mira todo lo ocurrido desde que se navego a la ruta (sirve
 * para el health-check de carga); `origen: "caso"` (por defecto) mira solo lo
 * que provoco este caso. A diferencia de la version anterior, los errores
 * quedan atribuidos a quien los genero en lugar de caer en una bolsa global.
 */
async function verificarSinErrores(ctx, params) {
  const incluirConsola = params?.incluir_consola !== false;
  const incluirRed = params?.incluir_red !== false;
  const estadoMinimo = Number(params?.solo_estado_minimo ?? 400);

  const alcance = params?.origen === 'ruta' ? ctx.erroresDeLaRuta() : ctx.erroresDelCaso();
  const consola = incluirConsola ? alcance.consola : [];
  const red = incluirRed ? alcance.red.filter((error) => error.estado >= estadoMinimo) : [];

  if (!consola.length && !red.length) {
    return { estado: 'ok', detalle: 'Sin errores de consola ni de red' };
  }

  if (consola.length) {
    ctx.hallazgo({
      tipo: 'consola',
      gravedad: 'alta',
      detalle: `${consola.length} error(es) de consola durante el caso.`,
      datos: { mensajes: consola.slice(0, 5).map((error) => error.mensaje) },
    });
  }
  if (red.length) {
    ctx.hallazgo({
      tipo: 'red',
      gravedad: red.some((error) => error.estado >= 500) ? 'alta' : 'media',
      detalle: `${red.length} respuesta(s) HTTP >= ${estadoMinimo}.`,
      datos: { respuestas: red.slice(0, 5) },
    });
  }

  return {
    estado: 'hallazgo',
    detalle: `${consola.length} error(es) JS, ${red.length} error(es) HTTP`,
    datos: { consola: consola.length, red: red.length },
  };
}

/**
 * Verifica presencia (o ausencia) de un selector.
 */
async function verificarElemento(ctx, params) {
  const selector = params?.selector;
  if (!selector) throw new Error('verificar_elemento requiere "selector"');

  const debeExistir = params?.debe_existir !== false;
  const cantidad = await ctx.page.locator(selector).count();
  const existe = cantidad > 0;

  if (existe === debeExistir) {
    return { estado: 'ok', detalle: `${cantidad} coincidencia(s) para ${selector}` };
  }

  ctx.hallazgo({
    tipo: 'ui',
    gravedad: 'alta',
    detalle: debeExistir
      ? `No se encontro ningun elemento para "${selector}".`
      : `Se encontro un elemento que no deberia estar: "${selector}".`,
    datos: { selector, cantidad },
  });
  return { estado: 'hallazgo', detalle: `Selector ${selector} en estado inesperado` };
}

/**
 * Controla que la URL actual cumpla lo esperado. Sirve para detectar que una
 * ruta protegida rebote a /login por sesion caida.
 */
async function verificarUrl(ctx, params) {
  const actual = ctx.page.url();

  if (params?.contiene && !actual.includes(params.contiene)) {
    ctx.hallazgo({
      tipo: 'navegacion',
      gravedad: 'alta',
      detalle: `La URL "${actual}" no contiene "${params.contiene}".`,
      datos: { url: actual },
    });
    return { estado: 'hallazgo', detalle: 'URL inesperada' };
  }

  if (params?.no_contiene && actual.includes(params.no_contiene)) {
    ctx.hallazgo({
      tipo: 'navegacion',
      gravedad: 'alta',
      detalle: `La URL "${actual}" contiene "${params.no_contiene}" y no deberia.`,
      datos: { url: actual },
    });
    return { estado: 'hallazgo', detalle: 'Redireccion inesperada' };
  }

  return { estado: 'ok', detalle: actual };
}

/**
 * Completa los campos visibles con el conjunto de payloads pedido.
 *
 * Optimizacion respecto de la version anterior: el filtrado de campos visibles
 * y habilitados se resuelve en UNA sola llamada al navegador en vez de tres
 * round-trips por campo (`nth()` + `isVisible()` + `isEnabled()`).
 */
async function fuzzFormularios(ctx, params) {
  const conjunto = params?.conjunto ?? 'funcional';
  const maximo = Number(params?.max_campos ?? ctx.catalogo.umbrales?.max_campos_fuzz ?? 40);
  const selector = params?.selector ?? SELECTOR_CAMPOS;

  // Un unico viaje al navegador: devuelve indice y tipo de cada campo utilizable.
  const campos = await ctx.page.$$eval(selector, (elementos) =>
    elementos
      .map((elemento, indice) => {
        const rect = elemento.getBoundingClientRect();
        const estilo = window.getComputedStyle(elemento);
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          estilo.visibility !== 'hidden' &&
          estilo.display !== 'none' &&
          estilo.opacity !== '0';
        if (!visible) return null;
        return {
          indice,
          tipo: (elemento.getAttribute('type') || elemento.tagName.toLowerCase()).toLowerCase(),
          nombre: elemento.getAttribute('name') || elemento.getAttribute('aria-label') || null,
        };
      })
      .filter(Boolean),
  );

  if (!campos.length) {
    return { estado: 'omitido', detalle: 'La ruta no tiene campos editables visibles' };
  }

  const objetivo = campos.slice(0, maximo);
  const lista = ctx.page.locator(selector);
  const completados = [];
  const fallidos = [];

  for (let i = 0; i < objetivo.length; i++) {
    const campo = objetivo[i];
    const familia = familiaCampo(campo.tipo);
    const valor = elegirPayload(ctx.catalogo, conjunto, familia, i);

    try {
      await lista.nth(campo.indice).fill(valor, { timeout: ctx.timeoutCampoMs });
      completados.push({ campo: campo.nombre ?? `#${campo.indice}`, tipo: campo.tipo, valor });
    } catch (error) {
      fallidos.push({ campo: campo.nombre ?? `#${campo.indice}`, motivo: error.message.split('\n')[0] });
    }
  }

  const omitidos = campos.length - objetivo.length;
  const detalle =
    `${completados.length}/${campos.length} campos completados con payloads "${conjunto}"` +
    (omitidos > 0 ? ` (${omitidos} fuera del tope)` : '');

  return {
    estado: 'ok',
    detalle,
    datos: { conjunto, total_campos: campos.length, completados: completados.length, fallidos },
  };
}

/**
 * Envia el formulario visible y espera a que la app reaccione.
 *
 * Con `verificar_sanitizacion: true` (lo usa SPIDER-FRM-003, despues de
 * fuzzear con la tabla "seguridad"), ademas escucha los requests salientes
 * durante el envio y chequea si alguno de esos payloads viaja tal cual, sin
 * escapar, en el body. No es una garantia de seguridad -la validacion real
 * tiene que pasar en el backend- pero indica si el frontend no aplica ningun
 * filtro antes de mandar el dato.
 */
async function enviarFormulario(ctx, params) {
  const selector = params?.selector ?? 'button[type="submit"]:not([disabled])';
  const boton = ctx.page.locator(selector).first();

  if (!(await boton.count())) {
    return { estado: 'omitido', detalle: 'La ruta no tiene boton de envio habilitado' };
  }

  const verificarSanitizacion = params?.verificar_sanitizacion === true;
  const requestsCapturadas = [];
  const onRequest = (request) => {
    const metodo = request.method();
    if (metodo === 'GET' || metodo === 'HEAD') return;
    requestsCapturadas.push({ url: request.url(), body: request.postData() ?? '' });
  };
  if (verificarSanitizacion) ctx.page.on('request', onRequest);

  try {
    await boton.click({ timeout: ctx.timeoutCampoMs }).catch((error) => {
      throw new Error(`No se pudo hacer click en el boton de envio: ${error.message.split('\n')[0]}`);
    });
    await ctx.page.waitForTimeout(Number(params?.espera_ms ?? 1500));
  } finally {
    if (verificarSanitizacion) ctx.page.off('request', onRequest);
  }

  if (!verificarSanitizacion) {
    return { estado: 'ok', detalle: 'Formulario enviado' };
  }

  const payloadsPeligrosos = recolectarPayloadsDeSeguridad(ctx.catalogo);
  const encontrados = new Map();
  for (const { url, body } of requestsCapturadas) {
    if (!body) continue;
    for (const payload of payloadsPeligrosos) {
      if (body.includes(payload) && !encontrados.has(payload)) {
        encontrados.set(payload, { payload, url });
      }
    }
  }

  if (encontrados.size) {
    const muestra = [...encontrados.values()].slice(0, 5);
    ctx.hallazgo({
      tipo: 'seguridad',
      gravedad: 'media',
      detalle:
        `${encontrados.size} payload(s) de seguridad llegaron sin escapar al backend en el envio ` +
        `(el frontend no los filtra antes de mandarlos; la validacion real debe existir del lado del servidor).`,
      datos: { encontrados: muestra },
    });
    return {
      estado: 'hallazgo',
      detalle: `${encontrados.size} payload(s) sin sanear en el request de envio`,
      datos: { encontrados: muestra },
    };
  }

  return { estado: 'ok', detalle: 'Formulario enviado; ningun payload de seguridad viajo sin escapar al backend' };
}

/** Junta en una sola lista todos los strings de la tabla "seguridad" del catalogo. */
function recolectarPayloadsDeSeguridad(catalogo) {
  const tabla = catalogo?.payloads?.seguridad ?? {};
  const vistos = new Set();
  for (const lista of Object.values(tabla)) {
    for (const valor of lista ?? []) {
      if (typeof valor === 'string' && valor.trim().length >= 3) vistos.add(valor);
    }
  }
  return [...vistos];
}

/**
 * Click sobre un selector puntual.
 */
async function clickElemento(ctx, params) {
  const selector = params?.selector;
  if (!selector) throw new Error('click_elemento requiere "selector"');

  const elemento = ctx.page.locator(selector).first();
  if (!(await elemento.count())) {
    return { estado: 'omitido', detalle: `No existe ${selector} en esta ruta` };
  }

  await elemento.click({ timeout: ctx.timeoutCampoMs });
  if (params?.espera_ms) await ctx.page.waitForTimeout(Number(params.espera_ms));
  return { estado: 'ok', detalle: `Click en ${selector}` };
}

/**
 * Ejecuta codigo Playwright de una semilla guardada.
 *
 * Se mantiene por compatibilidad con las semillas ya creadas desde la UI. El
 * codigo se evalua en el proceso del runner, asi que solo corre para casos
 * elegidos explicitamente y puede deshabilitarse con QA_SPIDER_PERMITIR_SCRIPT=false.
 */
/**
 * Ejecuta el codigo linea por linea en vez de como un unico bloque atomico.
 *
 * Motivo: una linea puede quedar bloqueada por una validacion legitima de la
 * app (ej. un numero negativo en "extrema" deja un boton de guardar
 * deshabilitado). Con un solo bloque, esa linea revienta TODO el resto del
 * script — incluidos pasos que no dependian de ella. Corriendo linea por
 * linea, esa unica linea se reporta como hallazgo puntual y las siguientes
 * se siguen intentando, en vez de perder toda la evidencia de lo que venia
 * despues.
 *
 * Requiere que cada linea sea una sentencia autocontenida
 * (`await page.metodo(...).metodo(...);`), que es exactamente el patron que
 * produce Codegen y el generador de casos desde spec. Un script que declara
 * variables compartidas entre lineas (`const boton = ...; await boton.click();`)
 * no es compatible con este modo: cada linea se ejecuta en su propio scope.
 */
async function script(ctx, params) {
  if (!ctx.permitirScript) {
    return { estado: 'omitido', detalle: 'Ejecucion de semillas de codigo deshabilitada' };
  }

  const codigo = params?.codigo;
  if (typeof codigo !== 'string' || !codigo.trim()) {
    return { estado: 'omitido', detalle: 'La semilla no trae codigo' };
  }

  // Acepta tanto un test completo `test('x', async ({ page }) => { ... })`
  // como el cuerpo suelto de la funcion.
  const envoltorio = codigo.match(/async\s*\(\s*\{\s*page[^}]*\}\s*\)\s*=>\s*\{([\s\S]*)\}\s*\)\s*;?\s*$/);
  const cuerpo = envoltorio ? envoltorio[1] : codigo;
  const lineas = cuerpo
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0);

  if (!lineas.length) {
    return { estado: 'omitido', detalle: 'El script no tiene lineas para ejecutar' };
  }

  // En la categoria "seguridad" el script suele completar campos con payloads
  // de inyeccion y despues confirmar/enviar: se escucha la red durante toda la
  // corrida para chequear si alguno de esos payloads viaja sin escapar al backend.
  // Se mira la categoria propia del caso, no ctx.nivel: en una ejecucion
  // individual (boton "Ejecutar" de la lista) ctx.nivel vale siempre 'manual',
  // sin importar que categoria declaro el caso.
  const verificarSanitizacion = ctx.caso?.niveles?.includes('seguridad') ?? false;
  const requestsCapturadas = [];
  const onRequest = (request) => {
    const metodo = request.method();
    if (metodo === 'GET' || metodo === 'HEAD') return;
    requestsCapturadas.push(request.postData() ?? '');
  };
  if (verificarSanitizacion) ctx.page.on('request', onRequest);

  const FuncionAsincronica = Object.getPrototypeOf(async function () {}).constructor;
  const timeoutMs = ctx.timeoutLineaScriptMs ?? 8000;
  const fallos = [];
  let exitos = 0;

  try {
    for (const linea of lineas) {
      try {
        const ejecutable = new FuncionAsincronica('page', 'expect', linea);
        await Promise.race([
          ejecutable(ctx.page, ctx.expect),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`No respondio en ${timeoutMs}ms`)), timeoutMs),
          ),
        ]);
        exitos++;
      } catch (error) {
        const motivo = error.message.split('\n')[0];
        fallos.push({ linea, motivo });
        ctx.hallazgo({
          tipo: 'script',
          gravedad: 'media',
          detalle: `La linea no se pudo ejecutar: ${motivo}`,
          datos: { linea },
        });
      }
    }
  } finally {
    if (verificarSanitizacion) ctx.page.off('request', onRequest);
  }

  if (exitos === 0) {
    throw new Error(`Ninguna de las ${lineas.length} lineas del script pudo ejecutarse. Primer error: ${fallos[0]?.motivo}`);
  }

  let sinSanear = 0;
  if (verificarSanitizacion) {
    const payloadsPeligrosos = recolectarPayloadsDeSeguridad(ctx.catalogo);
    const encontrados = new Set();
    for (const body of requestsCapturadas) {
      if (!body) continue;
      for (const payload of payloadsPeligrosos) {
        if (body.includes(payload)) encontrados.add(payload);
      }
    }
    sinSanear = encontrados.size;
    if (sinSanear) {
      ctx.hallazgo({
        tipo: 'seguridad',
        gravedad: 'media',
        detalle:
          `${sinSanear} payload(s) de seguridad llegaron sin escapar al backend durante el script ` +
          `(el frontend no los filtra antes de mandarlos; la validacion real debe existir del lado del servidor).`,
        datos: { encontrados: [...encontrados].slice(0, 5) },
      });
    }
  }

  if (fallos.length || sinSanear) {
    return {
      estado: 'hallazgo',
      detalle:
        `${exitos}/${lineas.length} lineas ejecutadas.` +
        (fallos.length ? ` ${fallos.length} se saltearon.` : '') +
        (sinSanear ? ` ${sinSanear} payload(s) sin sanear.` : ''),
      datos: { fallos },
    };
  }

  return { estado: 'ok', detalle: `Las ${lineas.length} lineas del script se ejecutaron.` };
}

/* ── Registro ────────────────────────────────────────────────────────────── */

export const ACCIONES = {
  capturar,
  esperar,
  auditar_accesibilidad: auditarAccesibilidad,
  verificar_carga: verificarCarga,
  verificar_sin_errores: verificarSinErrores,
  verificar_elemento: verificarElemento,
  verificar_url: verificarUrl,
  fuzz_formularios: fuzzFormularios,
  enviar_formulario: enviarFormulario,
  click_elemento: clickElemento,
  script,
};

export function obtenerAccion(nombre) {
  const accion = ACCIONES[nombre];
  if (!accion) throw new Error(`Accion no registrada: ${nombre}`);
  return accion;
}
