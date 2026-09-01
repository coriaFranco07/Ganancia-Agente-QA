import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface SpiderSeccion {
  id: string;
  ruta: string;
  etiqueta: string;
  grupo?: string;
  por_defecto?: boolean;
}

export interface SpiderNivel {
  id: string;
  orden: number;
  etiqueta: string;
  descripcion: string;
}

export interface SpiderCasoCatalogo {
  id: string;
  nombre: string;
  descripcion?: string;
  ambito: string;
  niveles: string[];
  aplica_a: string | string[];
  pasos: string[];
}

export interface SpiderCatalogo {
  version: string;
  niveles: SpiderNivel[];
  secciones: SpiderSeccion[];
  umbrales: Record<string, number>;
  casos: SpiderCasoCatalogo[];
}

/**
 * Catalogo declarativo del Spider.
 *
 * Es la fuente de verdad de niveles y secciones: la lista de casos generados
 * necesita los niveles para sus badges, y el formulario de edicion necesita las
 * secciones para el selector de rutas cuando un caso es de ambito "ruta".
 */
@Injectable({ providedIn: 'root' })
export class QaCatalogoService {
  private apiUrl = `${environment.apiUrl}/qa/spider`;

  constructor(private http: HttpClient) {}

  getLabCatalogo(): Observable<SpiderCatalogo> {
    return this.http.get<SpiderCatalogo>(`${this.apiUrl}/catalogo`);
  }
}
