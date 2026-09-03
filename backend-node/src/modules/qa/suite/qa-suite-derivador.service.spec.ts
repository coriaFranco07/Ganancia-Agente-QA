import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CampoCatalogo } from '../qa-catalogo-elementos';
import { PasoEjecutable } from '../qa-sop-loom.service';
import { QaSuiteDerivadorService } from './qa-suite-derivador.service';

const campoCuil: CampoCatalogo = {
  clave: 'cuil',
  etiqueta: 'CUIL',
  testid: 'input-cuil',
  tipo: 'texto',
  obligatorio: true,
  alias: [],
  restriccion: { largo_exacto: 11 },
};

const campoNombre: CampoCatalogo = {
  clave: 'nombre',
  etiqueta: 'Nombre completo',
  testid: 'input-nombre',
  tipo: 'texto',
  obligatorio: true,
  alias: [],
};

const campoTelefono: CampoCatalogo = {
  clave: 'telefono',
  etiqueta: 'Teléfono',
  testid: 'input-telefono',
  tipo: 'texto',
  obligatorio: false,
  alias: [],
  restriccion: { largo_minimo: 6, largo_maximo: 15, patron: '^[0-9-]+$' },
};

const campoEdad: CampoCatalogo = {
  clave: 'edad',
  etiqueta: 'Edad',
  testid: 'input-edad',
  tipo: 'numero',
  obligatorio: true,
  alias: [],
  restriccion: { valor_minimo: 18, valor_maximo: 99 },
};

const campoFechaIngreso: CampoCatalogo = {
  clave: 'fecha_ingreso',
  etiqueta: 'Fecha de ingreso',
  testid: 'input-fecha-ingreso',
  tipo: 'fecha',
  obligatorio: true,
  alias: [],
  restriccion: { dias_atras_max: 30, dias_adelante_max: 5 },
};

const camposCompletos: CampoCatalogo[] = [campoCuil, campoNombre, campoTelefono, campoEdad, campoFechaIngreso];

const pasos: PasoEjecutable[] = [
  {
    orden: 1,
    tipo: 'navegar',
    nombre: 'Abrir Alta de cliente',
    escribe: false,
    valor: '/qa/pantalla-3',
    origen: { tipo: 'navegacion', ref: 'nav-1' },
  },
  {
    orden: 2,
    tipo: 'completar',
    nombre: 'Completar CUIL',
    escribe: true,
    campo: 'cuil',
    origen: { tipo: 'navegacion', ref: 'nav-2' },
  },
  {
    orden: 3,
    tipo: 'completar',
    nombre: 'Completar Nombre',
    escribe: true,
    campo: 'nombre',
    origen: { tipo: 'navegacion', ref: 'nav-3' },
  },
  {
    orden: 4,
    tipo: 'click',
    nombre: 'Guardar',
    escribe: false,
    origen: { tipo: 'navegacion', ref: 'nav-4' },
  },
];

const pasosCompletos: PasoEjecutable[] = [
  pasos[0],
  pasos[1],
  pasos[2],
  {
    orden: 3,
    tipo: 'completar',
    nombre: 'Completar Teléfono',
    escribe: true,
    campo: 'telefono',
    origen: { tipo: 'navegacion', ref: 'nav-telefono' },
  },
  {
    orden: 4,
    tipo: 'completar',
    nombre: 'Completar Edad',
    escribe: true,
    campo: 'edad',
    origen: { tipo: 'navegacion', ref: 'nav-edad' },
  },
  {
    orden: 5,
    tipo: 'completar',
    nombre: 'Completar Fecha de ingreso',
    escribe: true,
    campo: 'fecha_ingreso',
    origen: { tipo: 'navegacion', ref: 'nav-fecha' },
  },
  pasos[3],
];

