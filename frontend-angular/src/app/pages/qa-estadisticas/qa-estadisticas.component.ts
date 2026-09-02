import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../core/services/api.service';

interface PantallaEstadistica {
  ruta: string;
  codigo: string;
  nombre: string;
  casosTotal: number;
  ejecucionesTotal: number;
  tasaExito: number | null;
  ultimaEjecucionEn: string;
}

interface ResumenGlobal {
  totalPantallas: number;
  totalCasos: number;
  totalEjecuciones: number;
  tasaExitoGlobal: number | null;
  pantallaMasCorrida: string;
}

interface ResumenHallazgos {
  total: number;
  abiertos: number;
}

@Component({
  selector: 'app-qa-estadisticas',
  template: `
    <main class="stats-page" data-testid="qa-estadisticas-page">
      <section class="page-head">
        <div>
          <span class="eyebrow">QA / Datos</span>
          <h1>
            <mat-icon>insights</mat-icon>
            Estadísticas
          </h1>
          <p>Cuántas veces se corrió cada pantalla, con qué resultado, y los hallazgos que dejaron esas corridas.</p>
        </div>
        <button mat-stroked-button type="button" data-testid="qa-estadisticas-refresh-button" [disabled]="cargando" (click)="cargar()">
          <mat-icon>sync</mat-icon>
          Actualizar
        </button>
      </section>

      <div *ngIf="cargando" class="loading-row">
        <mat-icon class="girando">autorenew</mat-icon>
        <span>Cargando estadísticas...</span>
      </div>

      <div *ngIf="error" class="empty-state">
        <mat-icon>error_outline</mat-icon>
        <span>{{ error }}</span>
      </div>

      <ng-container *ngIf="!cargando && !error">
        <section class="metric-row">
          <article class="metric-card" data-testid="qa-estadisticas-metric-ejecuciones">
            <span class="metric-label">Ejecuciones totales</span>
            <strong class="metric-value">{{ resumen.totalEjecuciones }}</strong>
          </article>
          <article class="metric-card" data-testid="qa-estadisticas-metric-tasa">
            <span class="metric-label">Tasa de éxito global</span>
            <strong class="metric-value">{{ resumen.tasaExitoGlobal !== null ? resumen.tasaExitoGlobal + '%' : '—' }}</strong>
          </article>
          <article class="metric-card" data-testid="qa-estadisticas-metric-casos">
            <span class="metric-label">Casos cargados</span>
            <strong class="metric-value">{{ resumen.totalCasos }}</strong>
          </article>
          <article class="metric-card" data-testid="qa-estadisticas-metric-mas-corrida">
            <span class="metric-label">Pantalla más corrida</span>
            <strong class="metric-value metric-value-texto">{{ resumen.pantallaMasCorrida || 'Sin corridas todavía' }}</strong>
          </article>
          <article class="metric-card" data-testid="qa-estadisticas-metric-hallazgos">
            <span class="metric-label">Hallazgos abiertos</span>
            <strong class="metric-value">{{ hallazgos.abiertos }}</strong>
          </article>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <span class="kicker">Corridas por pantalla</span>
              <h2>Ejecuciones</h2>
            </div>
          </div>

          <div class="empty-inner" *ngIf="pantallas.length === 0">
            <mat-icon>inventory_2</mat-icon>
            <span>Todavía no hay pantallas con fuente de casos declarada.</span>
          </div>

          <div class="pantalla-grid" *ngIf="pantallas.length > 0">
            <article
              *ngFor="let pantalla of pantallas; trackBy: trackByRuta"
              class="pantalla-row"
              [attr.data-testid]="'qa-estadisticas-pantalla-' + pantalla.codigo">
              <div class="pantalla-row-head">
                <div>
                  <strong>{{ pantalla.nombre }}</strong>
                  <span class="pantalla-ruta">{{ pantalla.ruta }}</span>
                </div>
                <span class="pantalla-total">{{ pantalla.ejecucionesTotal }} corrida(s)</span>
              </div>
              <div class="barra-track">
                <div class="barra-fill" [style.width.%]="anchoBarra(pantalla)"></div>
              </div>
              <div class="pantalla-row-foot">
                <span class="pantalla-meta">{{ pantalla.casosTotal }} caso(s) cargados</span>
                <span class="pantalla-meta" *ngIf="pantalla.tasaExito !== null">· {{ pantalla.tasaExito }}% de éxito</span>
                <span class="pantalla-meta" *ngIf="pantalla.ejecucionesTotal === 0">Sin corridas todavía.</span>
              </div>
            </article>
          </div>
        </section>
      </ng-container>
    </main>
  `,
  styles: [`
    :host { display: block; }

    .stats-page {
      min-height: calc(100vh - 52px);
      padding: 24px;
      display: grid;
      align-content: start;
      gap: 18px;
      color: #0f172a;
      background: #f4f7fb;
    }

    .page-head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .eyebrow {
      display: block;
      color: #64748b;
      font-size: 11px;
      font-weight: 950;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    h1 {
      margin: 6px 0 0;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 26px;
      font-weight: 950;
    }

    .page-head p {
      margin: 8px 0 0;
      max-width: 640px;
      color: #64748b;
      font-size: 13px;
      font-weight: 750;
      line-height: 1.5;
    }

    .page-head > button {
      height: 40px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 950;
    }

    .loading-row,
    .empty-state,
    .empty-inner {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 28px;
      color: #64748b;
      font-size: 12px;
      font-weight: 800;
    }

    .empty-state {
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      background: #ffffff;
    }

    .girando {
      animation: girar 900ms linear infinite;
    }

    @keyframes girar {
      to { transform: rotate(360deg); }
    }

    .metric-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }

    .metric-card {
      display: grid;
      gap: 6px;
      padding: 16px 18px;
      border: 1px solid #dbe4f0;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 18px 44px rgba(15, 23, 42, .06);
    }

    .metric-label {
      color: #64748b;
      font-size: 11px;
      font-weight: 950;
      letter-spacing: .02em;
      text-transform: uppercase;
    }

    .metric-value {
      font-size: 26px;
      font-weight: 950;
      color: #0f172a;
    }

    .metric-value-texto {
      font-size: 16px;
      line-height: 1.3;
    }

    .panel {
      border: 1px solid #dbe4f0;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 18px 44px rgba(15, 23, 42, .08);
      overflow: hidden;
    }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      padding: 20px 22px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fbff;
    }

    .kicker {
      display: block;
      color: #64748b;
      font-size: 11px;
      font-weight: 950;
      letter-spacing: .03em;
      text-transform: uppercase;
    }

    .panel-head h2 {
      margin: 5px 0 0;
      font-size: 18px;
      font-weight: 950;
    }

    .pantalla-grid {
      display: grid;
      gap: 14px;
      padding: 20px 22px;
    }

    .pantalla-row {
      display: grid;
      gap: 8px;
      padding: 14px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #fbfcfe;
    }

    .pantalla-row-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .pantalla-row-head strong {
      display: block;
      font-size: 14px;
      font-weight: 950;
      color: #0f172a;
    }

    .pantalla-ruta {
      display: block;
      margin-top: 2px;
      color: #94a3b8;
      font-size: 11px;
      font-weight: 750;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }

    .pantalla-total {
      flex: 0 0 auto;
      color: #3157d5;
      font-size: 13px;
      font-weight: 950;
    }

    .barra-track {
      height: 8px;
      border-radius: 999px;
      background: #e8eef7;
      overflow: hidden;
    }

    .barra-fill {
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, #3157d5, #5b8bff);
      transition: width 240ms ease;
    }

    .pantalla-row-foot {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .pantalla-meta {
      color: #64748b;
      font-size: 11px;
      font-weight: 800;
    }
  `],
})
export class QaEstadisticasComponent implements OnInit {
  cargando = false;
  error = '';
  pantallas: PantallaEstadistica[] = [];
  resumen: ResumenGlobal = {
    totalPantallas: 0,
    totalCasos: 0,
    totalEjecuciones: 0,
    tasaExitoGlobal: null,
    pantallaMasCorrida: '',
  };
  hallazgos: ResumenHallazgos = { total: 0, abiertos: 0 };

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando = true;
    this.error = '';
    this.api.get<Record<string, unknown>>('/qa/estadisticas').subscribe({
      next: (respuesta) => {
        this.aplicar(respuesta);
        this.cargando = false;
      },
      error: () => {
        this.error = 'No pude cargar las estadísticas. Probá actualizar de nuevo.';
        this.cargando = false;
      },
    });
  }

  anchoBarra(pantalla: PantallaEstadistica): number {
    const max = Math.max(...this.pantallas.map((item) => item.ejecucionesTotal), 1);
    return Math.round((pantalla.ejecucionesTotal / max) * 100);
  }

  trackByRuta(_index: number, pantalla: PantallaEstadistica): string {
    return pantalla.ruta;
  }

  private aplicar(respuesta: Record<string, unknown>): void {
    const pantallas = this.arrayObjetos(respuesta['pantallas']);
    this.pantallas = pantallas.map((item) => ({
      ruta: this.texto(item['ruta']),
      codigo: this.texto(item['codigo']),
      nombre: this.texto(item['nombre']),
      casosTotal: this.numero(item['casos_total']),
      ejecucionesTotal: this.numero(item['ejecuciones_total']),
      tasaExito: item['tasa_exito'] === null || item['tasa_exito'] === undefined ? null : Number(item['tasa_exito']),
      ultimaEjecucionEn: this.texto(item['ultima_ejecucion_en']),
    }));

    const resumen = this.objeto(respuesta['resumen']);
    this.resumen = {
      totalPantallas: this.numero(resumen['total_pantallas']),
      totalCasos: this.numero(resumen['total_casos']),
      totalEjecuciones: this.numero(resumen['total_ejecuciones']),
      tasaExitoGlobal: resumen['tasa_exito_global'] === null || resumen['tasa_exito_global'] === undefined
        ? null
        : Number(resumen['tasa_exito_global']),
      pantallaMasCorrida: this.texto(resumen['pantalla_mas_corrida']),
    };

    const hallazgos = this.objeto(respuesta['hallazgos']);
    this.hallazgos = {
      total: this.numero(hallazgos['total']),
      abiertos: this.numero(hallazgos['abiertos']),
    };
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
  }

  private arrayObjetos(valor: unknown): Record<string, unknown>[] {
    return Array.isArray(valor) ? valor.map((item) => this.objeto(item)) : [];
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }

  private numero(valor: unknown): number {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }
}
