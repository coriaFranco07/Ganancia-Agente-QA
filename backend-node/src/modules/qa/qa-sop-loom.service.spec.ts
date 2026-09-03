import { QaSopLoomService } from './qa-sop-loom.service';
import { buscarPantallaPorRuta } from './qa-catalogo-elementos';
import { InspeccionPantalla } from './qa-pantalla-inspector.service';

interface CasoFake {
  id: string;
  descripcion?: string;
  activo?: boolean;
  dataset_codigo?: string;
  periodo?: string;
  contexto?: Record<string, unknown>;
  origen?: Record<string, unknown>;
}

/** Stub del modelo de casos: soporta find().lean() y find().sort().lean(), con $in por id. */
function modeloCasos(casos: CasoFake[]) {
  return {
    find(filtro: Record<string, unknown>) {
      const ids = (filtro['id'] as { $in?: string[] } | undefined)?.$in;
      const encontrados = casos.filter((caso) => (ids ? ids.includes(caso.id) : true));
      const lean = async () => encontrados;
      return { lean, sort: () => ({ lean }) };
    },
  };
}

function casoPantalla3(id: string, datos: Record<string, string | null>): CasoFake {
  return {
    id,
    descripcion: `Alta Pantalla 3 - ${datos['cliente'] ?? ''}`,
    activo: true,
    contexto: {
      contexto_complementario: {
        pantalla_3: datos,
        origen: { pantalla: 'QA - Pantalla 3' },
      },
    },
    origen: { pantalla: 'QA - Pantalla 3' },
  };
}

/** Pantalla 1 no marca `origen.pantalla` y guarda los datos en otras rutas. */
function casoPantalla1(id: string): CasoFake {
  return {
    id,
    descripcion: 'Retencion ganancias',
    activo: true,
    dataset_codigo: 'DS-AUD-GAN-082026',
    periodo: '08/2026',
    contexto: {
      empleado: { legajo: '434', nombre: 'Coria Franco', cuil: '20-12436587-4' },
      liquidacion: { remuneracion_bruta: 150000, deducciones: 20000 },
      contexto_complementario: {},
    },
    origen: { tipo: 'formulario_qa_pantalla_1' },
  } as CasoFake;
}

const CASO_COMPLETO = {
  cliente: 'Distribuidora del Oeste SA',
  area_sector: 'Administracion',
  telefono: '11 4444-8899',
  numero_documento: '27345678',
  cuil: '27-27345678-4',
  fecha_ingreso: '2026-04-15',
  fecha_fin: null,
};

const CASO_SEGUNDO = {
  cliente: 'Transporte Andino SRL',
  area_sector: 'Operaciones',
  telefono: '2615550101',
  numero_documento: '30999111',
  cuil: '20-30999111-7',
  fecha_ingreso: '2026-05-02',
  fecha_fin: null,
};

async function compilar(entrada: {
  ruta: string;
  pasos: string[];
  casos?: CasoFake[];
  seleccionados?: string[];
  descripcion?: string;
  consideracionesDecididas?: Record<string, unknown>[];
  ordenManualPasos?: string[];
  reglasValidacion?: Record<string, unknown>[];
  capturasPorRuta?: Record<string, string>;
  /** Rutas de pantallas secundarias que ya fueron inspeccionadas. */
  rutasExtra?: string[];
}) {
  const casos = entrada.casos ?? [casoPantalla3('QA-P3-ALTA-27345678-20260415', CASO_COMPLETO)];
  const reglasStub = entrada.reglasValidacion
    ? ({ listarResueltas: async () => entrada.reglasValidacion } as never)
    : undefined;
  const inspectorStub = entrada.capturasPorRuta
    ? ({ ultimaConCaptura: async (ruta: string) => entrada.capturasPorRuta?.[ruta] ?? null } as never)
    : undefined;
  const service = new QaSopLoomService(null as never, modeloCasos(casos) as never, inspectorStub, reglasStub);

  return (service as unknown as {
    compilar(input: {
      ruta: string;
      descripcion: string;
      pasos: Record<string, unknown>[];
      casosSeleccionados: string[];
      inspeccion: InspeccionPantalla | null;
      inspeccionesExtra?: InspeccionPantalla[];
      consideracionesDecididas?: Record<string, unknown>[];
      ordenManualPasos?: string[];
    }): Promise<{
      campos: Record<string, unknown>[];
      acciones: string[];
      pasos_ejecutables: Array<Record<string, unknown>>;
      casos: Array<Record<string, unknown>>;
      consideraciones: Array<Record<string, unknown>>;
      pendientes: string[];
      recorrido: Array<Record<string, unknown>>;
      inspecciones: Array<Record<string, unknown>>;
    }>;
  }).compilar({
    ruta: entrada.ruta,
    descripcion: entrada.descripcion ?? '',
    pasos: entrada.pasos.map((accion, index) => ({ orden: index + 1, accion })),
    casosSeleccionados: entrada.seleccionados ?? [],
    inspeccion: inspeccionDePrueba(entrada.ruta),
    inspeccionesExtra: (entrada.rutasExtra ?? []).map((ruta) => inspeccionDePrueba(ruta)),
    consideracionesDecididas: entrada.consideracionesDecididas,
    ordenManualPasos: entrada.ordenManualPasos,
  });
}

