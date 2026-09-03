import { BadRequestException } from '@nestjs/common';
import {
  QA_CONTRATO_DEFINICION_TECNICA,
  QA_DEFINICION_TECNICA_DEFAULT,
  QaDefinicionesTecnicasService,
} from './qa-definiciones-tecnicas.service';

function selector(nombre: string): string {
  return `[data-testid="${nombre}"]`;
}

function definicionValida(): Record<string, unknown> {
  return {
    codigo: QA_DEFINICION_TECNICA_DEFAULT,
    version: 1,
    nombre: 'Auditoría Ganancias - Retención por Excel',
    descripcion: 'Contrato técnico de prueba',
    sistema: 'auditoria-ganancias',
    modulo: 'qa',
    estado: 'vigente',
    rutas: {
      login: '/login',
      pantalla_qa: '/qa/pantalla-1',
      carga_excel: '/cargar-excel',
    },
    selectores: {
      login: {
        correo_input: selector('auth-email-input'),
        password_input: selector('auth-password-input'),
        submit_button: selector('auth-submit-button'),
      },
      formulario_qa: {
        titulo_texto: 'Legajo de Ganancias',
        pagina: selector('qa-pantalla1-page'),
        nuevo_boton: selector('qa-case-reset-button'),
        guardar_boton: selector('qa-case-save-button'),
        guardado_ok: selector('qa-case-message'),
        guardado_ok_texto: 'Caso guardado en MongoDB para Playwright.',
        excel_input: selector('qa-case-excel-input'),
        campos: {
          idCaso: selector('qa-case-id-input'),
          definicionTecnicaCodigo: selector('qa-case-definicion-select'),
          datasetCodigo: selector('qa-case-dataset-select'),
          periodo: selector('qa-case-periodo-input'),
          clienteNombre: selector('qa-case-cliente-input'),
          modoSaldoFavor: selector('qa-case-modo-saldo-select'),
          descripcion: selector('qa-case-descripcion-input'),
          legajo: selector('qa-case-legajo-input'),
          empleadoNombre: selector('qa-case-empleado-input'),
          cuil: selector('qa-case-cuil-input'),
          remuneracionBruta: selector('qa-case-remuneracion-input'),
          deducciones: selector('qa-case-deducciones-input'),
          estadoEsperado: selector('qa-case-estado-select'),
          campoResultado: selector('qa-case-campo-select'),
          valorEsperado: selector('qa-case-valor-esperado-input'),
          tolerancia: selector('qa-case-tolerancia-input'),
        },
      },
      carga_excel: {
        titulo_texto: 'Iniciar Auditoría',
        pagina: selector('carga-excel-page'),
        excel_input: selector('carga-excel-file-input'),
        cliente_input: selector('carga-excel-cliente-input'),
        legajo_input: selector('carga-excel-legajo-input'),
        periodo_fiscal_input: selector('carga-excel-periodo-fiscal-input'),
        mes_liquidacion_select: selector('carga-excel-mes-liquidacion-select'),
        ejecutar_boton: selector('carga-excel-run-button'),
        resultado_texto: 'Resultado del Análisis',
      },
    },
    pasos: [
      { orden: 1, accion: 'navegar', ruta: 'pantalla_qa' },
      { orden: 2, accion: 'completar_formulario_qa' },
      { orden: 3, accion: 'subir_archivo', destino: 'formulario_qa.excel_input' },
      { orden: 4, accion: 'guardar_caso' },
      { orden: 5, accion: 'ejecutar_analisis' },
      { orden: 6, accion: 'validar_snapshot' },
    ],
  };
}

describe('QaDefinicionesTecnicasService', () => {
  let service: QaDefinicionesTecnicasService;

  beforeEach(() => {
    service = new QaDefinicionesTecnicasService({} as never);
  });

  it('acepta una definición que cumple el contrato mínimo Playwright', () => {
    const contrato = service.validarContrato(definicionValida());

    expect(contrato.contrato_version).toBe(QA_CONTRATO_DEFINICION_TECNICA);
    expect(contrato.valido).toBe(true);
    expect(contrato.errores).toHaveLength(0);
  });

  it('marca como incompleta una definición sin selector obligatorio', () => {
    const definicion = definicionValida();
    const selectores = definicion.selectores as any;
    delete selectores.carga_excel.ejecutar_boton;

    const contrato = service.validarContrato(definicion);

    expect(contrato.valido).toBe(false);
    expect(contrato.errores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tipo: 'selector',
          path: 'selectores.carga_excel.ejecutar_boton',
        }),
      ]),
    );
  });

  it('exige data-testid en los selectores obligatorios', () => {
    const definicion = definicionValida();
    const selectores = definicion.selectores as any;
    selectores.login.submit_button = 'button[type="submit"]';

    const contrato = service.validarContrato(definicion);

    expect(contrato.valido).toBe(false);
    expect(contrato.errores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'selectores.login.submit_button',
          mensaje: 'El selector obligatorio debe usar data-testid estable.',
        }),
      ]),
    );
  });

  it('bloquea el guardado de una definición incompleta antes de persistir', async () => {
    await expect(service.guardar({ codigo: 'DEF-INCOMPLETA', version: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
