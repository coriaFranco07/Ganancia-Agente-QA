import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SpiderCasoOperador } from './qa-spider-casos.service';

export interface CampoDetectado {
  nombre: string;
  familia: 'texto' | 'numero' | 'email' | 'fecha';
  valor_original: string;
}

export interface BotonGuardadoDetectado {
  nombre: string;
}

export interface AnalisisSpecResultado {
  login_detectado_y_omitido: boolean;
  total_campos: number;
  total_botones_guardado: number;
  lineas_no_reconocidas: number;
  corte_sin_permitir_guardar: string | null;
  campos: CampoDetectado[];
  botones_guardado: BotonGuardadoDetectado[];
}

export interface GenerarDesdeSpecResultado {
  grupo_generado: string;
  login_detectado_y_omitido: boolean;
  permitio_guardar: boolean;
  casos: SpiderCasoOperador[];
}

@Injectable({ providedIn: 'root' })
export class QaSpecGeneradorService {
  private apiUrl = `${environment.apiUrl}/qa/spider/generador`;

  constructor(private http: HttpClient) {}

  analizar(codigo: string): Observable<AnalisisSpecResultado> {
    return this.http.post<AnalisisSpecResultado>(`${this.apiUrl}/analizar`, { codigo });
  }

  generar(datos: {
    codigo: string;
    nombreBase: string;
    /** Relato en prosa del proceso; se guarda igual en los 3 casos generados. */
    transcripcion?: string;
    nombreArchivo?: string;
    permitirGuardar?: boolean;
  }): Observable<GenerarDesdeSpecResultado> {
    return this.http.post<GenerarDesdeSpecResultado>(`${this.apiUrl}/generar`, datos);
  }
}
