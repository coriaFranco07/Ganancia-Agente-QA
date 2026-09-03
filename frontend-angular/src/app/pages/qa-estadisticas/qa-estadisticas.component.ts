import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../core/services/api.service';

interface PantallaEstadistica {
  ruta: string;
  codigo: string;
  nombre: string;
  casosTotal: number;
  ejecucionesTotal: number;
}

interface ResumenGlobal {
  totalPantallas: number;
  totalCasos: number;
  totalEjecuciones: number;
  pantallaMasCorrida: string;
  pantallaMasCorridaPorcentaje: number | null;
  deltaEjecucionesPct: number | null;
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
          <p>Resumen real de la actividad del sistema: corridas y hallazgos detectados.</p>
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
          <article class="metric-card metric-blue" data-testid="qa-estadisticas-metric-ejecuciones">
            <span class="metric-icon"><mat-icon>play_circle</mat-icon></span>
            <div class="metric-text">
              <span class="metric-label">Ejecuciones totales</span>
              <strong class="metric-value">{{ resumen.totalEjecuciones }}</strong>
              <span
                class="metric-delta"
                *ngIf="resumen.deltaEjecucionesPct !== null"
                [class.up]="resumen.deltaEjecucionesPct > 0"
                [class.down]="resumen.deltaEjecucionesPct < 0">
                <mat-icon>{{ resumen.deltaEjecucionesPct >= 0 ? 'trending_up' : 'trending_down' }}</mat-icon>
                {{ resumen.deltaEjecucionesPct > 0 ? '+' : '' }}{{ resumen.deltaEjecucionesPct }}% vs. semana anterior
              </span>
              <span class="metric-delta neutral" *ngIf="resumen.deltaEjecucionesPct === null">Sin corridas la semana pasada</span>
            </div>
          </article>
          <article class="metric-card metric-indigo" data-testid="qa-estadisticas-metric-casos">
            <span class="metric-icon"><mat-icon>description</mat-icon></span>
            <div class="metric-text">
              <span class="metric-label">Casos cargados</span>
              <strong class="metric-value">{{ resumen.totalCasos }}</strong>
            </div>
          </article>
          <article class="metric-card metric-amber" data-testid="qa-estadisticas-metric-mas-corrida">
            <span class="metric-icon"><mat-icon>emoji_events</mat-icon></span>
            <div class="metric-text">
              <span class="metric-label">Pantalla más corrida</span>
              <strong class="metric-value metric-value-texto">{{ resumen.pantallaMasCorrida || 'Sin corridas todavía' }}</strong>
              <span class="metric-sub" *ngIf="resumen.pantallaMasCorridaPorcentaje !== null">
                {{ resumen.pantallaMasCorridaPorcentaje }}% de las corridas totales
              </span>
            </div>
          </article>
          <article class="metric-card metric-red" data-testid="qa-estadisticas-metric-hallazgos">
            <span class="metric-icon"><mat-icon>report_problem</mat-icon></span>
            <div class="metric-text">
              <span class="metric-label">Hallazgos abiertos</span>
              <strong class="metric-value">{{ hallazgos.abiertos }}</strong>
              <span class="metric-sub" *ngIf="hallazgos.total > 0">de {{ hallazgos.total }} detectados en total</span>
            </div>
          </article>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <span class="kicker">Solo pantallas que ya corrieron</span>
              <h2>Ejecuciones por pantalla</h2>
            </div>
          </div>

          <div class="empty-inner" *ngIf="pantallasEjecutadas.length === 0">
            <mat-icon>not_started</mat-icon>
            <span>Todavía no se ejecutó ninguna pantalla.</span>
          </div>

