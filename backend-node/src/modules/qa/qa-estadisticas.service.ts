import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { fuentesCasosDisponibles, filtroCasosMongo } from './qa-catalogo-elementos';
import { QaCaso, QaCasoDocument } from './schemas/qa-caso.schema';
import { QaEjecucion, QaEjecucionDocument } from './schemas/qa-ejecucion.schema';
import { QaSopLoomEjecucion, QaSopLoomEjecucionDocument } from './schemas/qa-sop-loom-ejecucion.schema';
import { QaHallazgo, QaHallazgoDocument } from './schemas/qa-hallazgo.schema';

interface EstadisticaPantalla {
  ruta: string;
  codigo: string;
  nombre: string;
  casos_total: number;
  ejecuciones_total: number;
  ejecuciones_verde: number;
  ejecuciones_rojo: number;
  ejecuciones_corriendo: number;
  tasa_exito: number | null;
  ultima_ejecucion_en: string | null;
}

@Injectable()
export class QaEstadisticasService {
  constructor(
    @InjectModel(QaCaso.name) private readonly casos: Model<QaCasoDocument>,
    @InjectModel(QaEjecucion.name) private readonly ejecuciones: Model<QaEjecucionDocument>,
    @InjectModel(QaSopLoomEjecucion.name) private readonly ejecucionesSopLoom: Model<QaSopLoomEjecucionDocument>,
    @InjectModel(QaHallazgo.name) private readonly hallazgos: Model<QaHallazgoDocument>,
  ) {}

  async resumen(): Promise<Record<string, unknown>> {
    const pantallas = await Promise.all(
      fuentesCasosDisponibles().map((item) => this.estadisticaDePantalla(item)),
    );
    pantallas.sort((a, b) => b.ejecuciones_total - a.ejecuciones_total);

    const hallazgos = await this.hallazgos
      .find({})
      .select({ tipo: 1, severidad: 1, estado: 1 })
      .lean<Array<{ tipo: string; severidad: string; estado: string }>>();

    const totalEjecuciones = pantallas.reduce((acc, item) => acc + item.ejecuciones_total, 0);
    const totalVerde = pantallas.reduce((acc, item) => acc + item.ejecuciones_verde, 0);

    return {
      pantallas,
      resumen: {
        total_pantallas: pantallas.length,
        total_casos: pantallas.reduce((acc, item) => acc + item.casos_total, 0),
        total_ejecuciones: totalEjecuciones,
        tasa_exito_global: this.tasaExito(totalVerde, totalEjecuciones),
        pantalla_mas_corrida: pantallas.find((item) => item.ejecuciones_total > 0)?.nombre ?? null,
      },
      hallazgos: {
        total: hallazgos.length,
        abiertos: hallazgos.filter((item) => item.estado === 'abierto').length,
        por_severidad: this.contarPor(hallazgos, 'severidad'),
        por_tipo: this.contarPor(hallazgos, 'tipo'),
      },
      generado_en: new Date().toISOString(),
    };
  }

  private async estadisticaDePantalla(
    item: ReturnType<typeof fuentesCasosDisponibles>[number],
  ): Promise<EstadisticaPantalla> {
    const casosIds = await this.casos
      .find(filtroCasosMongo(item.fuente))
      .select({ id: 1 })
      .lean<Array<{ id: string }>>()
      .then((docs) => docs.map((doc) => doc.id));

    // Los casos de Legajo de Ganancias se corren uno por uno con el runner
    // genérico (`qa_ejecuciones`, por caso_id). Los de una pantalla que solo
    // se opera vía SOP Loom (hoy Legajo de Cliente) no tienen ejecución
    // individual: se cuentan por las corridas del flujo (`qa_sop_loom_ejecuciones`).
    const conteo = item.fuente.ejecutable
      ? await this.contarPorCasoId(casosIds)
      : await this.contarPorRuta(item.ruta);

    return {
      ruta: item.ruta,
      codigo: item.codigo,
      nombre: item.nombre,
      casos_total: casosIds.length,
      ...conteo,
    };
  }

  private async contarPorCasoId(casosIds: string[]): Promise<Omit<EstadisticaPantalla, 'ruta' | 'codigo' | 'nombre' | 'casos_total'>> {
    if (casosIds.length === 0) {
      return { ejecuciones_total: 0, ejecuciones_verde: 0, ejecuciones_rojo: 0, ejecuciones_corriendo: 0, tasa_exito: null, ultima_ejecucion_en: null };
    }
    const filtro = { caso_id: { $in: casosIds } };
    const [total, verde, rojo, corriendo, ultima] = await Promise.all([
      this.ejecuciones.countDocuments(filtro),
      this.ejecuciones.countDocuments({ ...filtro, estado: 'verde' }),
      this.ejecuciones.countDocuments({ ...filtro, estado: 'rojo' }),
      this.ejecuciones.countDocuments({ ...filtro, estado: 'corriendo' }),
      this.ejecuciones.findOne(filtro).sort({ iniciado_en: -1 }).select({ iniciado_en: 1 }).lean<{ iniciado_en?: string }>(),
    ]);
    return {
      ejecuciones_total: total,
      ejecuciones_verde: verde,
      ejecuciones_rojo: rojo,
      ejecuciones_corriendo: corriendo,
      tasa_exito: this.tasaExito(verde, total),
      ultima_ejecucion_en: ultima?.iniciado_en ?? null,
    };
  }

  private async contarPorRuta(ruta: string): Promise<Omit<EstadisticaPantalla, 'ruta' | 'codigo' | 'nombre' | 'casos_total'>> {
    const filtro = { ruta };
    const [total, verde, rojo, corriendo, ultima] = await Promise.all([
      this.ejecucionesSopLoom.countDocuments(filtro),
      this.ejecucionesSopLoom.countDocuments({ ...filtro, estado: 'verde' }),
      this.ejecucionesSopLoom.countDocuments({ ...filtro, estado: 'rojo' }),
      this.ejecucionesSopLoom.countDocuments({ ...filtro, estado: 'corriendo' }),
      this.ejecucionesSopLoom.findOne(filtro).sort({ iniciada_en: -1 }).select({ iniciada_en: 1 }).lean<{ iniciada_en?: string }>(),
    ]);
    return {
      ejecuciones_total: total,
      ejecuciones_verde: verde,
      ejecuciones_rojo: rojo,
      ejecuciones_corriendo: corriendo,
      tasa_exito: this.tasaExito(verde, total),
      ultima_ejecucion_en: ultima?.iniciada_en ?? null,
    };
  }

  private tasaExito(verde: number, total: number): number | null {
    if (total === 0) return null;
    return Math.round((verde / total) * 1000) / 10;
  }

  private contarPor(items: Array<Record<string, unknown>>, campo: string): Record<string, number> {
    return items.reduce<Record<string, number>>((acc, item) => {
      const clave = String(item[campo] ?? 'sin_dato');
      acc[clave] = (acc[clave] ?? 0) + 1;
      return acc;
    }, {});
  }
}
