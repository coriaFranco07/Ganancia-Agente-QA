import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

interface CampoFuente {
  clave: string;
  etiqueta: string;
  tipo: 'texto' | 'numero' | 'fecha' | 'archivo' | 'select';
  obligatorio: boolean;
}

interface FuenteCasos {
  ruta: string;
  codigo: string;
  nombre: string;
  etiqueta: string;
  /** Si sus casos se pueden correr uno por uno con el runner genérico. */
  ejecutable: boolean;
  campos: CampoFuente[];
}

interface CasoFila {
  id: string;
  descripcion: string;
  activo: boolean;
  actualizado: string;
  datos: Record<string, string>;
}

type EstadoEjecucionQa = 'corriendo' | 'verde' | 'rojo';

interface EjecucionQa {
  id: string;
  caso_id: string;
  estado: EstadoEjecucionQa;
  detalle: string;
  capturas: string[];
}

interface CapturaAbierta {
  casoId: string;
  indice: number;
  url: string;
  nombre: string;
}

@Component({
  selector: 'app-qa-casos',
  template: `
    <main class="casos-page" data-testid="qa-casos-page">
      <section class="page-head">
        <div>
          <span class="eyebrow">QA / Datos</span>
          <h1>
            <mat-icon>table_view</mat-icon>
            Casos
          </h1>
          <p>Todos los casos QA cargados en las pantallas, en un solo lugar para revisar, editar o eliminar.</p>
        </div>
        <button mat-stroked-button type="button" data-testid="qa-casos-refresh-button" [disabled]="cargandoFuentes || cargandoCasos" (click)="refrescar()">
          <mat-icon>sync</mat-icon>
          Actualizar
        </button>
      </section>

      <nav class="pantalla-tabs" *ngIf="fuentes.length > 0" data-testid="qa-casos-tabs">
        <button
          *ngFor="let fuente of fuentes; trackBy: trackByFuente"
          type="button"
          class="pantalla-tab"
          [class.activa]="fuente.ruta === pantallaSeleccionada?.ruta"
          [attr.data-testid]="'qa-casos-tab-' + slug(fuente.ruta)"
          (click)="seleccionarFuente(fuente)">
          <span>{{ fuente.nombre }}</span>
          <strong *ngIf="totalPorRuta[fuente.ruta] !== undefined">{{ totalPorRuta[fuente.ruta] }}</strong>
        </button>
      </nav>

      <section class="panel" *ngIf="pantallaSeleccionada as fuente">
        <div class="panel-head">
          <div>
            <span class="kicker">{{ fuente.etiqueta }}</span>
            <h2>{{ fuente.nombre }}</h2>
          </div>
          <label class="search-box">
            <mat-icon>search</mat-icon>
            <input
              type="text"
              [(ngModel)]="filtroTexto"
              data-testid="qa-casos-search-input"
              placeholder="Buscar por cualquier dato del caso...">
          </label>
        </div>

        <div *ngIf="cargandoCasos" class="loading-row">
          <mat-icon class="girando">autorenew</mat-icon>
          <span>Cargando casos...</span>
        </div>

        <div *ngIf="!cargandoCasos && casosFiltrados.length === 0" class="empty-state">
          <mat-icon>inventory_2</mat-icon>
          <span *ngIf="!filtroTexto">Sin casos cargados todavía en {{ fuente.nombre }}.</span>
          <span *ngIf="filtroTexto">Ningún caso coincide con "{{ filtroTexto }}".</span>
        </div>

        <div class="table-wrap" *ngIf="!cargandoCasos && casosFiltrados.length > 0">
          <table data-testid="qa-casos-table">
            <thead>
              <tr>
                <th class="col-id">Caso</th>
                <th *ngFor="let campo of fuente.campos">{{ campo.etiqueta }}</th>
                <th class="col-fecha">Actualizado</th>
                <th class="col-ejecucion" *ngIf="fuente.ejecutable">Ejecución</th>
                <th class="col-acciones">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let caso of casosFiltrados; trackBy: trackByCaso" [attr.data-testid]="'qa-casos-row-' + caso.id">
                <td class="col-id">
                  <strong>{{ caso.id }}</strong>
                  <span *ngIf="caso.descripcion">{{ caso.descripcion }}</span>
                </td>
                <td *ngFor="let campo of fuente.campos">{{ caso.datos[campo.clave] || '-' }}</td>
                <td class="col-fecha">{{ fechaTexto(caso.actualizado) }}</td>
                <td class="col-ejecucion" *ngIf="fuente.ejecutable">
                  <span class="estado-pill" [ngClass]="estadoClase(caso.id)" *ngIf="ultimaEjecucion(caso.id) as ejecucion; else sinCorrer">
                    {{ estadoTexto(ejecucion.estado) }}
                  </span>
                  <ng-template #sinCorrer>
                    <span class="estado-pill sin-correr">Sin correr</span>
                  </ng-template>
                </td>
                <td class="col-acciones">
                  <button
                    *ngIf="fuente.ejecutable"
                    mat-icon-button
                    type="button"
                    title="Ejecutar en modo demo"
                    [attr.data-testid]="'qa-casos-run-' + caso.id"
                    [disabled]="casoCorriendo(caso.id)"
                    (click)="ejecutarCaso(caso)">
                    <mat-icon>{{ casoCorriendo(caso.id) ? 'hourglass_top' : 'play_arrow' }}</mat-icon>
                  </button>
                  <button
                    *ngIf="fuente.ejecutable"
                    mat-icon-button
                    type="button"
                    title="Ver imágenes del agente"
                    [attr.data-testid]="'qa-casos-images-' + caso.id"
                    [disabled]="!tieneCapturas(caso.id)"
                    (click)="abrirImagenes(caso.id)">
                    <mat-icon>photo_library</mat-icon>
                  </button>
                  <button
                    mat-icon-button
                    type="button"
                    title="Editar en la pantalla de origen"
                    [attr.data-testid]="'qa-casos-edit-' + caso.id"
                    (click)="editarCaso(caso)">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button
                    mat-icon-button
                    type="button"
                    title="Eliminar caso"
                    class="delete-button"
                    [attr.data-testid]="'qa-casos-delete-' + caso.id"
                    [disabled]="eliminandoId === caso.id"
                    (click)="eliminarCaso(caso)">
                    <mat-icon>{{ eliminandoId === caso.id ? 'hourglass_top' : 'delete' }}</mat-icon>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="table-footer" *ngIf="!cargandoCasos && casosFiltrados.length > 0">
          {{ casosFiltrados.length }} de {{ casos.length }} caso(s)
        </div>
      </section>

      <section class="empty-state page-empty" *ngIf="!cargandoFuentes && fuentes.length === 0">
        <mat-icon>inventory_2</mat-icon>
        <span>No hay pantallas con fuente de casos declarada todavía.</span>
      </section>

      <section
        *ngIf="capturaAbierta as captura"
        class="captura-modal"
        data-testid="qa-casos-images-modal"
        role="dialog"
        aria-modal="true"
        (click)="cerrarImagenes()">
        <article class="captura-modal-card" (click)="$event.stopPropagation()">
          <header>
            <div>
              <span>Captura del agente</span>
              <strong>{{ captura.nombre }}</strong>
            </div>
            <button mat-icon-button type="button" data-testid="qa-casos-images-close" (click)="cerrarImagenes()">
              <mat-icon>close</mat-icon>
            </button>
          </header>
          <div class="captura-modal-body">
            <button
              mat-icon-button
              type="button"
              class="captura-nav prev"
              data-testid="qa-casos-images-prev"
              [disabled]="!puedeMoverCaptura()"
              (click)="moverCaptura(-1)">
              <mat-icon>chevron_left</mat-icon>
            </button>
            <img [src]="captura.url" [alt]="captura.nombre">
            <button
              mat-icon-button
              type="button"
              class="captura-nav next"
              data-testid="qa-casos-images-next"
              [disabled]="!puedeMoverCaptura()"
              (click)="moverCaptura(1)">
              <mat-icon>chevron_right</mat-icon>
            </button>
          </div>
          <footer>{{ captura.indice + 1 }} de {{ totalCapturas() }}</footer>
        </article>
      </section>
    </main>
  `,
  styles: [`
    :host { display: block; }

    .casos-page {
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

    .pantalla-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .pantalla-tab {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 42px;
      padding: 0 16px;
      border: 1px solid #dbe4f0;
      border-radius: 999px;
      background: #ffffff;
      color: #334155;
      font-size: 13px;
      font-weight: 900;
      cursor: pointer;
      transition: border 150ms ease, background 150ms ease, color 150ms ease;
    }

    .pantalla-tab:hover {
      border-color: #94a3b8;
    }

    .pantalla-tab.activa {
      border-color: #2563eb;
      background: #2563eb;
      color: #ffffff;
    }

    .pantalla-tab strong {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 22px;
      padding: 0 6px;
      border-radius: 999px;
      background: rgba(37, 99, 235, .12);
      color: #2563eb;
      font-size: 11px;
      font-weight: 950;
    }

    .pantalla-tab.activa strong {
      background: rgba(255, 255, 255, .22);
      color: #ffffff;
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

    .search-box {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 40px;
      min-width: 260px;
      padding: 0 12px;
      border: 1px solid #cbd8ea;
      border-radius: 8px;
      background: #ffffff;
    }

    .search-box mat-icon {
      color: #94a3b8;
      font-size: 19px;
      width: 19px;
      height: 19px;
    }

    .search-box input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font: inherit;
      font-size: 13px;
      font-weight: 750;
      color: #0f172a;
    }

    .loading-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 40px 22px;
      color: #64748b;
      font-size: 13px;
      font-weight: 850;
    }

    .girando {
      animation: girar 1.1s linear infinite;
    }

    @keyframes girar {
      to { transform: rotate(360deg); }
    }

    .empty-state {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 84px;
      margin: 18px;
      padding: 14px;
      border: 1px dashed #cbd8ea;
      border-radius: 8px;
      background: #f8fbff;
      color: #64748b;
      font-size: 13px;
      font-weight: 850;
    }

    .empty-state mat-icon {
      color: #2563eb;
    }

    .page-empty {
      margin: 0;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      min-width: 720px;
      border-collapse: collapse;
    }

    th, td {
      padding: 13px 14px;
      border-bottom: 1px solid #e2e8f0;
      text-align: left;
      vertical-align: middle;
      font-size: 12px;
      font-weight: 800;
    }

    th {
      color: #475569;
      background: #f8fbff;
      font-size: 10px;
      font-weight: 950;
      letter-spacing: .03em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    td { color: #0f172a; }

    .col-id strong {
      display: block;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 950;
    }

    .col-id span {
      display: block;
      margin-top: 4px;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #64748b;
      font-size: 11px;
      font-weight: 750;
    }

    .col-fecha { white-space: nowrap; color: #64748b; }

    .col-ejecucion { white-space: nowrap; }

    .estado-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 74px;
      height: 26px;
      padding: 0 10px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 950;
      text-transform: uppercase;
    }

    .estado-pill.sin-correr { background: #f1f5f9; color: #64748b; }
    .estado-pill.corriendo { background: #eff6ff; color: #1d4ed8; }
    .estado-pill.verde { background: #dcfce7; color: #166534; }
    .estado-pill.rojo { background: #fee2e2; color: #991b1b; }

    .captura-modal {
      position: fixed;
      inset: 0;
      z-index: 1200;
      display: grid;
      place-items: center;
      padding: 28px;
      background: rgba(15, 23, 42, .68);
      backdrop-filter: blur(4px);
    }

    .captura-modal-card {
      width: min(1180px, 96vw);
      max-height: 92vh;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      overflow: hidden;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 28px 90px rgba(15, 23, 42, .36);
    }

    .captura-modal-card header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid #e2e8f0;
    }

    .captura-modal-card header span {
      display: block;
      color: #64748b;
      font-size: 10px;
      font-weight: 950;
      text-transform: uppercase;
    }

    .captura-modal-card header strong {
      display: block;
      overflow: hidden;
      color: #0f172a;
      font-size: 14px;
      font-weight: 950;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .captura-modal-body {
      position: relative;
      min-height: 0;
      display: grid;
      place-items: center;
      padding: 16px 58px;
      background: #f8fafc;
    }

    .captura-modal-body img {
      max-width: 100%;
      max-height: calc(92vh - 136px);
      object-fit: contain;
      border-radius: 10px;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      box-shadow: 0 18px 48px rgba(15, 23, 42, .18);
    }

    .captura-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 42px;
      height: 42px;
      background: #ffffff;
      color: #2563eb;
      box-shadow: 0 12px 28px rgba(15, 23, 42, .18);
    }

    .captura-nav.prev { left: 12px; }
    .captura-nav.next { right: 12px; }

    .captura-modal-card footer {
      padding: 10px 16px;
      border-top: 1px solid #e2e8f0;
      background: #ffffff;
      color: #64748b;
      font-size: 11px;
      font-weight: 850;
      text-align: center;
    }

    .col-acciones {
      width: 180px;
      white-space: nowrap;
    }

    .col-acciones button {
      width: 34px;
      height: 34px;
    }

    .col-acciones mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .delete-button mat-icon {
      color: #b91c1c;
    }

    .table-footer {
      padding: 12px 22px;
      border-top: 1px solid #e2e8f0;
      background: #f8fbff;
      color: #64748b;
      font-size: 11px;
      font-weight: 850;
    }

    @media (max-width: 720px) {
      .casos-page { padding: 16px 12px 24px; }
      .panel-head { flex-direction: column; align-items: stretch; }
      .search-box { min-width: 0; }
    }
  `],
})
export class QaCasosComponent implements OnInit, OnDestroy {
  fuentes: FuenteCasos[] = [];
  pantallaSeleccionada: FuenteCasos | null = null;
  casos: CasoFila[] = [];
  totalPorRuta: Record<string, number> = {};
  filtroTexto = '';
  cargandoFuentes = false;
  cargandoCasos = false;
  eliminandoId = '';
  capturaAbierta: CapturaAbierta | null = null;

