import { QaHallazgosService } from './qa-hallazgos.service';

class ModeloHallazgosFake {
  private readonly docs = new Map<string, Record<string, unknown>>();

  find(query: Record<string, unknown>) {
    const docs = Array.from(this.docs.values()).filter((doc) => this.coincide(doc, query));
    return this.query(docs);
  }

  findOne(query: Record<string, unknown>) {
    const doc = Array.from(this.docs.values()).find((item) => this.coincide(item, query)) ?? null;
    return { lean: async () => doc };
  }

  findOneAndUpdate(query: Record<string, unknown>, update: Record<string, unknown>) {
    const doc = Array.from(this.docs.values()).find((item) => this.coincide(item, query)) ?? null;
    if (!doc) return { lean: async () => null };

    Object.assign(doc, this.objeto(update['$set']));
    return { lean: async () => doc };
  }

  async bulkWrite(ops: Array<Record<string, unknown>>): Promise<void> {
    for (const op of ops) {
      const updateOne = this.objeto(op['updateOne']);
      const filter = this.objeto(updateOne['filter']);
      const update = this.objeto(updateOne['update']);
      const id = String(filter['id']);
      const existente = this.docs.get(id);
      const siguiente = {
        ...(existente ? {} : this.objeto(update['$setOnInsert'])),
        ...(existente ?? {}),
        ...this.objeto(update['$set']),
        id,
      };
      this.docs.set(id, siguiente);
    }
  }

  async updateMany(query: Record<string, unknown>, update: Record<string, unknown>): Promise<void> {
    for (const doc of this.docs.values()) {
      if (!this.coincide(doc, query)) continue;
      Object.assign(doc, this.objeto(update['$set']));
    }
  }

  private query(docs: Record<string, unknown>[]) {
    const chain = {
      sort: () => chain,
      limit: () => chain,
      lean: async () => docs,
    };
    return chain;
  }

  private coincide(doc: Record<string, unknown>, query: Record<string, unknown>): boolean {
    return Object.entries(query).every(([campo, esperado]) => {
      if (campo === 'id' && this.objeto(esperado)['$nin']) {
        const excluidos = this.objeto(esperado)['$nin'];
        return Array.isArray(excluidos) ? !excluidos.includes(doc['id']) : true;
      }
      return doc[campo] === esperado;
    });
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? valor as Record<string, unknown>
      : {};
  }
}

describe('QaHallazgosService', () => {
  let modelo: ModeloHallazgosFake;
  let service: QaHallazgosService;

  beforeEach(() => {
    modelo = new ModeloHallazgosFake();
    service = new QaHallazgosService(modelo as never);
  });

  it('clasifica una diferencia de cálculo como hallazgo de negocio', async () => {
    const hallazgos = await service.registrarDesdeEjecucion({
      id: 'QA-RUN-NEGOCIO-1',
      caso_id: 'QA-GAN-RET-001',
      estado: 'rojo',
      finalizado_en: '2026-08-27T10:00:00.000Z',
      detalle: 'calculo.retencion_calculada: esperado 0, actual 57584.39, diferencia 57584.39, tolerancia 0.05',
      evidencia_path: 'outputs/playwright/qa-casos/qa-casos-evidence.json',
      evidencia: {
        validaciones: [
          {
            campo: 'calculo.retencion_calculada',
            esperado: 0,
            actual: 57584.39,
            tolerancia: 0.05,
            estado: 'fallo',
          },
        ],
      },
    } as never);

    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toEqual(expect.objectContaining({
      caso_id: 'QA-GAN-RET-001',
      codigo: 'QA_NEGOCIO_CALCULO_RETENCION_CALCULADA',
      tipo: 'negocio',
      severidad: 'alta',
      estado: 'abierto',
      campo: 'calculo.retencion_calculada',
      esperado: 0,
      actual: 57584.39,
    }));
  });

  it('clasifica Excel de otro legajo como precondición', async () => {
    const hallazgos = await service.registrarDesdeEjecucion({
      id: 'QA-RUN-LEGAJO-1',
      caso_id: 'QA-GAN-IMP-010',
      estado: 'rojo',
      finalizado_en: '2026-08-27T10:00:00.000Z',
      detalle: 'El Excel no corresponde al legajo del caso QA: esperado 665, detectado 55.',
      evidencia_path: 'outputs/playwright/qa-casos/qa-casos-evidence.json',
      evidencia: {
        capturas: ['outputs/playwright/qa-casos/qa-gan-imp-010-final.png'],
      },
    } as never);

    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toEqual(expect.objectContaining({
      codigo: 'QA_PRECONDICION_LEGAJO_EXCEL',
      tipo: 'precondicion',
      severidad: 'media',
      campo: 'archivo.legajo',
      esperado: '665',
      actual: '55',
    }));
  });

  it('no genera hallazgos abiertos para una ejecución verde', async () => {
    const hallazgos = await service.registrarDesdeEjecucion({
      id: 'QA-RUN-VERDE-1',
      caso_id: 'QA-GAN-RET-002',
      estado: 'verde',
      finalizado_en: '2026-08-27T10:00:00.000Z',
      detalle: '1 assertion(s) OK',
      evidencia: { validaciones: [] },
    } as never);

    expect(hallazgos).toHaveLength(0);
  });

  it('permite resolver un hallazgo dejando cierre auditado', async () => {
    const [hallazgo] = await service.registrarDesdeEjecucion({
      id: 'QA-RUN-RESOLVER-1',
      caso_id: 'QA-GAN-RET-003',
      estado: 'rojo',
      finalizado_en: '2026-08-27T10:00:00.000Z',
      detalle: 'Timeout waiting for locator("[data-testid=\\"carga-excel-run-button\\"]")',
      evidencia: {},
    } as never);

    const resuelto = await service.cambiarEstado(hallazgo['id'] as string, {
      estado: 'resuelto',
      motivo: 'Selector corregido.',
    }, { id: 'u1', correo: 'qa@local.test' } as never);

    expect(resuelto).toEqual(expect.objectContaining({
      id: hallazgo['id'],
      estado: 'resuelto',
    }));
    expect(resuelto['cierre']).toEqual(expect.objectContaining({
      motivo: 'Selector corregido.',
      correo: 'qa@local.test',
    }));
  });
});