function inspeccionDePrueba(ruta: string): InspeccionPantalla {
  const pantalla = buscarPantallaPorRuta(ruta);
  const elementos = new Map<string, Record<string, unknown>>();
  const agregar = (testid: string, tag: string, etiqueta = '', tipo = '') => {
    if (!testid || elementos.has(testid)) return;
    elementos.set(testid, {
      testid,
      selector: `[data-testid="${testid}"]`,
      tag,
      tipo,
      rol: '',
      nombre: '',
      etiqueta,
      placeholder: '',
      obligatorio: false,
      deshabilitado: false,
      visible: pantalla?.instrumentada !== false,
      opciones: [],
      fuente: { tipo: 'navegacion', ref: `http://localhost:4200${ruta}` },
    });
  };

  if (pantalla) {
    for (const [clave, selector] of Object.entries(pantalla.selectores)) {
      const testid = /\[data-testid="([^"]+)"\]/.exec(selector)?.[1] ?? '';
      agregar(testid, clave === 'pagina' ? 'main' : clave === 'formulario' ? 'form' : 'section');
    }
    for (const campo of pantalla.campos) {
      agregar(campo.testid, campo.tipo === 'select' ? 'select' : 'input', campo.etiqueta, campo.tipo);
    }
    for (const accion of pantalla.acciones) agregar(accion.testid, 'button', accion.etiqueta, 'button');
  } else {
    agregar('qa-pantalla-99-page', 'main', 'Pantalla 99');
  }

  return {
    id: `QA-NAV-${ruta.replace(/\W/g, '') || 'ROOT'}`,
    ruta,
    frontend_url: 'http://localhost:4200',
    titulo: 'Auditoria de Ganancias',
    encabezado: pantalla?.nombre ?? 'Pantalla desconocida',
    inspeccionada_en: '2026-08-28T10:00:00.000Z',
    solicitada_por: 'qa@test.local',
    elementos: Array.from(elementos.values()) as never,
    captura_path: 'captura.png',
    hash: 'hash-navegacion-prueba',
    activa: true,
  };
}

const PASOS_PANTALLA_3 = [
  'Ingreso al menu QA y abro Pantalla 3.',
  'Completo el cliente con la razon social.',
  'Completo el area / sector al que pertenece.',
  'Completo el telefono de contacto.',
  'Completo el numero de documento.',
  'Completo el CUIL del titular.',
  'Completo la fecha de ingreso.',
  'Por ultimo guardo el caso y verifico el mensaje de confirmacion.',
];

describe('QaSopLoomService.eliminar', () => {
  function modeloAprendizajes(docs: Array<Record<string, unknown>>) {
    return {
      ultimoFiltro: null as Record<string, unknown> | null,
      async updateMany(
        filtro: Record<string, unknown>,
        update: { $set?: Record<string, unknown> },
      ) {
        if (filtro['ultima_ejecucion.estado'] !== 'corriendo') return { modifiedCount: 0 };
        let modificados = 0;
        for (const doc of docs) {
          const ejecucion = doc['ultima_ejecucion'] as Record<string, unknown> | undefined;
          if (ejecucion?.['estado'] !== 'corriendo') continue;
          for (const [ruta, valor] of Object.entries(update.$set ?? {})) {
            if (ruta.startsWith('ultima_ejecucion.')) ejecucion[ruta.split('.')[1]] = valor;
          }
          modificados += 1;
        }
        return { modifiedCount: modificados };
      },
      find(filtro: Record<string, unknown>) {
        this.ultimoFiltro = filtro;
        const activos = docs.filter((doc) => doc['activo'] !== false);
        const lean = async () => activos;
        return { lean, sort: () => ({ lean }) };
      },
      findOneAndUpdate(filtro: Record<string, unknown>, update: Record<string, unknown>) {
        const doc = docs.find((item) => item['id'] === filtro['id'] && item['activo'] !== false);
        if (!doc) return { lean: async () => null };
        Object.assign(doc, (update['$set'] as Record<string, unknown>) ?? {});
        return { lean: async () => doc };
      },
    };
  }

  it('da de baja logica y lo saca del listado', async () => {
    const docs = [{ id: 'sop-1', nombre: 'Flujo 1', activo: true }];
    const modelo = modeloAprendizajes(docs);
    const service = new QaSopLoomService(modelo as never, modeloCasos([]) as never);

    await expect(service.eliminar('sop-1')).resolves.toEqual({ id: 'sop-1', activo: false });
    expect(docs[0]['activo']).toBe(false);
    await expect(service.listar()).resolves.toEqual([]);
  });

  it('el listado excluye los dados de baja', async () => {
    const modelo = modeloAprendizajes([
      { id: 'sop-1', nombre: 'Vivo', activo: true },
      { id: 'sop-2', nombre: 'Borrado', activo: false },
    ]);
    const service = new QaSopLoomService(modelo as never, modeloCasos([]) as never);

    const listado = await service.listar();
    expect(listado.map((item) => item['id'])).toEqual(['sop-1']);
  });

  it('falla al eliminar uno inexistente o ya dado de baja', async () => {
    const modelo = modeloAprendizajes([{ id: 'sop-1', nombre: 'Borrado', activo: false }]);
    const service = new QaSopLoomService(modelo as never, modeloCasos([]) as never);

    await expect(service.eliminar('sop-1')).rejects.toThrow(/inexistente/i);
    await expect(service.eliminar('no-existe')).rejects.toThrow(/inexistente/i);
  });

  it('no elimina un aprendizaje que se está ejecutando', async () => {
    const modelo = modeloAprendizajes([{ id: 'sop-1', nombre: 'Corriendo', activo: true }]);
    const service = new QaSopLoomService(modelo as never, modeloCasos([]) as never);
    (service as unknown as { procesos: Map<string, unknown> })
      .procesos.set('sop-1', { killed: false });

    await expect(service.eliminar('sop-1')).rejects.toThrow(/se está ejecutando/i);
  });
});