  private ejecucionesPorCaso = new Map<string, EjecucionQa>();
  private readonly casosCorriendo = new Set<string>();
  private polling?: Subscription;

  constructor(private api: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.cargarFuentes();
    this.polling = timer(4000, 4000).subscribe(() => {
      if (this.pantallaSeleccionada?.ejecutable && this.hayEjecucionesCorriendo()) {
        this.cargarEjecuciones();
      }
    });
  }

  ngOnDestroy(): void {
    this.polling?.unsubscribe();
  }

  get casosFiltrados(): CasoFila[] {
    const termino = this.normalizar(this.filtroTexto);
    if (!termino) return this.casos;
    return this.casos.filter((caso) => {
      const valores = [caso.id, caso.descripcion, ...Object.values(caso.datos)];
      return valores.some((valor) => this.normalizar(valor).includes(termino));
    });
  }

  refrescar(): void {
    this.cargarFuentes();
  }

  seleccionarFuente(fuente: FuenteCasos): void {
    if (this.pantallaSeleccionada?.ruta === fuente.ruta) return;
    this.pantallaSeleccionada = fuente;
    this.filtroTexto = '';
    this.cargarCasos(fuente);
    if (fuente.ejecutable) this.cargarEjecuciones();
  }

  /** Corre el caso en modo demo: Chrome visible, más lento, para poder verlo. */
  ejecutarCaso(caso: CasoFila): void {
    if (this.casoCorriendo(caso.id)) return;

    this.casosCorriendo.add(caso.id);
    this.api.post<EjecucionQa>(`/qa/casos/${encodeURIComponent(caso.id)}/ejecutar`, { modo: 'demo' }).subscribe({
      next: (ejecucion) => {
        this.casosCorriendo.delete(caso.id);
        this.ejecucionesPorCaso.set(ejecucion.caso_id, ejecucion);
      },
      error: (error) => {
        this.casosCorriendo.delete(caso.id);
        alert(this.mensajeErrorApi(error, `No se pudo ejecutar ${caso.id}.`));
      },
    });
  }

