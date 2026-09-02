import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type CategoriaQaSuite = 'funcional' | 'seguridad' | 'accesibilidad';
export type ModoQaSuite = 'rapido' | 'demo';
export type EstadoQaSuiteEjecucion = 'corriendo' | 'verde' | 'rojo';
export type EstadoQaSuiteCorrida = 'corriendo' | 'verde' | 'amarillo' | 'rojo';

export interface AprendizajeAprobado {
  id: string;
  nombre: string;
  modulo: string;
  ruta: string;
  firmas: { negocio: unknown; tecnica: unknown };
}

export interface QaSuiteEjecucion {
  id: string;
  aprendizaje_id: string;
  categoria: CategoriaQaSuite;
  modo: ModoQaSuite;
  estado: EstadoQaSuiteEjecucion;
  iniciado_en: string;
  finalizado_en?: string;
  detalle?: string;
  capturas?: string[];
}

export interface QaSuiteCorrida {
  id: string;
  disparado_por: string;
  disparado_en: string;
  modo: ModoQaSuite;
  aprendizajes: string[];
  categorias: CategoriaQaSuite[];
  ejecuciones: string[];
  estado_consolidado: EstadoQaSuiteCorrida;
  informe: { por_aprendizaje: Record<string, InformeAprendizaje> } | null;
}

export interface TablaCategoriaInforme {
  categoria: CategoriaQaSuite;
  estado: EstadoQaSuiteEjecucion;
  duracion_ms: number | null;
  ejecucion_id: string;
  hallazgos_por_severidad: Record<string, number>;
}

export interface HallazgoInforme {
  id: string;
  categoria_prueba: CategoriaQaSuite;
  severidad: 'info' | 'baja' | 'media' | 'alta' | 'critica';
  codigo: string;
  titulo: string;
  detalle: string;
  campo?: string;
  paso?: string;
  esperado?: unknown;
  actual?: unknown;
  propuesta?: Record<string, unknown>;
}

export interface InformeAprendizaje {
  ficha: {
    aprendizaje_id: string;
    nombre: string;
    modulo: string;
    ruta: string;
    disparado_por: string;
    disparado_en: string;
    modo: ModoQaSuite;
  };
  semaforo: EstadoQaSuiteCorrida;
  tabla_categorias: TablaCategoriaInforme[];
  hallazgos_priorizados: HallazgoInforme[];
  evidencia: string[];
  comparacion_historica: {
    corrida_id: string;
    disparado_en: string;
    semaforo: EstadoQaSuiteCorrida;
    hallazgos_total_anterior: number;
  } | null;
}

export interface EscenarioPrevia {
  campo: string | null;
  valor: string | null;
  motivo: string;
  datos_completos: Record<string, string> | null;
}

export interface CategoriaPrevia {
  categoria: CategoriaQaSuite;
  escenarios: EscenarioPrevia[];
}

export interface AprendizajePrevia {
  aprendizaje_id: string;
  aprendizaje_nombre: string;
  categorias: CategoriaPrevia[];
}

@Injectable({ providedIn: 'root' })
export class QaSuiteService {
  private apiUrl = `${environment.apiUrl}/qa/suite`;

  constructor(private http: HttpClient) {}

  listarAprendizajes(): Observable<AprendizajeAprobado[]> {
    return this.http.get<AprendizajeAprobado[]>(`${this.apiUrl}/aprendizajes`);
  }

  vistaPrevia(datos: { aprendizajes: string[]; categorias: CategoriaQaSuite[]; modo: ModoQaSuite }): Observable<AprendizajePrevia[]> {
    return this.http.post<AprendizajePrevia[]>(`${this.apiUrl}/vista-previa`, datos);
  }

  dispararCorrida(datos: { aprendizajes: string[]; categorias: CategoriaQaSuite[]; modo: ModoQaSuite }): Observable<QaSuiteCorrida> {
    return this.http.post<QaSuiteCorrida>(`${this.apiUrl}/corridas`, datos);
  }

  listarCorridas(): Observable<QaSuiteCorrida[]> {
    return this.http.get<QaSuiteCorrida[]>(`${this.apiUrl}/corridas`);
  }

  obtenerCorrida(id: string): Observable<QaSuiteCorrida> {
    return this.http.get<QaSuiteCorrida>(`${this.apiUrl}/corridas/${encodeURIComponent(id)}`);
  }
}
