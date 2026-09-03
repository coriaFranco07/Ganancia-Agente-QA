import { QaReglasValidacionService } from './qa-reglas-validacion.service';

/** Stub del modelo de reglas: soporta find().sort().lean() y findOneAndUpdate() con upsert. */
function modeloReglas(docs: Array<Record<string, unknown>> = []) {
  return {
    find(filtro: Record<string, unknown>) {
      const activos = filtro['activo'] ? docs.filter((doc) => doc['activo'] !== false) : docs;
      return { sort: () => ({ lean: async () => activos }), lean: async () => activos };
    },
    findOneAndUpdate(filtro: Record<string, unknown>, update: Record<string, unknown>) {
      const esUpsertPorId = Object.keys(filtro).length === 1 && filtro['id'] !== undefined;
      let doc = docs.find((item) => item['id'] === filtro['id']);
      if (doc && filtro['activo'] && (doc['activo'] as boolean) === false) doc = undefined;
      const set = (update['$set'] as Record<string, unknown>) ?? {};
      if (!doc) {
        if (!esUpsertPorId) return { lean: async () => null };
        doc = { ...set };
        docs.push(doc);
      } else {
        Object.assign(doc, set);
      }
      return { lean: async () => doc };
    },
  };
}

function servicio(docs: Array<Record<string, unknown>> = []): QaReglasValidacionService {
  return new QaReglasValidacionService(modeloReglas(docs) as never);
}

describe('QaReglasValidacionService.catalogo', () => {
  it('expone las pantallas con campos, con clave, etiqueta y tipo', () => {
    const catalogo = servicio().catalogo();
    const pantalla3 = catalogo.find((p) => p.ruta === '/qa/pantalla-3');

    expect(pantalla3).toBeDefined();
    const cuil = pantalla3?.campos.find((c) => c.clave === 'cuil');
    expect(cuil).toBeDefined();
    expect(cuil?.tipo).toBe('texto');

    const fechaIngreso = pantalla3?.campos.find((c) => c.clave === 'fecha_ingreso');
    expect(fechaIngreso?.tipo).toBe('fecha');
  });
});

