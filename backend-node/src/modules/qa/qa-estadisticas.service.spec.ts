import { QaEstadisticasService } from './qa-estadisticas.service';

interface CasoFake {
  id: string;
  activo?: boolean;
  origen?: Record<string, unknown>;
}

interface EjecucionFake {
  caso_id: string;
  estado: string;
  iniciado_en: string;
}

interface EjecucionSopLoomFake {
  ruta: string;
  estado: string;
  iniciada_en: string;
  pantalla_nombre?: string;
}

interface HallazgoFake {
  tipo: string;
  severidad: string;
  estado: string;
}

/** Lee un valor por ruta con puntos (`origen.tipo`) en un objeto anidado, como lo haría Mongo. */
function porRuta(doc: unknown, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((actual, tramo) => {
    if (!actual || typeof actual !== 'object') return undefined;
    return (actual as Record<string, unknown>)[tramo];
  }, doc);
}

function coincideCondicion(actual: unknown, condicion: unknown): boolean {
  if (condicion && typeof condicion === 'object' && !Array.isArray(condicion)) {
    const operadores = condicion as Record<string, unknown>;
    if ('$in' in operadores) return (operadores['$in'] as unknown[]).includes(actual);
    if ('$ne' in operadores) return actual !== operadores['$ne'];
    if ('$gte' in operadores) return String(actual ?? '') >= String(operadores['$gte']);
  }
  return actual === condicion;
}

/**
 * Query encadenable al estilo Mongoose: `.sort()/.limit()/.select()` se
 * pueden llamar en cualquier orden (como hace el código real) y `.lean()`
 * siempre cierra la cadena.
 */
function query<T extends object>(resultado: T[]) {
  let items = resultado;
  const self = {
    sort: (criterio: Record<string, 1 | -1>) => {
      const [campo, direccion] = Object.entries(criterio)[0] ?? [];
      if (campo) {
        items = [...items].sort((a, b) => {
          const va = String((a as Record<string, unknown>)[campo] ?? '');
          const vb = String((b as Record<string, unknown>)[campo] ?? '');
          return direccion === -1 ? vb.localeCompare(va) : va.localeCompare(vb);
        });
      }
      return self;
    },
    limit: (n: number) => {
      items = items.slice(0, n);
      return self;
    },
    select: () => self,
    lean: async () => items,
  };
  return self;
}

/** Stub de un modelo Mongoose: soporta find(), findOne() y countDocuments() con el encadenado real que usa el servicio. */
function modeloConsulta<T extends object>(docs: T[], ordenarPor?: keyof T) {
  const coincide = (doc: T, filtro: Record<string, unknown>): boolean =>
    Object.entries(filtro).every(([clave, valor]) => {
      if (clave === '$or') {
        return (valor as Record<string, unknown>[]).some((sub) => coincide(doc, sub));
      }
      return coincideCondicion(porRuta(doc, clave), valor);
    });

  return {
    find(filtro: Record<string, unknown> = {}) {
      return query(docs.filter((doc) => coincide(doc, filtro)));
    },
    findOne(filtro: Record<string, unknown> = {}) {
      const encontrados = docs.filter((doc) => coincide(doc, filtro));
      return {
        sort: () => ({
          select: () => ({
            lean: async () => {
              if (encontrados.length === 0) return null;
              if (!ordenarPor) return encontrados[0];
              return [...encontrados].sort((a, b) => String(b[ordenarPor]).localeCompare(String(a[ordenarPor])))[0];
            },
          }),
        }),
      };
    },
    countDocuments: async (filtro: Record<string, unknown> = {}) => docs.filter((doc) => coincide(doc, filtro)).length,
  };
}

function servicio(datos: {
  casos?: CasoFake[];
  ejecuciones?: EjecucionFake[];
  ejecucionesSopLoom?: EjecucionSopLoomFake[];
  hallazgos?: HallazgoFake[];
}): QaEstadisticasService {
  return new QaEstadisticasService(
    modeloConsulta(datos.casos ?? []) as never,
    modeloConsulta(datos.ejecuciones ?? [], 'iniciado_en') as never,
    modeloConsulta(datos.ejecucionesSopLoom ?? [], 'iniciada_en') as never,
    modeloConsulta(datos.hallazgos ?? []) as never,
  );
}