describe('QaSopLoomService.revalidarCasosCongelados', () => {
  function revalidar(congelados: Array<Record<string, unknown>>, actuales: CasoFake[]) {
    const service = new QaSopLoomService(null as never, modeloCasos(actuales) as never);
    return (service as unknown as {
      revalidarCasosCongelados(doc: Record<string, unknown>): Promise<string[]>;
    }).revalidarCasosCongelados({
      definicion_ejecutable: {
        rutas: { pantalla_objetivo: '/qa/pantalla-3' },
        casos: congelados,
      },
    });
  }

  const CONGELADO_A = {
    id: 'QA-P3-A',
    datos: { ...CASO_COMPLETO, fecha_fin: '' },
  };

  it('no reporta desvios si los casos siguen igual', async () => {
    const desvios = await revalidar([CONGELADO_A], [casoPantalla3('QA-P3-A', CASO_COMPLETO)]);
    expect(desvios).toEqual([]);
  });

  it('pide cargar casos cuando ya no queda ninguno', async () => {
    const desvios = await revalidar([CONGELADO_A], []);
    expect(desvios.join(' ')).toMatch(/Ya no hay casos en/i);
    expect(desvios.join(' ')).toMatch(/Cargá al menos uno/i);
  });

  it('avisa cuando un caso puntual dejo de estar disponible', async () => {
    const desvios = await revalidar(
      [CONGELADO_A, { id: 'QA-P3-B', datos: CASO_SEGUNDO }],
      [casoPantalla3('QA-P3-A', CASO_COMPLETO)],
    );
    expect(desvios.join(' ')).toMatch(/QA-P3-B ya no está disponible/i);
  });

  it('avisa el campo exacto que cambio desde la aprobacion', async () => {
    const desvios = await revalidar(
      [CONGELADO_A],
      [casoPantalla3('QA-P3-A', { ...CASO_COMPLETO, cuil: '27-27345678-9' })],
    );
    expect(desvios.join(' ')).toMatch(/cambió cuil/i);
    expect(desvios.join(' ')).toMatch(/27-27345678-4.*27-27345678-9/);
  });

  it('avisa de casos nuevos que quedarian fuera de la corrida aprobada', async () => {
    const desvios = await revalidar(
      [CONGELADO_A],
      [casoPantalla3('QA-P3-A', CASO_COMPLETO), casoPantalla3('QA-P3-NUEVO', CASO_SEGUNDO)],
    );
    expect(desvios.join(' ')).toMatch(/cargados después de aprobar/i);
    expect(desvios.join(' ')).toMatch(/QA-P3-NUEVO/);
  });

  it('avisa si el aprendizaje quedo sin casos congelados (definicion vieja)', async () => {
    const desvios = await revalidar([], [casoPantalla3('QA-P3-A', CASO_COMPLETO)]);
    expect(desvios.join(' ')).toMatch(/no tiene casos congelados/i);
  });
});

