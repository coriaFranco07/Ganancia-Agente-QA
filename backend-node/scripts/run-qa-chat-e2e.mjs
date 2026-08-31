import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import mongoose from 'mongoose';

const backendRoot = process.cwd();
const repoRoot = resolve(backendRoot, '..');
const apiUrl = (process.env.AUDITORIA_API_URL ?? 'http://localhost:8001/api').replace(/\/$/, '');
const mongodbUri = process.env.MONGODB_URI ?? process.env.AUDITORIA_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/auditoria_ganancias';
const correo = process.env.AUDITORIA_QA_CORREO ?? 'qa-local@auditoria.test';
const contrasena = process.env.AUDITORIA_QA_PASSWORD ?? 'qa-local-123456';
const casoIdFiltro = process.env.AUDITORIA_QA_CASE;
const ejecutarPlan = process.env.AUDITORIA_QA_CHAT_E2E_RUN === 'true';
const conservarPlan = process.env.AUDITORIA_QA_CHAT_E2E_KEEP === 'true' || ejecutarPlan;
const requestTimeoutMs = Number(process.env.AUDITORIA_QA_CHAT_E2E_TIMEOUT_MS ?? 90000);
const outputDir = resolve(repoRoot, process.env.AUDITORIA_QA_OUTPUT_DIR ?? 'outputs/playwright/qa-chat-e2e');
const evidenciaPath = join(outputDir, 'qa-chat-e2e-evidence.json');
const cookies = new Map();
const checks = [];
const planesCreados = [];

let evidencia = {
  estado: 'corriendo',
  sistema: 'auditoria-ganancias',
  api_url: apiUrl,
  mongodb_uri: ocultarMongo(mongodbUri),
  caso_filtro: casoIdFiltro ?? null,
  ejecuta_plan: ejecutarPlan,
  conserva_plan: conservarPlan,
  request_timeout_ms: requestTimeoutMs,
  checks,
  planes_creados: planesCreados,
  fecha: new Date().toISOString(),
};