function casoGanancias(id: string): CasoFake {
  return { id, activo: true, origen: { tipo: 'formulario_qa_pantalla_1' } };
}

function casoCliente(id: string): CasoFake {
  return { id, activo: true, origen: { tipo: 'formulario_cliente_basico' } };
}

describe('QaEstadisticasService.resumen', () => {
  it('sin datos, cada pantalla catalogada aparece en cero', async () => {
    const resultado = await servicio({}).resumen();

    const pantallas = resultado['pantallas'] as Array<Record<string, unknown>>;
    expect(pantallas.length).toBeGreaterThanOrEqual(2);
    for (const pantalla of pantallas) {
      expect(pantalla['casos_total']).toBe(0);
      expect(pantalla['ejecuciones_total']).toBe(0);
      expect(pantalla['tasa_exito']).toBeNull();
    }
    expect((resultado['resumen'] as Record<string, unknown>)['pantalla_mas_corrida']).toBeNull();
  });

  it('cuenta ejecuciones de Legajo de Ganancias por caso_id (runner genérico)', async () => {
    const resultado = await servicio({
      casos: [casoGanancias('QA-GAN-1'), casoGanancias('QA-GAN-2')],
      ejecuciones: [
        { caso_id: 'QA-GAN-1', estado: 'verde', iniciado_en: '2026-08-01T10:00:00.000Z' },
        { caso_id: 'QA-GAN-1', estado: 'rojo', iniciado_en: '2026-08-02T10:00:00.000Z' },
        { caso_id: 'QA-GAN-2', estado: 'verde', iniciado_en: '2026-08-03T10:00:00.000Z' },
      ],
    }).resumen();

    const ganancias = (resultado['pantallas'] as Array<Record<string, unknown>>)
      .find((item) => item['ruta'] === '/qa/pantalla-1');
    expect(ganancias).toMatchObject({
      casos_total: 2,
      ejecuciones_total: 3,
      ejecuciones_verde: 2,
      ejecuciones_rojo: 1,
      tasa_exito: 66.7,
      ultima_ejecucion_en: '2026-08-03T10:00:00.000Z',
    });
  });

  it('cuenta ejecuciones de Legajo de Cliente por ruta, no por caso (se opera vía SOP Loom)', async () => {
    const resultado = await servicio({
      casos: [casoCliente('QA-P3-1')],
      ejecucionesSopLoom: [
        { ruta: '/qa/pantalla-3', estado: 'verde', iniciada_en: '2026-08-01T10:00:00.000Z' },
        { ruta: '/qa/pantalla-3', estado: 'verde', iniciada_en: '2026-08-02T10:00:00.000Z' },
        { ruta: '/qa/pantalla-3', estado: 'rojo', iniciada_en: '2026-08-03T10:00:00.000Z' },
        { ruta: '/qa/pantalla-3', estado: 'rojo', iniciada_en: '2026-08-04T10:00:00.000Z' },
      ],
    }).resumen();

    const cliente = (resultado['pantallas'] as Array<Record<string, unknown>>)
      .find((item) => item['ruta'] === '/qa/pantalla-3');
    expect(cliente).toMatchObject({
      casos_total: 1,
      ejecuciones_total: 4,
      ejecuciones_verde: 2,
      ejecuciones_rojo: 2,
      tasa_exito: 50,
    });
  });

  it('ordena las pantallas de mayor a menor cantidad de ejecuciones', async () => {
    const resultado = await servicio({
      ejecucionesSopLoom: [
        { ruta: '/qa/pantalla-3', estado: 'verde', iniciada_en: '2026-08-01T10:00:00.000Z' },
        { ruta: '/qa/pantalla-3', estado: 'verde', iniciada_en: '2026-08-02T10:00:00.000Z' },
        { ruta: '/qa/pantalla-3', estado: 'verde', iniciada_en: '2026-08-03T10:00:00.000Z' },
      ],
      casos: [casoGanancias('QA-GAN-1')],
      ejecuciones: [{ caso_id: 'QA-GAN-1', estado: 'verde', iniciado_en: '2026-08-01T10:00:00.000Z' }],
    }).resumen();

    const pantallas = resultado['pantallas'] as Array<Record<string, unknown>>;
    expect(pantallas[0]['ruta']).toBe('/qa/pantalla-3');
    expect((resultado['resumen'] as Record<string, unknown>)['pantalla_mas_corrida']).toBe('Legajo de Cliente');
  });

  it('resume hallazgos por severidad, tipo y cuántos siguen abiertos', async () => {
    const resultado = await servicio({
      hallazgos: [
        { tipo: 'negocio', severidad: 'alta', estado: 'abierto' },
        { tipo: 'negocio', severidad: 'alta', estado: 'resuelto' },
        { tipo: 'estructural', severidad: 'media', estado: 'abierto' },
      ],
    }).resumen();

    expect(resultado['hallazgos']).toMatchObject({
      total: 3,
      abiertos: 2,
      por_severidad: { alta: 2, media: 1 },
      por_tipo: { negocio: 2, estructural: 1 },
    });
  });

  it('no cuenta casos dados de baja ni ejecuciones de otra pantalla', async () => {
    const resultado = await servicio({
      casos: [
        casoGanancias('QA-GAN-1'),
        { id: 'QA-GAN-BAJA', activo: false, origen: { tipo: 'formulario_qa_pantalla_1' } },
      ],
      ejecuciones: [
        { caso_id: 'QA-GAN-1', estado: 'verde', iniciado_en: '2026-08-01T10:00:00.000Z' },
        { caso_id: 'QA-GAN-BAJA', estado: 'verde', iniciado_en: '2026-08-01T10:00:00.000Z' },
        { caso_id: 'QA-CASO-INEXISTENTE', estado: 'rojo', iniciado_en: '2026-08-01T10:00:00.000Z' },
      ],
    }).resumen();

    const ganancias = (resultado['pantallas'] as Array<Record<string, unknown>>)
      .find((item) => item['ruta'] === '/qa/pantalla-1');
    expect(ganancias).toMatchObject({ casos_total: 1, ejecuciones_total: 1, ejecuciones_verde: 1 });
  });
});

