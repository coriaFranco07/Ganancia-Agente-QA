import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Resultado de la última corrida de un caso, sea automática o por el botón "Ejecutar". */
export interface SpiderUltimaEjecucion {
  estado: 'pass' | 'fail' | 'error' | 'omitido';
  fecha: string;
  duracion_ms: number;
  hallazgos: number;
}

/** Caso del Spider cargado por el operador: código Playwright + transcripción. */
export interface SpiderCasoOperador {
  id: string;
  nombre: string;
  descripcion: string;
  transcripcion: string;
  codigo_playwright: string;
  niveles: string[];
  ambito: 'global' | 'ruta';
  aplica_a: string[];
  activo: boolean;
  ultima_ejecucion?: SpiderUltimaEjecucion | null;
  /** Id compartido por los casos generados juntos desde el mismo spec. Null si es manual. */
  grupo_generado?: string | null;
  /** Nombre del archivo/spec de origen, solo para los casos generados. */
  generado_desde?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type GuardarSpiderCaso = Omit<
  SpiderCasoOperador,
  'id' | 'ultima_ejecucion' | 'grupo_generado' | 'generado_desde' | 'createdAt' | 'updatedAt'
>;

/** Un paso ejecutado dentro de un caso, tal como lo informa el runner. */
export interface SpiderPasoEjecutado {
  accion: string;
  estado: string;
  detalle: string | null;
  duracion_ms: number;
  datos?: any;
}

/** Un hallazgo puntual (error de código o de validación) dentro de un caso. */
export interface SpiderHallazgo {
  tipo: string;
  gravedad: string;
  detalle: string;
  datos?: any;
}

/** Respuesta del proceso runner al ejecutar un caso individual. */
export interface SpiderEjecucionResultado {
  estado: 'verde' | 'rojo';
  stdout: string;
  stderr: string;
  duracion_ms: number;
  fecha: string;
}

@Injectable({ providedIn: 'root' })
export class QaSpiderCasosService {
  private apiUrl = `${environment.apiUrl}/qa/spider/casos`;

  constructor(private http: HttpClient) {}

  listar(soloActivos = false): Observable<SpiderCasoOperador[]> {
    const query = soloActivos ? '?activos=true' : '';
    return this.http.get<SpiderCasoOperador[]>(`${this.apiUrl}${query}`);
  }

  crear(caso: GuardarSpiderCaso): Observable<SpiderCasoOperador> {
    return this.http.post<SpiderCasoOperador>(this.apiUrl, caso);
  }

  actualizar(id: string, caso: GuardarSpiderCaso): Observable<SpiderCasoOperador> {
    return this.http.put<SpiderCasoOperador>(`${this.apiUrl}/${id}`, caso);
  }

  cambiarEstado(id: string, activo: boolean): Observable<SpiderCasoOperador> {
    return this.http.patch<SpiderCasoOperador>(`${this.apiUrl}/${id}/estado`, { activo });
  }

  eliminar(id: string): Observable<{ mensaje: string; id: string }> {
    return this.http.delete<{ mensaje: string; id: string }>(`${this.apiUrl}/${id}`);
  }

  /** Corre este caso ahora mismo, aislado del resto de la corrida del Spider. */
  ejecutar(id: string): Observable<SpiderEjecucionResultado> {
    return this.http.post<SpiderEjecucionResultado>(`${this.apiUrl}/${id}/ejecutar`, {});
  }
}