  ultimaEjecucion(casoId: string): EjecucionQa | null {
    return this.ejecucionesPorCaso.get(casoId) ?? null;
  }

  casoCorriendo(casoId: string): boolean {
    return this.casosCorriendo.has(casoId) || this.ultimaEjecucion(casoId)?.estado === 'corriendo';
  }

  tieneCapturas(casoId: string): boolean {
    return (this.ultimaEjecucion(casoId)?.capturas.length ?? 0) > 0;
  }

  estadoClase(casoId: string): string {
    return this.ultimaEjecucion(casoId)?.estado ?? 'sin-correr';
  }

  estadoTexto(estado: EstadoEjecucionQa): string {
    if (estado === 'verde') return 'Verde';
    if (estado === 'rojo') return 'Rojo';
    return 'Corriendo';
  }

  abrirImagenes(casoId: string): void {
    const ejecucion = this.ultimaEjecucion(casoId);
    if (!ejecucion || ejecucion.capturas.length === 0) return;
    this.mostrarCaptura(ejecucion, 0);
  }

  cerrarImagenes(): void {
    this.capturaAbierta = null;
  }

  puedeMoverCaptura(): boolean {
    return this.totalCapturas() > 1;
  }

  totalCapturas(): number {
    if (!this.capturaAbierta) return 0;
    return this.ultimaEjecucion(this.capturaAbierta.casoId)?.capturas.length ?? 0;
  }