function haceNDias(n: number): string {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() - n);
  fecha.setUTCHours(12, 0, 0, 0);
  return fecha.toISOString();
}

describe('QaEstadisticasService.resumen - evolucion diaria', () => {
  it('devuelve 14 dias, incluyendo los que no tuvieron corridas, sin saltear ninguno', async () => {
    const resultado = await servicio({}).resumen();
    const evolucion = resultado['evolucion'] as Array<Record<string, unknown>>;

    expect(evolucion).toHaveLength(14);
    expect(evolucion.every((dia) => dia['ejecuciones'] === 0)).toBe(true);
    // Ultimo dia de la serie es hoy.
    expect(evolucion[13]['fecha']).toBe(new Date().toISOString().slice(0, 10));
  });

  it('suma ejecuciones de ambas fuentes en el dia que realmente corrieron', async () => {
    const resultado = await servicio({
      casos: [casoGanancias('QA-GAN-1')],
      ejecuciones: [{ caso_id: 'QA-GAN-1', estado: 'verde', iniciado_en: haceNDias(2) }],
      ejecucionesSopLoom: [{ ruta: '/qa/pantalla-3', estado: 'verde', iniciada_en: haceNDias(2) }],
    }).resumen();

    const evolucion = resultado['evolucion'] as Array<Record<string, unknown>>;
    const diaClave = haceNDias(2).slice(0, 10);
    const dia = evolucion.find((item) => item['fecha'] === diaClave);
    expect(dia?.['ejecuciones']).toBe(2);
  });

  it('ignora ejecuciones de mas de 14 dias atras', async () => {
    const resultado = await servicio({
      casos: [casoGanancias('QA-GAN-1')],
      ejecuciones: [{ caso_id: 'QA-GAN-1', estado: 'verde', iniciado_en: haceNDias(20) }],
    }).resumen();

    const evolucion = resultado['evolucion'] as Array<Record<string, unknown>>;
    expect(evolucion.reduce((acc, item) => acc + (item['ejecuciones'] as number), 0)).toBe(0);
  });

  it('calcula el delta entre la ultima semana y la anterior', async () => {
    const resultado = await servicio({
      casos: [casoGanancias('QA-GAN-1')],
      ejecuciones: [
        // Semana anterior (dias 13 a 7): 1 corrida.
        { caso_id: 'QA-GAN-1', estado: 'verde', iniciado_en: haceNDias(10) },
        // Semana actual (dias 6 a 0): 3 corridas.
        { caso_id: 'QA-GAN-1', estado: 'verde', iniciado_en: haceNDias(5) },
        { caso_id: 'QA-GAN-1', estado: 'verde', iniciado_en: haceNDias(2) },
        { caso_id: 'QA-GAN-1', estado: 'verde', iniciado_en: haceNDias(0) },
      ],
    }).resumen();

    const resumen = resultado['resumen'] as Record<string, unknown>;
    // (3 - 1) / 1 * 100 = 200%
    expect(resumen['delta_ejecuciones_pct']).toBe(200);
  });

  it('sin corridas en ningun periodo, el delta es null en vez de dividir por cero', async () => {
    const resultado = await servicio({}).resumen();
    const resumen = resultado['resumen'] as Record<string, unknown>;
    expect(resumen['delta_ejecuciones_pct']).toBeNull();
  });
});

