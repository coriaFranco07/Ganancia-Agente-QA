/**
 * Analiza un spec de Playwright Codegen y genera 3 variantes -funcional,
 * seguridad y accesibilidad- sustituyendo lo que se escribe en cada campo,
 * sin tocar la navegación ni los clicks.
 *
 * Es deliberadamente simple: procesa el spec línea por línea, como lo escribe
 * Codegen (una sentencia `await page....();` por línea). No es un parser de
 * JavaScript completo — cualquier línea que no reconozca la deja tal cual, para
 * no romper el flujo con un caso que no supo interpretar.
 */

export type TipoPaso = 'goto' | 'fill' | 'click' | 'press' | 'otro';
export type Familia = 'texto' | 'numero' | 'email' | 'fecha';
export type Nivel = 'funcional' | 'seguridad' | 'accesibilidad';

export interface PasoAnalizado {
  linea: number;
  textoOriginal: string;
  tipo: TipoPaso;
  /** Para fill/click: la cadena antes del método final, ej. `page.getByRole(...)`. */
  locatorChain?: string;
  /** Hint de nombre extraído del locator (name/label/placeholder/texto o el selector crudo). */
  nombreCampo?: string;
  familia?: Familia;
  valorOriginal?: string;
  esBotonGuardado?: boolean;
  /** true si esta línea forma parte del login inicial detectado y se omite del flujo real. */
  omitidoLogin?: boolean;
}

export interface AnalisisSpec {
  pasos: PasoAnalizado[];
  /** Solo los pasos que van a formar parte de las 3 variantes generadas. */
  pasosReales: PasoAnalizado[];
  loginDetectado: boolean;
  totalCampos: number;
  totalBotonesGuardado: number;
  lineasNoReconocidas: number;
}

const VERBOS_GUARDADO =
  /^(crear|guardar|emitir|confirmar|enviar|eliminar|borrar|actualizar|publicar|finalizar|registrar|aceptar)\b/i;

const PATRON_LOGIN_URL = /\/login(?:[/?#]|$)/i;
const PATRON_LOGIN_BOTON = /iniciar sesi[oó]n|ingresar|log ?in|entrar/i;

/**
 * Codegen envuelve el flujo en `import {...}` + `test('x', async ({ page }) => { ... });`.
 * Ese envoltorio no es valido dentro del cuerpo de funcion que ejecuta el
 * runner (un `import` ahi adentro tira SyntaxError), asi que se descarta antes
 * de analizar: solo interesa el cuerpo entre el `=>` y el cierre final.
 * Si el texto pegado ya es solo el cuerpo (sin wrapper), se usa tal cual.
 */
function extraerCuerpo(codigoFuente: string): string {
  const conWrapper = codigoFuente.match(
    /async\s*\(\s*\{\s*page[^}]*\}\s*\)\s*=>\s*\{([\s\S]*)\}\s*\)\s*;?\s*$/,
  );
  return conWrapper ? conWrapper[1] : codigoFuente;
}

/* ── Tokenizado de una linea ─────────────────────────────────────────────── */

/**
 * Divide `page.metodoA(...).metodoB(...)` en sus segmentos, respetando
 * parentesis/llaves/corchetes anidados y strings, para no cortar por un punto
 * que este dentro de un literal o de los argumentos de otro metodo.
 */
function dividirCadenaLlamadas(statement: string): string[] {
  const partes: string[] = [];
  let actual = '';
  let profundidad = 0;
  let comilla: string | null = null;

  for (let i = 0; i < statement.length; i++) {
    const c = statement[i];

    if (comilla) {
      actual += c;
      if (c === '\\' && i + 1 < statement.length) {
        i++;
        actual += statement[i];
        continue;
      }
      if (c === comilla) comilla = null;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      comilla = c;
      actual += c;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') {
      profundidad++;
      actual += c;
      continue;
    }
    if (c === ')' || c === '}' || c === ']') {
      profundidad--;
      actual += c;
      continue;
    }
    if (c === '.' && profundidad === 0) {
      partes.push(actual);
      actual = '';
      continue;
    }
    actual += c;
  }
  if (actual) partes.push(actual);
  return partes;
}

