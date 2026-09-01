import { Component, OnInit } from '@angular/core';
import { QaCatalogoService, SpiderNivel, SpiderSeccion } from '../../core/services/qa-catalogo.service';

/**
 * Contenedor de la pantalla: resuelve el catalogo una sola vez y se lo reparte
 * a los hijos. La lista de casos necesita los niveles para las badges y las
 * secciones para el selector de rutas del formulario de edicion.
 */
@Component({
  selector: 'app-qa-pantalla-2',
  template: `
    <main class="qa-page">
      <section class="titulo-seccion">
        <h1>
          <mat-icon>rule</mat-icon>
          QA - Pantalla 2
        </h1>
        <p>Genera casos de prueba desde un spec y ejecutalos de a uno.</p>
      </section>

      <div class="cargando" *ngIf="cargando">
        <mat-spinner diameter="22"></mat-spinner>
        <span>Cargando catálogo...</span>
      </div>

      <mat-card class="panel error" *ngIf="error">
        <mat-icon>error_outline</mat-icon>
        <div>
          <h2>No se pudo cargar el catálogo</h2>
          <p>{{ error }}</p>
        </div>
      </mat-card>

      <ng-container *ngIf="!cargando && !error">
        <app-qa-spider-casos #listaCasos [niveles]="niveles" [secciones]="secciones"></app-qa-spider-casos>
        <app-qa-spec-generador (casosGenerados)="listaCasos.cargar()"></app-qa-spec-generador>
      </ng-container>
    </main>
  `,
  styles: [`
    :host {
      display: block;
    }

    .qa-page {
      padding: 24px;
      display: grid;
      gap: 16px;
    }

    .titulo-seccion h1 {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0;
      color: #0f172a;
      font-size: 24px;
      line-height: 1.2;
      font-weight: 950;
    }

    .titulo-seccion h1 mat-icon {
      color: #2563eb;
    }

    .titulo-seccion p {
      margin: 6px 0 0 34px;
      color: #64748b;
      font-size: 13px;
    }

    .cargando {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #64748b;
      font-size: 13px;
    }

    .panel {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      max-width: 680px;
      padding: 18px;
    }

    .panel.error {
      border-left: 3px solid #ef4444;
    }

    .panel.error mat-icon {
      color: #ef4444;
    }

    .panel h2 {
      margin: 0 0 4px;
      font-size: 15px;
      color: #0f172a;
    }

    .panel p {
      margin: 0;
      font-size: 13px;
      color: #64748b;
    }
  `],
})
export class QaPantalla2Component implements OnInit {
  niveles: SpiderNivel[] = [];
  secciones: SpiderSeccion[] = [];
  cargando = false;
  error: string | null = null;

  constructor(private catalogo: QaCatalogoService) {}

  ngOnInit(): void {
    this.cargando = true;
    this.catalogo.getLabCatalogo().subscribe({
      next: (catalogo) => {
        this.niveles = catalogo?.niveles ?? [];
        this.secciones = catalogo?.secciones ?? [];
        this.cargando = false;
      },
      error: (err) => {
        this.error = err?.error?.message ?? err?.message ?? 'error desconocido';
        this.cargando = false;
      },
    });
  }
}
