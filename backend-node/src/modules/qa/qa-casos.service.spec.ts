import { BadRequestException } from '@nestjs/common';
import { QaCasosService } from './qa-casos.service';

/** Stub del modelo de casos: soporta find().sort().lean(). */
function modeloCasos(casos: Array<Record<string, unknown>>) {
  return {
    find: () => ({
      sort: () => ({ lean: async () => casos }),
    }),
  };
}

function servicio(casos: Array<Record<string, unknown>> = []): QaCasosService {
  return new QaCasosService(modeloCasos(casos) as never, {} as never, {} as never);
}

function casoPantalla3(id: string, datos: Record<string, string>): Record<string, unknown> {
  return {
    id,
    activo: true,
    updatedAt: new Date('2026-08-28T18:00:00.000Z'),
    contexto: { contexto_complementario: { pantalla_3: datos, origen: { pantalla: 'QA - Pantalla 3' } } },
    origen: { pantalla: 'QA - Pantalla 3' },
  };
}

function casoPantalla1(id: string): Record<string, unknown> {
  return {
    id,
    activo: true,
    updatedAt: new Date('2026-08-24T13:00:00.000Z'),
    dataset_codigo: 'DS-AUD-GAN-082026',
    periodo: '08/2026',
    contexto: { empleado: { legajo: '6', nombre: 'Coria Franco', cuil: '20-12436587-4' }, liquidacion: {} },
    origen: { tipo: 'formulario_qa_pantalla_1' },
  };
}

/** Stub del modelo de casos con soporte para guardar(): find/sort/lean + findOneAndUpdate con upsert. */
function modeloCasosGuardable(casos: Array<Record<string, unknown>> = []) {
  return {
    find: () => ({ sort: () => ({ lean: async () => casos }) }),
    findOneAndUpdate(filtro: Record<string, unknown>, update: Record<string, unknown>) {
      let doc = casos.find((item) => item['id'] === filtro['id']);
      const set = (update['$set'] as Record<string, unknown>) ?? {};
      if (!doc) {
        doc = { ...set };
        casos.push(doc);
      } else {
        Object.assign(doc, set);
      }
      return { lean: async () => doc };
    },
  };
}

function definicionesTecnicasStub() {
  return { obtenerParaUso: async () => ({ codigo: 'DEF-TEST' }) };
}

function datasetsStub() {
  return {
    resolverParaCaso: async () => null,
    obtener: async () => ({ periodo: '08/2026' }),
  };
}

function reglasStub(resueltas: Array<Record<string, unknown>>) {
  return { listarResueltas: async () => resueltas };
}

function servicioGuardar(casos: Array<Record<string, unknown>> = [], reglas?: Array<Record<string, unknown>>): QaCasosService {
  return new QaCasosService(
    modeloCasosGuardable(casos) as never,
    datasetsStub() as never,
    definicionesTecnicasStub() as never,
    reglas ? (reglasStub(reglas) as never) : undefined,
  );
}

function fechaISO(offsetDias: number): string {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + offsetDias);
  return fecha.toISOString().slice(0, 10);
}

function payloadPantalla3(datos: Partial<Record<'cliente' | 'area_sector' | 'telefono' | 'numero_documento' | 'cuil' | 'fecha_ingreso', string>> = {}): Record<string, unknown> {
  const base = {
    cliente: 'Acme SA',
    area_sector: 'Administracion',
    telefono: '2613355822',
    numero_documento: '12345678',
    cuil: '20-12436587-4',
    fecha_ingreso: '2026-01-01',
    ...datos,
  };
  return {
    id: 'QA-P3-TEST-1',
    origen: { pantalla: 'QA - Pantalla 3' },
    contexto: {
      contexto_complementario: { pantalla_3: base, origen: { pantalla: 'QA - Pantalla 3' } },
    },
  };
}

