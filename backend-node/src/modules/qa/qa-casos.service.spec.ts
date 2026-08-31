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
