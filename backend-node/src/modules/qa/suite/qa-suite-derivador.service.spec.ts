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
});