function payloadPantalla1(datos: Partial<Record<'legajo' | 'nombre' | 'cuil' | 'cliente_nombre', string>> = {}): Record<string, unknown> {
  return {
    id: 'QA-GAN-TEST-1',
    origen: { tipo: 'formulario_qa_pantalla_1' },
    contexto: {
      empleado: { legajo: datos.legajo ?? '6', nombre: datos.nombre ?? 'Coria Franco', cuil: datos.cuil ?? '20-12436587-4' },
      liquidacion: {},
      contexto_complementario: datos.cliente_nombre ? { datos_cliente: { cliente_nombre: datos.cliente_nombre } } : {},
    },
  };
}

describe('QaCasosService.fuentes', () => {
  it('expone las pantallas con fuente de casos, sin el campo id redundante', () => {
    const fuentes = servicio().fuentes();
    const rutas = fuentes.map((f) => f.ruta);

    expect(rutas).toContain('/qa/pantalla-1');
    expect(rutas).toContain('/qa/pantalla-3');

    const pantalla1 = fuentes.find((f) => f.ruta === '/qa/pantalla-1');
    expect(pantalla1).toBeDefined();
    const claves = ((pantalla1 as Record<string, unknown>).campos as Array<{ clave: string }>).map((c) => c.clave);
    expect(claves).not.toContain('id');
    expect(claves).toContain('legajo');
  });

  it('marca Pantalla 1 como ejecutable y Pantalla 3 como no ejecutable', () => {
    const fuentes = servicio().fuentes();
    const p1 = fuentes.find((f) => f.ruta === '/qa/pantalla-1') as Record<string, unknown>;
    const p3 = fuentes.find((f) => f.ruta === '/qa/pantalla-3') as Record<string, unknown>;
    expect(p1['ejecutable']).toBe(true);
    expect(p3['ejecutable']).toBe(false);
  });

  it('no incluye pantallas sin fuente de casos, como SOP Loom', () => {
    const fuentes = servicio().fuentes();
    expect(fuentes.map((f) => f.ruta)).not.toContain('/qa/sop-loom');
  });
});

describe('QaCasosService.listarPorPantalla', () => {
  it('resuelve los datos de Pantalla 3 a valores planos', async () => {
    const casos = [casoPantalla3('QA-P3-A', {
      cliente: 'Distribuidora del Oeste SA',
      area_sector: 'Administracion',
      cuil: '27-27345678-4',
    })];

    const resultado = await servicio(casos).listarPorPantalla('/qa/pantalla-3');

    expect(resultado).toHaveLength(1);
    expect(resultado[0]['datos']).toMatchObject({
      cliente: 'Distribuidora del Oeste SA',
      area_sector: 'Administracion',
      cuil: '27-27345678-4',
    });
  });

  it('resuelve los datos de Pantalla 1, que usa mapeo para claves que no coinciden', async () => {
    const resultado = await servicio([casoPantalla1('QA-GAN-RET-001')]).listarPorPantalla('/qa/pantalla-1');

    expect(resultado).toHaveLength(1);
    expect(resultado[0]['datos']).toMatchObject({
      legajo: '6',
      empleado: 'Coria Franco',
      cuil: '20-12436587-4',
      dataset: 'DS-AUD-GAN-082026',
      periodo: '08/2026',
    });
  });

  it('rechaza una ruta sin fuente de casos declarada', async () => {
    await expect(servicio().listarPorPantalla('/qa/sop-loom')).rejects.toThrow(BadRequestException);
  });

  it('rechaza una ruta que no existe en el catalogo', async () => {
    await expect(servicio().listarPorPantalla('/qa/no-existe')).rejects.toThrow(BadRequestException);
  });
});