try {
  await mkdir(outputDir, { recursive: true });
  await conectarMongo();
  await asegurarUsuario();

  const salud = await requestJson(`${apiUrl}/salud`, { etiqueta: 'salud' });
  check('backend saludable', salud.data?.estado === 'ok', salud.data);

  const version = await requestJson(`${apiUrl}/version`, { etiqueta: 'version' });
  check('version compatible', version.data?.tipo_analisis === 'ANALISIS_BASICO', version.data);

  const login = await requestJson(`${apiUrl}/auth/login`, {
    metodo: 'POST',
    body: { correo, contrasena },
    etiqueta: 'login',
    estadosOk: [200, 201],
  });
  check('login tecnico QA', login.data?.usuario?.correo === correo, login.data?.usuario);

  const contexto = await requestJson(`${apiUrl}/qa/asistente/contexto`, { etiqueta: 'contexto' });
  const casos = Array.isArray(contexto.data?.casos) ? contexto.data.casos : [];
  check('contexto con casos activos', casos.length > 0, { casos: casos.length });
  check('politica de registro visible', Boolean(contexto.data?.politica_registro), contexto.data?.politica_registro);

  const resumen = await requestJson(`${apiUrl}/qa/asistente/mensajes`, {
    metodo: 'POST',
    body: { mensaje: 'Mostrame el resumen de casos QA activos.' },
    etiqueta: 'chat resumen',
    estadosOk: [200, 201],
  });
  check('chat responde resumen general', resumen.data?.tipo === 'resumen', { tipo: resumen.data?.tipo });

  const hallazgos = await requestJson(`${apiUrl}/qa/hallazgos`, {
    etiqueta: 'catalogo hallazgos',
    estadosOk: [200],
  });
  check('catalogo de hallazgos publicado por API', Array.isArray(hallazgos.data), {
    cantidad: Array.isArray(hallazgos.data) ? hallazgos.data.length : null,
  });

  const { caso, plan } = await crearPlanEjecutable(casos);
  planesCreados.push(plan.id);
  evidencia.caso = {
    id: caso.id,
    dataset_codigo: caso.dataset_codigo,
    periodo: caso.periodo,
    ultima_ejecucion: caso.ultima_ejecucion?.estado ?? null,
  };
  evidencia.plan_id = plan.id;

  const diagnostico = await requestJson(`${apiUrl}/qa/asistente/mensajes`, {
    metodo: 'POST',
    body: { mensaje: `Por que fallo ${caso.id}`, caso_id: caso.id },
    etiqueta: 'chat diagnostico',
    estadosOk: [200, 201],
  });
  check('chat diagnostica caso elegido', diagnostico.data?.tipo === 'diagnostico', {
    tipo: diagnostico.data?.tipo,
    caso_id: diagnostico.data?.caso_id,
  });

  const correccion = await requestJson(`${apiUrl}/qa/asistente/mensajes`, {
    metodo: 'POST',
    body: { mensaje: `Como corregir ${caso.id}`, caso_id: caso.id },
    etiqueta: 'chat correccion asistida',
    estadosOk: [200, 201],
  });
  check('chat genera correccion asistida', correccion.data?.tipo === 'correccion' && Boolean(correccion.data?.correccion?.accion_recomendada), {
    tipo: correccion.data?.tipo,
    proveedor: correccion.data?.correccion?.proveedor,
    estado: correccion.data?.correccion?.estado,
  });
  check('correccion incluye ticket y prueba de regresion', Boolean(correccion.data?.correccion?.ticket_sugerido?.asunto)
    && Boolean(correccion.data?.correccion?.prueba_regresion?.comando), {
    ticket: correccion.data?.correccion?.ticket_sugerido?.asunto,
    regresion: correccion.data?.correccion?.prueba_regresion?.comando,
  });

  check('plan queda propuesto', plan.estado === 'plan_propuesto', { estado: plan.estado });
  check('plan sin parametros pendientes', cantidad(plan.parametros_pendientes) === 0, plan.parametros_pendientes);
  check('plan muestra parametros resueltos', cantidad(plan.plan?.parametros_resueltos) > 0, { cantidad: cantidad(plan.plan?.parametros_resueltos) });
  check('plan muestra precondiciones', cantidad(plan.plan?.precondiciones) > 0, { cantidad: cantidad(plan.plan?.precondiciones) });
  check('plan muestra pasos', cantidad(plan.plan?.pasos) > 0, { cantidad: cantidad(plan.plan?.pasos) });
  check('plan tiene hash y vencimiento', Boolean(plan.hash_plan) && Boolean(plan.vence_en), { hash: recortar(plan.hash_plan), vence_en: plan.vence_en });
  check('plan registra actor humano', plan.actor?.correo === correo && plan.actor?.usuario_id !== 'agente', plan.actor);
  check('plan registra ejecutor agente separado', plan.ejecutor?.tipo === 'agente' && plan.ejecutor?.nombre === 'Asistente QA', plan.ejecutor);
  check('plan registra versiones', Boolean(plan.versiones?.definicion?.codigo) && Boolean(plan.versiones?.script), plan.versiones);
  check('plan guarda texto mostrado', typeof plan.texto_mostrado === 'string' && plan.texto_mostrado.includes('Parámetros resueltos'), {
    longitud: plan.texto_mostrado?.length,
  });

  const bloqueo = await requestJson(`${apiUrl}/qa/asistente/planes/${encodeURIComponent(plan.id)}/ejecutar`, {
    metodo: 'POST',
    body: {},
    etiqueta: 'bloqueo sin aprobacion',
    estadosOk: [409],
  });
  check('ejecucion sin aprobacion bloqueada', bloqueo.status === 409, bloqueo.data);

  const aprobado = await requestJson(`${apiUrl}/qa/asistente/planes/${encodeURIComponent(plan.id)}/aprobar`, {
    metodo: 'POST',
    body: { hash_plan: plan.hash_plan },
    etiqueta: 'aprobar plan',
    estadosOk: [200, 201],
  });
  check('plan aprobado con hash', aprobado.data?.estado === 'aprobado' && aprobado.data?.aprobacion?.hash_plan === plan.hash_plan, {
    estado: aprobado.data?.estado,
    aprobacion: aprobado.data?.aprobacion,
  });

  let planFinal = aprobado.data;
  if (ejecutarPlan) {
    const ejecucion = await requestJson(`${apiUrl}/qa/asistente/planes/${encodeURIComponent(plan.id)}/ejecutar`, {
      metodo: 'POST',
      body: {},
      etiqueta: 'ejecutar plan aprobado',
      estadosOk: [200, 201],
    });
    check('ejecucion iniciada desde plan aprobado', ejecucion.data?.estado === 'ejecutando' && Boolean(ejecucion.data?.ejecucion_id), {
      estado: ejecucion.data?.estado,
      ejecucion_id: ejecucion.data?.ejecucion_id,
    });
    planFinal = await esperarPlanFinal(plan.id);
    check('plan ejecutado llega a estado final', ['verificado', 'fallido', 'abortado', 'vencido'].includes(planFinal.estado), {
      estado: planFinal.estado,
      verificacion: planFinal.verificacion,
    });
  } else {
    const leido = await requestJson(`${apiUrl}/qa/asistente/planes/${encodeURIComponent(plan.id)}`, { etiqueta: 'leer plan aprobado' });
    planFinal = leido.data;
    check('plan aprobado se puede releer', planFinal.estado === 'aprobado', { estado: planFinal.estado });
  }

  const recoleccion = await requestJson(`${apiUrl}/qa/asistente/mensajes`, {
    metodo: 'POST',
    body: { mensaje: 'Necesito ejecutar un caso QA en demo, pero todavía no elegí el caso.' },
    etiqueta: 'chat recoleccion sin caso',
    estadosOk: [200, 201],
  });
  if (recoleccion.data?.plan?.id) planesCreados.push(recoleccion.data.plan.id);
  check('chat inicia recoleccion de parametros', recoleccion.data?.tipo === 'recoleccion' && recoleccion.data?.plan?.estado === 'recolectando', {
    tipo: recoleccion.data?.tipo,
    estado: recoleccion.data?.plan?.estado,
  });
  check('recoleccion lista parametros pendientes', cantidad(recoleccion.data?.plan?.parametros_pendientes) > 0, recoleccion.data?.plan?.parametros_pendientes);

  const planDesdeRecoleccion = await requestJson(`${apiUrl}/qa/asistente/mensajes`, {
    metodo: 'POST',
    body: { mensaje: caso.id },
    etiqueta: 'chat completa recoleccion con caso',
    estadosOk: [200, 201],
  });
  if (planDesdeRecoleccion.data?.plan?.id && !planesCreados.includes(planDesdeRecoleccion.data.plan.id)) {
    planesCreados.push(planDesdeRecoleccion.data.plan.id);
  }
  check('chat convierte recoleccion en plan propuesto', planDesdeRecoleccion.data?.tipo === 'plan' && planDesdeRecoleccion.data?.plan?.estado === 'plan_propuesto', {
    tipo: planDesdeRecoleccion.data?.tipo,
    estado: planDesdeRecoleccion.data?.plan?.estado,
  });
  check('plan desde recoleccion no tiene pendientes', cantidad(planDesdeRecoleccion.data?.plan?.parametros_pendientes) === 0, planDesdeRecoleccion.data?.plan?.parametros_pendientes);
  check('plan desde recoleccion muestra origen respondido', cantidad(planDesdeRecoleccion.data?.plan?.plan?.parametros_resueltos) > 0
    && JSON.stringify(planDesdeRecoleccion.data?.plan?.plan?.parametros_resueltos).includes('respondido'), {
    parametros_resueltos: planDesdeRecoleccion.data?.plan?.plan?.parametros_resueltos,
  });

  evidencia.estado = 'verde';
  evidencia.plan_final = resumenPlan(planFinal);
  await limpiarPlanesDePrueba();
  await guardarEvidencia();

  console.log('');
  console.log('QA Chat E2E Auditoria Ganancias: verde');
  console.log('');
  console.log(`- caso=${caso.id}`);
  console.log(`- plan=${plan.id}`);
  console.log(`- checks=${checks.length}`);
  console.log(`- evidencia=${evidenciaPath}`);
} catch (error) {
  evidencia.estado = 'rojo';
  evidencia.error = detalleError(error);
  await guardarEvidencia().catch(() => undefined);
  console.error('');
  console.error('QA Chat E2E Auditoria Ganancias: rojo');
  console.error('');
  console.error(`- error=${detalleError(error)}`);
  console.error(`- evidencia=${evidenciaPath}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => undefined);
}

async function crearPlanEjecutable(casos) {
  const candidatos = casoIdFiltro
    ? casos.filter((caso) => caso.id === casoIdFiltro)
    : casos.filter((caso) => caso.ultima_ejecucion?.estado !== 'corriendo');

  if (!candidatos.length) {
    throw new Error(casoIdFiltro
      ? `No encontré el caso activo ${casoIdFiltro}.`
      : 'No hay casos disponibles para proponer un plan.');
  }

  const errores = [];
  for (const caso of candidatos) {
    const respuesta = await requestJson(`${apiUrl}/qa/asistente/planes`, {
      metodo: 'POST',
      body: {
        caso_id: caso.id,
        modo: 'rapido',
        pedido: `E2E chat QA: ejecutar Start para ${caso.id}`,
      },
      etiqueta: `crear plan ${caso.id}`,
      estadosOk: [200, 201, 400, 404, 409],
    });

    if ([200, 201].includes(respuesta.status)) return { caso, plan: respuesta.data };
    errores.push(`${caso.id}: HTTP ${respuesta.status} ${JSON.stringify(respuesta.data)}`);
  }

  throw new Error(`No pude crear un plan con los casos disponibles. ${errores.join(' | ')}`);
}

async function esperarPlanFinal(planId) {
  const finales = new Set(['verificado', 'fallido', 'abortado', 'vencido']);
  let ultimo;
  for (let intento = 0; intento < 36; intento += 1) {
    await dormir(5000);
    const respuesta = await requestJson(`${apiUrl}/qa/asistente/planes/${encodeURIComponent(planId)}`, { etiqueta: `poll plan ${planId}` });
    ultimo = respuesta.data;
    if (finales.has(ultimo?.estado)) return ultimo;
  }
  throw new Error(`El plan ${planId} no terminó dentro del tiempo esperado. Último estado: ${ultimo?.estado ?? 'desconocido'}.`);
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

async function limpiarPlanesDePrueba() {
  if (conservarPlan || planesCreados.length === 0) return;
  await mongoose.connection.collection('qa_planes_asistente').deleteMany({
    id: { $in: planesCreados },
    estado: { $in: ['recolectando', 'plan_propuesto', 'aprobado', 'vencido', 'abortado'] },
  });
  evidencia.planes_limpiados = planesCreados;
}

async function requestJson(url, opciones = {}) {
  const metodo = opciones.metodo ?? 'GET';
  const estadosOk = opciones.estadosOk ?? [200];
  const headers = { Accept: 'application/json' };
  const cookie = cookieHeader();
  if (cookie) headers.Cookie = cookie;
  if (opciones.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetchConTimeout(url, {
    method: metodo,
    headers,
    body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
  });
  guardarCookies(response.headers.get('set-cookie'));

  const text = await response.text();
  const data = text ? parseJson(text) : null;
  if (!estadosOk.includes(response.status)) {
    throw new Error(`${opciones.etiqueta ?? metodo} falló: HTTP ${response.status} ${text}`);
  }
  return { status: response.status, data };
}

async function fetchConTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function guardarCookies(setCookie) {
  if (!setCookie) return;
  const partes = setCookie.split(/,(?=\s*[^;=]+=[^;]+)/);
  for (const parte of partes) {
    const [cookie] = parte.trim().split(';');
    const separador = cookie.indexOf('=');
    if (separador <= 0) continue;
    cookies.set(cookie.slice(0, separador), cookie.slice(separador + 1));
  }
}

function cookieHeader() {
  return Array.from(cookies.entries()).map(([nombre, valor]) => `${nombre}=${valor}`).join('; ');
}

function check(nombre, condicion, detalle) {
  assert.ok(condicion, nombre);
  checks.push({ nombre, estado: 'ok', detalle });
  console.log(`OK ${nombre}`);
}

async function guardarEvidencia() {
  evidencia.fecha_fin = new Date().toISOString();
  await writeFile(evidenciaPath, `${JSON.stringify(evidencia, null, 2)}\n`, 'utf8');
}

function crearPasswordHash(valor) {
  const iteraciones = 210_000;
  const salt = randomBytes(16).toString('base64url');
  const hash = pbkdf2Sync(valor, salt, iteraciones, 32, 'sha256').toString('base64url');
  return `pbkdf2$${iteraciones}$${salt}$${hash}`;
}

function cantidad(valor) {
  return Array.isArray(valor) ? valor.length : 0;
}

function resumenPlan(plan) {
  return {
    id: plan?.id,
    caso_id: plan?.caso_id,
    estado: plan?.estado,
    hash_plan: recortar(plan?.hash_plan),
    aprobacion: plan?.aprobacion ?? null,
    ejecucion_id: plan?.ejecucion_id ?? null,
    verificacion: plan?.verificacion ?? null,
  };
}

function recortar(valor) {
  return typeof valor === 'string' ? valor.slice(0, 12) : valor;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detalleError(error) {
  return error instanceof Error ? error.message : String(error);
}

function ocultarMongo(uri) {
  return uri.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:***@');
}
