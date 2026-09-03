import { CampoCatalogo, RestriccionCampo, TipoCampoCatalogo } from '../qa-catalogo-elementos';

/**
 * Genera los valores de prueba para un campo, segun su tipo, su restriccion
 * real declarada (catalogo + reglas de validacion) y la categoria de la
 * Suite que los pide.
 *
 * Deliberadamente NO usa datos de negocio: la Suite prueba requisitos
 * funcionales, de seguridad y de accesibilidad, no la logica de calculo. Por
 * eso los valores se derivan de la restriccion declarada del campo -algo
 * real y ya aprobado por un humano-, nunca de un caso de `qa_casos`.
 *
 * - funcional: valores VALIDOS segun la restriccion, en los bordes.
 * - seguridad: valores que violan la restriccion a proposito + payloads de
 *   inyeccion/manipulacion.
 */

export interface CandidatoValor {
  valor: string;
  motivo: string;
}

const PAYLOADS_INYECCION_TEXTO: CandidatoValor[] = [
  { valor: "' OR '1'='1", motivo: 'inyeccion SQL basica' },
  { valor: '{"$ne": null}', motivo: 'inyeccion NoSQL basica (Mongo)' },
  { valor: '<script>alert(1)</script>', motivo: 'XSS reflejado basico' },
  { valor: '../../etc/passwd', motivo: 'path traversal basico' },
  { valor: '{{7*7}}', motivo: 'inyeccion de plantilla basica' },
];

function textoConLargo(largo: number): string {
  return '9'.repeat(Math.max(largo, 0));
}

function funcionalTexto(restriccion: RestriccionCampo, obligatorio: boolean): CandidatoValor[] {
  const candidatos: CandidatoValor[] = [];

  if (typeof restriccion.largo_exacto === 'number') {
    candidatos.push({
      valor: textoConLargo(restriccion.largo_exacto),
      motivo: `largo exacto declarado (${restriccion.largo_exacto} caracteres)`,
    });
  } else {
    if (typeof restriccion.largo_minimo === 'number') {
      candidatos.push({
        valor: textoConLargo(restriccion.largo_minimo),
        motivo: `borde inferior de largo (${restriccion.largo_minimo} caracteres)`,
      });
    }
    if (typeof restriccion.largo_maximo === 'number') {
      candidatos.push({
        valor: textoConLargo(restriccion.largo_maximo),
        motivo: `borde superior de largo (${restriccion.largo_maximo} caracteres)`,
      });
    }
  }

  if (!candidatos.length) {
    candidatos.push({ valor: 'dato de prueba', motivo: 'valor tipico, sin restriccion de largo declarada' });
  }

  if (!obligatorio) {
    candidatos.push({ valor: '', motivo: 'campo no obligatorio, vacio' });
  }

  return candidatos;
}

function seguridadTexto(restriccion: RestriccionCampo): CandidatoValor[] {
  const candidatos: CandidatoValor[] = [...PAYLOADS_INYECCION_TEXTO];

  if (typeof restriccion.largo_exacto === 'number') {
    candidatos.push({
      valor: textoConLargo(restriccion.largo_exacto * 2),
      motivo: `viola el largo exacto declarado (${restriccion.largo_exacto} caracteres esperados)`,
    });
  }
  if (typeof restriccion.largo_maximo === 'number') {
    candidatos.push({
      valor: textoConLargo(restriccion.largo_maximo + 20),
      motivo: `excede el largo maximo declarado (${restriccion.largo_maximo})`,
    });
  }
  if (restriccion.patron) {
    candidatos.push({
      valor: 'valor-que-no-matchea-el-patron',
      motivo: `no respeta el patron declarado (${restriccion.patron})`,
    });
  }

  return candidatos;
}

function funcionalNumero(restriccion: RestriccionCampo): CandidatoValor[] {
  const candidatos: CandidatoValor[] = [];
  if (typeof restriccion.valor_minimo === 'number') {
    candidatos.push({ valor: String(restriccion.valor_minimo), motivo: `borde inferior declarado (${restriccion.valor_minimo})` });
  }
  if (typeof restriccion.valor_maximo === 'number') {
    candidatos.push({ valor: String(restriccion.valor_maximo), motivo: `borde superior declarado (${restriccion.valor_maximo})` });
  }
  if (!candidatos.length) {
    candidatos.push({ valor: '1000', motivo: 'valor tipico, sin restriccion numerica declarada' });
  }
  return candidatos;
}