describe('QaEstadisticasService.resumen - actividad reciente', () => {
  it('mezcla ejecuciones de las dos fuentes y hallazgos, ordenados del mas nuevo al mas viejo', async () => {
    const resultado = await servicio({
      casos: [casoGanancias('QA-GAN-1')],
      ejecuciones: [
        { caso_id: 'QA-GAN-1', estado: 'verde', iniciado_en: '2026-08-01T10:00:00.000Z' },
      ],
      ejecucionesSopLoom: [
        { ruta: '/qa/pantalla-3', estado: 'rojo', iniciada_en: '2026-08-03T10:00:00.000Z', pantalla_nombre: 'Legajo de Cliente' },
      ],
      hallazgos: [
        { tipo: 'negocio', severidad: 'alta', estado: 'abierto' },
      ],
    }).resumen();

    const actividad = resultado['actividad'] as Array<Record<string, unknown>>;
    expect(actividad.length).toBeGreaterThanOrEqual(2);
    expect(actividad[0]['tipo']).toBe('ejecucion_rojo');
    expect(actividad[0]['pantalla']).toBe('Legajo de Cliente');
  });

  it('no incluye ejecuciones que todavia estan corriendo', async () => {
    const resultado = await servicio({
      casos: [casoGanancias('QA-GAN-1')],
      ejecuciones: [
        { caso_id: 'QA-GAN-1', estado: 'corriendo', iniciado_en: '2026-08-01T10:00:00.000Z' },
      ],
    }).resumen();

    const actividad = resultado['actividad'] as Array<Record<string, unknown>>;
    expect(actividad.some((item) => item['detalle'] === 'Ejecución completada' || item['detalle'] === 'Ejecución fallida')).toBe(false);
  });

  it('recorta la actividad a un maximo de 8 eventos', async () => {
    const casos = [casoGanancias('QA-GAN-1')];
    const ejecuciones = Array.from({ length: 12 }, (_, i) => ({
      caso_id: 'QA-GAN-1',
      estado: 'verde',
      iniciado_en: haceNDias(i),
    }));
    const resultado = await servicio({ casos, ejecuciones }).resumen();
    const actividad = resultado['actividad'] as Array<Record<string, unknown>>;
    expect(actividad.length).toBeLessThanOrEqual(8);
  });
});
