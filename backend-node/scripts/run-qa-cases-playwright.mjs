import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
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
const casoId = process.env.AUDITORIA_QA_CASE;
const excelDir = resolve(process.env.AUDITORIA_QA_EXCEL_DIR ?? carpetaDownloads());
const excelPathDirecto = process.env.AUDITORIA_QA_EXCEL_PATH ? resolve(process.env.AUDITORIA_QA_EXCEL_PATH) : null;
const outputDir = resolve(repoRoot, process.env.AUDITORIA_QA_OUTPUT_DIR ?? 'outputs/playwright/qa-casos');
const timeoutMs = Number(process.env.AUDITORIA_PLAYWRIGHT_TIMEOUT_MS ?? 120_000);
const modoDemo = process.argv.includes('--demo') || process.env.AUDITORIA_PLAYWRIGHT_DEMO === 'true';
const modoMuyLento = process.argv.includes('--muy-lento') || process.env.AUDITORIA_PLAYWRIGHT_MUY_LENTO === 'true';
const forzarChrome = process.argv.includes('--chrome') || process.env.PLAYWRIGHT_BROWSER === 'chrome';
const headless = modoDemo ? false : process.env.PLAYWRIGHT_HEADLESS !== 'false';
const slowMoMs = Number(process.env.PLAYWRIGHT_SLOWMO_MS ?? (modoMuyLento ? 2600 : modoDemo ? 1800 : headless ? 0 : 100));
const demoPauseMs = Number(process.env.PLAYWRIGHT_DEMO_PAUSE_MS ?? (modoMuyLento ? 1800 : modoDemo ? 900 : 0));
const demoFinalPauseMs = Number(process.env.PLAYWRIGHT_DEMO_FINAL_PAUSE_MS ?? (modoMuyLento ? 25000 : modoDemo ? 15000 : 0));
const cargarFormularioQa = modoDemo || process.env.AUDITORIA_QA_CARGAR_FORM === 'true';

const capturas = [];
let browser;
let page;