describe('QaSopLoomService doble firma', () => {
  function definicionDePrueba(overrides: Record<string, unknown> = {}) {
    return {
      rutas: { login: '/login', pantalla_objetivo: '/qa/pantalla-3' },
      selectores: { pagina: '[data-testid="qa-screen3-page"]' },
      pasos_ejecutables: [{ orden: 1, tipo: 'navegar' }],
      fuentes: { navegacion: { hash: 'hash-nav' } },
      valores: { objetivo: 'dar de alta', criterio_aceptacion: 'queda registrado' },
      casos: [{ id: 'QA-P3-A' }],
      consideraciones: [],
      fuente_datos: { tipo: 'casos_qa' },
      ...overrides,
    };
  }

  function servicioCon(doc: Record<string, unknown>) {
    const docs = [doc];
    const modelo = {
      find() {
        const lean = async () => docs;
        return { lean, sort: () => ({ lean }) };
      },
      findOne(filtro: Record<string, unknown>) {
        const encontrado = docs.find((item) => item['id'] === filtro['id']) ?? null;
        return { lean: async () => encontrado };
      },
      findOneAndUpdate(filtro: Record<string, unknown>, update: Record<string, unknown>) {
        const encontrado = docs.find((item) => item['id'] === filtro['id']);
        if (encontrado) Object.assign(encontrado, (update['$set'] as Record<string, unknown>) ?? {});
        return { lean: async () => encontrado ?? null };
      },
      updateMany: async () => undefined,
    };
    return {
      servicio: new QaSopLoomService(modelo as never, modeloCasos([]) as never),
      doc,
    };
  }

  function docAprendizaje(overrides: Record<string, unknown> = {}) {
    return {
      id: 'sop-1',
      activo: true,
      estado: 'listo',
      pendientes: [],
      definicion_ejecutable: definicionDePrueba(),
      inspeccion_navegacion: { id: 'QA-NAV-1', hash: 'hash-nav' },
      firmas: { negocio: null, tecnica: null },
      aprobacion: null,
      ...overrides,
    };
  }

  it('una sola firma no alcanza para aprobar', async () => {
    const { servicio, doc } = servicioCon(docAprendizaje());

    await servicio.firmar('sop-1', 'tecnica', { correo: 'qa@test', rol: 'qa' });

    expect(doc['estado']).toBe('listo');
    expect(doc['aprobacion']).toBeNull();
  });

  it('con las dos firmas queda aprobado', async () => {
    const { servicio, doc } = servicioCon(docAprendizaje());

    await servicio.firmar('sop-1', 'tecnica', { correo: 'qa@test', rol: 'qa' });
    await servicio.firmar('sop-1', 'negocio', { correo: 'consultoria@test', rol: 'consultor' });

    expect(doc['estado']).toBe('aprobado');
    const firmas = doc['firmas'] as Record<string, Record<string, unknown>>;
    expect(firmas['tecnica']['por']).toBe('qa@test');
    expect(firmas['negocio']['por']).toBe('consultoria@test');
  });

  it('rechaza un tipo de firma que no existe', async () => {
    const { servicio } = servicioCon(docAprendizaje());
    await expect(servicio.firmar('sop-1', 'gerencia', {})).rejects.toThrow(/negocio.*tecnica/i);
  });

  it('un cambio tecnico invalida solo la firma tecnica', async () => {
    const { servicio, doc } = servicioCon(docAprendizaje());
    await servicio.firmar('sop-1', 'tecnica', { correo: 'qa@test', rol: 'qa' });
    await servicio.firmar('sop-1', 'negocio', { correo: 'consultoria@test', rol: 'consultor' });

    // Cambia un selector: se recompila la mitad técnica.
    doc['definicion_ejecutable'] = definicionDePrueba({
      selectores: { pagina: '[data-testid="qa-screen3-page-v2"]' },
    });

    const vigentes = (servicio as unknown as {
      firmasVigentes(d: unknown): Record<string, unknown>;
    }).firmasVigentes(doc);

    expect(vigentes['tecnica']).toBeNull();
    expect(vigentes['negocio']).not.toBeNull();
  });

  it('un cambio de criterio invalida solo la firma de negocio', async () => {
    const { servicio, doc } = servicioCon(docAprendizaje());
    await servicio.firmar('sop-1', 'tecnica', { correo: 'qa@test', rol: 'qa' });
    await servicio.firmar('sop-1', 'negocio', { correo: 'consultoria@test', rol: 'consultor' });

    doc['definicion_ejecutable'] = definicionDePrueba({
      valores: { objetivo: 'dar de alta', criterio_aceptacion: 'otro criterio distinto' },
    });

    const vigentes = (servicio as unknown as {
      firmasVigentes(d: unknown): Record<string, unknown>;
    }).firmasVigentes(doc);

    expect(vigentes['negocio']).toBeNull();
    expect(vigentes['tecnica']).not.toBeNull();
  });

  it('no deja firmar negocio con una guarda sin decidir', async () => {
    const { servicio } = servicioCon(docAprendizaje({
      definicion_ejecutable: definicionDePrueba({
        consideraciones: [{ id: 'g1', texto: 'No marcar sin confirmar', control: 'sin_definir' }],
      }),
    }));

    await expect(servicio.firmar('sop-1', 'negocio', {})).rejects.toThrow(/no se puede firmar/i);
  });

  it('no deja firmar tecnica sin inspeccion del sandbox', async () => {
    const { servicio } = servicioCon(docAprendizaje({ inspeccion_navegacion: {} }));
    await expect(servicio.firmar('sop-1', 'tecnica', {})).rejects.toThrow(/no se puede firmar/i);
  });

  it('no deja firmar un aprendizaje con pendientes', async () => {
    const { servicio } = servicioCon(docAprendizaje({ pendientes: ['falta algo'] }));
    await expect(servicio.firmar('sop-1', 'tecnica', {})).rejects.toThrow(/pendientes/i);
  });

  it('migra una aprobacion vieja como firma tecnica', async () => {
    const definicion = definicionDePrueba();
    const hashViejo = require('crypto').createHash('sha256')
      .update(JSON.stringify(definicion)).digest('hex');
    const { servicio, doc } = servicioCon(docAprendizaje({
      definicion_ejecutable: definicion,
      firmas: { negocio: null, tecnica: null },
      aprobacion: { por: 'qa-viejo@test', rol: 'qa', tipo: 'tecnica', hash_definicion: hashViejo },
    }));

    const vigentes = (servicio as unknown as {
      firmasVigentes(d: unknown): Record<string, Record<string, unknown> | null>;
    }).firmasVigentes(doc);

    expect(vigentes['tecnica']?.['por']).toBe('qa-viejo@test');
    expect(vigentes['tecnica']?.['migrada_de']).toBe('aprobacion_v3');
  });
});

describe('QaSopLoomService guardas del SOP', () => {
  const PASO_GUARDA = 'Importante: no marcar el alta como activa sin confirmar la habilitación.';

  it('detecta la precaución del SOP y bloquea hasta que una persona la resuelva', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: [...PASOS_PANTALLA_3, PASO_GUARDA],
    });

    expect(resultado.consideraciones).toHaveLength(1);
    expect(resultado.consideraciones[0]['control']).toBe('sin_definir');
    expect(resultado.consideraciones[0]['testeable']).toBeNull();
    expect(resultado.pendientes.join(' ')).toMatch(/regla evaluable por el test o un control humano/i);
  });

  it('marcada como control humano, deja de bloquear pero queda registrada', async () => {
    const previa = await compilar({ ruta: '/qa/pantalla-3', pasos: [...PASOS_PANTALLA_3, PASO_GUARDA] });
    const id = previa.consideraciones[0]['id'];

    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: [...PASOS_PANTALLA_3, PASO_GUARDA],
      consideracionesDecididas: [{ id, testeable: false }],
    });

    expect(resultado.consideraciones[0]['control']).toBe('humano');
    expect(resultado.pendientes).toEqual([]);
  });

  it('marcada como testeable queda como control automatico', async () => {
    const previa = await compilar({ ruta: '/qa/pantalla-3', pasos: [...PASOS_PANTALLA_3, PASO_GUARDA] });
    const id = previa.consideraciones[0]['id'];

    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: [...PASOS_PANTALLA_3, PASO_GUARDA],
      consideracionesDecididas: [{ id, testeable: true }],
    });

    expect(resultado.consideraciones[0]['control']).toBe('automatico');
    expect(resultado.pendientes).toEqual([]);
  });

  it('un SOP sin frases de precaucion no genera guardas', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3 });
    expect(resultado.consideraciones).toEqual([]);
  });

  it('tambien detecta precauciones escritas fuera de los pasos', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: PASOS_PANTALLA_3,
      descripcion: 'Nunca cargues un CUIL de otra empresa en este formulario.',
    });

    expect(resultado.consideraciones).toHaveLength(1);
    expect(resultado.consideraciones[0]['texto']).toMatch(/Nunca cargues/i);
  });
});

