/**
 * qa-suite-derivador.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Espejo en JS plano de `src/modules/qa/suite/qa-suite-derivador.service.ts` y
 * `qa-suite-payloads.ts`. Se duplica -no se importa desde `dist/`- para que
 * los scripts de la Suite sigan siendo procesos Node autonomos, igual que el
 * resto de los runners del proyecto. Si cambia el algoritmo de un lado, tiene
 * que cambiar del otro: son la misma logica, dos runtimes.
 */

const PAYLOADS_INYECCION_TEXTO = [
  { valor: "' OR '1'='1", motivo: 'inyeccion SQL basica', tipo: 'inyeccion' },
  { valor: '{"$ne": null}', motivo: 'inyeccion NoSQL basica (Mongo)', tipo: 'inyeccion' },
  { valor: '<script>alert(1)</script>', motivo: 'XSS reflejado basico', tipo: 'inyeccion' },
  { valor: '../../etc/passwd', motivo: 'path traversal basico', tipo: 'inyeccion' },
  { valor: '{{7*7}}', motivo: 'inyeccion de plantilla basica', tipo: 'inyeccion' },
];

function textoConLargo(largo) {
  return '9'.repeat(Math.max(largo, 0));
}

function funcionalTexto(restriccion, obligatorio) {
  const candidatos = [];
  if (typeof restriccion.largo_exacto === 'number') {
    candidatos.push({ valor: textoConLargo(restriccion.largo_exacto), motivo: `largo exacto declarado (${restriccion.largo_exacto} caracteres)` });
  } else {
    if (typeof restriccion.largo_minimo === 'number') {
      candidatos.push({ valor: textoConLargo(restriccion.largo_minimo), motivo: `borde inferior de largo (${restriccion.largo_minimo} caracteres)` });
    }
    if (typeof restriccion.largo_maximo === 'number') {
      candidatos.push({ valor: textoConLargo(restriccion.largo_maximo), motivo: `borde superior de largo (${restriccion.largo_maximo} caracteres)` });
    }
  }
  if (!candidatos.length) candidatos.push({ valor: 'dato de prueba', motivo: 'valor tipico, sin restriccion de largo declarada' });
  if (!obligatorio) candidatos.push({ valor: '', motivo: 'campo no obligatorio, vacio' });
  return candidatos;
}

function seguridadTexto(restriccion) {
  const candidatos = [...PAYLOADS_INYECCION_TEXTO];
  if (typeof restriccion.largo_exacto === 'number') {
    candidatos.push({ valor: textoConLargo(restriccion.largo_exacto * 2), motivo: `viola el largo exacto declarado (${restriccion.largo_exacto} caracteres esperados)`, tipo: 'violacion_restriccion' });
  }
  if (typeof restriccion.largo_maximo === 'number') {
    candidatos.push({ valor: textoConLargo(restriccion.largo_maximo + 20), motivo: `excede el largo maximo declarado (${restriccion.largo_maximo})`, tipo: 'violacion_restriccion' });
  }
  if (restriccion.patron) {
    candidatos.push({ valor: 'valor-que-no-matchea-el-patron', motivo: `no respeta el patron declarado (${restriccion.patron})`, tipo: 'violacion_restriccion' });
  }
  return candidatos;
}

function funcionalNumero(restriccion) {
  const candidatos = [];
  if (typeof restriccion.valor_minimo === 'number') candidatos.push({ valor: String(restriccion.valor_minimo), motivo: `borde inferior declarado (${restriccion.valor_minimo})` });
  if (typeof restriccion.valor_maximo === 'number') candidatos.push({ valor: String(restriccion.valor_maximo), motivo: `borde superior declarado (${restriccion.valor_maximo})` });
  if (!candidatos.length) candidatos.push({ valor: '1000', motivo: 'valor tipico, sin restriccion numerica declarada' });
  return candidatos;
}

function seguridadNumero(restriccion) {
  const candidatos = [
    { valor: '-99999999', motivo: 'numero negativo fuera de cualquier rango razonable', tipo: 'violacion_restriccion' },
    { valor: '1e309', motivo: 'desborde numerico (Infinity)', tipo: 'violacion_restriccion' },
    { valor: 'NaN', motivo: 'valor no numerico en campo numerico', tipo: 'violacion_restriccion' },
  ];
  if (typeof restriccion.valor_maximo === 'number') candidatos.push({ valor: String(restriccion.valor_maximo * 1000), motivo: `muy por encima del maximo declarado (${restriccion.valor_maximo})`, tipo: 'violacion_restriccion' });
  if (typeof restriccion.valor_minimo === 'number') candidatos.push({ valor: String(restriccion.valor_minimo - 1), motivo: `un paso por debajo del minimo declarado (${restriccion.valor_minimo})`, tipo: 'violacion_restriccion' });
  return candidatos;
}

