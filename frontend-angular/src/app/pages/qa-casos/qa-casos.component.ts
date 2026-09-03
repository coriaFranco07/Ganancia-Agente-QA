import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatPaginatorIntl, PageEvent } from '@angular/material/paginator';
import { Subscription, timer } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

/** Textos del paginador en castellano, scoped a este componente. */
function paginadorEnCastellano(): MatPaginatorIntl {
  const intl = new MatPaginatorIntl();
  intl.itemsPerPageLabel = 'Casos por página:';
  intl.nextPageLabel = 'Página siguiente';
  intl.previousPageLabel = 'Página anterior';
  intl.firstPageLabel = 'Primera página';
  intl.lastPageLabel = 'Última página';
  intl.getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) return `0 de ${length}`;
    const total = Math.max(length, 0);
    const inicio = page * pageSize;
    const fin = Math.min(inicio + pageSize, total);
    return `${inicio + 1} – ${fin} de ${total}`;
  };
  return intl;
}

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
  // Ejecuciones viejas en Mongo no tienen este campo: nunca asumir que existe.
  capturas?: string[];
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
              (ngModelChange)="paginaActual = 0"
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

        <div class="casos-grid" *ngIf="!cargandoCasos && casosFiltrados.length > 0" data-testid="qa-casos-grid">
          <article
            *ngFor="let caso of casosPaginados; trackBy: trackByCaso"
            class="caso-card"
            [class.inactivo]="!caso.activo"
            [attr.data-testid]="'qa-casos-card-' + caso.id">
            <header class="caso-card-head">
              <div class="caso-card-titulo">
                <strong>{{ caso.id }}</strong>
                <span *ngIf="caso.descripcion">{{ caso.descripcion }}</span>
              </div>
              <span class="veces-pill" [title]="ultimaEjecucion(caso.id)?.detalle || ''">
                {{ vecesCorrida(caso.id) }} {{ vecesCorrida(caso.id) === 1 ? 'corrida' : 'corridas' }}
              </span>
            </header>

            <div class="caso-card-datos" *ngIf="datosPrincipales(caso) as datos">
              <div class="caso-dato" *ngFor="let dato of datos">
                <span class="caso-dato-label">{{ dato.etiqueta }}</span>
                <span class="caso-dato-valor">{{ dato.valor }}</span>
              </div>
              <div class="caso-dato" *ngIf="datos.length === 0">
                <span class="caso-dato-valor caso-dato-vacio">Sin datos cargados</span>
              </div>
            </div>

            <footer class="caso-card-fecha">{{ fechaTexto(caso.actualizado) }}</footer>

            <div class="caso-card-actions">
              <div class="caso-run-row">
                <button
                  type="button"
                  class="caso-action caso-action-run"
                  [title]="fuente.ejecutable ? 'Ejecutar rápido (sin ventana)' : 'Esta pantalla todavía no tiene ejecución automática'"
                  [attr.data-testid]="'qa-casos-run-rapido-' + caso.id"
                  [disabled]="!fuente.ejecutable || casoCorriendo(caso.id)"
                  (click)="ejecutarCaso(caso, 'rapido')">
                  <mat-icon>{{ casoCorriendo(caso.id) ? 'hourglass_top' : 'speed' }}</mat-icon>
                  <span>Rápido</span>
                </button>
                <button
                  type="button"
                  class="caso-action caso-action-run caso-action-run-lento"
                  [title]="fuente.ejecutable ? 'Ejecutar lento (con ventana, para ver al agente)' : 'Esta pantalla todavía no tiene ejecución automática'"
                  [attr.data-testid]="'qa-casos-run-lento-' + caso.id"
                  [disabled]="!fuente.ejecutable || casoCorriendo(caso.id)"
                  (click)="ejecutarCaso(caso, 'demo')">
                  <mat-icon>{{ casoCorriendo(caso.id) ? 'hourglass_top' : 'slow_motion_video' }}</mat-icon>
                  <span>Lento</span>
                </button>
              </div>
              <div class="caso-icon-row">
                <button
                  type="button"
                  class="caso-action"
                  title="Ver toda la información del caso"
                  [attr.data-testid]="'qa-casos-info-' + caso.id"
                  (click)="verInfo(caso)">
                  <mat-icon>visibility</mat-icon>
                </button>
                <button
                  type="button"
                  class="caso-action"
                  [title]="fuente.ejecutable ? 'Ver imágenes del agente' : 'Esta pantalla todavía no tiene ejecución automática'"
                  [attr.data-testid]="'qa-casos-images-' + caso.id"
                  [disabled]="!fuente.ejecutable || !tieneCapturas(caso.id)"
                  (click)="abrirImagenes(caso.id)">
                  <mat-icon>photo_library</mat-icon>
                </button>
                <button
                  type="button"
                  class="caso-action"
                  title="Editar en la pantalla de origen"
                  [attr.data-testid]="'qa-casos-edit-' + caso.id"
                  (click)="editarCaso(caso)">
                  <mat-icon>edit</mat-icon>
                </button>
                <button
                  type="button"
                  class="caso-action caso-action-delete"
                  title="Eliminar caso"
                  [attr.data-testid]="'qa-casos-delete-' + caso.id"
                  [disabled]="eliminandoId === caso.id"
                  (click)="eliminarCaso(caso)">
                  <mat-icon>{{ eliminandoId === caso.id ? 'hourglass_top' : 'delete' }}</mat-icon>
                </button>
              </div>
            </div>
          </article>
        </div>

        <mat-paginator
          *ngIf="!cargandoCasos && casosFiltrados.length > 0"
          data-testid="qa-casos-paginator"
          class="casos-paginator"
          [length]="casosFiltrados.length"
          [pageSize]="tamanoPagina"
          [pageSizeOptions]="tamanosPagina"
          [pageIndex]="paginaActual"
          showFirstLastButtons
          (page)="onPaginar($event)">
        </mat-paginator>
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
            <img
              *ngIf="!capturaConError"
              [src]="captura.url"
              [alt]="captura.nombre"
              (error)="capturaConError = true"
              (load)="capturaConError = false">
            <div class="captura-error" *ngIf="capturaConError">
              <mat-icon>broken_image</mat-icon>
              <span>No se pudo cargar la captura. Puede que el archivo ya no exista en disco.</span>
            </div>
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

      <section
        *ngIf="infoAbierta as caso"
        class="info-modal"
        data-testid="qa-casos-info-modal"
        role="dialog"
        aria-modal="true"
        (click)="cerrarInfo()">
        <article class="info-modal-card" (click)="$event.stopPropagation()">
          <header>
            <div>
              <span>Caso</span>
              <strong>{{ caso.id }}</strong>
            </div>
            <button mat-icon-button type="button" data-testid="qa-casos-info-close" (click)="cerrarInfo()">
              <mat-icon>close</mat-icon>
            </button>
          </header>
          <div class="info-modal-body">
            <p class="info-descripcion" *ngIf="caso.descripcion">{{ caso.descripcion }}</p>
            <dl>
              <div class="info-row" *ngFor="let campo of pantallaSeleccionada?.campos">
                <dt>{{ campo.etiqueta }}</dt>
                <dd>{{ caso.datos[campo.clave] || '—' }}</dd>
              </div>
              <div class="info-row" *ngIf="pantallaSeleccionada?.ejecutable">
                <dt>Veces corrido</dt>
                <dd>{{ vecesCorrida(caso.id) }}</dd>
              </div>
              <div class="info-row" *ngIf="pantallaSeleccionada?.ejecutable && ultimaEjecucion(caso.id) as ejecucion">
                <dt>Último resultado</dt>
                <dd>{{ estadoTexto(ejecucion.estado) }}</dd>
              </div>
              <div class="info-row">
                <dt>Actualizado</dt>
                <dd>{{ fechaTexto(caso.actualizado) }}</dd>
              </div>
              <div class="info-row">
                <dt>Activo</dt>
                <dd>{{ caso.activo ? 'Sí' : 'No' }}</dd>
              </div>
            </dl>
          </div>
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
    }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      padding: 20px 22px;
      border-bottom: 1px solid #e2e8f0;
      border-radius: 8px 8px 0 0;
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

    .casos-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
      padding: 20px 22px;
    }

    .caso-card {
      display: grid;
      grid-template-rows: auto 1fr auto auto;
      gap: 12px;
      padding: 16px;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
      transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
    }

    .caso-card:hover {
      transform: translateY(-3px);
      border-color: #bcd0f5;
      box-shadow: 0 16px 32px rgba(15, 23, 42, .1);
    }

    .caso-card.inactivo {
      opacity: .55;
    }

    .caso-card-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 6px 8px;
    }

    .caso-card-titulo {
      min-width: 0;
    }

    .caso-card-titulo strong {
      display: block;
      overflow: hidden;
      color: #0f172a;
      font-size: 14px;
      font-weight: 950;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .caso-card-titulo span {
      display: block;
      margin-top: 3px;
      overflow: hidden;
      color: #64748b;
      font-size: 11.5px;
      font-weight: 750;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .caso-card-datos {
      display: grid;
      gap: 8px;
      align-content: start;
    }

    .caso-dato {
      display: grid;
      gap: 2px;
      padding-bottom: 7px;
      border-bottom: 1px dashed #edf1f7;
    }

    .caso-dato:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .caso-dato-label {
      color: #94a3b8;
      font-size: 9.5px;
      font-weight: 900;
      letter-spacing: .02em;
      text-transform: uppercase;
    }

    .caso-dato-valor {
      overflow: hidden;
      color: #1e293b;
      font-size: 12.5px;
      font-weight: 800;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .caso-dato-vacio {
      color: #94a3b8;
      font-weight: 700;
      font-style: italic;
    }

    .caso-card-fecha {
      color: #94a3b8;
      font-size: 10.5px;
      font-weight: 800;
    }

    .caso-card-actions {
      display: grid;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid #f1f5f9;
    }

    .caso-run-row,
    .caso-icon-row {
      display: flex;
      gap: 6px;
    }

    .caso-icon-row .caso-action {
      flex: 1 1 auto;
      padding: 0;
    }

    .caso-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 34px;
      padding: 0 10px;
      border: 1px solid #e2e8f0;
      border-radius: 9px;
      background: #ffffff;
      color: #475569;
      font: inherit;
      font-size: 11px;
      font-weight: 900;
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease, opacity 150ms ease;
    }

    .caso-action:not(:disabled):hover {
      border-color: #bcd0f5;
      background: #f4f8ff;
      color: #2458fb;
    }

    .caso-action:disabled {
      opacity: .45;
      cursor: default;
    }

    .caso-action mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }

    .caso-action span {
      white-space: nowrap;
    }

    .caso-action-run {
      flex: 1 1 auto;
      border-color: #2458fb;
      background: #2458fb;
      color: #ffffff;
    }

    .caso-action-run:not(:disabled):hover {
      background: #1d49d6;
      border-color: #1d49d6;
      color: #ffffff;
    }

    .caso-action-run-lento {
      background: #475569;
      border-color: #475569;
    }

    .caso-action-run-lento:not(:disabled):hover {
      background: #334155;
      border-color: #334155;
      color: #ffffff;
    }

    .caso-action-delete:not(:disabled):hover {
      border-color: #fca5a5;
      background: #fef2f2;
      color: #b91c1c;
    }

    .veces-pill {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      height: 24px;
      padding: 0 10px;
      border-radius: 999px;
      background: #eef2ff;
      color: #4338ca;
      font-size: 9.5px;
      font-weight: 950;
      white-space: nowrap;
      text-transform: uppercase;
    }

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
      min-height: 420px;
      display: grid;
      place-items: center;
      padding: 16px 58px;
      background: #f8fafc;
    }

    .captura-error {
      display: grid;
      justify-items: center;
      gap: 10px;
      max-width: 320px;
      color: #64748b;
      font-size: 13px;
      font-weight: 800;
      text-align: center;
    }

    .captura-error mat-icon {
      color: #94a3b8;
      font-size: 32px;
      width: 32px;
      height: 32px;
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

    .casos-paginator {
      border-top: 1px solid #e2e8f0;
      border-radius: 0 0 8px 8px;
      background: #f8fbff;
      overflow: hidden;
    }

    .info-modal {
      position: fixed;
      inset: 0;
      z-index: 1200;
      display: grid;
      place-items: center;
      padding: 28px;
      background: rgba(15, 23, 42, .68);
      backdrop-filter: blur(4px);
    }

    .info-modal-card {
      width: min(560px, 96vw);
      max-height: 88vh;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 28px 90px rgba(15, 23, 42, .36);
    }

    .info-modal-card header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid #e2e8f0;
    }

    .info-modal-card header span {
      display: block;
      color: #64748b;
      font-size: 10px;
      font-weight: 950;
      text-transform: uppercase;
    }

    .info-modal-card header strong {
      display: block;
      overflow: hidden;
      color: #0f172a;
      font-size: 15px;
      font-weight: 950;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .info-modal-body {
      overflow-y: auto;
      padding: 6px 18px 18px;
    }

    .info-descripcion {
      margin: 12px 0 4px;
      padding: 10px 12px;
      border-radius: 9px;
      background: #f8fbff;
      color: #334155;
      font-size: 12.5px;
      font-weight: 750;
      line-height: 1.45;
    }

    .info-modal-body dl {
      margin: 6px 0 0;
    }

    .info-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 0;
      border-bottom: 1px solid #f1f5f9;
    }

    .info-row:last-child {
      border-bottom: none;
    }

    .info-row dt {
      flex: 0 0 auto;
      color: #64748b;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .01em;
      text-transform: uppercase;
    }

    .info-row dd {
      margin: 0;
      overflow-wrap: anywhere;
      text-align: right;
      color: #0f172a;
      font-size: 13px;
      font-weight: 800;
    }

    @media (max-width: 1180px) {
      .casos-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }

    @media (max-width: 900px) {
      .casos-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 640px) {
      .casos-page { padding: 16px 12px 24px; }
      .panel-head { flex-direction: column; align-items: stretch; }
      .search-box { min-width: 0; }
      .casos-grid { grid-template-columns: minmax(0, 1fr); padding: 16px; }
    }
  `],
  providers: [{ provide: MatPaginatorIntl, useFactory: paginadorEnCastellano }],
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
  capturaConError = false;
  infoAbierta: CasoFila | null = null;
  paginaActual = 0;
  tamanoPagina = 10;
  readonly tamanosPagina = [10, 25, 50, 100];

  /** Claves que ayudan más de un vistazo a identificar el caso: si están
   * cargadas, se priorizan sobre el resto para las 3 tarjetas de la card. */
  private static readonly CLAVES_PRIORITARIAS = ['cliente', 'empleado', 'periodo', 'dataset', 'area_sector', 'telefono'];

  private ejecucionesPorCaso = new Map<string, EjecucionQa>();
  private conteosPorCaso: Record<string, number> = {};
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

  /** Solo la porción de la página actual: la tabla nunca muestra el listado completo. */
  get casosPaginados(): CasoFila[] {
    const inicio = this.paginaActual * this.tamanoPagina;
    return this.casosFiltrados.slice(inicio, inicio + this.tamanoPagina);
  }

  onPaginar(evento: PageEvent): void {
    this.paginaActual = evento.pageIndex;
    this.tamanoPagina = evento.pageSize;
  }

  refrescar(): void {
    this.cargarFuentes();
  }

  seleccionarFuente(fuente: FuenteCasos): void {
    if (this.pantallaSeleccionada?.ruta === fuente.ruta) return;
    this.pantallaSeleccionada = fuente;
    this.filtroTexto = '';
    this.paginaActual = 0;
    this.cargarCasos(fuente);
    this.cargarConteos();
    if (fuente.ejecutable) this.cargarEjecuciones();
  }

  /** Corre el caso: 'rapido' sin ventana, 'demo' con Chrome visible para poder verlo. */
  ejecutarCaso(caso: CasoFila, modo: 'rapido' | 'demo'): void {
    if (this.casoCorriendo(caso.id) || !this.pantallaSeleccionada?.ejecutable) return;

    this.casosCorriendo.add(caso.id);
    this.api.post<EjecucionQa>(`/qa/casos/${encodeURIComponent(caso.id)}/ejecutar`, { modo }).subscribe({
      next: (ejecucion) => {
        this.casosCorriendo.delete(caso.id);
        this.ejecucionesPorCaso.set(ejecucion.caso_id, ejecucion);
        this.cargarConteos();
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

  vecesCorrida(casoId: string): number {
    return this.conteosPorCaso[casoId] ?? 0;
  }

  casoCorriendo(casoId: string): boolean {
    return this.casosCorriendo.has(casoId) || this.ultimaEjecucion(casoId)?.estado === 'corriendo';
  }

  tieneCapturas(casoId: string): boolean {
    return (this.ultimaEjecucion(casoId)?.capturas?.length ?? 0) > 0;
  }

  estadoTexto(estado: EstadoEjecucionQa): string {
    // "Rojo" leía como si el agente se hubiera roto. La comparación corrió
    // bien: lo que dice es si el valor calculado coincidió con el esperado.
    if (estado === 'verde') return 'Correcto';
    if (estado === 'rojo') return 'Incorrecto';
    return 'Corriendo';
  }

  abrirImagenes(casoId: string): void {
    const ejecucion = this.ultimaEjecucion(casoId);
    if (!ejecucion?.capturas?.length) return;
    this.mostrarCaptura(ejecucion, 0);
  }

  cerrarImagenes(): void {
    this.capturaAbierta = null;
  }

  verInfo(caso: CasoFila): void {
    this.infoAbierta = caso;
  }

  cerrarInfo(): void {
    this.infoAbierta = null;
  }

  /** 2 o 3 datos para mostrar de un vistazo en la tarjeta, sin repetir el id
   * (ya es el título) y priorizando los campos más identificables si están cargados. */
  datosPrincipales(caso: CasoFila): { etiqueta: string; valor: string }[] {
    const fuente = this.pantallaSeleccionada;
    if (!fuente) return [];
    const disponibles = fuente.campos
      .filter((campo) => campo.clave !== 'id')
      .map((campo) => ({ clave: campo.clave, etiqueta: campo.etiqueta, valor: caso.datos[campo.clave] || '' }))
      .filter((dato) => dato.valor);
    const prioritarios = disponibles.filter((dato) => QaCasosComponent.CLAVES_PRIORITARIAS.includes(dato.clave));
    const resto = disponibles.filter((dato) => !QaCasosComponent.CLAVES_PRIORITARIAS.includes(dato.clave));
    return [...prioritarios, ...resto].slice(0, 3);
  }

  puedeMoverCaptura(): boolean {
    return this.totalCapturas() > 1;
  }

  totalCapturas(): number {
    if (!this.capturaAbierta) return 0;
    return this.ultimaEjecucion(this.capturaAbierta.casoId)?.capturas?.length ?? 0;
  }

  moverCaptura(paso: number): void {
    if (!this.capturaAbierta) return;
    const ejecucion = this.ultimaEjecucion(this.capturaAbierta.casoId);
    const total = ejecucion?.capturas?.length ?? 0;
    if (!ejecucion || total === 0) return;
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
        // Si el borrado deja la página actual vacía, retrocede en vez de mostrarla en blanco.
        const ultimaPagina = Math.max(0, Math.ceil(this.casosFiltrados.length / this.tamanoPagina) - 1);
        if (this.paginaActual > ultimaPagina) this.paginaActual = ultimaPagina;
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
          this.cargarConteos();
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

  /** Cuántas veces se corrió cada caso, para el contador de la tarjeta. */
  private cargarConteos(): void {
    this.api.get<Record<string, number>>('/qa/ejecuciones/conteos').subscribe({
      next: (conteos) => {
        this.conteosPorCaso = conteos && typeof conteos === 'object' ? conteos : {};
      },
    });
  }

  private hayEjecucionesCorriendo(): boolean {
    return this.casosCorriendo.size > 0
      || Array.from(this.ejecucionesPorCaso.values()).some((ejecucion) => ejecucion.estado === 'corriendo');
  }

  private mostrarCaptura(ejecucion: EjecucionQa, indice: number): void {
    const nombre = ejecucion.capturas?.[indice]?.split(/[\\/]/).pop() ?? `captura-${indice + 1}.png`;
    this.capturaConError = false;
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
