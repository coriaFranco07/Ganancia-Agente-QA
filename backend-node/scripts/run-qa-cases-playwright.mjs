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
const datasetsMongoUri = process.env.QA_DATASETS_MONGODB_URI ?? process.env.DATASETS_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/qa_agentico_esueldos';
const datasetsCollection = process.env.QA_DATASETS_COLLECTION ?? 'datasets';
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
const validarArchivoQa = process.env.AUDITORIA_QA_VALIDAR_ARCHIVO !== 'false';
const definicionTecnicaDefaultCodigo = 'DEF-AUD-GAN-RETENCION-V1';
const contratoDefinicionTecnica = 'QA_DEF_TEC_MIN_V1';
const rutasObligatoriasDefinicion = [
  'rutas.login',
  'rutas.pantalla_qa',
  'rutas.carga_excel',
];
const selectoresObligatoriosDefinicion = [
  'selectores.login.correo_input',
  'selectores.login.password_input',
  'selectores.login.submit_button',
  'selectores.formulario_qa.pagina',
  'selectores.formulario_qa.nuevo_boton',
  'selectores.formulario_qa.guardar_boton',
  'selectores.formulario_qa.guardado_ok',
  'selectores.formulario_qa.excel_input',
  'selectores.formulario_qa.campos.idCaso',
  'selectores.formulario_qa.campos.definicionTecnicaCodigo',
  'selectores.formulario_qa.campos.datasetCodigo',
  'selectores.formulario_qa.campos.periodo',
  'selectores.formulario_qa.campos.clienteNombre',
  'selectores.formulario_qa.campos.modoSaldoFavor',
  'selectores.formulario_qa.campos.descripcion',
  'selectores.formulario_qa.campos.legajo',
  'selectores.formulario_qa.campos.empleadoNombre',
  'selectores.formulario_qa.campos.cuil',
  'selectores.formulario_qa.campos.remuneracionBruta',
  'selectores.formulario_qa.campos.deducciones',
  'selectores.formulario_qa.campos.estadoEsperado',
  'selectores.formulario_qa.campos.campoResultado',
  'selectores.formulario_qa.campos.valorEsperado',
  'selectores.formulario_qa.campos.tolerancia',
  'selectores.carga_excel.pagina',
  'selectores.carga_excel.excel_input',
  'selectores.carga_excel.cliente_input',
  'selectores.carga_excel.legajo_input',
  'selectores.carga_excel.periodo_fiscal_input',
  'selectores.carga_excel.mes_liquidacion_select',
  'selectores.carga_excel.ejecutar_boton',
];
const valoresObligatoriosDefinicion = [
  'selectores.formulario_qa.titulo_texto',
  'selectores.formulario_qa.guardado_ok_texto',
  'selectores.carga_excel.titulo_texto',
  'selectores.carga_excel.resultado_texto',
];
const pasosObligatoriosDefinicion = [
  'navegar',
  'completar_formulario_qa',
  'subir_archivo',
  'guardar_caso',
  'ejecutar_analisis',
  'validar_snapshot',
];

const capturas = [];
const capturasFallidas = [];
let browser;
let page;
let datasetsConnection;

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
    datasets_mongodb_uri: ocultarMongo(datasetsMongoUri),
    excel_dir: excelDir,
    caso_filtro: casoId ?? null,
    modo_demo: modoDemo,
    carga_formulario_qa: cargarFormularioQa,
    slow_mo_ms: slowMoMs,
    resultados,
    capturas,
    capturas_fallidas: capturasFallidas,
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
  await datasetsConnection?.close().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
}