function seguridadNumero(restriccion: RestriccionCampo): CandidatoValor[] {
  const candidatos: CandidatoValor[] = [
    { valor: '-99999999', motivo: 'numero negativo fuera de cualquier rango razonable' },
    { valor: '1e309', motivo: 'desborde numerico (Infinity)' },
    { valor: 'NaN', motivo: 'valor no numerico en campo numerico' },
  ];
  if (typeof restriccion.valor_maximo === 'number') {
    candidatos.push({
      valor: String(restriccion.valor_maximo * 1000),
      motivo: `muy por encima del maximo declarado (${restriccion.valor_maximo})`,
    });
  }
  if (typeof restriccion.valor_minimo === 'number') {
    candidatos.push({
      valor: String(restriccion.valor_minimo - 1),
      motivo: `un paso por debajo del minimo declarado (${restriccion.valor_minimo})`,
    });
  }
  return candidatos;
}

function fechaDesdeHoy(dias: number): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function funcionalFecha(restriccion: RestriccionCampo): CandidatoValor[] {
  const candidatos: CandidatoValor[] = [];
  if (typeof restriccion.dias_atras_max === 'number') {
    candidatos.push({
      valor: fechaDesdeHoy(-restriccion.dias_atras_max),
      motivo: `borde de antiguedad declarado (${restriccion.dias_atras_max} dias atras)`,
    });
  }
  if (typeof restriccion.dias_adelante_max === 'number') {
    candidatos.push({
      valor: fechaDesdeHoy(restriccion.dias_adelante_max),
      motivo: `borde de futuro declarado (${restriccion.dias_adelante_max} dias adelante)`,
    });
  }
  if (!candidatos.length) {
    candidatos.push({ valor: fechaDesdeHoy(0), motivo: 'fecha de hoy, sin restriccion declarada' });
  }
  return candidatos;
}

function seguridadFecha(restriccion: RestriccionCampo): CandidatoValor[] {
  const candidatos: CandidatoValor[] = [
    { valor: '9999-99-99', motivo: 'fecha con mes y dia invalidos' },
    { valor: '0000-00-00', motivo: 'fecha nula invalida' },
  ];
  if (typeof restriccion.dias_atras_max === 'number') {
    candidatos.push({
      valor: fechaDesdeHoy(-restriccion.dias_atras_max - 3650),
      motivo: `muy anterior al limite de antiguedad declarado (${restriccion.dias_atras_max} dias)`,
    });
  }
  if (typeof restriccion.dias_adelante_max === 'number') {
    candidatos.push({
      valor: fechaDesdeHoy(restriccion.dias_adelante_max + 3650),
      motivo: `muy posterior al limite de futuro declarado (${restriccion.dias_adelante_max} dias)`,
    });
  }
  return candidatos;
}

/** Candidatos funcionales: valores validos, en los bordes de la restriccion real del campo. */
export function candidatosFuncionales(campo: CampoCatalogo): CandidatoValor[] {
  switch (campo.tipo) {
    case 'texto':
      return funcionalTexto(campo.restriccion ?? {}, campo.obligatorio);
    case 'numero':
      return funcionalNumero(campo.restriccion ?? {});
    case 'fecha':
      return funcionalFecha(campo.restriccion ?? {});
    default:
      return [{ valor: '', motivo: `tipo ${campo.tipo}: sin variacion funcional aplicable` }];
  }
}

/** Candidatos de seguridad: violan la restriccion a proposito, mas payloads de inyeccion/manipulacion. */
export function candidatosDeSeguridad(campo: CampoCatalogo): CandidatoValor[] {
  switch (campo.tipo) {
    case 'texto':
      return seguridadTexto(campo.restriccion ?? {});
    case 'numero':
      return seguridadNumero(campo.restriccion ?? {});
    case 'fecha':
      return seguridadFecha(campo.restriccion ?? {});
    default:
      return [];
  }
}

/** Un solo valor "seguro" por campo, usado para completar el resto del formulario mientras se ataca uno solo por vez. */
export function valorSeguro(campo: CampoCatalogo): string {
  return candidatosFuncionales(campo)[0]?.valor ?? '';
}

export function esTipoConValor(tipo: TipoCampoCatalogo): boolean {
  return tipo === 'texto' || tipo === 'numero' || tipo === 'fecha';
}