describe('QaSopLoomService.compilar', () => {
  it('compila el flujo de Pantalla 3 contra los testids reales', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3 });

    expect(resultado.pendientes).toEqual([]);

    const tipos = resultado.pasos_ejecutables.map((paso) => paso['tipo']);
    expect(tipos[0]).toBe('navegar');
    expect(tipos).toContain('completar');
    expect(tipos).toContain('click');
    expect(tipos).toContain('verificar');
    expect(tipos[tipos.length - 1]).toBe('verificar_fila');

    const selectores = resultado.pasos_ejecutables.map((paso) => paso['selector']);
    expect(selectores).toContain('[data-testid="qa-screen3-cliente-input"]');
    expect(selectores).toContain('[data-testid="qa-screen3-cuil-input"]');
    expect(selectores).toContain('[data-testid="qa-screen3-save-button"]');
  });

  it('deja los pasos como plantilla, sin valores fijos', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3 });
    const completar = resultado.pasos_ejecutables.filter((paso) => paso['tipo'] === 'completar');

    expect(completar.length).toBeGreaterThan(0);
    expect(completar.every((paso) => paso['valor'] === undefined)).toBe(true);
    expect(completar.every((paso) => typeof paso['campo'] === 'string' && paso['campo'])).toBe(true);
  });

  it('toma los datos de los casos cargados en la pantalla, no de valores inventados', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3 });

    expect(resultado.casos).toHaveLength(1);
    expect(resultado.casos[0]['datos']).toMatchObject({
      cliente: 'Distribuidora del Oeste SA',
      cuil: '27-27345678-4',
      fecha_ingreso: '2026-04-15',
    });
  });

  it('congela una vuelta por cada caso cargado', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: PASOS_PANTALLA_3,
      casos: [
        casoPantalla3('QA-P3-ALTA-27345678-20260415', CASO_COMPLETO),
        casoPantalla3('QA-P3-ALTA-30999111-20260502', CASO_SEGUNDO),
      ],
    });

    expect(resultado.pendientes).toEqual([]);
    expect(resultado.casos.map((caso) => caso['id'])).toEqual([
      'QA-P3-ALTA-27345678-20260415',
      'QA-P3-ALTA-30999111-20260502',
    ]);
  });

  it('reconstruye el id que la pantalla le va a asignar al caso guardado', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3 });
    expect(resultado.casos[0]['id_esperado']).toBe('QA-P3-ALTA-27345678-20260415');
  });

  it('respeta la seleccion explicita de casos', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: PASOS_PANTALLA_3,
      casos: [
        casoPantalla3('QA-P3-ALTA-27345678-20260415', CASO_COMPLETO),
        casoPantalla3('QA-P3-ALTA-30999111-20260502', CASO_SEGUNDO),
      ],
      seleccionados: ['QA-P3-ALTA-30999111-20260502'],
    });

    expect(resultado.casos.map((caso) => caso['id'])).toEqual(['QA-P3-ALTA-30999111-20260502']);
  });

  it('lee tambien casos viejos que solo tienen contexto.empleado', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: PASOS_PANTALLA_3,
      casos: [{
        id: 'QA-P3-LEGACY',
        activo: true,
        origen: { pantalla: 'QA - Pantalla 3' },
        contexto: { empleado: CASO_COMPLETO },
      }],
    });

    expect(resultado.pendientes).toEqual([]);
    expect(resultado.casos[0]['datos']).toMatchObject({ cliente: 'Distribuidora del Oeste SA' });
  });

  it('no compila si la pantalla no tiene casos cargados', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3, casos: [] });

    expect(resultado.casos).toEqual([]);
    expect(resultado.pendientes.join(' ')).toMatch(/No hay casos en/i);
  });

  it('marca pendiente un caso incompleto en lugar de completarlo con datos inventados', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: PASOS_PANTALLA_3,
      casos: [casoPantalla3('QA-P3-INCOMPLETO', { ...CASO_COMPLETO, cuil: '' })],
    });

    expect(resultado.casos).toEqual([]);
    expect(resultado.pendientes.join(' ')).toMatch(/QA-P3-INCOMPLETO no tiene CUIL/i);
  });

  it('respeta el orden del SOP y deja el guardar despues de completar los campos', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3 });

    const indiceGuardar = resultado.pasos_ejecutables.findIndex(
      (paso) => paso['selector'] === '[data-testid="qa-screen3-save-button"]',
    );
    const indicesCompletar = resultado.pasos_ejecutables
      .map((paso, index) => ({ tipo: paso['tipo'], index }))
      .filter((item) => item.tipo === 'completar')
      .map((item) => item.index);

    expect(indiceGuardar).toBeGreaterThan(-1);
    expect(Math.max(...indicesCompletar)).toBeLessThan(indiceGuardar);
  });

  it('reordena los pasos completar segun el orden manual, sin mover navegar/click/verificar', async () => {
    const sinOrden = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3 });
    const camposOriginal = sinOrden.pasos_ejecutables
      .filter((paso) => paso['tipo'] === 'completar')
      .map((paso) => paso['campo']);
    expect(camposOriginal.indexOf('cuil')).toBeGreaterThan(camposOriginal.indexOf('numero_documento'));

    const conOrden = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: PASOS_PANTALLA_3,
      ordenManualPasos: ['completar:cuil', 'completar:numero_documento'],
    });

    const camposReordenados = conOrden.pasos_ejecutables
      .filter((paso) => paso['tipo'] === 'completar')
      .map((paso) => paso['campo']);
    expect(camposReordenados.indexOf('cuil')).toBeLessThan(camposReordenados.indexOf('numero_documento'));

    // navegar sigue primero y el resto de los tipos no cambia de posicion relativa.
    const tiposOriginal = sinOrden.pasos_ejecutables.map((paso) => paso['tipo']);
    const tiposReordenados = conOrden.pasos_ejecutables.map((paso) => paso['tipo']);
    expect(tiposReordenados).toEqual(tiposOriginal);
  });

  it('agrega al final del grupo los campos completar que el orden manual no menciona', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: PASOS_PANTALLA_3,
      ordenManualPasos: ['completar:cuil'],
    });

    const campos = resultado.pasos_ejecutables
      .filter((paso) => paso['tipo'] === 'completar')
      .map((paso) => paso['campo']);
    expect(campos[0]).toBe('cuil');
    expect(new Set(campos)).toEqual(new Set(['cliente', 'area_sector', 'telefono', 'numero_documento', 'cuil', 'fecha_ingreso']));
  });

  it('renumera el campo orden de cada paso despues de reordenar', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: PASOS_PANTALLA_3,
      ordenManualPasos: ['completar:cuil', 'completar:cliente'],
    });

    resultado.pasos_ejecutables.forEach((paso, index) => {
      expect(paso['orden']).toBe(index + 1);
    });
  });

  it('inserta los campos obligatorios que el SOP no nombro, antes del paso que escribe', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: ['Abro Pantalla 3.', 'Completo el cliente.', 'Guardo el caso.'],
    });

    const indiceGuardar = resultado.pasos_ejecutables.findIndex(
      (paso) => paso['selector'] === '[data-testid="qa-screen3-save-button"]',
    );
    const indiceCuil = resultado.pasos_ejecutables.findIndex(
      (paso) => paso['selector'] === '[data-testid="qa-screen3-cuil-input"]',
    );

    expect(indiceCuil).toBeGreaterThan(-1);
    expect(indiceCuil).toBeLessThan(indiceGuardar);
    expect(resultado.pendientes).toEqual([]);
  });

  it('una regla global agrega al plan un campo que el catálogo trae opcional, si la regla lo marca obligatorio', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: PASOS_PANTALLA_3, // no menciona fecha_fin: es opcional en el catálogo
      reglasValidacion: [{ campo: 'fecha_fin', alcance: 'global', obligatorio: true }],
    });

    const campos = resultado.pasos_ejecutables
      .filter((paso) => paso['tipo'] === 'completar')
      .map((paso) => paso['campo']);
    expect(campos).toContain('fecha_fin');
  });

  it('una regla global saca del plan un campo que el SOP no menciona, si la regla lo marca opcional', async () => {
    const pasosSinTelefono = PASOS_PANTALLA_3.filter((linea) => !/telefono/i.test(linea));
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: pasosSinTelefono,
      reglasValidacion: [{ campo: 'telefono', alcance: 'global', obligatorio: false }],
    });

    const campos = resultado.pasos_ejecutables
      .filter((paso) => paso['tipo'] === 'completar')
      .map((paso) => paso['campo']);
    expect(campos).not.toContain('telefono');
  });

  it('una regla de otra pantalla no afecta el plan de Pantalla 3', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: PASOS_PANTALLA_3,
      reglasValidacion: [{ campo: 'fecha_fin', alcance: 'pantalla', ruta: '/qa/pantalla-1', obligatorio: true }],
    });

    const campos = resultado.pasos_ejecutables
      .filter((paso) => paso['tipo'] === 'completar')
      .map((paso) => paso['campo']);
    expect(campos).not.toContain('fecha_fin');
  });

  it('marca los campos con fuente navegacion, nunca inferido', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3 });
    const fuentes = resultado.campos.map((campo) => campo['fuente']);

    expect(fuentes.length).toBeGreaterThan(0);
    expect(fuentes.every((fuente) => (fuente as { tipo?: string })?.tipo === 'navegacion')).toBe(true);
  });

  it('descubre una ruta nueva pero la deja pendiente hasta registrar su fuente de casos', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-99', pasos: PASOS_PANTALLA_3 });

    expect(resultado.pendientes.join(' ')).toMatch(/fuente de casos QA/i);
  });

  it('deja pendiente una pantalla sin fuente de casos configurada', async () => {
    // SOP Loom no genera casos QA: no hay datos con los que operarla.
    const resultado = await compilar({
      ruta: '/qa/sop-loom',
      pasos: ['Abro SOP Loom.', 'Completo el texto del loom.', 'Guardo el flujo.'],
    });

    expect(resultado.pendientes.join(' ')).toMatch(/no tiene fuente de casos/i);
  });

  it('resuelve los casos de Pantalla 1, que se reconocen por origen.tipo', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-1',
      pasos: ['Abro Pantalla 1.', 'Completo el legajo.', 'Completo el empleado.', 'Guardo el caso.'],
      casos: [casoPantalla1('QA-GAN-RET-001')],
    });

    expect(resultado.casos).toHaveLength(1);
    // `empleado` vive en contexto.empleado.nombre: se resuelve por mapeo.
    expect(resultado.casos[0]['datos']).toMatchObject({
      legajo: '434',
      empleado: 'Coria Franco',
      cuil: '20-12436587-4',
      remuneracion_bruta: '150000',
      periodo: '08/2026',
      dataset: 'DS-AUD-GAN-082026',
    });
  });

  it('no compila un flujo sin accion que guarde', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: ['Abro Pantalla 3.', 'Reviso los casos cargados.'],
    });

    expect(resultado.pendientes.join(' ')).toMatch(/ninguna accion que guarde/i);
  });

  it('no automatiza una importacion sin ruta de archivo real', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: [...PASOS_PANTALLA_3, 'Despues presiono Importar Datos para la carga masiva.'],
    });

    expect(resultado.pendientes.join(' ')).toMatch(/ruta de archivo real/i);
    const selectores = resultado.pasos_ejecutables.map((paso) => paso['selector']);
    expect(selectores).not.toContain('[data-testid="qa-screen3-import-button"]');
  });

  it('no confunde "ingreso al menu" ni "dar de alta" con el campo fecha de ingreso', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: [
        'Ingreso al menu QA y abro Pantalla 3.',
        'Completo el cliente para dar de alta el registro.',
        'Guardo el caso.',
      ],
    });

    const pasoFechaIngreso = resultado.pasos_ejecutables.find(
      (paso) => paso['selector'] === '[data-testid="qa-screen3-fecha-ingreso-input"]',
    );

    expect(pasoFechaIngreso?.['origen']).toMatchObject({ tipo: 'navegacion', fuente_paso: 'sistema' });
  });

  it('con pendientes el estado nunca queda listo, aunque el frontend lo mande', () => {
    const service = new QaSopLoomService(null as never, modeloCasos([]) as never);
    const estado = (service as unknown as {
      estadoDesdeEntrada(valor: unknown, pendientes: string[]): string;
    }).estadoDesdeEntrada.bind(service);

    expect(estado('listo', ['falta algo'])).toBe('revisar');
    expect(estado('aprobado', ['falta algo'])).toBe('revisar');
    // Guardar nunca deja un aprendizaje aprobado: recompila e invalida la firma.
    expect(estado('aprobado', [])).toBe('listo');
    expect(estado('listo', [])).toBe('listo');
    expect(estado('borrador', [])).toBe('borrador');
  });

  it('no confunde "definir" con el campo fecha de fin', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: [...PASOS_PANTALLA_3, 'Queda por definir el tratamiento de bajas.'],
    });

    const selectores = resultado.pasos_ejecutables.map((paso) => paso['selector']);
    expect(selectores).not.toContain('[data-testid="qa-screen3-fecha-fin-input"]');
  });
});

