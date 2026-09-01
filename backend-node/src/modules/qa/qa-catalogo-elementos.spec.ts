import {
  CampoCatalogo,
  ReglaValidacionResuelta,
  aplicarReglasCampos,
  buscarPantallaPorRuta,
  pantallaPorOrigenCaso,
  tipoDeCampo,
  validarDatosCampos,
  validarValorCampo,
} from './qa-catalogo-elementos';

const PANTALLA_3 = buscarPantallaPorRuta('/qa/pantalla-3')!;
const PANTALLA_1 = buscarPantallaPorRuta('/qa/pantalla-1')!;

function reglaObligatoria(campo: string, alcance: 'global' | 'pantalla', obligatorio: boolean, ruta = ''): ReglaValidacionResuelta {
  return { campo, alcance, ruta, obligatorio, largo_exacto: null, largo_minimo: null, largo_maximo: null, patron: '', patron_mensaje: '' };
}

describe('aplicarReglasCampos', () => {
  it('sin reglas activas devuelve la pantalla sin tocar', () => {
    expect(aplicarReglasCampos(PANTALLA_3, [])).toBe(PANTALLA_3);
  });

  it('una regla global cambia el default del catálogo para todas las pantallas que tengan ese campo', () => {
    const regla = reglaObligatoria('cuil', 'global', false);
    const p1 = aplicarReglasCampos(PANTALLA_1, [regla]);
    const p3 = aplicarReglasCampos(PANTALLA_3, [regla]);

    expect(p1.campos.find((c) => c.clave === 'cuil')?.obligatorio).toBe(false);
    expect(p3.campos.find((c) => c.clave === 'cuil')?.obligatorio).toBe(false);
  });

  it('una regla de pantalla puntual pisa a la global y no afecta otras pantallas', () => {
    const global = reglaObligatoria('cuil', 'global', false);
    const puntual = reglaObligatoria('cuil', 'pantalla', true, '/qa/pantalla-3');
    const p1 = aplicarReglasCampos(PANTALLA_1, [global, puntual]);
    const p3 = aplicarReglasCampos(PANTALLA_3, [global, puntual]);

    expect(p1.campos.find((c) => c.clave === 'cuil')?.obligatorio).toBe(false);
    expect(p3.campos.find((c) => c.clave === 'cuil')?.obligatorio).toBe(true);
  });

  it('no muta el catálogo original', () => {
    const original = PANTALLA_3.campos.find((c) => c.clave === 'cuil')?.obligatorio;
    aplicarReglasCampos(PANTALLA_3, [reglaObligatoria('cuil', 'global', false)]);
    expect(PANTALLA_3.campos.find((c) => c.clave === 'cuil')?.obligatorio).toBe(original);
  });

  it('un atributo no definido en la regla hereda el default del catálogo, no lo borra', () => {
    const regla: ReglaValidacionResuelta = {
      campo: 'cuil',
      alcance: 'pantalla',
      ruta: '/qa/pantalla-3',
      obligatorio: false,
      largo_exacto: null,
      largo_minimo: null,
      largo_maximo: null,
      patron: '',
      patron_mensaje: '',
    };
    const p3 = aplicarReglasCampos(PANTALLA_3, [regla]);
    const cuil = p3.campos.find((c) => c.clave === 'cuil');

    expect(cuil?.obligatorio).toBe(false);
    expect(cuil?.restriccion?.largo_exacto).toBe(11); // sigue viniendo del catálogo
  });

  it('ajusta el largo mínimo del teléfono', () => {
    const regla: ReglaValidacionResuelta = {
      campo: 'telefono',
      alcance: 'global',
      obligatorio: null,
      largo_exacto: null,
      largo_minimo: 8,
      largo_maximo: null,
      patron: '',
      patron_mensaje: '',
    };
    const p3 = aplicarReglasCampos(PANTALLA_3, [regla]);
    expect(p3.campos.find((c) => c.clave === 'telefono')?.restriccion?.largo_minimo).toBe(8);
  });
});