async function ejecutarCaso(caso) {
  const casoSeguro = nombreSeguro(caso.id);
  try {
    caso.definicion_tecnica = await resolverDefinicionTecnicaCaso(caso);
    const dataset = await resolverDatasetCaso(caso);
    const excelPath = resolverExcel(caso);
    if (cargarFormularioQa) {
      await cargarCasoQaPorUi(caso, excelPath, casoSeguro);
    }
    await cargarExcelPorUi(caso, excelPath, casoSeguro);
    const snapshotId = extraerSnapshotId(page.url());
    const analisis = await leerAnalisis(snapshotId);
    const verificacionesArchivo = validarArchivoCaso(caso, analisis);
    const verificaciones = [...verificacionesArchivo, ...validarAssertions(caso, analisis)];
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
      definicion_tecnica: resumenDefinicionTecnica(caso.definicion_tecnica),
      dataset,
      snapshot_id: snapshotId,
      archivo: basename(excelPath),
      control_archivo: analisis.control_archivo ?? null,
      controles_archivo: verificacionesArchivo,
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
      definicion_tecnica: resumenDefinicionTecnica(caso.definicion_tecnica),
      detalle: detalleError(error),
    };
  }
}

async function cargarCasoQaPorUi(caso, excelPath, casoSeguro) {
  await page.goto(urlRuta(caso, 'pantalla_qa', '/qa/pantalla-1'), { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: regexTexto(valorTecnico(caso, 'selectores.formulario_qa.titulo_texto', 'QA - Pantalla 1')) }).waitFor({ state: 'visible' });
  await page.locator(selectorTecnico(caso, 'selectores.formulario_qa.campos.definicionTecnicaCodigo', 'select[name="definicionTecnicaCodigo"]')).waitFor({ state: 'visible' });
  await page.locator(`${selectorTecnico(caso, 'selectores.formulario_qa.campos.definicionTecnicaCodigo', 'select[name="definicionTecnicaCodigo"]')} option`).filter({ hasText: codigoDefinicionTecnica(caso) }).first().waitFor({ state: 'attached' });
  await page.locator(selectorTecnico(caso, 'selectores.formulario_qa.campos.datasetCodigo', 'select[name="datasetCodigo"]')).waitFor({ state: 'visible' });
  await page.locator(`${selectorTecnico(caso, 'selectores.formulario_qa.campos.datasetCodigo', 'select[name="datasetCodigo"]')} option`).filter({ hasText: caso.dataset_codigo }).first().waitFor({ state: 'attached' });
  await pausaDemo();

  await clickBotonFormularioQa(caso, 'nuevo_boton', 'nuevo_boton_nombre', 'Nuevo limpio');
  await pausaDemo();

  await completarFormularioQa(caso);
  await page.locator(selectorTecnico(caso, 'selectores.formulario_qa.excel_input', '.form-panel input[accept=".xlsx,.xls"]')).setInputFiles(excelPath);
  await page.getByText(basename(excelPath)).first().waitFor({ state: 'visible' });
  await tomarCaptura(`${casoSeguro}-qa-form`);
  await pausaDemo();

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/qa/casos') && r.request().method() === 'POST', {
      timeout: 45_000,
    }),
    clickBotonFormularioQa(caso, 'guardar_boton', 'guardar_boton_nombre', 'Guardar caso'),
  ]);
  if (!response.ok()) {
    throw new Error(`Guardado del caso QA falló ${response.status()}: ${await response.text()}`);
  }

  await esperarMensajeGuardadoCaso(caso);
  await tomarCaptura(`${casoSeguro}-qa-form-guardado`);
  await pausaDemo();
}

async function clickBotonFormularioQa(caso, selectorNombre, textoNombre, textoFallback) {
  const selector = texto(valorTecnico(caso, `selectores.formulario_qa.${selectorNombre}`, ''));
  if (selector) {
    await page.locator(selector).click();
    return;
  }

  await page.getByRole('button', {
    name: regexTexto(valorTecnico(caso, `selectores.formulario_qa.${textoNombre}`, textoFallback)),
  }).click();
}