describe('QaSuiteDerivadorService', () => {
  const service = new QaSuiteDerivadorService();

  it('es determinista: el mismo aprendizaje y la misma categoria derivan siempre los mismos escenarios', () => {
    const primera = service.derivarEscenarios('APR-1', pasos, [campoCuil, campoNombre], 'seguridad');
    const segunda = service.derivarEscenarios('APR-1', pasos, [campoCuil, campoNombre], 'seguridad');
    expect(segunda).toEqual(primera);
  });

  it('funcional respeta el largo exacto declarado del campo', () => {
    const escenarios = service.derivarEscenarios('APR-1', pasos, [campoCuil, campoNombre], 'funcional');
    const deCuil = escenarios.filter((e) => e.campo_bajo_prueba === 'cuil');
    expect(deCuil.length).toBeGreaterThan(0);
    for (const escenario of deCuil) {
      expect(escenario.valor_bajo_prueba).toHaveLength(11);
    }
  });

  it('seguridad incluye un valor que viola el largo exacto declarado', () => {
    const escenarios = service.derivarEscenarios('APR-1', pasos, [campoCuil, campoNombre], 'seguridad');
    const violaLargo = escenarios.some(
      (e) => e.campo_bajo_prueba === 'cuil' && e.valor_bajo_prueba?.length !== 11,
    );
    expect(violaLargo).toBe(true);
  });

  it('seguridad incluye al menos un payload de inyeccion en un campo de texto libre', () => {
    const escenarios = service.derivarEscenarios('APR-1', pasos, [campoCuil, campoNombre], 'seguridad');
    const conInyeccion = escenarios.some(
      (e) => e.campo_bajo_prueba === 'nombre' && /script|OR '1'='1|\$ne/.test(e.valor_bajo_prueba ?? ''),
    );
    expect(conInyeccion).toBe(true);
  });

  it('accesibilidad no varia ningun valor: un solo escenario base con valores funcionales seguros', () => {
    const escenarios = service.derivarEscenarios('APR-1', pasos, [campoCuil, campoNombre], 'accesibilidad');
    expect(escenarios).toHaveLength(1);
    expect(escenarios[0].campo_bajo_prueba).toBeNull();
    expect(escenarios[0].datos.cuil).toHaveLength(11);
  });

  it('al atacar un campo, el resto se completa con un valor funcional seguro para no romper el flujo', () => {
    const escenarios = service.derivarEscenarios('APR-1', pasos, [campoCuil, campoNombre], 'seguridad');
    const atacaCuil = escenarios.find((e) => e.campo_bajo_prueba === 'cuil');
    expect(atacaCuil?.datos.nombre).toBe('dato de prueba');
  });

  it('marca el candidato que viola el largo del CUIL como violacion_restriccion: run-qa-suite-seguridad.mjs decide el oraculo por ese campo', () => {
    const escenarios = service.derivarEscenarios('APR-1', pasos, [campoCuil, campoNombre], 'seguridad');
    const violaLargo = escenarios.find((e) => e.campo_bajo_prueba === 'cuil' && e.motivo.includes('largo exacto declarado'));
    expect(violaLargo?.valor_bajo_prueba).toHaveLength(22);
    expect(violaLargo?.tipo).toBe('violacion_restriccion');
  });

  it('marca los payloads de inyeccion como tipo inyeccion', () => {
    const escenarios = service.derivarEscenarios('APR-1', pasos, [campoCuil, campoNombre], 'seguridad');
    const conScript = escenarios.find((e) => e.valor_bajo_prueba?.includes('<script>'));
    expect(conScript?.tipo).toBe('inyeccion');
  });

  /**
   * Fase 9 del plan de la Suite (docs/plan_suite_calidad.md): sin este test,
   * nada impide que `qa-suite-derivador.service.ts` (usado por la vista
   * previa) y `scripts/lib/qa-suite-derivador.mjs` (su espejo en JS, usado
   * por los runners) se desincronicen -y si eso pasa, la vista previa deja
   * de mostrar lo que la Suite realmente va a escribir. Se corren ambos
   * motores, con los mismos campos (texto con y sin restriccion, numero,
   * fecha) y pasos, sobre las tres categorias, y se exige salida identica.
   *
   * El espejo se corre en un proceso Node aparte (no con `import()` directo
   * desde el test): Jest intercepta los imports dinamicos con su propio
   * loader, que no entiende sintaxis ESM (`export`) fuera de lo que pasa por
   * su `transform` -y `.mjs` queda deliberadamente afuera de ese transform,
   * son procesos Node autonomos. Correrlo aparte evita pelearse con eso y
   * ademas prueba el mismo runtime que usan los runners reales.
   */
  it('paridad: el motor en TS y su espejo en JS derivan exactamente los mismos escenarios', () => {
    const rutaEspejo = resolve(__dirname, '../../../../scripts/lib/qa-suite-derivador.mjs');
    // El especificador de un import dinámico tiene que ser una URL de verdad:
    // en Windows una ruta cruda ("D:\...") arranca con lo que el loader ESM
    // lee como esquema "d:" y tira ERR_UNSUPPORTED_ESM_URL_SCHEME.
    const codigo = `
      import { derivarEscenarios } from ${JSON.stringify(pathToFileURL(rutaEspejo).href)};
      const pasos = ${JSON.stringify(pasosCompletos)};
      const campos = ${JSON.stringify(camposCompletos)};
      const resultado = {};
      for (const categoria of ['funcional', 'seguridad', 'accesibilidad']) {
        resultado[categoria] = derivarEscenarios('PARIDAD', pasos, campos, categoria);
      }
      process.stdout.write(JSON.stringify(resultado));
    `;
    const salida = execFileSync(process.execPath, ['--input-type=module', '-e', codigo], { encoding: 'utf8' });
    const desdeJs = JSON.parse(salida) as Record<string, unknown[]>;

    for (const categoria of ['funcional', 'seguridad', 'accesibilidad'] as const) {
      const desdeTs = service.derivarEscenarios('PARIDAD', pasosCompletos, camposCompletos, categoria);
      expect(desdeJs[categoria]).toEqual(desdeTs);
    }
  });
});