describe('QaSopLoomService recorrido de pantallas', () => {
  it('un flujo de una sola pantalla devuelve esa pantalla, cubierta por el plan', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3 });

    expect(resultado.recorrido).toHaveLength(1);
    expect(resultado.recorrido[0]).toMatchObject({
      orden: 1,
      ruta: '/qa/pantalla-3',
      cubierta: true,
      instrumentada: true,
    });
    expect(resultado.recorrido[0]['pasos']).toBe(resultado.pasos_ejecutables.length);
    expect(resultado.recorrido[0]['campos']).toBe(resultado.campos.length);
  });

  it('un SOP que salta de una pantalla a otra las devuelve en el orden en que las nombra', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-1',
      pasos: [
        'Abro Pantalla 1 y completo el legajo.',
        'Toco Siguiente y eso me lleva a Pantalla 3.',
        'Completo el CUIL y guardo el caso.',
      ],
    });

    expect(resultado.recorrido.map((pantalla) => pantalla['ruta'])).toEqual([
      '/qa/pantalla-1',
      '/qa/pantalla-3',
    ]);
  });

  it('marca cubierta solo la pantalla que el plan compila, no las demas que el SOP nombra', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-1',
      pasos: [
        'Abro Pantalla 1 y completo el legajo.',
        'Toco Siguiente y eso me lleva a Pantalla 3.',
        'Completo el CUIL y guardo el caso.',
      ],
    });

    const porRuta = new Map(resultado.recorrido.map((pantalla) => [pantalla['ruta'], pantalla]));
    expect(porRuta.get('/qa/pantalla-1')?.['cubierta']).toBe(true);
    expect(porRuta.get('/qa/pantalla-3')?.['cubierta']).toBe(false);
    expect(porRuta.get('/qa/pantalla-3')?.['pasos']).toBe(0);
  });

  it('avisa que la pantalla secundaria no tiene pasos cuando no se pudo compilar', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-1',
      pasos: [
        'Abro Pantalla 1 y completo el legajo.',
        'Toco Siguiente y eso me lleva a Pantalla 3.',
        'Completo el CUIL y guardo el caso.',
      ],
    });

    expect(resultado.pendientes.join(' ')).toMatch(/no ejecuta ning[uú]n paso ah[ií]/i);
  });

  it('incluye la pantalla compilada aunque el texto del SOP no la nombre', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-3',
      pasos: ['Completo el cliente.', 'Completo el CUIL.', 'Guardo el caso.'],
    });

    expect(resultado.recorrido.map((pantalla) => pantalla['ruta'])).toEqual(['/qa/pantalla-3']);
    expect(resultado.recorrido[0]['cubierta']).toBe(true);
  });

  it('la pantalla cubierta trae el id de su propia inspección, para pedir su foto', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3 });

    expect(resultado.recorrido[0]['inspeccion_id']).toBe('QA-NAV-qapantalla3');
  });

  it('una pantalla nombrada pero no cubierta presta la ultima inspeccion con foto de esa ruta', async () => {
    const resultado = await compilar({
      ruta: '/qa/pantalla-1',
      pasos: [
        'Abro Pantalla 1 y completo el legajo.',
        'Toco Siguiente y eso me lleva a Pantalla 3.',
        'Completo el CUIL y guardo el caso.',
      ],
      capturasPorRuta: { '/qa/pantalla-3': 'QA-NAV-VIEJA-PANTALLA-3' },
    });

    const pantalla3 = resultado.recorrido.find((pantalla) => pantalla['ruta'] === '/qa/pantalla-3');
    expect(pantalla3?.['inspeccion_id']).toBe('QA-NAV-VIEJA-PANTALLA-3');
  });

  it('sin inspector disponible o sin foto previa, la pantalla no cubierta queda sin inspeccion_id', async () => {
    const sinInspector = await compilar({
      ruta: '/qa/pantalla-1',
      pasos: ['Abro Pantalla 1.', 'Toco Siguiente y eso me lleva a Pantalla 3.', 'Guardo.'],
    });
    const pantalla3SinInspector = sinInspector.recorrido.find((pantalla) => pantalla['ruta'] === '/qa/pantalla-3');
    expect(pantalla3SinInspector?.['inspeccion_id']).toBe('');

    const sinFotoPrevia = await compilar({
      ruta: '/qa/pantalla-1',
      pasos: ['Abro Pantalla 1.', 'Toco Siguiente y eso me lleva a Pantalla 3.', 'Guardo.'],
      capturasPorRuta: {},
    });
    const pantalla3SinFoto = sinFotoPrevia.recorrido.find((pantalla) => pantalla['ruta'] === '/qa/pantalla-3');
    expect(pantalla3SinFoto?.['inspeccion_id']).toBe('');
  });
});