describe('validarValorCampo', () => {
  const cuilCampo = PANTALLA_3.campos.find((c) => c.clave === 'cuil')!;
  const telefonoCampo = PANTALLA_3.campos.find((c) => c.clave === 'telefono')!;
  const clienteCampo = PANTALLA_3.campos.find((c) => c.clave === 'cliente')!;

  it('rechaza un campo obligatorio vacío', () => {
    expect(validarValorCampo(clienteCampo, '')).toEqual([expect.stringContaining('Cliente')]);
  });

  it('un campo opcional vacío no genera error de formato', () => {
    const opcional = { ...cuilCampo, obligatorio: false };
    expect(validarValorCampo(opcional, '')).toEqual([]);
  });

  it('acepta un CUIL de 11 dígitos, con o sin guiones', () => {
    expect(validarValorCampo(cuilCampo, '27-27345678-4')).toEqual([]);
    expect(validarValorCampo(cuilCampo, '27273456784')).toEqual([]);
  });

  it('rechaza un CUIL que no tiene exactamente 11 dígitos', () => {
    const errores = validarValorCampo(cuilCampo, '2727345678');
    expect(errores).toEqual([expect.stringContaining('11 dígitos')]);
  });

  it('rechaza un teléfono con menos de 6 dígitos', () => {
    const errores = validarValorCampo(telefonoCampo, '123');
    expect(errores).toEqual([expect.stringContaining('al menos 6 dígitos')]);
  });

  it('acepta un teléfono con 6 dígitos o más', () => {
    expect(validarValorCampo(telefonoCampo, '2613355822')).toEqual([]);
  });

  it('valida un patrón custom y usa el mensaje configurado', () => {
    const campo = { ...clienteCampo, restriccion: { patron: '^[A-Z]', patron_mensaje: 'Debe empezar con mayúscula.' } };
    expect(validarValorCampo(campo, 'acme')).toEqual(['Debe empezar con mayúscula.']);
    expect(validarValorCampo(campo, 'Acme')).toEqual([]);
  });

  it('un patrón inválido no bloquea al usuario', () => {
    const campo = { ...clienteCampo, restriccion: { patron: '(' } };
    expect(validarValorCampo(campo, 'cualquier cosa')).toEqual([]);
  });
});

describe('validarValorCampo - tipo numero', () => {
  const campoNumero: CampoCatalogo = {
    clave: 'remuneracion_bruta',
    etiqueta: 'Remuneración bruta',
    testid: 'x',
    tipo: 'numero',
    obligatorio: false,
    alias: [],
    restriccion: { valor_minimo: 0, valor_maximo: 10000000 },
  };

  it('acepta un valor dentro del rango', () => {
    expect(validarValorCampo(campoNumero, '500000')).toEqual([]);
  });

  it('rechaza un valor menor al mínimo', () => {
    expect(validarValorCampo(campoNumero, '-5')).toEqual([expect.stringContaining('mayor o igual a 0')]);
  });

  it('rechaza un valor mayor al máximo', () => {
    expect(validarValorCampo(campoNumero, '99999999')).toEqual([expect.stringContaining('menor o igual a 10000000')]);
  });

  it('no le pide largo en dígitos a un campo numero, aunque el catálogo lo tuviera seteado', () => {
    const campo: CampoCatalogo = { ...campoNumero, restriccion: { largo_exacto: 3 } };
    expect(validarValorCampo(campo, '12345')).toEqual([]);
  });
});

describe('validarValorCampo - tipo fecha', () => {
  function fechaISO(offsetDias: number): string {
    const fecha = new Date();
    fecha.setUTCDate(fecha.getUTCDate() + offsetDias);
    return fecha.toISOString().slice(0, 10);
  }

  const campoFecha: CampoCatalogo = {
    clave: 'fecha_ingreso',
    etiqueta: 'Fecha de ingreso',
    testid: 'x',
    tipo: 'fecha',
    obligatorio: false,
    alias: [],
    restriccion: { dias_atras_max: 30, dias_adelante_max: 7 },
  };

  it('acepta la fecha de hoy', () => {
    expect(validarValorCampo(campoFecha, fechaISO(0))).toEqual([]);
  });

  it('acepta una fecha pasada dentro de la ventana permitida', () => {
    expect(validarValorCampo(campoFecha, fechaISO(-10))).toEqual([]);
  });

  it('rechaza una fecha pasada fuera de la ventana permitida', () => {
    const errores = validarValorCampo(campoFecha, fechaISO(-40));
    expect(errores).toEqual([expect.stringContaining('anterior a hoy')]);
  });

  it('acepta una fecha futura dentro de la ventana permitida', () => {
    expect(validarValorCampo(campoFecha, fechaISO(5))).toEqual([]);
  });

  it('rechaza una fecha futura fuera de la ventana permitida', () => {
    const errores = validarValorCampo(campoFecha, fechaISO(20));
    expect(errores).toEqual([expect.stringContaining('posterior a hoy')]);
  });

  it('dias_atras_max en 0 no permite ninguna fecha pasada', () => {
    const campo: CampoCatalogo = { ...campoFecha, restriccion: { dias_atras_max: 0 } };
    const errores = validarValorCampo(campo, fechaISO(-1));
    expect(errores).toEqual([expect.stringContaining('no puede ser anterior a hoy')]);
  });

  it('dias_adelante_max en 0 no permite ninguna fecha futura', () => {
    const campo: CampoCatalogo = { ...campoFecha, restriccion: { dias_adelante_max: 0 } };
    const errores = validarValorCampo(campo, fechaISO(1));
    expect(errores).toEqual([expect.stringContaining('no puede ser posterior a hoy')]);
  });

  it('no le pide largo en dígitos a un campo fecha, aunque el catálogo lo tuviera seteado', () => {
    const campo: CampoCatalogo = { ...campoFecha, restriccion: { largo_exacto: 5 } };
    expect(validarValorCampo(campo, fechaISO(0))).toEqual([]);
  });
});