          <div class="kpi-grid" *ngIf="pantallasEjecutadas.length > 0">
            <article
              *ngFor="let pantalla of pantallasEjecutadas; let i = index; trackBy: trackByRuta"
              class="kpi-card"
              [class.top]="i === 0"
              [attr.data-testid]="'qa-estadisticas-pantalla-' + pantalla.codigo">
              <svg viewBox="0 0 120 120" class="kpi-ring">
                <circle cx="60" cy="60" r="50" class="kpi-ring-fondo"></circle>
                <circle
                  cx="60" cy="60" r="50"
                  class="kpi-ring-fill"
                  [class.top]="i === 0"
                  [style.strokeDasharray]="arcoPantalla(pantalla)">
                </circle>
                <text x="60" y="57" text-anchor="middle" class="kpi-ring-valor">{{ pantalla.ejecucionesTotal }}</text>
                <text x="60" y="75" text-anchor="middle" class="kpi-ring-sub">corrida(s)</text>
              </svg>
              <div class="kpi-info">
                <span class="kpi-icon" [class.top]="i === 0">
                  <mat-icon>{{ iconoPantalla(pantalla.nombre) }}</mat-icon>
                </span>
                <div class="kpi-nombre">
                  <strong>{{ pantalla.nombre }}</strong>
                  <span>{{ pantalla.ruta }}</span>
                </div>
              </div>
              <span class="kpi-porcentaje">{{ porcentajeDelTotal(pantalla) }}% del total de corridas</span>
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
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 14px;
    }

    .metric-card {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 16px 18px;
      border: 1px solid #dbe4f0;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 14px 32px rgba(15, 23, 42, .06);
      transition: transform 160ms ease, box-shadow 160ms ease;
    }

    .metric-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 20px 40px rgba(15, 23, 42, .1);
    }

    .metric-icon {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 46px;
      height: 46px;
      border-radius: 12px;
    }

    .metric-icon mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .metric-blue .metric-icon { background: #eff6ff; color: #2563eb; }
    .metric-indigo .metric-icon { background: #eef2ff; color: #4f46e5; }
    .metric-amber .metric-icon { background: #fffbeb; color: #d97706; }
    .metric-red .metric-icon { background: #fef2f2; color: #dc2626; }

    .metric-text {
      min-width: 0;
      display: grid;
      gap: 4px;
    }

    .metric-label {
      color: #64748b;
      font-size: 10.5px;
      font-weight: 950;
      letter-spacing: .02em;
      text-transform: uppercase;
    }

    .metric-value {
      font-size: 25px;
      font-weight: 950;
      color: #0f172a;
      line-height: 1.1;
    }

    .metric-value-texto {
      font-size: 15px;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }

    .metric-sub {
      color: #94a3b8;
      font-size: 10.5px;
      font-weight: 800;
    }

    .metric-delta {
      display: flex;
      align-items: center;
      gap: 3px;
      color: #94a3b8;
      font-size: 10.5px;
      font-weight: 900;
    }

    .metric-delta mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .metric-delta.up { color: #16a34a; }
    .metric-delta.down { color: #dc2626; }
    .metric-delta.neutral { color: #94a3b8; }

    .panel {
      border: 1px solid #dbe4f0;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 18px 44px rgba(15, 23, 42, .08);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      padding: 18px 22px;
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
      font-size: 17px;
      font-weight: 950;
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
      padding: 22px;
    }

    .kpi-card {
      display: grid;
      justify-items: center;
      gap: 10px;
      padding: 18px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      background: #fbfcfe;
      text-align: center;
      transition: transform 160ms ease, box-shadow 160ms ease;
    }

    .kpi-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 30px rgba(15, 23, 42, .08);
    }

    .kpi-card.top {
      border-color: #fde68a;
      background: linear-gradient(160deg, #fffdf5, #fbfcfe 65%);
    }

    .kpi-ring {
      width: 108px;
      height: 108px;
    }

    .kpi-ring-fondo {
      fill: none;
      stroke: #eef2f7;
      stroke-width: 10;
    }

    .kpi-ring-fill {
      fill: none;
      stroke: #3157d5;
      stroke-width: 10;
      stroke-linecap: round;
      transform: rotate(-90deg);
      transform-origin: 60px 60px;
      transition: stroke-dasharray 320ms ease;
    }

    .kpi-ring-fill.top {
      stroke: #d97706;
    }

    .kpi-ring-valor {
      font-size: 26px;
      font-weight: 950;
      fill: #0f172a;
    }

    .kpi-ring-sub {
      font-size: 9.5px;
      font-weight: 800;
      fill: #94a3b8;
      text-transform: uppercase;
      letter-spacing: .03em;
    }

    .kpi-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .kpi-icon {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 28px;
      height: 28px;
      border-radius: 9px;
      background: #eff6ff;
      color: #2563eb;
    }

    .kpi-icon.top {
      background: #fef3c7;
      color: #b45309;
    }

    .kpi-icon mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }

    .kpi-nombre {
      text-align: left;
      min-width: 0;
    }

    .kpi-nombre strong {
      display: block;
      font-size: 12.5px;
      font-weight: 950;
      color: #0f172a;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 130px;
    }

    .kpi-nombre span {
      display: block;
      color: #94a3b8;
      font-size: 10px;
      font-weight: 750;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }

    .kpi-porcentaje {
      color: #64748b;
      font-size: 10.5px;
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
    pantallaMasCorrida: '',
    pantallaMasCorridaPorcentaje: null,
    deltaEjecucionesPct: null,
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

  /** Solo las pantallas que ya tuvieron al menos una corrida: las que nunca corrieron no aportan nada al gráfico. */
  get pantallasEjecutadas(): PantallaEstadistica[] {
    return this.pantallas.filter((item) => item.ejecucionesTotal > 0);
  }

  /** Qué porción del anillo pintar, proporcional al total de corridas de todas las pantallas. */
  arcoPantalla(pantalla: PantallaEstadistica): string {
    const circunferencia = 2 * Math.PI * 50;
    const total = this.resumen.totalEjecuciones || 0;
    if (total === 0) return `0 ${circunferencia}`;
    const largo = (pantalla.ejecucionesTotal / total) * circunferencia;
    return `${largo} ${circunferencia - largo}`;
  }

  porcentajeDelTotal(pantalla: PantallaEstadistica): number {
    const total = this.resumen.totalEjecuciones || 0;
    if (total === 0) return 0;
    return Math.round((pantalla.ejecucionesTotal / total) * 1000) / 10;
  }

  /** Icono representativo de la pantalla, según palabras clave de su nombre. */
  iconoPantalla(nombre: string): string {
    const texto = nombre.toLowerCase();
    if (texto.includes('ganancias')) return 'payments';
    if (texto.includes('cliente')) return 'badge';
    return 'dashboard';
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
    }));

    const resumen = this.objeto(respuesta['resumen']);
    this.resumen = {
      totalPantallas: this.numero(resumen['total_pantallas']),
      totalCasos: this.numero(resumen['total_casos']),
      totalEjecuciones: this.numero(resumen['total_ejecuciones']),
      pantallaMasCorrida: this.texto(resumen['pantalla_mas_corrida']),
      pantallaMasCorridaPorcentaje: this.numeroONulo(resumen['pantalla_mas_corrida_porcentaje']),
      deltaEjecucionesPct: this.numeroONulo(resumen['delta_ejecuciones_pct']),
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

  private numeroONulo(valor: unknown): number | null {
    return valor === null || valor === undefined ? null : this.numero(valor);
  }
}