describe('QaSopLoomService compilacion multi-pantalla', () => {
  /** Un SOP que arranca en Legajo de Ganancias y sigue en Legajo de Cliente. */
  const PASOS_SALTO = [
    'Abro Pantalla 1 y completo el legajo.',
    'Toco Siguiente y eso me lleva a Pantalla 3.',
    'Completo el cliente y guardo el caso.',
  ];

  const AMBAS = { ruta: '/qa/pantalla-1', pasos: PASOS_SALTO, rutasExtra: ['/qa/pantalla-3'] };

  function navegaciones(resultado: { pasos_ejecutables: Array<Record<string, unknown>> }): unknown[] {
    return resultado.pasos_ejecutables.filter((paso) => paso['tipo'] === 'navegar').map((paso) => paso['valor']);
  }

  it('emite un navegar por pantalla, en el orden en que el SOP las recorre', async () => {
    const resultado = await compilar(AMBAS);

    expect(navegaciones(resultado)).toEqual(['/qa/pantalla-1', '/qa/pantalla-3']);
  });

  it('resuelve los campos de cada tramo contra los selectores de su propia pantalla', async () => {
    const resultado = await compilar(AMBAS);

    const selectores = resultado.pasos_ejecutables
      .filter((paso) => paso['tipo'] === 'completar')
      .map((paso) => paso['selector']);
    expect(selectores).toContain('[data-testid="qa-case-legajo-input"]');
    expect(selectores).toContain('[data-testid="qa-screen3-cliente-input"]');
  });

  it('el campo de la pantalla secundaria queda despues de haber navegado a ella', async () => {
    const resultado = await compilar(AMBAS);

    const tipos = resultado.pasos_ejecutables.map((paso) => `${paso['tipo']}:${paso['selector'] ?? paso['valor']}`);
    const navegoAPantalla3 = tipos.indexOf('navegar:/qa/pantalla-3');
    const completoCliente = tipos.indexOf('completar:[data-testid="qa-screen3-cliente-input"]');
    expect(navegoAPantalla3).toBeGreaterThanOrEqual(0);
    expect(completoCliente).toBeGreaterThan(navegoAPantalla3);
  });

  it('marca cubiertas las dos pantallas del recorrido, con sus propios conteos', async () => {
    const resultado = await compilar(AMBAS);

    const porRuta = new Map(resultado.recorrido.map((pantalla) => [pantalla['ruta'], pantalla]));
    expect(porRuta.get('/qa/pantalla-1')?.['cubierta']).toBe(true);
    expect(porRuta.get('/qa/pantalla-3')?.['cubierta']).toBe(true);
    expect(Number(porRuta.get('/qa/pantalla-3')?.['pasos'])).toBeGreaterThan(0);
  });

  it('devuelve una inspeccion por pantalla compilada, para poder revalidarlas todas antes de correr', async () => {
    const resultado = await compilar(AMBAS);

    expect(resultado.inspecciones.map((item) => item['ruta'])).toEqual(['/qa/pantalla-1', '/qa/pantalla-3']);
  });

  it('sin inspeccion de la pantalla secundaria no compila ese tramo y lo deja pendiente', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-1', pasos: PASOS_SALTO });

    expect(navegaciones(resultado)).toEqual(['/qa/pantalla-1']);
    expect(resultado.pendientes.join(' ')).toMatch(/todav[ií]a no se inspeccion/i);
  });

  it('avisa cuando el caso de la pantalla de entrada no trae los datos que pide la secundaria', async () => {
    const resultado = await compilar({
      ...AMBAS,
      casos: [{
        id: 'QA-GAN-SOLO-LEGAJO',
        activo: true,
        origen: { tipo: 'formulario_qa_pantalla_1' },
        contexto: { empleado: { legajo: '5' } },
      }],
    });

    const pendientes = resultado.pendientes.join(' ');
    expect(pendientes).toMatch(/no traen/i);
    expect(pendientes).toMatch(/cliente/i);
  });

  it('un flujo de una sola pantalla sigue compilando un unico tramo', async () => {
    const resultado = await compilar({ ruta: '/qa/pantalla-3', pasos: PASOS_PANTALLA_3 });

    expect(navegaciones(resultado)).toEqual(['/qa/pantalla-3']);
    expect(resultado.inspecciones).toHaveLength(1);
  });
});