  moverCaptura(paso: number): void {
    if (!this.capturaAbierta) return;
    const ejecucion = this.ultimaEjecucion(this.capturaAbierta.casoId);
    if (!ejecucion) return;
    const total = ejecucion.capturas.length;
    const siguiente = (this.capturaAbierta.indice + paso + total) % total;
    this.mostrarCaptura(ejecucion, siguiente);
  }

  /**
   * La edición se hace en la pantalla de origen: ahí ya existe el formulario
   * completo con sus validaciones. Este módulo solo navega con el id.
   */
  editarCaso(caso: CasoFila): void {
    if (!this.pantallaSeleccionada) return;
    this.router.navigate([this.pantallaSeleccionada.ruta], { queryParams: { editar: caso.id } });
  }

  eliminarCaso(caso: CasoFila): void {
    if (!confirm(`¿Eliminar el caso "${caso.id}"?`)) return;

    this.eliminandoId = caso.id;
    this.api.delete<{ id: string }>(`/qa/casos/${encodeURIComponent(caso.id)}`).subscribe({
      next: () => {
        this.casos = this.casos.filter((item) => item.id !== caso.id);
        if (this.pantallaSeleccionada) {
          this.totalPorRuta[this.pantallaSeleccionada.ruta] = this.casos.length;
        }
      },
      error: () => {
        alert('No pude eliminar el caso. Probá de nuevo.');
      },
      complete: () => {
        this.eliminandoId = '';
      },
    });
  }

