import { QaSuiteRunnerService } from './qa-suite-runner.service';

/**
 * Solo ejercita `calcularEstadoConsolidado`, un metodo puro (sin I/O) que
 * decide el semaforo de una corrida. El resto del servicio depende de Mongo
 * y de procesos Playwright spawneados, fuera de alcance de un test unitario;
 * los `null` del constructor nunca se usan en este método.
 */
function crearServicio(): QaSuiteRunnerService {
  return new QaSuiteRunnerService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
}

function ejecucion(estado: 'corriendo' | 'verde' | 'rojo' | 'error') {
  return { estado } as never;
}

function hallazgo(severidad: 'info' | 'baja' | 'media' | 'alta' | 'critica') {
  return { severidad } as never;
}

describe('QaSuiteRunnerService — calcularEstadoConsolidado', () => {
  const service = crearServicio();
  const calcular = (ejecuciones: unknown[], hallazgos: unknown[]) =>
    (service as unknown as { calcularEstadoConsolidado: (e: unknown[], h: unknown[]) => string })
      .calcularEstadoConsolidado(ejecuciones, hallazgos);

  it('nunca consolida en verde si alguna ejecución no pudo correr, aunque no haya hallazgos', () => {
    expect(calcular([ejecucion('verde'), ejecucion('error')], [])).toBe('error');
  });

  it('nunca consolida en verde si alguna ejecución falló, aunque no haya hallazgos registrados', () => {
    expect(calcular([ejecucion('verde'), ejecucion('rojo')], [])).toBe('rojo');
  });

  it('error pesa más que rojo: que la Suite no haya podido correr importa más que una app que falló', () => {
    expect(calcular([ejecucion('rojo'), ejecucion('error')], [])).toBe('error');
  });

  it('con todas las ejecuciones verdes, un hallazgo de severidad alta consolida en rojo', () => {
    expect(calcular([ejecucion('verde'), ejecucion('verde')], [hallazgo('alta')])).toBe('rojo');
  });

  it('con todas las ejecuciones verdes y hallazgos solo de baja severidad, consolida en amarillo', () => {
    expect(calcular([ejecucion('verde')], [hallazgo('baja')])).toBe('amarillo');
  });

  it('con todas las ejecuciones verdes y sin hallazgos, consolida en verde', () => {
    expect(calcular([ejecucion('verde'), ejecucion('verde')], [])).toBe('verde');
  });
});