try {
  await mkdir(outputDir, { recursive: true });
  await verificarServicios();
  await conectarMongo();
  await asegurarUsuario();
  const casos = await cargarCasos();

  const executablePath = detectarNavegador({ forzarChrome });
  browser = await chromium.launch({
    headless,
    ...(executablePath ? { executablePath } : {}),
    slowMo: slowMoMs,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'es-AR',
    acceptDownloads: true,
  });
  page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  await iniciarSesion();

  const resultados = [];
  for (const caso of casos) {
    resultados.push(await ejecutarCaso(caso));
  }

  const estado = resultados.every((resultado) => resultado.estado === 'verde') ? 'verde' : 'rojo';
  const evidenciaPath = join(outputDir, 'qa-casos-evidence.json');
  await writeFile(evidenciaPath, `${JSON.stringify({
    estado,
    sistema: 'auditoria-ganancias',
    frontend_url: frontendUrl,
    api_url: apiUrl,
    mongodb_uri: ocultarMongo(mongodbUri),
    excel_dir: excelDir,
    caso_filtro: casoId ?? null,
    modo_demo: modoDemo,
    carga_formulario_qa: cargarFormularioQa,
    slow_mo_ms: slowMoMs,
    resultados,
    capturas,
    fecha: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(`QA Playwright Auditoria Ganancias: ${estado}`);
  console.log(`- casos=${resultados.length}`);
  console.log(`- evidencia=${evidenciaPath}`);
  for (const resultado of resultados) {
    console.log(`- ${resultado.estado.toUpperCase()} ${resultado.caso}: ${resultado.detalle}`);
  }

  if (estado !== 'verde') process.exitCode = 1;
} catch (error) {
  if (page) await tomarCaptura('99-error').catch(() => undefined);
  console.error('');
  console.error('QA Playwright Auditoria Ganancias: rojo');
  console.error(`- ${detalleError(error)}`);
  console.error(`- Backend esperado: ${apiUrl}`);
  console.error(`- Frontend esperado: ${frontendUrl}`);
  console.error(`- Carpeta Excel esperada: ${excelDir}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
}

async function ejecutarCaso(caso) {
  const casoSeguro = nombreSeguro(caso.id);
  try {
    const excelPath = resolverExcel(caso);
    if (cargarFormularioQa) {
      await cargarCasoQaPorUi(caso, excelPath, casoSeguro);
    }
    await cargarExcelPorUi(caso, excelPath, casoSeguro);
    const snapshotId = extraerSnapshotId(page.url());
    const analisis = await leerAnalisis(snapshotId);
    const verificaciones = validarAssertions(caso, analisis);
    await mostrarResultadoDemo({
      estado: 'verde',
      caso,
      detalle: `${verificaciones.length} assertion(s) OK`,
      verificaciones,
    });
    await tomarCaptura(`${casoSeguro}-resultado`);
    await pausaFinalDemo();

    return {
      estado: 'verde',
      caso: caso.id,
      snapshot_id: snapshotId,
      archivo: basename(excelPath),
      assertions: verificaciones,
      detalle: `${verificaciones.length} assertion(s) OK`,
    };
  } catch (error) {
    await mostrarResultadoDemo({
      estado: 'rojo',
      caso,
      detalle: detalleError(error),
      verificaciones: [],
    }).catch(() => undefined);
    await tomarCaptura(`${casoSeguro}-error`).catch(() => undefined);
    await pausaFinalDemo().catch(() => undefined);
    return {
      estado: 'rojo',
      caso: caso.id,
      detalle: detalleError(error),
    };
  }
}

async function cargarCasoQaPorUi(caso, excelPath, casoSeguro) {
  await page.goto(`${frontendUrl}/qa/pantalla-1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /QA - Pantalla 1/i }).waitFor({ state: 'visible' });
  await pausaDemo();

  await page.getByRole('button', { name: /Nuevo limpio/i }).click();
  await pausaDemo();

  await completarFormularioQa(caso);
  await page.locator('input[type="file"]').setInputFiles(excelPath);
  await page.getByText(basename(excelPath)).first().waitFor({ state: 'visible' });
  await tomarCaptura(`${casoSeguro}-qa-form`);
  await pausaDemo();

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/qa/casos') && r.request().method() === 'POST', {
      timeout: 45_000,
    }),
    page.getByRole('button', { name: /Guardar caso/i }).click(),
  ]);
  if (!response.ok()) {
    throw new Error(`Guardado del caso QA falló ${response.status()}: ${await response.text()}`);
  }

  await page.getByText('Caso guardado en MongoDB para Playwright.').waitFor({ state: 'visible' });
  await tomarCaptura(`${casoSeguro}-qa-form-guardado`);
  await pausaDemo();
}

async function completarFormularioQa(caso) {
  const contexto = objeto(caso.contexto);
  const contextoComplementario = objeto(contexto.contexto_complementario);
  const datosCliente = objeto(contextoComplementario.datos_cliente);
  const empleado = objeto(contexto.empleado);
  const liquidacion = objeto(contexto.liquidacion);
  const resultado = objeto(caso.resultado_esperado);
  const assertionPrincipal = Array.isArray(caso.assertions) ? objeto(caso.assertions[0]) : {};
  const campoResultado = texto(resultado.campo) || texto(assertionPrincipal.campo) || 'calculo.retencion_excel';
  const valorEsperado = resultado.valor ?? resultado.retencion_ganancias ?? assertionPrincipal.esperado ?? '';
  const tolerancia = resultado.tolerancia ?? assertionPrincipal.tolerancia ?? 0.05;

  await llenarInput('idCaso', caso.id);
  await llenarInput('datasetCodigo', caso.dataset_codigo);
  await llenarInput('periodo', caso.periodo);
  await llenarInput('clienteNombre', datosCliente.cliente_nombre);
  await elegirSelect('modoSaldoFavor', datosCliente.modo_saldo_favor);
  await llenarInput('descripcion', caso.descripcion);
  await llenarInput('legajo', empleado.legajo);
  await llenarInput('empleadoNombre', empleado.nombre);
  await llenarInput('cuil', empleado.cuil);
  await llenarInput('remuneracionBruta', liquidacion.remuneracion_bruta);
  await llenarInput('deducciones', liquidacion.deducciones);
  await elegirSelect('estadoEsperado', resultado.estado ?? 'validado', etiquetaEstado(resultado.estado));
  await elegirSelect('campoResultado', campoResultado, etiquetaCampoResultado(campoResultado));
  await llenarInput('valorEsperado', valorEsperado);
  await llenarInput('tolerancia', tolerancia);
}

async function verificarServicios() {
  const salud = await requestJson(`${apiUrl}/salud`, 'Backend Auditoria no responde');
  assert.equal(salud.estado, 'ok');
  const version = await requestJson(`${apiUrl}/version`, 'Version Auditoria no responde');
  assert.equal(version.tipo_analisis, 'ANALISIS_BASICO');
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

async function cargarCasos() {
  const filtro = casoId ? { id: casoId, activo: { $ne: false } } : { activo: { $ne: false } };
  const docs = await mongoose.connection.collection('qa_casos').find(filtro).sort({ updatedAt: -1 }).toArray();
  if (docs.length === 0) {
    throw new Error(casoId
      ? `No hay caso QA activo con id ${casoId}.`
      : 'No hay casos QA activos. Cargá uno desde QA > Pantalla 1.');
  }
  return docs.map(normalizarCasoMongo);
}

async function iniciarSesion() {
  await page.goto(`${frontendUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[aria-label="Correo electrónico"]').fill(correo);
  await page.locator('input[aria-label="Contraseña"]').fill(contrasena);
  await tomarCaptura('00-login');

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST'),
    page.locator('button[type="submit"]').click(),
  ]);
  if (!response.ok()) {
    throw new Error(`Login UI falló ${response.status()}: ${await response.text()}`);
  }
  await page.waitForURL(/\/inicio(?:$|[?#])/, { timeout: 30_000 });
}

async function cargarExcelPorUi(caso, excelPath, casoSeguro) {
  await page.goto(`${frontendUrl}/cargar-excel`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Iniciar Auditoría').first().waitFor({ state: 'visible' });
  await page.locator('input[type="file"]').setInputFiles(excelPath);
  await page.getByText(basename(excelPath)).first().waitFor({ state: 'visible' });
  await completarContextoCarga(caso);
  await tomarCaptura(`${casoSeguro}-excel`);

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/analisis/excel') && r.request().method() === 'POST', {
      timeout: 150_000,
    }),
    page.locator('button.ejecutar-btn').click(),
  ]);
  if (!response.ok()) {
    throw new Error(`Carga Excel falló ${response.status()}: ${await response.text()}`);
  }
  await page.waitForURL(/\/analisis\/[a-f0-9]{24}(?:$|[?#])/, { timeout: 150_000 });
  await page.getByText('Resultado del Análisis').first().waitFor({ state: 'visible' });
}

async function completarContextoCarga(caso) {
  const contexto = caso.contexto?.contexto_complementario ?? {};
  const datosCliente = objeto(contexto.datos_cliente);
  const datosLegajo = objeto(contexto.datos_legajo);
  const datosContexto = objeto(contexto.datos_contexto);
  const periodo = parsearPeriodo(caso.periodo);

  const cliente = texto(datosCliente.cliente_nombre);
  const legajo = texto(datosLegajo.legajo_numero) || texto(caso.contexto?.empleado?.legajo);
  const periodoFiscal = numero(datosContexto.periodo_fiscal) ?? periodo.anio;
  const mesLiquidacion = numero(datosContexto.mes_liquidacion) ?? periodo.mes;

  if (cliente) await page.locator('input[aria-label="Cliente"]').fill(cliente);
  if (legajo) await page.locator('input[aria-label="Legajo"]').fill(legajo);
  if (periodoFiscal) await page.locator('input[aria-label="Período fiscal"]').fill(String(periodoFiscal));
  if (mesLiquidacion) {
    await page.locator('select[aria-label="Mes de liquidación"]').selectOption({ label: nombreMes(mesLiquidacion) });
  }
}

async function leerAnalisis(snapshotId) {
  const doc = await mongoose.connection.collection('analisis_snapshots').findOne({
    _id: new mongoose.Types.ObjectId(snapshotId),
  });
  if (!doc) throw new Error(`Snapshot ${snapshotId} no encontrado en MongoDB.`);
  return doc.snapshot_original ?? doc;
}

function validarAssertions(caso, analisis) {
  const assertions = Array.isArray(caso.assertions) && caso.assertions.length > 0
    ? caso.assertions
    : [assertionDesdeResultado(caso)];

  return assertions.map((assertion) => {
    const actual = resolverCampo(analisis, assertion.campo);
    const esperado = assertion.esperado;
    const tolerancia = numero(assertion.tolerancia) ?? 0.05;

    if (esNumero(actual) || esNumero(esperado)) {
      const actualNumero = Number(actual);
      const esperadoNumero = Number(esperado);
      assert.ok(Number.isFinite(actualNumero), `${assertion.campo} no es numérico: ${String(actual)}`);
      assert.ok(Number.isFinite(esperadoNumero), `${assertion.campo} esperado no es numérico: ${String(esperado)}`);
      const diferencia = Math.abs(actualNumero - esperadoNumero);
      assert.ok(diferencia <= tolerancia, `${assertion.campo}: esperado ${esperadoNumero}, actual ${actualNumero}, diferencia ${diferencia}, tolerancia ${tolerancia}`);
      return { campo: assertion.campo, esperado: esperadoNumero, actual: actualNumero, tolerancia };
    }

    assert.deepEqual(actual, esperado, `${assertion.campo}: esperado ${JSON.stringify(esperado)}, actual ${JSON.stringify(actual)}`);
    return { campo: assertion.campo, esperado, actual, tolerancia: null };
  });
}

function assertionDesdeResultado(caso) {
  const resultado = caso.resultado_esperado ?? {};
  return {
    campo: resultado.campo ?? 'calculo.retencion_excel',
    operador: 'igual',
    esperado: resultado.valor ?? resultado.retencion_ganancias ?? null,
    tolerancia: resultado.tolerancia ?? 0.05,
  };
}

function resolverCampo(origen, campo) {
  return String(campo).split('.').reduce((actual, parte) => {
    if (actual === undefined || actual === null) return undefined;
    if (Array.isArray(actual)) {
      if (/^\d+$/.test(parte)) return actual[Number(parte)];
      return actual.find((item) => item?.codigo === parte || item?.id === parte);
    }
    return actual[parte];
  }, origen);
}

function resolverExcel(caso) {
  const nombre = texto(caso.archivo?.nombre);
  if (!nombre) throw new Error('El caso no tiene archivo.nombre configurado.');

  const candidatos = [];
  if (excelPathDirecto && basename(excelPathDirecto).toLowerCase() === nombre.toLowerCase()) candidatos.push(excelPathDirecto);
  candidatos.push(resolve(excelDir, nombre));

  const encontrado = candidatos.find((candidato) => existsSync(candidato));
  if (!encontrado) {
    throw new Error(`No encontré el Excel ${nombre}. Definí AUDITORIA_QA_EXCEL_DIR o AUDITORIA_QA_EXCEL_PATH.`);
  }
  return encontrado;
}

function normalizarCasoMongo(doc) {
  const { _id, ...resto } = doc;
  void _id;
  return JSON.parse(JSON.stringify(resto));
}

function parsearPeriodo(periodo) {
  const match = /^(0?[1-9]|1[0-2])\D+((?:20)?\d{2})$/.exec(texto(periodo));
  if (!match) return { mes: null, anio: null };
  return {
    mes: Number(match[1]),
    anio: match[2].length === 2 ? Number(`20${match[2]}`) : Number(match[2]),
  };
}

function nombreMes(mes) {
  const nombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return nombres[mes - 1] ?? '';
}

function etiquetaEstado(estado) {
  const etiquetas = {
    validado: 'Validado',
    observado: 'Observado',
    pendiente: 'Pendiente',
  };
  return etiquetas[texto(estado)] ?? 'Validado';
}

function etiquetaCampoResultado(campo) {
  const etiquetas = {
    'calculo.retencion_excel': 'Retención informada/liquidada',
    'calculo.retencion_calculada': 'Retención calculada por motor',
    'validaciones.V10_RETENCION.retencion_efectiva_esperada': 'V10 retención efectiva esperada',
    'calculo.diferencia_retencion': 'Diferencia de retención',
  };
  return etiquetas[texto(campo)] ?? texto(campo);
}

async function tomarCaptura(nombre) {
  const destino = join(outputDir, `${nombreSeguro(nombre)}.png`);
  await page.screenshot({ path: destino, fullPage: true });
  capturas.push(destino);
  return destino;
}

async function mostrarResultadoDemo({ estado, caso, detalle, verificaciones }) {
  if (!modoDemo && demoFinalPauseMs <= 0) return;

  const filas = verificaciones.map((verificacion) => ({
    campo: texto(verificacion.campo),
    esperado: String(verificacion.esperado),
    actual: String(verificacion.actual),
    tolerancia: verificacion.tolerancia === null ? '-' : String(verificacion.tolerancia),
  }));

  await page.evaluate((data) => {
    document.getElementById('qa-playwright-final-overlay')?.remove();

    const verde = data.estado === 'verde';
    const overlay = document.createElement('section');
    overlay.id = 'qa-playwright-final-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '24px';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'grid';
    overlay.style.placeItems = 'center';
    overlay.style.pointerEvents = 'none';
    overlay.style.fontFamily = 'Inter, Arial, sans-serif';

    const card = document.createElement('div');
    card.style.width = 'min(760px, calc(100vw - 48px))';
    card.style.border = `3px solid ${verde ? '#22c55e' : '#ef4444'}`;
    card.style.borderRadius = '16px';
    card.style.background = 'rgba(255,255,255,0.98)';
    card.style.boxShadow = '0 28px 90px rgba(15, 23, 42, 0.28)';
    card.style.padding = '26px';
    card.style.color = '#0f172a';

    const estado = document.createElement('div');
    estado.textContent = verde ? 'QA VERDE' : 'QA ROJO';
    estado.style.display = 'inline-flex';
    estado.style.alignItems = 'center';
    estado.style.height = '34px';
    estado.style.padding = '0 14px';
    estado.style.borderRadius = '999px';
    estado.style.background = verde ? '#dcfce7' : '#fee2e2';
    estado.style.color = verde ? '#166534' : '#991b1b';
    estado.style.fontSize = '14px';
    estado.style.fontWeight = '900';
    card.appendChild(estado);

    const titulo = document.createElement('h2');
    titulo.textContent = verde ? 'El caso pasó correctamente' : 'El caso falló';
    titulo.style.margin = '16px 0 6px';
    titulo.style.fontSize = '30px';
    titulo.style.lineHeight = '1.1';
    titulo.style.fontWeight = '950';
    card.appendChild(titulo);

    const descripcion = document.createElement('p');
    descripcion.textContent = `Caso ${data.casoId} - ${data.detalle}`;
    descripcion.style.margin = '0 0 18px';
    descripcion.style.fontSize = '15px';
    descripcion.style.color = '#475569';
    descripcion.style.fontWeight = '750';
    card.appendChild(descripcion);

    const resumen = document.createElement('div');
    resumen.style.display = 'grid';
    resumen.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
    resumen.style.gap = '10px';
    resumen.style.marginBottom = '18px';
    for (const item of [
      ['Dataset', data.dataset],
      ['Período', data.periodo],
      ['Excel', data.excel],
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

      resumen.appendChild(box);
    }
    card.appendChild(resumen);

    if (data.filas.length > 0) {
      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';
      table.style.fontSize = '13px';

      const header = document.createElement('tr');
      for (const tituloColumna of ['Campo', 'Esperado', 'Actual', 'Tolerancia']) {
        const th = document.createElement('th');
        th.textContent = tituloColumna;
        th.style.textAlign = 'left';
        th.style.padding = '9px 10px';
        th.style.borderBottom = '1px solid #cbd5e1';
        th.style.color = '#334155';
        header.appendChild(th);
      }
      table.appendChild(header);

      for (const fila of data.filas) {
        const tr = document.createElement('tr');
        for (const valor of [fila.campo, fila.esperado, fila.actual, fila.tolerancia]) {
          const td = document.createElement('td');
          td.textContent = valor;
          td.style.padding = '10px';
          td.style.borderBottom = '1px solid #e2e8f0';
          td.style.fontWeight = '800';
          td.style.overflowWrap = 'anywhere';
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      card.appendChild(table);
    }

    const pie = document.createElement('p');
    pie.textContent = `Esta pantalla se mantiene ${Math.round(data.pausaMs / 1000)} segundos antes de cerrar el navegador.`;
    pie.style.margin = '18px 0 0';
    pie.style.color = '#64748b';
    pie.style.fontSize = '12px';
    pie.style.fontWeight = '800';
    card.appendChild(pie);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }, {
    estado,
    casoId: texto(caso.id),
    dataset: texto(caso.dataset_codigo),
    periodo: texto(caso.periodo),
    excel: texto(caso.archivo?.nombre),
    detalle,
    filas,
    pausaMs: demoFinalPauseMs,
  });
}

async function llenarInput(name, valor) {
  const input = page.locator(`input[name="${name}"]`);
  await input.scrollIntoViewIfNeeded();
  await input.fill(texto(valor));
  await pausaDemo(0.35);
}

async function elegirSelect(name, valor, etiqueta = '') {
  const select = page.locator(`select[name="${name}"]`);
  await select.scrollIntoViewIfNeeded();
  const encontrado = await select.evaluate((elemento, args) => {
    const target = String(args.valor ?? '').trim();
    const labelTarget = String(args.etiqueta ?? '').trim();
    const opciones = Array.from(elemento.options);
    const opcion = opciones.find((item) => {
      const value = item.value.trim();
      const text = (item.textContent ?? '').trim();
      return value === target ||
        value.endsWith(` ${target}`) ||
        text === labelTarget ||
        text === target;
    });

    if (!opcion) return false;
    elemento.value = opcion.value;
    elemento.dispatchEvent(new Event('input', { bubbles: true }));
    elemento.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { valor, etiqueta });

  if (!encontrado) {
    throw new Error(`No encontré la opción ${texto(valor) || texto(etiqueta)} en el select ${name}.`);
  }
  await pausaDemo(0.35);
}

async function pausaDemo(factor = 1) {
  if (!demoPauseMs || factor <= 0) return;
  await page.waitForTimeout(Math.round(demoPauseMs * factor));
}

async function pausaFinalDemo() {
  if (!demoFinalPauseMs) return;
  await page.waitForTimeout(demoFinalPauseMs);
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

function detectarNavegador({ forzarChrome: soloChrome = false } = {}) {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

  const chrome = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    resolve(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  ];
  const chromePath = chrome.find((candidato) => candidato && existsSync(candidato));
  if (chromePath) return chromePath;

  if (soloChrome) {
    throw new Error('No encontré Google Chrome. Instalá Chrome o definí PLAYWRIGHT_CHROMIUM_EXECUTABLE.');
  }

  const edge = [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    resolve(process.env.LOCALAPPDATA ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  return edge.find((candidato) => candidato && existsSync(candidato));
}

function extraerSnapshotId(url) {
  const snapshotId = new URL(url).pathname.split('/').filter(Boolean).at(-1);
  assert.match(snapshotId ?? '', /^[a-f0-9]{24}$/);
  return snapshotId;
}

function carpetaDownloads() {
  const base = process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
  return join(base, 'Downloads');
}

function nombreSeguro(valor) {
  return String(valor).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'captura';
}

function ocultarMongo(uri) {
  return uri.replace(/\/\/([^:/@]+):([^@]+)@/, '//***:***@');
}

function objeto(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
}

function texto(valor) {
  return valor === undefined || valor === null ? '' : String(valor).trim();
}

function numero(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function esNumero(valor) {
  return valor !== null && valor !== undefined && valor !== '' && Number.isFinite(Number(valor));
}

function detalleError(error) {
  return error instanceof Error ? error.message : String(error);
}
