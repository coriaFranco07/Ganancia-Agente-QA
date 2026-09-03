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

interface DiaEvolucion {
  fecha: string;
  ejecuciones: number;
}

interface EventoActividad {
  tipo: 'ejecucion_verde' | 'ejecucion_rojo' | 'hallazgo';
  pantalla: string;
  detalle: string;
  severidad?: string;
  en: string;
}

const DIAS_EVOLUCION = 14;

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
    const masCorrida = pantallas.find((item) => item.ejecuciones_total > 0) ?? null;

    const evolucion = await this.evolucionDiaria();
    const [evolucionAnterior, evolucionActual] = this.partirEnMitades(evolucion);

    return {
      pantallas,
      resumen: {
        total_pantallas: pantallas.length,
        total_casos: pantallas.reduce((acc, item) => acc + item.casos_total, 0),
        total_ejecuciones: totalEjecuciones,
        tasa_exito_global: this.tasaExito(totalVerde, totalEjecuciones),
        pantalla_mas_corrida: masCorrida?.nombre ?? null,
        pantalla_mas_corrida_porcentaje: masCorrida ? this.tasaExito(masCorrida.ejecuciones_total, totalEjecuciones) : null,
        // Compara la suma de los últimos 7 días contra los 7 anteriores, con
        // los mismos datos de `evolucion` — sin otra consulta a Mongo.
        delta_ejecuciones_pct: this.deltaPorcentual(evolucionAnterior, evolucionActual),
      },
      evolucion,
      hallazgos: {
        total: hallazgos.length,
        abiertos: hallazgos.filter((item) => item.estado === 'abierto').length,
        por_severidad: this.contarPor(hallazgos, 'severidad'),
        por_tipo: this.contarPor(hallazgos, 'tipo'),
      },
      actividad: await this.actividadReciente(),
      generado_en: new Date().toISOString(),
    };
  }

  /**
   * Ejecuciones por día de los últimos `DIAS_EVOLUCION` días, sumando ambas
   * fuentes (runner genérico y SOP Loom). Un día sin corridas queda en cero:
   * no se salta, para que el gráfico no distorsione la escala de tiempo.
   */
  private async evolucionDiaria(): Promise<DiaEvolucion[]> {
    const hoy = new Date();
    const desde = new Date(hoy);
    desde.setUTCDate(desde.getUTCDate() - (DIAS_EVOLUCION - 1));
    desde.setUTCHours(0, 0, 0, 0);
    const desdeIso = desde.toISOString();

    const [genericas, sopLoom] = await Promise.all([
      this.ejecuciones.find({ iniciado_en: { $gte: desdeIso } }).select({ iniciado_en: 1 }).lean<Array<{ iniciado_en: string }>>(),
      this.ejecucionesSopLoom.find({ iniciada_en: { $gte: desdeIso } }).select({ iniciada_en: 1 }).lean<Array<{ iniciada_en: string }>>(),
    ]);

    const porDia = new Map<string, number>();
    for (const item of [...genericas.map((e) => e.iniciado_en), ...sopLoom.map((e) => e.iniciada_en)]) {
      const dia = this.texto(item).slice(0, 10);
      if (!dia) continue;
      porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
    }

    const dias: DiaEvolucion[] = [];
    for (let i = 0; i < DIAS_EVOLUCION; i++) {
      const fecha = new Date(desde);
      fecha.setUTCDate(fecha.getUTCDate() + i);
      const clave = fecha.toISOString().slice(0, 10);
      dias.push({ fecha: clave, ejecuciones: porDia.get(clave) ?? 0 });
    }
    return dias;
  }

  /** Divide una serie de N días en dos mitades iguales: [más vieja, más nueva]. */
  private partirEnMitades(dias: DiaEvolucion[]): [DiaEvolucion[], DiaEvolucion[]] {
    const mitad = Math.floor(dias.length / 2);
    return [dias.slice(0, mitad), dias.slice(mitad)];
  }

  private deltaPorcentual(anterior: DiaEvolucion[], actual: DiaEvolucion[]): number | null {
    const sumaAnterior = anterior.reduce((acc, item) => acc + item.ejecuciones, 0);
    const sumaActual = actual.reduce((acc, item) => acc + item.ejecuciones, 0);
    if (sumaAnterior === 0) return sumaActual > 0 ? 100 : null;
    return Math.round(((sumaActual - sumaAnterior) / sumaAnterior) * 1000) / 10;
  }

  /**
   * Últimos eventos reales del sistema: corridas terminadas (de las dos
   * fuentes de ejecución) y hallazgos detectados, mezclados y ordenados por
   * fecha. No incluye altas de casos: ya se ve como conteo en la tarjeta de
   * arriba y sumarlo acá duplicaba la señal sin agregar nada nuevo.
   */
  private async actividadReciente(): Promise<EventoActividad[]> {
    const pantallaEjecutable = fuentesCasosDisponibles().find((item) => item.fuente.ejecutable)?.nombre ?? 'Legajo de Ganancias';

    const [genericas, sopLoom, hallazgosRecientes] = await Promise.all([
      this.ejecuciones
        .find({ estado: { $ne: 'corriendo' } })
        .sort({ iniciado_en: -1 })
        .limit(6)
        .select({ estado: 1, iniciado_en: 1, finalizado_en: 1 })
        .lean<Array<{ estado: string; iniciado_en: string; finalizado_en?: string }>>(),
      this.ejecucionesSopLoom
        .find({ estado: { $ne: 'corriendo' } })
        .sort({ iniciada_en: -1 })
        .limit(6)
        .select({ estado: 1, iniciada_en: 1, finalizada_en: 1, pantalla_nombre: 1 })
        .lean<Array<{ estado: string; iniciada_en: string; finalizada_en?: string; pantalla_nombre: string }>>(),
      this.hallazgos
        .find({})
        .sort({ detectado_en: -1 })
        .limit(6)
        .select({ titulo: 1, severidad: 1, detectado_en: 1 })
        .lean<Array<{ titulo: string; severidad: string; detectado_en: string }>>(),
    ]);

    const eventos: EventoActividad[] = [
      ...genericas.map((item) => ({
        tipo: (item.estado === 'verde' ? 'ejecucion_verde' : 'ejecucion_rojo') as EventoActividad['tipo'],
        pantalla: pantallaEjecutable,
        detalle: item.estado === 'verde' ? 'Ejecución completada' : 'Ejecución fallida',
        en: item.finalizado_en || item.iniciado_en,
      })),
      ...sopLoom.map((item) => ({
        tipo: (item.estado === 'verde' ? 'ejecucion_verde' : 'ejecucion_rojo') as EventoActividad['tipo'],
        pantalla: item.pantalla_nombre,
        detalle: item.estado === 'verde' ? 'Ejecución completada' : 'Ejecución fallida',
        en: item.finalizada_en || item.iniciada_en,
      })),
      ...hallazgosRecientes.map((item) => ({
        tipo: 'hallazgo' as const,
        pantalla: '',
        detalle: item.titulo,
        severidad: item.severidad,
        en: item.detectado_en,
      })),
    ];

    return eventos
      .filter((item) => item.en)
      .sort((a, b) => (a.en < b.en ? 1 : a.en > b.en ? -1 : 0))
      .slice(0, 8);
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

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }
}
