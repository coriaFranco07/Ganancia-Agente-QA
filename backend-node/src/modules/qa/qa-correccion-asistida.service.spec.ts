import { QaCorreccionAsistidaService } from './qa-correccion-asistida.service';

describe('QaCorreccionAsistidaService', () => {
  const geminiOriginal = process.env.GEMINI_API_KEY;
  const correccionIaOriginal = process.env.AUDITORIA_QA_CORRECCION_IA;
  const modeloOriginal = process.env.GEMINI_MODEL;
  const modelosOriginal = process.env.GEMINI_MODELOS;
  const reintentosOriginal = process.env.GEMINI_REINTENTOS;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.AUDITORIA_QA_CORRECCION_IA;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODELOS;
    delete process.env.GEMINI_REINTENTOS;
  });

  afterAll(() => {
    restaurarEnv('GEMINI_API_KEY', geminiOriginal);
    restaurarEnv('AUDITORIA_QA_CORRECCION_IA', correccionIaOriginal);
    restaurarEnv('GEMINI_MODEL', modeloOriginal);
    restaurarEnv('GEMINI_MODELOS', modelosOriginal);
    restaurarEnv('GEMINI_REINTENTOS', reintentosOriginal);
  });

  it('no propone cambios si el caso todavía no tiene ejecución', async () => {
    const service = new QaCorreccionAsistidaService();

    const correccion = await service.generar({
      caso: { id: 'QA-GAN-RET-001' },
      ejecucion: null,
      hallazgo: { codigo: 'sin_detalle' },
    });

    expect(correccion.estado).toBe('sin_ejecucion');
    expect(correccion.cambios_sugeridos[0].tipo).toBe('sin_cambio');
    expect(correccion.accion_recomendada).toContain('Crear un plan');
  });

  it('no propone corrección sobre una ejecución verde', async () => {
    const service = new QaCorreccionAsistidaService();

    const correccion = await service.generar({
      caso: { id: 'QA-GAN-RET-001' },
      ejecucion: { estado: 'verde', detalle: '1 assertion(s) OK' },
      hallazgo: { codigo: 'generico' },
    });

    expect(correccion.estado).toBe('sin_fallo');
    expect(correccion.accion_recomendada).toContain('No cambiar');
  });

  it('genera una corrección accionable para Excel de otro legajo', async () => {
    const service = new QaCorreccionAsistidaService();

    const correccion = await service.generar({
      caso: {
        id: 'QA-GAN-IMP-010',
        archivo: { nombre: 'Raices_Control Ganancias 082026.xlsx' },
        contexto: { empleado: { legajo: '665' } },
      },
      ejecucion: {
        id: 'QA-RUN-1',
        estado: 'rojo',
        detalle: 'El Excel no corresponde al legajo del caso QA: esperado 665, detectado 55.',
        evidencia: {
          empleado: {
            legajo_esperado: '665',
            legajo_detectado: '55',
          },
          excel: {
            nombre: 'Raices_Control Ganancias 082026.xlsx',
          },
        },
      },
      hallazgo: {
        codigo: 'excel_legajo',
        motivo: 'El Excel es de otro legajo.',
      },
    });

    expect(correccion.estado).toBe('fallback_local');
    expect(correccion.resumen).toContain('legajo');
    expect(correccion.datos_a_revisar).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nombre: 'Legajo esperado', valor_actual: '665' }),
        expect.objectContaining({ nombre: 'Legajo detectado', valor_actual: '55' }),
      ]),
    );
    expect(correccion.ticket_sugerido.criterios_aceptacion.length).toBeGreaterThan(0);
    expect(correccion.prueba_regresion.comando).toContain('QA-GAN-IMP-010');
  });

  it('usa Gemini cuando está configurado y conserva los datos determinísticos del backend', async () => {
    process.env.GEMINI_API_KEY = 'clave-test';
    process.env.GEMINI_MODELOS = 'gemini-test';
    process.env.GEMINI_REINTENTOS = '1';

    const fetchOriginal = global.fetch;
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                resumen: 'Resumen mejorado por IA.',
                causa_probable: 'La assertion no coincide con el snapshot calculado.',
                accion_recomendada: 'Confirmar el esperado con negocio antes de cambiar el caso.',
                pasos: ['Revisar evidencia', 'Actualizar caso solo con aprobación'],
                preguntas_para_responsable: ['¿El esperado fue validado por negocio?'],
                criterios_aceptacion: ['El esperado queda justificado.'],
                mensaje_ticket: 'Ticket redactado por IA.',
                limites: ['No aplicar cambios automáticos.'],
              }),
            }],
          },
        }],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      const service = new QaCorreccionAsistidaService();

      const correccion = await service.generar({
        caso: {
          id: 'QA-GAN-RET-001',
          resultado_esperado: { campo: 'calculo.retencion_calculada', valor: 0 },
        },
        ejecucion: {
          estado: 'rojo',
          detalle: 'calculo.retencion_calculada: esperado 0, actual 57584.39, diferencia 57584.39, tolerancia 0.05',
        },
        hallazgo: {
          codigo: 'assertion',
          motivo: 'Retención esperada distinta al cálculo.',
        },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/models/gemini-test:generateContent'),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(correccion.estado).toBe('generada');
      expect(correccion.proveedor).toBe('gemini');
      expect(correccion.modelo).toBe('gemini-test');
      expect(correccion.resumen).toBe('Resumen mejorado por IA.');
      expect(correccion.datos_a_revisar).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nombre: 'Campo validado', valor_actual: 'calculo.retencion_calculada' }),
          expect.objectContaining({ nombre: 'Valor esperado', valor_actual: '0' }),
        ]),
      );
      expect(correccion.ticket_sugerido.descripcion).toBe('Ticket redactado por IA.');
      expect(correccion.prueba_regresion.comando).toContain('QA-GAN-RET-001');
    } finally {
      global.fetch = fetchOriginal;
    }
  });
});

function restaurarEnv(nombre: string, valor: string | undefined): void {
  if (valor === undefined) {
    delete process.env[nombre];
    return;
  }
  process.env[nombre] = valor;
}