describe('QaCasosService.guardar contra las reglas de validación', () => {
  it('guarda un caso de Pantalla 3 que cumple el formato de fábrica (CUIL 11 dígitos, teléfono >= 6)', async () => {
    await expect(servicioGuardar().guardar(payloadPantalla3())).resolves.toMatchObject({ id: 'QA-P3-TEST-1' });
  });

  it('rechaza un CUIL de Pantalla 3 que no tiene 11 dígitos, usando el default del catálogo', async () => {
    await expect(servicioGuardar().guardar(payloadPantalla3({ cuil: '2012436587' })))
      .rejects.toMatchObject({
        response: expect.objectContaining({
          errores: expect.arrayContaining([expect.stringContaining('11 dígitos')]),
        }),
      });
  });

  it('rechaza un teléfono de Pantalla 3 con menos de 6 dígitos', async () => {
    await expect(servicioGuardar().guardar(payloadPantalla3({ telefono: '123' })))
      .rejects.toMatchObject({
        response: expect.objectContaining({
          errores: expect.arrayContaining([expect.stringContaining('al menos 6 dígitos')]),
        }),
      });
  });

  it('una regla global puede reemplazar el largo exacto del CUIL del catálogo para todas las pantallas', async () => {
    const reglas = [{ campo: 'cuil', alcance: 'global', ruta: '', obligatorio: null, largo_exacto: 10, largo_minimo: null, largo_maximo: null, patron: '', patron_mensaje: '' }];
    await expect(servicioGuardar([], reglas).guardar(payloadPantalla3({ cuil: '2012436587' })))
      .resolves.toMatchObject({ id: 'QA-P3-TEST-1' });
  });

  it('una regla de fecha bloquea un caso cuya fecha_ingreso queda fuera de la ventana permitida', async () => {
    const reglas = [{
      campo: 'fecha_ingreso', alcance: 'pantalla', ruta: '/qa/pantalla-3', obligatorio: null,
      largo_exacto: null, largo_minimo: null, largo_maximo: null, patron: '', patron_mensaje: '',
      valor_minimo: null, valor_maximo: null, dias_atras_max: null, dias_adelante_max: 5,
    }];
    await expect(servicioGuardar([], reglas).guardar(payloadPantalla3({ fecha_ingreso: fechaISO(20) })))
      .rejects.toMatchObject({
        response: expect.objectContaining({
          errores: expect.arrayContaining([expect.stringContaining('posterior a hoy')]),
        }),
      });
  });

  it('la misma regla de fecha deja pasar un caso dentro de la ventana permitida', async () => {
    const reglas = [{
      campo: 'fecha_ingreso', alcance: 'pantalla', ruta: '/qa/pantalla-3', obligatorio: null,
      largo_exacto: null, largo_minimo: null, largo_maximo: null, patron: '', patron_mensaje: '',
      valor_minimo: null, valor_maximo: null, dias_atras_max: null, dias_adelante_max: 5,
    }];
    await expect(servicioGuardar([], reglas).guardar(payloadPantalla3({ fecha_ingreso: fechaISO(2) })))
      .resolves.toMatchObject({ id: 'QA-P3-TEST-1' });
  });

  it('una regla de pantalla puntual hace obligatorio un campo que en el catálogo es opcional', async () => {
    const reglas = [{ campo: 'cliente', alcance: 'pantalla', ruta: '/qa/pantalla-1', obligatorio: true, largo_exacto: null, largo_minimo: null, largo_maximo: null, patron: '', patron_mensaje: '' }];
    const svc = servicioGuardar([], reglas);

    await expect(svc.guardar(payloadPantalla1())).rejects.toMatchObject({
      response: expect.objectContaining({ errores: expect.arrayContaining([expect.stringContaining('Cliente')]) }),
    });
    await expect(servicioGuardar([], reglas).guardar(payloadPantalla1({ cliente_nombre: 'NETSER SA' })))
      .resolves.toMatchObject({ id: 'QA-GAN-TEST-1' });
  });

  it('una regla de otra pantalla no afecta a Pantalla 1', async () => {
    const reglas = [{ campo: 'cliente', alcance: 'pantalla', ruta: '/qa/pantalla-3', obligatorio: true, largo_exacto: null, largo_minimo: null, largo_maximo: null, patron: '', patron_mensaje: '' }];
    await expect(servicioGuardar([], reglas).guardar(payloadPantalla1())).resolves.toMatchObject({ id: 'QA-GAN-TEST-1' });
  });
});