describe('QaReglasValidacionService.guardar', () => {
  it('rechaza una regla sin campo', async () => {
    await expect(servicio().guardar({ alcance: 'global', obligatorio: true })).rejects.toThrow(/requiere un campo/i);
  });

  it('rechaza una regla de pantalla sin ruta', async () => {
    await expect(servicio().guardar({ campo: 'cuil', alcance: 'pantalla', obligatorio: true }))
      .rejects.toThrow(/indicar la pantalla/i);
  });

  it('rechaza una pantalla que no existe en el catálogo', async () => {
    await expect(servicio().guardar({ campo: 'cuil', alcance: 'pantalla', ruta: '/qa/no-existe', obligatorio: true }))
      .rejects.toThrow(/no existe la pantalla/i);
  });

  it('rechaza un campo que no pertenece a la pantalla indicada', async () => {
    await expect(servicio().guardar({ campo: 'telefono', alcance: 'pantalla', ruta: '/qa/pantalla-1', obligatorio: true }))
      .rejects.toThrow(/no tiene el campo/i);
  });

  it('rechaza un campo global que no existe en ningún lado del catálogo', async () => {
    await expect(servicio().guardar({ campo: 'campo_inventado', alcance: 'global', obligatorio: true }))
      .rejects.toThrow(/ningún campo del catálogo/i);
  });

  it('rechaza una regla sin ninguna restricción', async () => {
    await expect(servicio().guardar({ campo: 'cuil', alcance: 'global' }))
      .rejects.toThrow(/al menos una restricción/i);
  });

  it('rechaza un largo mínimo mayor al máximo', async () => {
    await expect(servicio().guardar({
      campo: 'telefono', alcance: 'global', largoMinimo: 10, largoMaximo: 5,
    })).rejects.toThrow(/mínimo no puede ser mayor/i);
  });

  it('rechaza un patrón que no es una expresión regular válida', async () => {
    await expect(servicio().guardar({ campo: 'cuil', alcance: 'global', patron: '(' }))
      .rejects.toThrow(/no es una expresión regular válida/i);
  });

  it('guarda una regla global válida y la deja lista para listarResueltas', async () => {
    const svc = servicio();
    const guardada = await svc.guardar({ campo: 'cuil', alcance: 'global', obligatorio: false });

    expect(guardada['campo']).toBe('cuil');
    expect(guardada['alcance']).toBe('global');
    expect(guardada['obligatorio']).toBe(false);

    const resueltas = await svc.listarResueltas();
    expect(resueltas).toEqual([{
      campo: 'cuil', alcance: 'global', ruta: '', obligatorio: false,
      largo_exacto: null, largo_minimo: null, largo_maximo: null, patron: '', patron_mensaje: '',
      valor_minimo: null, valor_maximo: null, dias_atras_max: null, dias_adelante_max: null,
    }]);
  });

  it('guarda una regla de pantalla con restricciones de formato', async () => {
    const svc = servicio();
    const guardada = await svc.guardar({
      campo: 'telefono', alcance: 'pantalla', ruta: '/qa/pantalla-3', largoMinimo: 8, patron: '^\\d+$', patronMensaje: 'Solo números.',
    });

    expect(guardada['ruta']).toBe('/qa/pantalla-3');
    expect(guardada['largo_minimo']).toBe(8);
    expect(guardada['patron']).toBe('^\\d+$');
    expect(guardada['patron_mensaje']).toBe('Solo números.');
  });

  it('rechaza pedir largo/patrón en un campo que no es de tipo texto', async () => {
    await expect(servicio().guardar({ campo: 'legajo', alcance: 'global', largoExacto: 4 }))
      .rejects.toThrow(/no admite restricciones de largo/i);
  });

  it('rechaza pedir valor mínimo/máximo en un campo que no es de tipo numero', async () => {
    await expect(servicio().guardar({ campo: 'cuil', alcance: 'global', valorMinimo: 10 }))
      .rejects.toThrow(/no admite restricciones de valor/i);
  });

  it('rechaza pedir ventana de días en un campo que no es de tipo fecha', async () => {
    await expect(servicio().guardar({ campo: 'legajo', alcance: 'global', diasAtrasMax: 5 }))
      .rejects.toThrow(/no admite restricciones de fecha/i);
  });

  it('acepta valor mínimo/máximo en un campo numero', async () => {
    const guardada = await servicio().guardar({ campo: 'legajo', alcance: 'global', valorMinimo: 1, valorMaximo: 9999 });
    expect(guardada['valor_minimo']).toBe(1);
    expect(guardada['valor_maximo']).toBe(9999);
  });

  it('rechaza un valor mínimo mayor al máximo', async () => {
    await expect(servicio().guardar({ campo: 'legajo', alcance: 'global', valorMinimo: 100, valorMaximo: 10 }))
      .rejects.toThrow(/mínimo no puede ser mayor/i);
  });

  it('acepta la ventana de días en un campo fecha', async () => {
    const guardada = await servicio().guardar({
      campo: 'fecha_ingreso', alcance: 'pantalla', ruta: '/qa/pantalla-3', diasAtrasMax: 30, diasAdelanteMax: 0,
    });
    expect(guardada['dias_atras_max']).toBe(30);
    expect(guardada['dias_adelante_max']).toBe(0);
  });

  it('volver a guardar la misma regla (mismo campo/alcance/ruta) la actualiza en vez de duplicarla', async () => {
    const svc = servicio();
    await svc.guardar({ campo: 'cuil', alcance: 'global', obligatorio: false });
    await svc.guardar({ campo: 'cuil', alcance: 'global', obligatorio: true });

    const listado = await svc.listar();
    expect(listado).toHaveLength(1);
    expect(listado[0]['obligatorio']).toBe(true);
  });
});

describe('QaReglasValidacionService.eliminar', () => {
  it('da de baja logica la regla', async () => {
    const svc = servicio();
    const guardada = await svc.guardar({ campo: 'cuil', alcance: 'global', obligatorio: false });

    await expect(svc.eliminar(guardada['id'] as string)).resolves.toEqual({ id: guardada['id'], activo: false });
    expect(await svc.listar()).toEqual([]);
  });

  it('falla al eliminar una regla inexistente', async () => {
    await expect(servicio().eliminar('no-existe')).rejects.toThrow(/inexistente/i);
  });
});