function fechaDesdeHoy(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function funcionalFecha(restriccion) {
  const candidatos = [];
  if (typeof restriccion.dias_atras_max === 'number') candidatos.push({ valor: fechaDesdeHoy(-restriccion.dias_atras_max), motivo: `borde de antiguedad declarado (${restriccion.dias_atras_max} dias atras)` });
  if (typeof restriccion.dias_adelante_max === 'number') candidatos.push({ valor: fechaDesdeHoy(restriccion.dias_adelante_max), motivo: `borde de futuro declarado (${restriccion.dias_adelante_max} dias adelante)` });
  if (!candidatos.length) candidatos.push({ valor: fechaDesdeHoy(0), motivo: 'fecha de hoy, sin restriccion declarada' });
  return candidatos;
}

function seguridadFecha(restriccion) {
  const candidatos = [
    { valor: '9999-99-99', motivo: 'fecha con mes y dia invalidos', tipo: 'violacion_restriccion' },
    { valor: '0000-00-00', motivo: 'fecha nula invalida', tipo: 'violacion_restriccion' },
  ];
  if (typeof restriccion.dias_atras_max === 'number') candidatos.push({ valor: fechaDesdeHoy(-restriccion.dias_atras_max - 3650), motivo: `muy anterior al limite de antiguedad declarado (${restriccion.dias_atras_max} dias)`, tipo: 'violacion_restriccion' });
  if (typeof restriccion.dias_adelante_max === 'number') candidatos.push({ valor: fechaDesdeHoy(restriccion.dias_adelante_max + 3650), motivo: `muy posterior al limite de futuro declarado (${restriccion.dias_adelante_max} dias)`, tipo: 'violacion_restriccion' });
  return candidatos;
}

export function candidatosFuncionales(campo) {
  const restriccion = campo.restriccion ?? {};
  if (campo.tipo === 'texto') return funcionalTexto(restriccion, campo.obligatorio);
  if (campo.tipo === 'numero') return funcionalNumero(restriccion);
  if (campo.tipo === 'fecha') return funcionalFecha(restriccion);
  return [{ valor: '', motivo: `tipo ${campo.tipo}: sin variacion funcional aplicable` }];
}

export function candidatosDeSeguridad(campo) {
  const restriccion = campo.restriccion ?? {};
  if (campo.tipo === 'texto') return seguridadTexto(restriccion);
  if (campo.tipo === 'numero') return seguridadNumero(restriccion);
  if (campo.tipo === 'fecha') return seguridadFecha(restriccion);
  return [];
}

export function valorSeguro(campo) {
  return candidatosFuncionales(campo)[0]?.valor ?? '';
}

export function esTipoConValor(tipo) {
  return tipo === 'texto' || tipo === 'numero' || tipo === 'fecha';
}

/** Ver `QaSuiteDerivadorService.derivarEscenarios` (TS) — misma logica. */
export function derivarEscenarios(aprendizajeId, pasos, campos, categoria) {
  const camposPorClave = new Map(campos.map((campo) => [campo.clave, campo]));
  const clavesCompletar = [...new Set(pasos.filter((p) => p.tipo === 'completar' && p.campo).map((p) => p.campo))];

  if (categoria === 'accesibilidad') {
    const datos = {};
    for (const clave of clavesCompletar) {
      const campo = camposPorClave.get(clave);
      datos[clave] = campo ? valorSeguro(campo) : '';
    }
    return [{
      id: `${aprendizajeId}-${categoria}-base`,
      categoria,
      campo_bajo_prueba: null,
      valor_bajo_prueba: null,
      motivo: 'valores funcionales seguros en todos los campos, solo para llegar al estado a auditar',
      datos,
    }];
  }

  const escenarios = [];
  for (const claveObjetivo of clavesCompletar) {
    const campo = camposPorClave.get(claveObjetivo);
    if (!campo || !esTipoConValor(campo.tipo)) continue;

    const candidatos = categoria === 'funcional' ? candidatosFuncionales(campo) : candidatosDeSeguridad(campo);

    candidatos.forEach((candidato, indice) => {
      const datos = {};
      for (const clave of clavesCompletar) {
        if (clave === claveObjetivo) {
          datos[clave] = candidato.valor;
          continue;
        }
        const otroCampo = camposPorClave.get(clave);
        datos[clave] = otroCampo ? valorSeguro(otroCampo) : '';
      }
      escenarios.push({
        id: `${aprendizajeId}-${categoria}-${campo.clave}-${indice + 1}`,
        categoria,
        campo_bajo_prueba: campo.clave,
        valor_bajo_prueba: candidato.valor,
        motivo: candidato.motivo,
        tipo: candidato.tipo,
        datos,
      });
    });
  }
  return escenarios;
}