  trackByFuente(_index: number, fuente: FuenteCasos): string {
    return fuente.ruta;
  }

  trackByCaso(_index: number, caso: CasoFila): string {
    return caso.id;
  }

  slug(valor: string): string {
    return valor.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  }

  fechaTexto(valor: string): string {
    if (!valor) return '-';
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return '-';
    return fecha.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  private cargarFuentes(): void {
    this.cargandoFuentes = true;
    this.api.get<FuenteCasos[]>('/qa/casos/fuentes').subscribe({
      next: (fuentes) => {
        this.cargandoFuentes = false;
        this.fuentes = Array.isArray(fuentes) ? fuentes : [];
        const previa = this.pantallaSeleccionada?.ruta;
        const objetivo = this.fuentes.find((fuente) => fuente.ruta === previa) ?? this.fuentes[0] ?? null;
        this.pantallaSeleccionada = objetivo;
        this.fuentes.forEach((fuente) => this.cargarCasos(fuente, true));
        if (objetivo) {
          this.cargarCasos(objetivo);
          if (objetivo.ejecutable) this.cargarEjecuciones();
        }
      },
      error: () => {
        this.cargandoFuentes = false;
        this.fuentes = [];
      },
    });
  }

  /** Trae la última ejecución de cada caso, para el chip de estado y las capturas. */
  private cargarEjecuciones(): void {
    this.api.get<EjecucionQa[]>('/qa/ejecuciones/ultimas').subscribe({
      next: (ejecuciones) => {
        this.ejecucionesPorCaso = new Map((Array.isArray(ejecuciones) ? ejecuciones : []).map((ejecucion) => [ejecucion.caso_id, ejecucion]));
      },
    });
  }

  private hayEjecucionesCorriendo(): boolean {
    return this.casosCorriendo.size > 0
      || Array.from(this.ejecucionesPorCaso.values()).some((ejecucion) => ejecucion.estado === 'corriendo');
  }

  private mostrarCaptura(ejecucion: EjecucionQa, indice: number): void {
    const nombre = ejecucion.capturas[indice]?.split(/[\\/]/).pop() ?? `captura-${indice + 1}.png`;
    this.capturaAbierta = {
      casoId: ejecucion.caso_id,
      indice,
      nombre,
      url: this.api.url(`/qa/ejecuciones/${encodeURIComponent(ejecucion.id)}/capturas/${indice}`),
    };
  }

  private mensajeErrorApi(error: unknown, fallback: string): string {
    const err = this.objeto(error);
    const body = this.objeto(err['error']);
    const mensaje = body['message'] ?? err['message'];
    if (Array.isArray(mensaje)) return mensaje.map((item) => this.texto(item)).filter(Boolean).join(' ');
    return mensaje ? this.texto(mensaje) : fallback;
  }

  private cargarCasos(fuente: FuenteCasos, soloContar = false): void {
    if (!soloContar) this.cargandoCasos = true;
    this.api.get<Record<string, unknown>[]>('/qa/casos', { pantalla: fuente.ruta }).subscribe({
      next: (respuesta) => {
        const filas = (Array.isArray(respuesta) ? respuesta : []).map((item) => this.normalizarCaso(item));
        this.totalPorRuta[fuente.ruta] = filas.length;
        if (!soloContar) {
          this.casos = filas;
          this.cargandoCasos = false;
        }
      },
      error: () => {
        if (!soloContar) {
          this.casos = [];
          this.cargandoCasos = false;
        }
      },
    });
  }

  private normalizarCaso(item: Record<string, unknown>): CasoFila {
    const datosBrutos = this.objeto(item['datos']);
    const datos: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(datosBrutos)) {
      datos[clave] = this.texto(valor);
    }
    return {
      id: this.texto(item['id']),
      descripcion: this.texto(item['descripcion']),
      activo: item['activo'] !== false,
      actualizado: this.texto(item['updatedAt'] ?? item['updated_at']),
      datos,
    };
  }

  private normalizar(valor: string): string {
    return valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? valor as Record<string, unknown>
      : {};
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }
}