async function esperarMensajeGuardadoCaso(caso) {
  const mensaje = valorTecnico(caso, 'selectores.formulario_qa.guardado_ok_texto', 'Caso guardado en MongoDB para Playwright.');
  const selector = texto(valorTecnico(caso, 'selectores.formulario_qa.guardado_ok', ''));
  if (selector) {
    await page.locator(selector).filter({ hasText: mensaje }).waitFor({ state: 'visible' });
    return;
  }

  await page.getByText(mensaje).waitFor({ state: 'visible' });
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

  await llenarInput(caso, 'idCaso', caso.id);
  await elegirSelect(caso, 'definicionTecnicaCodigo', codigoDefinicionTecnica(caso));
  await elegirSelect(caso, 'datasetCodigo', caso.dataset_codigo);
  await verificarInputValue(caso, 'periodo', caso.periodo);
  await llenarInput(caso, 'clienteNombre', datosCliente.cliente_nombre);
  await elegirSelect(caso, 'modoSaldoFavor', datosCliente.modo_saldo_favor);
  await llenarInput(caso, 'descripcion', caso.descripcion);
  await llenarInput(caso, 'legajo', empleado.legajo);
  await llenarInput(caso, 'empleadoNombre', empleado.nombre);
  await llenarInput(caso, 'cuil', empleado.cuil);
  await llenarInput(caso, 'remuneracionBruta', liquidacion.remuneracion_bruta);
  await llenarInput(caso, 'deducciones', liquidacion.deducciones);
  await elegirSelect(caso, 'estadoEsperado', resultado.estado ?? 'validado', etiquetaEstado(resultado.estado));
  await elegirSelect(caso, 'campoResultado', campoResultado, etiquetaCampoResultado(campoResultado));
  await llenarInput(caso, 'valorEsperado', valorEsperado);
  await llenarInput(caso, 'tolerancia', tolerancia);
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
  const definicion = definicionTecnicaDefault();
  await page.goto(`${frontendUrl}${rutaDefinicion(definicion, 'login', '/login')}`, { waitUntil: 'domcontentloaded' });
  await page.locator(valorDesdeObjeto(definicion, 'selectores.login.correo_input', 'input[aria-label="Correo electrónico"]')).fill(correo);
  await page.locator(valorDesdeObjeto(definicion, 'selectores.login.password_input', 'input[aria-label="Contraseña"]')).fill(contrasena);
  await tomarCaptura('00-login');

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST'),
    page.locator(valorDesdeObjeto(definicion, 'selectores.login.submit_button', 'button[type="submit"]')).click(),
  ]);
  if (!response.ok()) {
    throw new Error(`Login UI falló ${response.status()}: ${await response.text()}`);
  }
  await page.waitForURL(/\/inicio(?:$|[?#])/, { timeout: 30_000 });
}

async function cargarExcelPorUi(caso, excelPath, casoSeguro) {
  await page.goto(urlRuta(caso, 'carga_excel', '/cargar-excel'), { waitUntil: 'domcontentloaded' });
  await page.getByText(valorTecnico(caso, 'selectores.carga_excel.titulo_texto', 'Iniciar Auditoría')).first().waitFor({ state: 'visible' });
  await page.locator(selectorTecnico(caso, 'selectores.carga_excel.excel_input', 'input[type="file"]')).setInputFiles(excelPath);
  await page.getByText(basename(excelPath)).first().waitFor({ state: 'visible' });
  await completarContextoCarga(caso);
  await tomarCaptura(`${casoSeguro}-excel`);

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/analisis/excel') && r.request().method() === 'POST', {
      timeout: 150_000,
    }),
    page.locator(selectorTecnico(caso, 'selectores.carga_excel.ejecutar_boton', 'button.ejecutar-btn')).click(),
  ]);
  if (!response.ok()) {
    throw new Error(`Carga Excel falló ${response.status()}: ${await response.text()}`);
  }
  await page.waitForURL(/\/analisis\/[a-f0-9]{24}(?:$|[?#])/, { timeout: 150_000 });
  await page.getByText(valorTecnico(caso, 'selectores.carga_excel.resultado_texto', 'Resultado del Análisis')).first().waitFor({ state: 'visible' });
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

  if (cliente) await page.locator(selectorTecnico(caso, 'selectores.carga_excel.cliente_input', 'input[aria-label="Cliente"]')).fill(cliente);
  if (legajo) await page.locator(selectorTecnico(caso, 'selectores.carga_excel.legajo_input', 'input[aria-label="Legajo"]')).fill(legajo);
  if (periodoFiscal) await page.locator(selectorTecnico(caso, 'selectores.carga_excel.periodo_fiscal_input', 'input[aria-label="Período fiscal"]')).fill(String(periodoFiscal));
  if (mesLiquidacion) {
    await page.locator(selectorTecnico(caso, 'selectores.carga_excel.mes_liquidacion_select', 'select[aria-label="Mes de liquidación"]')).selectOption({ label: nombreMes(mesLiquidacion) });
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

function validarArchivoCaso(caso, analisis) {
  if (!validarArchivoQa) return [];

  const control = objeto(analisis.control_archivo);
  if (!Object.keys(control).length) {
    throw new Error('El análisis no informó control_archivo; no puedo confirmar que el Excel corresponda al caso QA.');
  }

  const verificaciones = [];
  const periodoCaso = parsearPeriodo(caso.periodo);
  const periodoExcel = periodoDesdeControl(control);
  if (periodoCaso.mes && periodoCaso.anio) {
    if (!periodoExcel.mes) {
      throw new Error(`No pude confirmar el período del Excel para ${caso.id}. El caso espera ${periodoTexto(periodoCaso)}.`);
    }

    if (periodoExcel.mes !== periodoCaso.mes || (periodoExcel.anio && periodoExcel.anio !== periodoCaso.anio)) {
      throw new Error(`El Excel no corresponde al período del caso QA: esperado ${periodoTexto(periodoCaso)}, detectado ${periodoTexto(periodoExcel)} (${texto(periodoExcel.fuente) || 'fuente no informada'}).`);
    }

    verificaciones.push({
      campo: 'archivo.periodo',
      esperado: periodoTexto(periodoCaso),
      actual: periodoTexto(periodoExcel),
      tolerancia: null,
    });
  }

  const legajoEsperado = legajoCaso(caso);
  if (legajoEsperado) {
    const legajoDetectado = texto(control.legajo_detectado) ||
      texto(control.metadata_detectada?.legajo) ||
      texto(control.contexto_excel_detectado?.datos_legajo?.legajo_numero);

    if (!legajoDetectado) {
      throw new Error(`No pude confirmar el legajo del Excel para ${caso.id}. El caso espera legajo ${legajoEsperado}.`);
    }

    if (normalizarLegajo(legajoDetectado) !== normalizarLegajo(legajoEsperado)) {
      throw new Error(`El Excel no corresponde al legajo del caso QA: esperado ${legajoEsperado}, detectado ${legajoDetectado}.`);
    }

    verificaciones.push({
      campo: 'archivo.legajo',
      esperado: legajoEsperado,
      actual: legajoDetectado,
      tolerancia: null,
    });
  }

  return verificaciones;
}

function periodoDesdeControl(control) {
  const periodo = objeto(control.periodo_detectado);
  return {
    mes: numero(periodo.mes),
    anio: numero(periodo.anio),
    etiqueta: texto(periodo.etiqueta),
    fuente: texto(periodo.fuente),
  };
}

function periodoTexto(periodo) {
  if (periodo.etiqueta) return periodo.etiqueta;
  if (!periodo.mes) return '-';
  return periodo.anio ? `${String(periodo.mes).padStart(2, '0')}/${periodo.anio}` : String(periodo.mes).padStart(2, '0');
}

function legajoCaso(caso) {
  return texto(caso.contexto?.empleado?.legajo) ||
    texto(caso.contexto?.contexto_complementario?.datos_legajo?.legajo_numero);
}

function normalizarLegajo(valor) {
  const textoValor = texto(valor);
  const soloDigitos = textoValor.replace(/\D+/g, '');
  return soloDigitos || textoValor.toLowerCase();
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

async function resolverDatasetCaso(caso) {
  const codigo = texto(caso.dataset_codigo);
  if (!codigo) throw new Error(`El caso ${caso.id} no tiene dataset_codigo.`);

  const collection = await obtenerColeccionDatasets();
  const doc = await collection.findOne({ codigo }, {
    projection: {
      _id: 0,
      codigo: 1,
      convenio: 1,
      periodo: 1,
      vigencia: 1,
      validado_por: 1,
      validado_en: 1,
      fuente_normativa: 1,
      estado: 1,
    },
  });
  if (!doc) throw new Error(`Dataset ${codigo} no existe en ${ocultarMongo(datasetsMongoUri)}.`);

  const dataset = serializarDataset(doc);
  const errores = validarDatasetQa(dataset);
  const periodoDataset = normalizarPeriodo(dataset.periodo);
  const periodoCaso = normalizarPeriodo(caso.periodo);
  if (periodoDataset && periodoCaso && periodoDataset !== periodoCaso) {
    errores.push(`periodo caso=${caso.periodo} distinto de dataset=${dataset.periodo}`);
  }

  if (errores.length) {
    throw new Error(`Dataset ${codigo} no válido para ${caso.id}: ${errores.join('; ')}`);
  }
  return dataset;
}

async function obtenerColeccionDatasets() {
  if (!datasetsConnection) {
    datasetsConnection = await mongoose.createConnection(datasetsMongoUri, { serverSelectionTimeoutMS: 5000 }).asPromise();
  }
  return datasetsConnection.collection(datasetsCollection);
}

function serializarDataset(doc) {
  return {
    codigo: texto(doc.codigo),
    convenio: texto(doc.convenio),
    periodo: texto(doc.periodo),
    vigencia: objeto(doc.vigencia),
    validado_por: texto(doc.validado_por),
    validado_en: texto(doc.validado_en),
    fuente_normativa: objeto(doc.fuente_normativa),
    estado: texto(doc.estado) || 'validado',
  };
}

function validarDatasetQa(dataset) {
  const errores = [];
  if (!dataset.codigo) errores.push('codigo obligatorio');
  if (!/^DS-[A-Z0-9_-]+$/i.test(dataset.codigo)) errores.push('codigo debe comenzar con DS-');
  if (!dataset.convenio) errores.push('convenio obligatorio');
  if (!normalizarPeriodo(dataset.periodo)) errores.push('periodo debe tener formato MM/AAAA');
  if (!texto(dataset.vigencia.desde)) errores.push('vigencia.desde obligatorio');
  if (!dataset.validado_por) errores.push('validado_por obligatorio');
  if (!dataset.validado_en || Number.isNaN(Date.parse(dataset.validado_en))) errores.push('validado_en ISO obligatorio');
  if (!texto(dataset.fuente_normativa.ref)) errores.push('fuente_normativa.ref obligatorio');
  if (dataset.estado && dataset.estado !== 'validado') errores.push(`estado debe ser validado; actual=${dataset.estado}`);
  return errores;
}

function normalizarPeriodo(periodo) {
  const match = /^(0?[1-9]|1[0-2])\/(20\d{2})$/.exec(texto(periodo));
  if (!match) return '';
  return `${match[1].padStart(2, '0')}/${match[2]}`;
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

async function resolverDefinicionTecnicaCaso(caso) {
  const codigo = codigoDefinicionTecnica(caso);
  const doc = await mongoose.connection.collection('qa_definiciones_tecnicas').findOne(
    { codigo, estado: { $ne: 'deprecado' } },
    { projection: { _id: 0 } },
  );

  const definicion = doc && codigo !== definicionTecnicaDefaultCodigo ? doc : definicionTecnicaDefault();
  const errores = validarDefinicionTecnica(definicion);
  if (errores.length) {
    throw new Error(`Definición técnica ${codigo} inválida para ${caso.id}: ${errores.join('; ')}`);
  }
  return JSON.parse(JSON.stringify(definicion));
}

function validarDefinicionTecnica(definicion) {
  const errores = [];
  if (!texto(definicion.codigo)) errores.push('codigo obligatorio');

  const version = numero(definicion.version);
  if (!version || version < 1) errores.push('version mayor a cero obligatoria');

  for (const ruta of rutasObligatoriasDefinicion) {
    if (!texto(valorDesdeObjeto(definicion, ruta, ''))) errores.push(`${ruta} obligatorio`);
  }

  for (const selector of selectoresObligatoriosDefinicion) {
    const valor = texto(valorDesdeObjeto(definicion, selector, ''));
    if (!valor) {
      errores.push(`${selector} obligatorio`);
      continue;
    }
    if (!esDataTestId(valor)) errores.push(`${selector} debe usar data-testid estable`);
  }

  for (const valor of valoresObligatoriosDefinicion) {
    if (!texto(valorDesdeObjeto(definicion, valor, ''))) errores.push(`${valor} obligatorio`);
  }

  const pasos = Array.isArray(definicion.pasos)
    ? definicion.pasos.map((paso) => texto(objeto(paso).accion)).filter(Boolean)
    : [];
  for (const accion of pasosObligatoriosDefinicion) {
    if (!pasos.includes(accion)) errores.push(`pasos.${accion} obligatorio`);
  }
  return errores;
}

function esDataTestId(selector) {
  return /\[data-testid\s*=/i.test(texto(selector));
}

function resumenDefinicionTecnica(definicion) {
  const def = objeto(definicion);
  if (!Object.keys(def).length) return null;
  return {
    codigo: texto(def.codigo) || definicionTecnicaDefaultCodigo,
    version: numero(def.version) ?? 1,
    nombre: texto(def.nombre),
    contrato_version: contratoDefinicionTecnica,
  };
}

function codigoDefinicionTecnica(caso) {
  return texto(caso.definicion_tecnica_codigo) || definicionTecnicaDefaultCodigo;
}

function definicionTecnicaDefault() {
  return {
    codigo: definicionTecnicaDefaultCodigo,
    version: 1,
    nombre: 'Auditoría Ganancias - Retención por Excel',
    rutas: {
      login: '/login',
      inicio: '/inicio',
      pantalla_qa: '/qa/pantalla-1',
      asistente_qa: '/qa/asistente',
      carga_excel: '/cargar-excel',
      analisis: '/analisis',
    },
    selectores: {
      login: {
        correo_input: '[data-testid="auth-email-input"]',
        password_input: '[data-testid="auth-password-input"]',
        submit_button: '[data-testid="auth-submit-button"]',
      },
      formulario_qa: {
        titulo_texto: 'QA - Pantalla 1',
        pagina: '[data-testid="qa-pantalla1-page"]',
        nuevo_boton: '[data-testid="qa-case-reset-button"]',
        nuevo_boton_nombre: 'Nuevo limpio',
        guardar_boton: '[data-testid="qa-case-save-button"]',
        guardar_boton_nombre: 'Guardar caso',
        guardado_ok: '[data-testid="qa-case-message"]',
        guardado_ok_texto: 'Caso guardado en MongoDB para Playwright.',
        excel_input: '[data-testid="qa-case-excel-input"]',
        campos: {
          idCaso: '[data-testid="qa-case-id-input"]',
          definicionTecnicaCodigo: '[data-testid="qa-case-definicion-select"]',
          datasetCodigo: '[data-testid="qa-case-dataset-select"]',
          periodo: '[data-testid="qa-case-periodo-input"]',
          clienteNombre: '[data-testid="qa-case-cliente-input"]',
          modoSaldoFavor: '[data-testid="qa-case-modo-saldo-select"]',
          descripcion: '[data-testid="qa-case-descripcion-input"]',
          legajo: '[data-testid="qa-case-legajo-input"]',
          empleadoNombre: '[data-testid="qa-case-empleado-input"]',
          cuil: '[data-testid="qa-case-cuil-input"]',
          remuneracionBruta: '[data-testid="qa-case-remuneracion-input"]',
          deducciones: '[data-testid="qa-case-deducciones-input"]',
          estadoEsperado: '[data-testid="qa-case-estado-select"]',
          campoResultado: '[data-testid="qa-case-campo-select"]',
          valorEsperado: '[data-testid="qa-case-valor-esperado-input"]',
          tolerancia: '[data-testid="qa-case-tolerancia-input"]',
        },
      },
      asistente_qa: {
        pagina: '[data-testid="qa-chat-page"]',
        casos_lista: '[data-testid="qa-chat-cases-list"]',
        mensajes: '[data-testid="qa-chat-messages"]',
        buscar_caso_input: '[data-testid="qa-chat-case-search-input"]',
        pregunta_input: '[data-testid="qa-chat-input"]',
        enviar_boton: '[data-testid="qa-chat-send-button"]',
        aprobar_plan_boton: '[data-testid="qa-chat-plan-approve-button"]',
        ejecutar_plan_boton: '[data-testid="qa-chat-plan-run-button"]',
      },
      carga_excel: {
        titulo_texto: 'Iniciar Auditoría',
        pagina: '[data-testid="carga-excel-page"]',
        excel_input: '[data-testid="carga-excel-file-input"]',
        cliente_input: '[data-testid="carga-excel-cliente-input"]',
        legajo_input: '[data-testid="carga-excel-legajo-input"]',
        periodo_fiscal_input: '[data-testid="carga-excel-periodo-fiscal-input"]',
        mes_liquidacion_select: '[data-testid="carga-excel-mes-liquidacion-select"]',
        ejecutar_boton: '[data-testid="carga-excel-run-button"]',
        resultado_texto: 'Resultado del Análisis',
      },
    },
    pasos: [
      { orden: 1, accion: 'navegar', ruta: 'pantalla_qa', escribe: false, reversible: true },
      { orden: 2, accion: 'completar_formulario_qa', escribe: true, reversible: true },
      { orden: 3, accion: 'subir_archivo', destino: 'formulario_qa.excel_input', escribe: true, reversible: true },
      { orden: 4, accion: 'guardar_caso', escribe: true, reversible: true },
      { orden: 5, accion: 'navegar', ruta: 'carga_excel', escribe: false, reversible: true },
      { orden: 6, accion: 'subir_archivo', destino: 'carga_excel.excel_input', escribe: true, reversible: true },
      { orden: 7, accion: 'ejecutar_analisis', escribe: true, reversible: true },
      { orden: 8, accion: 'validar_snapshot', escribe: false, reversible: true },
    ],
  };
}

function urlRuta(caso, nombre, fallback) {
  return `${frontendUrl}${rutaDefinicion(caso.definicion_tecnica, nombre, fallback)}`;
}

function rutaDefinicion(definicion, nombre, fallback) {
  const ruta = texto(valorDesdeObjeto(definicion, `rutas.${nombre}`, fallback)) || fallback;
  return ruta.startsWith('/') ? ruta : `/${ruta}`;
}

function selectorCampoFormulario(caso, nombre, fallback) {
  return selectorTecnico(caso, `selectores.formulario_qa.campos.${nombre}`, fallback);
}

function selectorTecnico(caso, path, fallback) {
  return valorTecnico(caso, path, fallback);
}

function valorTecnico(caso, path, fallback) {
  return texto(valorDesdeObjeto(caso.definicion_tecnica, path, fallback)) || fallback;
}

function valorDesdeObjeto(origen, path, fallback) {
  const valor = String(path).split('.').reduce((actual, parte) => {
    if (!actual || typeof actual !== 'object') return undefined;
    return actual[parte];
  }, objeto(origen));
  return valor === undefined || valor === null || valor === '' ? fallback : valor;
}

function regexTexto(valor) {
  return new RegExp(escapeRegExp(texto(valor)), 'i');
}

function escapeRegExp(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizarCasoMongo(doc) {
  const { _id, ...resto } = doc;
  void _id;
  return {
    definicion_tecnica_codigo: definicionTecnicaDefaultCodigo,
    ...JSON.parse(JSON.stringify(resto)),
  };
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
  try {
    await page.screenshot({ path: destino, fullPage: false, animations: 'disabled', timeout: 20_000 });
    capturas.push(destino);
    return destino;
  } catch (error) {
    capturasFallidas.push({ nombre, destino, error: detalleError(error) });
    return null;
  }
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

async function llenarInput(caso, name, valor) {
  const input = page.locator(selectorCampoFormulario(caso, name, `input[name="${name}"]`));
  await input.scrollIntoViewIfNeeded();
  await input.fill(texto(valor));
  await pausaDemo(0.35);
}

async function verificarInputValue(caso, name, valor) {
  const esperado = texto(valor);
  const selector = selectorCampoFormulario(caso, name, `input[name="${name}"]`);
  const input = page.locator(selector);
  await input.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    ({ selector, expected }) => document.querySelector(selector)?.value === expected,
    { selector, expected: esperado },
  );
  await pausaDemo(0.2);
}

async function elegirSelect(caso, name, valor, etiqueta = '') {
  const select = page.locator(selectorCampoFormulario(caso, name, `select[name="${name}"]`));
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