describe('validarValorCampo - tipo select y archivo', () => {
  it('no aplica ninguna restricción de formato a un campo select', () => {
    const campo: CampoCatalogo = {
      clave: 'modo',
      etiqueta: 'Modo',
      testid: 'x',
      tipo: 'select',
      obligatorio: false,
      alias: [],
      restriccion: { largo_exacto: 3, valor_minimo: 10 },
    };
    expect(validarValorCampo(campo, 'cualquier valor')).toEqual([]);
  });

  it('no aplica ninguna restricción de formato a un campo archivo', () => {
    const campo: CampoCatalogo = {
      clave: 'excel',
      etiqueta: 'Excel',
      testid: 'x',
      tipo: 'archivo',
      obligatorio: false,
      alias: [],
      restriccion: { largo_exacto: 3 },
    };
    expect(validarValorCampo(campo, 'archivo.xlsx')).toEqual([]);
  });
});

describe('tipoDeCampo', () => {
  it('devuelve el tipo de un campo existente', () => {
    expect(tipoDeCampo('cuil')).toBe('texto');
    expect(tipoDeCampo('legajo')).toBe('numero');
    expect(tipoDeCampo('fecha_ingreso')).toBe('fecha');
  });

  it('devuelve null para un campo que no existe en ningún lado del catálogo', () => {
    expect(tipoDeCampo('campo_inventado')).toBeNull();
  });

  it('con ruta, busca solo en esa pantalla', () => {
    expect(tipoDeCampo('telefono', '/qa/pantalla-1')).toBeNull();
    expect(tipoDeCampo('telefono', '/qa/pantalla-3')).toBe('texto');
  });
});

describe('validarDatosCampos', () => {
  it('junta los errores de todos los campos de la pantalla', () => {
    const errores = validarDatosCampos(PANTALLA_3, {
      cliente: '',
      area_sector: 'Administracion',
      telefono: '123',
      numero_documento: '12345678',
      cuil: '20-12436587-4',
      fecha_ingreso: '2026-01-01',
    });

    expect(errores).toHaveLength(2);
    expect(errores.some((e) => e.includes('Cliente'))).toBe(true);
    expect(errores.some((e) => e.includes('al menos 6 dígitos'))).toBe(true);
  });
});

describe('pantallaPorOrigenCaso', () => {
  it('reconoce un caso de Pantalla 3 por origen.pantalla', () => {
    const caso = { origen: { pantalla: 'QA - Pantalla 3' } };
    expect(pantallaPorOrigenCaso(caso)?.ruta).toBe('/qa/pantalla-3');
  });

  it('reconoce un caso de Pantalla 3 por contexto.contexto_complementario.origen.pantalla', () => {
    const caso = { contexto: { contexto_complementario: { origen: { pantalla: 'QA - Pantalla 3' } } } };
    expect(pantallaPorOrigenCaso(caso)?.ruta).toBe('/qa/pantalla-3');
  });

  it('reconoce un caso de Pantalla 1 por origen.tipo', () => {
    const caso = { origen: { tipo: 'formulario_qa_pantalla_1' } };
    expect(pantallaPorOrigenCaso(caso)?.ruta).toBe('/qa/pantalla-1');
  });

  it('devuelve null si el origen no matchea ninguna pantalla con fuente de casos', () => {
    expect(pantallaPorOrigenCaso({ origen: { tipo: 'algo_desconocido' } })).toBeNull();
    expect(pantallaPorOrigenCaso({})).toBeNull();
  });
});