/** Extrae el string literal de `'valor'` / `"valor"`, sin las comillas. */
function leerStringLiteral(texto: string): string | null {
  const m = texto.trim().match(/^['"`]([\s\S]*)['"`]$/);
  if (!m) return null;
  return m[1].replace(/\\(['"`\\])/g, '$1');
}

/** Extrae el hint de nombre de un locator: name/label/placeholder/texto, o el selector crudo. */
function extraerNombreCampo(locatorChain: string): string {
  const porOpcionName = locatorChain.match(/name:\s*['"]([^'"]*)['"]/);
  if (porOpcionName) return porOpcionName[1];

  const porMetodo = locatorChain.match(
    /get(?:ByLabel|ByPlaceholder|ByText|ByTitle|ByAltText)\(\s*['"]([^'"]*)['"]/,
  );
  if (porMetodo) return porMetodo[1];

  const porLocator = locatorChain.match(/locator\(\s*['"]([^'"]*)['"]/);
  if (porLocator) return porLocator[1];

  return locatorChain;
}

function inferirFamilia(nombreCampo: string): Familia {
  const texto = nombreCampo.toLowerCase();
  if (/correo|email|mail/.test(texto)) return 'email';
  if (/fecha|date/.test(texto)) return 'fecha';
  if (/precio|monto|importe|cant\.|cantidad|numero|número|edad|codigo postal|código postal|unit\./.test(texto)) {
    return 'numero';
  }
  return 'texto';
}

/**
 * Analiza una linea cruda del spec. Devuelve `tipo: 'otro'` para cualquier cosa
 * que no reconozca (imports, wrappers de test(), llaves de cierre, comentarios).
 */
function analizarLinea(lineaCruda: string, numeroLinea: number): PasoAnalizado {
  const base: PasoAnalizado = { linea: numeroLinea, textoOriginal: lineaCruda, tipo: 'otro' };

  let statement = lineaCruda.trim();
  if (!statement.startsWith('await page.')) return base;

  statement = statement.replace(/^await\s+/, '').replace(/;\s*$/, '');
  if (!statement.endsWith(')')) return base;

  const partes = dividirCadenaLlamadas(statement);
  if (partes.length < 2) return base;

  const ultimo = partes[partes.length - 1];
  const matchMetodo = ultimo.match(/^(\w+)\((.*)\)$/s);
  if (!matchMetodo) return base;

  const [, metodo, argsTexto] = matchMetodo;
  const locatorChain = partes.slice(0, -1).join('.');
  const nombreCampo = extraerNombreCampo(locatorChain);

  if (metodo === 'fill') {
    const valorOriginal = leerStringLiteral(argsTexto);
    if (valorOriginal === null) return base;
    return {
      ...base,
      tipo: 'fill',
      locatorChain,
      nombreCampo,
      familia: inferirFamilia(nombreCampo),
      valorOriginal,
    };
  }

  if (metodo === 'press') {
    return { ...base, tipo: 'press', locatorChain, nombreCampo };
  }

  if (['click', 'check', 'uncheck', 'selectOption'].includes(metodo)) {
    return {
      ...base,
      tipo: 'click',
      locatorChain,
      nombreCampo,
      esBotonGuardado: metodo === 'click' && VERBOS_GUARDADO.test(nombreCampo.trim()),
    };
  }

  if (metodo === 'goto') {
    const url = leerStringLiteral(argsTexto);
    return { ...base, tipo: 'goto', nombreCampo: url ?? undefined };
  }

  return base;
}

/* ── Analisis completo ───────────────────────────────────────────────────── */

/**
 * Analiza el spec completo: clasifica cada linea y detecta el login inicial
 * (page.goto a /login seguido de fills y un click de "Iniciar sesion") para
 * excluirlo del flujo real. El Spider ya inicia sesion antes de correr
 * cualquier caso, asi que repetir el login adentro del caso es redundante y
 * riesgoso: pisa la sesion activa con otra cuenta y obliga a guardar una
 * contrasena real en el caso.
 */
export function analizarSpec(codigoFuenteCrudo: string): AnalisisSpec {
  const codigoFuente = extraerCuerpo(codigoFuenteCrudo);
  const lineas = codigoFuente.split('\n');
  const pasos = lineas.map((linea, indice) => analizarLinea(linea, indice + 1));

  let loginDetectado = false;

  // El primer paso reconocible (saltando lineas en blanco/indentacion sueltas)
  // debe ser un goto a /login para considerar que el spec arranca logueandose.
  const indicePrimerPaso = pasos.findIndex((paso) => paso.tipo !== 'otro');
  const primerPaso = indicePrimerPaso !== -1 ? pasos[indicePrimerPaso] : undefined;

  if (primerPaso?.tipo === 'goto' && primerPaso.nombreCampo && PATRON_LOGIN_URL.test(primerPaso.nombreCampo)) {
    const indiceClickLogin = pasos.findIndex(
      (paso, i) => i > indicePrimerPaso && paso.tipo === 'click' && PATRON_LOGIN_BOTON.test(paso.nombreCampo ?? ''),
    );
    if (indiceClickLogin !== -1) {
      loginDetectado = true;
      for (let i = indicePrimerPaso; i <= indiceClickLogin; i++) {
        pasos[i] = { ...pasos[i], omitidoLogin: true };
      }
    }
  }

  const pasosReales = pasos.filter((paso) => !paso.omitidoLogin);
  const camposFill = pasosReales.filter((paso) => paso.tipo === 'fill');
  const botonesGuardado = pasosReales.filter((paso) => paso.tipo === 'click' && paso.esBotonGuardado);
  const noReconocidas = pasosReales.filter(
    (paso) => paso.tipo === 'otro' && paso.textoOriginal.trim().startsWith('await page.'),
  );

  return {
    pasos,
    pasosReales,
    loginDetectado,
    totalCampos: camposFill.length,
    totalBotonesGuardado: botonesGuardado.length,
    lineasNoReconocidas: noReconocidas.length,
  };
}

/* ── Generacion de variantes ─────────────────────────────────────────────── */

export interface TablaPayloads {
  funcional: Record<string, string[]>;
  seguridad: Record<string, string[]>;
}

/**
 * Genera el codigo Playwright para una categoria a partir del analisis.
 *
 * - accesibilidad: repite los valores tal cual fueron grabados, para llegar
 *   al mismo estado que exploro el operador y auditar esa pantalla (el paso
 *   de auditoria WCAG se agrega aparte, al cargar el caso).
 * - funcional/seguridad: sustituye cada fill por un payload de la tabla comun
 *   del catalogo (misma fuente que usa el fuzzing en vivo del Spider).
 *
 * Si un valor de fill se reutiliza mas adelante en el mismo spec (por ejemplo,
 * seleccionar por texto el registro que el propio caso acaba de crear), el
 * reemplazo se propaga a esas apariciones posteriores para no romper el
 * flujo: sin esto, "Juan Perez" sustituido en el alta dejaria de coincidir
 * con el `getByText('Juan Perez')` que lo busca mas adelante.
 *
 * Cuando se omite un boton de guardado (permitirGuardar=false), el flujo SE
 * CORTA ahi: los pasos siguientes suelen depender de que ese guardado haya
 * ocurrido de verdad (por ejemplo, elegir de una lista el registro recien
 * creado). Seguir ejecutandolos sin el dato real solo produce un timeout que
 * no dice nada sobre el modulo bajo prueba. Verificar que el boton existe y
 * esta habilitado ya es la prueba util para esa parte del flujo.
 */
export function generarVariante(
  pasosReales: PasoAnalizado[],
  nivel: Nivel,
  payloads: TablaPayloads,
  permitirGuardar: boolean,
): string {
  const salida: string[] = [];
  const reemplazos: [string, string][] = [];
  let indiceCampo = 0;

  const aplicarReemplazos = (texto: string): string =>
    reemplazos.reduce((acc, [viejo, nuevo]) => (viejo ? acc.split(viejo).join(nuevo) : acc), texto);

  for (const paso of pasosReales) {
    if (paso.tipo === 'fill' && paso.locatorChain) {
      const locator = aplicarReemplazos(paso.locatorChain);
      let valor = paso.valorOriginal ?? '';

      if (nivel !== 'accesibilidad') {
        const conjunto = nivel === 'funcional' ? payloads.funcional : payloads.seguridad;
        const lista = conjunto[paso.familia ?? 'texto'] ?? conjunto.generico ?? ['dato'];
        const nuevoValor = lista[indiceCampo % lista.length];
        if (paso.valorOriginal && paso.valorOriginal.trim()) {
          reemplazos.push([paso.valorOriginal, nuevoValor]);
        }
        valor = nuevoValor;
      }

      indiceCampo++;
      salida.push(`  await ${locator}.fill(${JSON.stringify(valor)});`);
      continue;
    }

    if (paso.tipo === 'click' && paso.esBotonGuardado && paso.locatorChain) {
      if (!permitirGuardar) {
        const locator = aplicarReemplazos(paso.locatorChain);
        salida.push(`  await expect(${locator}).toBeEnabled();`);
        break;
      }
      salida.push(`  ${aplicarReemplazos(paso.textoOriginal.trim())}`);
      continue;
    }

    salida.push(`  ${aplicarReemplazos(paso.textoOriginal.trim())}`);
  }

  return salida.join('\n');
}
