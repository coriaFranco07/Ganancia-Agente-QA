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
  }
  return actual === condicion;
}

/** Stub de un modelo Mongoose: soporta find().select().lean(), findOne().sort().select().lean() y countDocuments(). */
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
      const encontrados = docs.filter((doc) => coincide(doc, filtro));
      return {
        select: () => ({ lean: async () => encontrados }),
      };
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
