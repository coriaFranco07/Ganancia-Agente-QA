import { Component, OnInit } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ApiService } from '../../core/services/api.service';

type EstadoAprendizaje = 'borrador' | 'revisar' | 'listo' | 'aprobado';

interface FormularioLoom {
  descripcionVideo: string;
}

interface PasoAprendido {
  orden: number;
  accion: string;
  ruta: string;
  selectorSugerido: string;
}

interface CampoAprendido {
  nombre: string;
  etiqueta: string;
  testid: string;
  tipo: 'texto' | 'select' | 'archivo' | 'numero' | 'fecha' | 'desconocido';
  obligatorio: boolean;
  fuente: 'navegacion' | 'detectado' | 'inferido';
}

interface ElementoNavegado {
  testid: string;
  selector: string;
  tag: string;
  tipo: string;
  nombre: string;
  etiqueta: string;
  visible: boolean;
  fuente: Record<string, unknown>;
}

interface InspeccionNavegacion {
  id: string;
  ruta: string;
  frontendUrl: string;
  titulo: string;
  encabezado: string;
  inspeccionadaEn: string;
  solicitadaPor: string;
  elementos: ElementoNavegado[];
  capturaPath: string;
  hash: string;
}

/** Paso resuelto contra elementos observados por Playwright en el sandbox. */
interface PasoEjecutable {
  orden: number;
  tipo: string;
  nombre: string;
  selector: string;
  campo: string;
  valor: string;
  escribe: boolean;
}

/** Caso QA real (cargado a mano o por Excel) con el que el agente va a operar. */
interface CasoAEjecutar {
  id: string;
  descripcion: string;
  idEsperado: string;
  resumen: string;
}

/** Precaución del SOP y la decisión humana sobre si el test la cubre. */
interface GuardaSop {
  id: string;
  texto: string;
  testeable: boolean | null;
  control: 'automatico' | 'humano' | 'sin_definir';
}

interface FirmaAprendizaje {
  por: string;
  en: string;
  rol: string;
}

interface PantallaAprendida {
  id: string;
  nombre: string;
  modulo: string;
  ruta: string;
  rol: string;
  entorno: string;
  estado: EstadoAprendizaje;
  creadoEn: string;
  loomRef: string | null;
  objetivo: string;
  criterioAceptacion: string;
  descripcionVideo: string;
  pasos: PasoAprendido[];
  campos: CampoAprendido[];
  acciones: string[];
  consideraciones: GuardaSop[];
  pendientes: string[];
  aprobacion?: Record<string, unknown> | null;
  firmas?: Record<string, unknown> | null;
  ultimaEjecucion?: Record<string, unknown> | null;
  definicionEjecutable?: Record<string, unknown> | null;
  inspeccionNavegacion?: InspeccionNavegacion | null;
}

@Component({
  selector: 'app-qa-sop-loom',
  template: `
    <main class="loom-page" data-testid="qa-sop-loom-page">
      <section class="page-head">
        <div>
          <span class="eyebrow">QA / SOP</span>
          <h1>
            <mat-icon>psychology</mat-icon>
            SOP Loom
          </h1>
          <p>Pegá únicamente el texto que devuelve Loom para aprender el flujo operativo de una pantalla.</p>
        </div>

        <div class="head-actions">
          <button mat-stroked-button type="button" data-testid="qa-sop-loom-refresh-button" (click)="actualizarAprendizajes()">
            <mat-icon>sync</mat-icon>
            Actualizar
          </button>
          <button mat-stroked-button type="button" data-testid="qa-sop-loom-reset-button" (click)="nuevoLimpio()">
            <mat-icon>refresh</mat-icon>
            Nuevo
          </button>
          <button mat-flat-button color="primary" type="button" data-testid="qa-sop-loom-example-button" (click)="cargarEjemplo()">
            <mat-icon>auto_fix_high</mat-icon>
            Ejemplo
          </button>
        </div>
      </section>

      <form class="panel capture-panel" data-testid="qa-sop-loom-form" (submit)="$event.preventDefault(); aprenderFlujo()">
        <div class="panel-title">
          <div>
            <span class="kicker">Entrada</span>
            <h2>Texto de Loom</h2>
          </div>
          <span class="state-chip" [ngClass]="resultado?.estado || 'borrador'">{{ estadoTexto(resultado?.estado || 'borrador') }}</span>
        </div>

        <label class="loom-text">
          <span>Descripción o transcripción</span>
          <textarea
            [(ngModel)]="form.descripcionVideo"
            name="descripcionVideo"
            rows="10"
            data-testid="qa-sop-loom-text-input"
            placeholder="Pegá acá todo el texto que entrega Loom. Ejemplo: ingreso a QA, abro Pantalla 3, completo el campo legajo, selecciono dataset y guardo el caso."></textarea>
        </label>

        <div *ngIf="mensaje" class="message" data-testid="qa-sop-loom-message" [class.error]="mensajeError">{{ mensaje }}</div>

        <div class="actions">
          <button
            mat-stroked-button
            type="button"
            data-testid="qa-sop-loom-inspect-button"
            [disabled]="!resultado?.ruta || inspeccionando"
            (click)="inspeccionarPantalla()">
            <mat-icon>travel_explore</mat-icon>
            {{ inspeccionando ? 'Inspeccionando...' : 'Inspeccionar pantalla' }}
          </button>
          <button mat-stroked-button type="button" data-testid="qa-sop-loom-save-button" [disabled]="!resultado?.inspeccionNavegacion || guardando" (click)="guardarAprendizaje()">
            <mat-icon>save</mat-icon>
            {{ guardando ? 'Guardando...' : 'Guardar flujo' }}
          </button>
          <button mat-flat-button color="primary" type="submit" data-testid="qa-sop-loom-learn-button">
            <mat-icon>school</mat-icon>
            Analizar texto
          </button>
        </div>
      </form>

      <ng-container *ngIf="resultado as aprendido; else sinResultado">
        <section class="panel result-head-panel" data-testid="qa-sop-loom-result">
          <div class="result-head">
            <div>
              <span class="kicker">Flujo detectado</span>
              <h2>{{ aprendido.nombre }}</h2>
              <p>{{ aprendido.ruta || 'Ruta pendiente' }}</p>
            </div>
            <span class="state-chip" [ngClass]="aprendido.estado">{{ estadoTexto(aprendido.estado) }}</span>
          </div>
        </section>

        <div class="result-accordion" *ngIf="aprendido.pendientes.length > 0">
          <mat-expansion-panel expanded data-testid="qa-sop-loom-pendientes">
            <mat-expansion-panel-header>
              <mat-panel-title>Pendientes</mat-panel-title>
              <mat-panel-description>{{ aprendido.pendientes.length }}</mat-panel-description>
            </mat-expansion-panel-header>
            <ul>
              <li *ngFor="let pendiente of aprendido.pendientes; trackBy: trackByTexto">{{ pendiente }}</li>
            </ul>
          </mat-expansion-panel>
        </div>

        <div class="result-accordion">
          <mat-expansion-panel data-testid="qa-sop-loom-pasos">
            <mat-expansion-panel-header>
              <mat-panel-title>Pasos aprendidos</mat-panel-title>
              <mat-panel-description>{{ aprendido.pasos.length }}</mat-panel-description>
            </mat-expansion-panel-header>
            <div class="steps">
              <article *ngFor="let paso of aprendido.pasos; trackBy: trackByPaso" class="step-card" [attr.data-testid]="'qa-sop-loom-step-' + paso.orden">
                <b>{{ paso.orden }}</b>
                <div>
                  <strong>{{ paso.accion }}</strong>
                  <span>{{ paso.ruta }} · {{ aprendido.inspeccionNavegacion ? 'resuelto por navegación' : paso.selectorSugerido }}</span>
                </div>
              </article>
            </div>
          </mat-expansion-panel>
        </div>

        <div class="result-accordion" *ngIf="aprendido.campos.length > 0">
          <mat-expansion-panel data-testid="qa-sop-loom-campos">
            <mat-expansion-panel-header>
              <mat-panel-title>Campos detectados</mat-panel-title>
              <mat-panel-description>{{ aprendido.campos.length }}</mat-panel-description>
            </mat-expansion-panel-header>
            <div class="field-grid">
              <article *ngFor="let campo of aprendido.campos; trackBy: trackByCampo" class="field-card">
                <div class="field-card-head">
                  <strong>{{ campo.etiqueta }}</strong>
                  <span class="tipo-pill" [class.obligatorio]="campo.obligatorio">
                    {{ campo.obligatorio ? 'Obligatorio' : 'Opcional' }}
                  </span>
                </div>
                <code class="testid-chip" *ngIf="campo.testid">{{ campo.testid }}</code>
                <span class="field-card-tipo">{{ campo.tipo }}</span>
              </article>
            </div>
          </mat-expansion-panel>
        </div>

        <div class="result-accordion" *ngIf="planEjecutable.length > 0">
          <mat-expansion-panel expanded data-testid="qa-sop-loom-plan">
                <mat-expansion-panel-header>
                  <mat-panel-title>Plan ejecutable · {{ pantallaObjetivo }}</mat-panel-title>
                  <mat-panel-description>{{ planEjecutable.length }} paso(s)</mat-panel-description>
                </mat-expansion-panel-header>
                <p class="block-hint">
                  Esta secuencia se repite una vez por cada caso cargado en la pantalla.
                  Los pasos de completar campos (<mat-icon class="inline-icon">drag_indicator</mat-icon>) se pueden
                  arrastrar para cambiar el orden en que el agente los carga.
                </p>
                <div class="order-hint" *ngIf="ordenSinGuardar" data-testid="qa-sop-loom-orden-sin-guardar">
                  <span>
                    <mat-icon>info</mat-icon>
                    Cambiaste el orden: guardá para que el agente lo use.
                  </span>
                  <button mat-flat-button color="primary" type="button" data-testid="qa-sop-loom-save-button-plan" [disabled]="guardando" (click)="guardarAprendizaje()">
                    <mat-icon>save</mat-icon>
                    {{ guardando ? 'Guardando...' : 'Guardar flujo' }}
                  </button>
                </div>
                <div class="plan-path" cdkDropList (cdkDropListDropped)="onDropPlan($event)">
                  <article
                    *ngFor="let paso of planEjecutable; trackBy: trackByPlan; let last = last"
                    class="plan-node"
                    [class.writes]="paso.escribe"
                    [class.draggable]="paso.tipo === 'completar'"
                    cdkDrag
                    [cdkDragDisabled]="paso.tipo !== 'completar'"
                    [attr.data-testid]="'qa-sop-loom-plan-' + paso.orden">
                    <div class="plan-node-marker">
                      <span class="plan-node-square">{{ paso.orden }}</span>
                      <span class="plan-node-line" *ngIf="!last"></span>
                    </div>
                    <div class="plan-node-body">
                      <div class="plan-node-head">
                        <strong>{{ paso.nombre }}<em *ngIf="paso.escribe"> · escribe</em></strong>
                        <mat-icon *ngIf="paso.tipo === 'completar'" class="drag-handle" cdkDragHandle title="Arrastrar para reordenar">drag_indicator</mat-icon>
                      </div>
                      <span>
                        {{ paso.selector || paso.tipo }}
                        <ng-container *ngIf="paso.campo"> ← caso.{{ paso.campo }}</ng-container>
                      </span>
                    </div>
                  </article>
                </div>
              </mat-expansion-panel>
            </div>

        <div class="result-accordion">
          <mat-expansion-panel data-testid="qa-sop-loom-casos">
            <mat-expansion-panel-header>
              <mat-panel-title>Casos que va a ejecutar</mat-panel-title>
              <mat-panel-description>{{ casosAEjecutar.length }}</mat-panel-description>
            </mat-expansion-panel-header>
            <p class="block-hint">
              Salen de los casos cargados en Pantalla 3, a mano o por importación de Excel.
              El sistema no inventa datos de prueba.
            </p>
            <div *ngIf="casosAEjecutar.length === 0" class="empty-row">
              <mat-icon>inventory_2</mat-icon>
              <span>Sin casos. Cargá al menos uno en Pantalla 3 y volvé a guardar el flujo.</span>
            </div>
            <div class="field-grid" *ngIf="casosAEjecutar.length > 0">
              <article
                *ngFor="let caso of casosAEjecutar; trackBy: trackByCaso"
                class="field-card"
                [attr.data-testid]="'qa-sop-loom-caso-' + caso.id">
                <strong>{{ caso.id }}</strong>
                <span>{{ caso.resumen }}</span>
              </article>
            </div>
          </mat-expansion-panel>
        </div>

        <div class="result-accordion" *ngIf="guardas.length > 0">
          <mat-expansion-panel expanded data-testid="qa-sop-loom-guardas">
            <mat-expansion-panel-header>
              <mat-panel-title>Guardas del SOP</mat-panel-title>
              <mat-panel-description>{{ guardas.length }}</mat-panel-description>
            </mat-expansion-panel-header>
            <p class="block-hint">
              El agente no decide si una precaución escrita en lenguaje humano es una regla
              evaluable o un juicio del operador. Resolvé cada una para poder firmar.
            </p>
            <div class="guard-list">
              <article
                *ngFor="let guarda of guardas; trackBy: trackByGuarda"
                class="guard-card"
                [class.pending]="guarda.control === 'sin_definir'"
                [class.human]="guarda.control === 'humano'"
                [attr.data-testid]="'qa-sop-loom-guarda-' + guarda.id">
                <strong>{{ guarda.texto }}</strong>
                <div class="guard-actions">
                  <button
                    mat-stroked-button
                    type="button"
                    [class.chosen]="guarda.testeable === true"
                    [attr.data-testid]="'qa-sop-loom-guarda-testeable-' + guarda.id"
                    (click)="decidirGuarda(guarda, true)">
                    El test la verifica
                  </button>
                  <button
                    mat-stroked-button
                    type="button"
                    [class.chosen]="guarda.testeable === false"
                    [attr.data-testid]="'qa-sop-loom-guarda-humana-' + guarda.id"
                    (click)="decidirGuarda(guarda, false)">
                    Control humano
                  </button>
                </div>
              </article>
            </div>
            <p class="block-hint" *ngIf="requiereControlHumano" data-testid="qa-sop-loom-control-humano">
              Este flujo queda marcado como <strong>no apto para automatización desatendida</strong>:
              hay al menos una guarda que depende del criterio de una persona.
            </p>
          </mat-expansion-panel>
        </div>

        <div class="run-actions" *ngIf="aprendido.id">
          <button
                mat-stroked-button
                type="button"
                data-testid="qa-sop-loom-sign-tecnica-button"
                [disabled]="firmando || aprendido.pendientes.length > 0 || planEjecutable.length === 0"
                (click)="firmarAprendizaje('tecnica')">
                <mat-icon>engineering</mat-icon>
                {{ firmas.tecnica ? 'Firma técnica ✓' : 'Firmar técnica' }}
              </button>
              <button
                mat-stroked-button
                type="button"
                data-testid="qa-sop-loom-sign-negocio-button"
                [disabled]="firmando || aprendido.pendientes.length > 0 || casosAEjecutar.length === 0"
                (click)="firmarAprendizaje('negocio')">
                <mat-icon>fact_check</mat-icon>
                {{ firmas.negocio ? 'Firma de negocio ✓' : 'Firmar negocio' }}
              </button>
              <button
                mat-flat-button
                color="primary"
                type="button"
                data-testid="qa-sop-loom-run-button"
                [disabled]="ejecutando || aprendido.estado !== 'aprobado'"
                (click)="ejecutarAprendizaje('demo')">
                <mat-icon>play_arrow</mat-icon>
                {{ ejecutando ? 'Ejecutando...' : 'Ejecutar agente' }}
              </button>
        </div>

        <section class="panel approval-summary" *ngIf="firmas.tecnica || firmas.negocio" data-testid="qa-sop-loom-approval-summary">
          <mat-icon>verified_user</mat-icon>
          <div>
            <strong>
              {{ aprendido.estado === 'aprobado' ? 'Aprobado con las dos firmas' : 'Falta una firma para aprobar' }}
            </strong>
            <span *ngIf="firmas.tecnica as tecnica">
              Técnica: {{ tecnica.por }} · {{ tecnica.en | date:'dd/MM/yy HH:mm' }}
            </span>
            <span *ngIf="firmas.negocio as negocio">
              Negocio: {{ negocio.por }} · {{ negocio.en | date:'dd/MM/yy HH:mm' }}
            </span>
          </div>
        </section>

        <section class="panel result-block" *ngIf="ultimaEjecucionTexto">
          <h3>Última ejecución</h3>
          <p class="block-hint" data-testid="qa-sop-loom-last-run">{{ ultimaEjecucionTexto }}</p>
        </section>
      </ng-container>

      <ng-template #sinResultado>
        <div class="empty-state">
          <mat-icon>smart_toy</mat-icon>
          <strong>Sin flujo aprendido</strong>
          <span>Pegá el texto de Loom y tocá Analizar texto.</span>
        </div>
      </ng-template>

      <section class="panel learned-panel" data-testid="qa-sop-loom-learned-panel">
        <div class="panel-title">
          <div>
            <span class="kicker">Registro del sistema</span>
            <h2>Flujos aprendidos</h2>
          </div>
          <span class="count-chip">{{ aprendizajes.length }}</span>
        </div>

        <div *ngIf="aprendizajes.length === 0" class="empty-row">
          <mat-icon>inventory_2</mat-icon>
          <span>Sin flujos guardados todavía.</span>
        </div>

        <div class="learned-grid" *ngIf="aprendizajes.length > 0">
          <article *ngFor="let item of aprendizajes; trackBy: trackByAprendizaje" class="learned-card" [attr.data-testid]="'qa-sop-loom-learned-' + item.id">
            <div>
              <strong>{{ item.nombre }}</strong>
              <span>{{ item.ruta || 'Ruta pendiente' }} · {{ item.pasos.length }} paso(s)</span>
            </div>
            <span class="state-chip" [ngClass]="item.estado">{{ estadoTexto(item.estado) }}</span>
            <button mat-stroked-button type="button" [attr.data-testid]="'qa-sop-loom-load-' + item.id" (click)="abrirAprendizaje(item)">
              Abrir
            </button>
            <button
              mat-icon-button
              type="button"
              class="delete-button"
              title="Eliminar flujo aprendido"
              [attr.data-testid]="'qa-sop-loom-delete-' + item.id"
              [disabled]="eliminandoId === item.id"
              (click)="eliminarAprendizaje(item)">
              <mat-icon>{{ eliminandoId === item.id ? 'hourglass_top' : 'delete' }}</mat-icon>
            </button>
          </article>
        </div>
      </section>
    </main>
  `,
  styles: [`
    :host { display: block; }

    .loom-page {
      min-height: calc(100vh - 52px);
      padding: 24px;
      display: grid;
      gap: 16px;
      color: #0f172a;
      background: #f4f7fb;
    }

    .page-head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
    }

    .eyebrow,
    .kicker {
      display: block;
      color: #64748b;
      font-size: 11px;
      line-height: 1;
      font-weight: 950;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    h1,
    h2,
    h3,
    p {
      margin: 0;
    }

    .page-head h1 {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 6px;
      font-size: 26px;
      line-height: 1.15;
      font-weight: 950;
    }

    .page-head h1 mat-icon {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 12px;
      color: #ffffff;
      background: #3157d5;
      box-shadow: 0 12px 28px rgba(49, 87, 213, .22);
    }

    .page-head p {
      margin-top: 7px;
      color: #64748b;
      font-size: 13px;
      line-height: 1.5;
    }

    .head-actions,
    .actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    .head-actions button,
    .actions button {
      height: 38px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 950;
    }

    .head-actions mat-icon,
    .actions mat-icon {
      margin-right: 5px;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .panel {
      border: 1px solid #dbe4f0;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 14px 38px rgba(15, 23, 42, .07);
    }

    .capture-panel,
    .result-head-panel,
    .result-block,
    .learned-panel {
      padding: 18px;
    }

    .panel-title,
    .result-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }

    .result-head-panel .result-head {
      margin-bottom: 0;
    }

    .panel-title h2,
    .result-head h2 {
      margin-top: 5px;
      font-size: 17px;
      line-height: 1.2;
      font-weight: 950;
    }

    .result-head p {
      margin-top: 5px;
      color: #3157d5;
      font-size: 12px;
      font-weight: 850;
      overflow-wrap: anywhere;
    }

    label {
      min-width: 0;
      display: grid;
      gap: 6px;
      color: #334155;
      font-size: 11px;
      font-weight: 950;
    }

    textarea {
      width: 100%;
      min-width: 0;
      min-height: 390px;
      padding: 14px;
      resize: vertical;
      border: 1px solid #cbd8ea;
      border-radius: 11px;
      background: #f8fbff;
      color: #0f172a;
      font: inherit;
      font-size: 13px;
      font-weight: 750;
      line-height: 1.55;
      outline: none;
      box-sizing: border-box;
      transition: border 150ms ease, box-shadow 150ms ease, background 150ms ease;
    }

    textarea:focus {
      border-color: #3157d5;
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(49, 87, 213, .12);
    }

    .message {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid #bbf7d0;
      border-radius: 10px;
      background: #f0fdf4;
      color: #166534;
      font-size: 12px;
      font-weight: 850;
    }

    .message.error {
      border-color: #fecaca;
      background: #fef2f2;
      color: #b91c1c;
    }

    .actions {
      margin-top: 14px;
    }

    .state-chip,
    .count-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 24px;
      padding: 0 10px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 950;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .state-chip.borrador { background: #fff7ed; color: #c2410c; }
    .state-chip.revisar { background: #fef3c7; color: #92400e; }
    .state-chip.listo { background: #dcfce7; color: #166534; }
    .state-chip.aprobado { background: #dbeafe; color: #1d4ed8; }
    .count-chip { background: #e0f2fe; color: #075985; }

    .result-block {
      display: grid;
      gap: 8px;
      margin-top: 14px;
    }

    .result-block h3 {
      font-size: 12px;
      font-weight: 950;
      color: #0f172a;
      text-transform: uppercase;
    }

    .result-accordion {
      display: block;
      margin-top: 14px;
    }

    .result-accordion .mat-expansion-panel {
      margin-bottom: 8px;
      border: 1px solid #dbe4f0;
      border-radius: 8px !important;
      box-shadow: none !important;
    }

    .result-accordion .mat-expansion-panel-header {
      height: auto;
      min-height: 46px;
      padding: 0 14px;
    }

    .result-accordion .mat-panel-title {
      font-size: 12px;
      font-weight: 950;
      color: #0f172a;
      text-transform: uppercase;
      flex-grow: 0;
    }

    .result-accordion .mat-panel-description {
      justify-content: flex-end;
      align-items: center;
      color: #64748b;
      font-size: 11px;
      font-weight: 900;
    }

    .result-accordion .mat-expansion-panel-body {
      display: grid;
      gap: 8px;
      padding: 0 14px 14px;
    }

    .inline-icon {
      vertical-align: middle;
      width: 14px;
      height: 14px;
      font-size: 14px;
    }

    .order-hint {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      background: #eff6ff;
      color: #1d4ed8;
      font-weight: 900;
    }

    .order-hint > span {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .order-hint mat-icon {
      width: 16px;
      height: 16px;
      font-size: 16px;
    }

    .order-hint button {
      flex: 0 0 auto;
      height: 32px;
      padding: 0 12px;
      font-size: 11px;
      font-weight: 950;
    }

    .order-hint button mat-icon {
      margin-right: 4px;
    }

    .drag-handle {
      flex: 0 0 auto;
      color: #94a3b8;
      cursor: grab;
      font-size: 17px;
      width: 17px;
      height: 17px;
      touch-action: none;
    }

    .cdk-drag-preview {
      box-sizing: border-box;
      border-radius: 11px;
      box-shadow: 0 12px 28px rgba(15, 23, 42, .22);
    }

    .cdk-drag-placeholder {
      opacity: 0.35;
    }

    .cdk-drop-list-dragging .plan-node:not(.cdk-drag-placeholder) {
      transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
    }

    .approval-summary {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 12px;
      padding: 11px 12px;
      border: 1px solid #bbf7d0;
      border-radius: 8px;
      background: #f0fdf4;
      color: #166534;
    }

    .approval-summary mat-icon {
      flex: 0 0 auto;
    }

    .approval-summary strong,
    .approval-summary span {
      display: block;
    }

    .approval-summary strong {
      font-size: 11px;
      font-weight: 950;
    }

    .approval-summary span {
      margin-top: 3px;
      font-size: 10px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }

    ul {
      margin: 0;
      padding-left: 18px;
      color: #475569;
      font-size: 12px;
      line-height: 1.45;
      font-weight: 750;
    }

    .steps {
      display: grid;
      gap: 8px;
      max-height: 340px;
      overflow: auto;
      padding-right: 2px;
    }

    .step-card {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      padding: 10px;
      border: 1px solid #dbe4f0;
      border-left: 4px solid #3157d5;
      border-radius: 11px;
      background: #ffffff;
    }

    .step-card b {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 8px;
      background: #e8efff;
      color: #3157d5;
      font-size: 12px;
      font-weight: 950;
    }

    .step-card strong,
    .field-card strong,
    .learned-card strong {
      display: block;
      color: #0f172a;
      font-size: 12px;
      line-height: 1.35;
      font-weight: 900;
    }

    .step-card span,
    .field-card span,
    .learned-card span {
      display: block;
      margin-top: 5px;
      color: #64748b;
      font-size: 11px;
      line-height: 1.35;
      font-weight: 750;
      overflow-wrap: anywhere;
    }

    .plan-path {
      display: grid;
      max-height: 420px;
      overflow-y: auto;
      overflow-x: hidden;
      padding-right: 2px;
    }

    .plan-node {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 12px;
      align-items: stretch;
    }

    .plan-node-marker {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .plan-node-square {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 32px;
      height: 32px;
      border-radius: 9px;
      background: #f1f5f9;
      color: #64748b;
      font-size: 12px;
      font-weight: 950;
      box-shadow: 0 0 0 3px #ffffff, 0 0 0 4px #e2e8f0;
    }

    .plan-node.draggable .plan-node-square {
      background: #e0f2fe;
      color: #0369a1;
      box-shadow: 0 0 0 3px #ffffff, 0 0 0 4px #bae6fd;
    }

    .plan-node.writes .plan-node-square {
      background: #fef3c7;
      color: #b45309;
      box-shadow: 0 0 0 3px #ffffff, 0 0 0 4px #fde68a;
    }

    .plan-node-line {
      width: 2px;
      flex: 1 1 auto;
      min-height: 12px;
      margin: 3px 0;
      background: #e2e8f0;
    }

    .plan-node-body {
      min-width: 0;
      margin-bottom: 12px;
      padding: 10px 12px;
      border: 1px solid #dbe4f0;
      border-radius: 10px;
      background: #ffffff;
    }

    .plan-node.writes .plan-node-body {
      border-color: #fde68a;
      background: #fffbeb;
    }

    .plan-node-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .plan-node-head strong {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #0f172a;
      font-size: 12px;
      font-weight: 900;
    }

    .plan-node-head em {
      font-style: normal;
      color: #b45309;
      font-weight: 950;
    }

    .plan-node-body > span {
      display: block;
      margin-top: 4px;
      color: #64748b;
      font-size: 11px;
      line-height: 1.35;
      font-weight: 750;
      overflow-wrap: anywhere;
    }

    .block-hint {
      margin: 0 0 8px;
      color: #64748b;
      font-size: 11px;
      line-height: 1.4;
      font-weight: 750;
      overflow-wrap: anywhere;
    }

    .guard-list {
      display: grid;
      gap: 8px;
    }

    .guard-card {
      display: grid;
      gap: 8px;
      padding: 11px 12px;
      border: 1px solid #dbe4f0;
      border-left: 4px solid #94a3b8;
      border-radius: 11px;
      background: #ffffff;
    }

    .guard-card.pending {
      border-left-color: #d97706;
      background: #fffbeb;
    }

    .guard-card.human {
      border-left-color: #b91c1c;
      background: #fef2f2;
    }

    .guard-card strong {
      color: #0f172a;
      font-size: 12px;
      line-height: 1.4;
      font-weight: 900;
    }

    .guard-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .guard-actions button {
      height: 30px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 900;
    }

    .guard-actions button.chosen {
      border-color: #2563eb;
      background: #e8efff;
      color: #1d4ed8;
    }

    .run-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: flex-end;
      padding-top: 4px;
    }

    .run-actions button {
      height: 40px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 950;
    }

    .run-actions mat-icon {
      margin-right: 6px;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .field-grid,
    .learned-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .field-card,
    .learned-card {
      border: 1px solid #dbe4f0;
      border-radius: 11px;
      background: #f8fbff;
      padding: 10px;
    }

    .field-card {
      display: grid;
      gap: 7px;
      transition: border-color 150ms ease, box-shadow 150ms ease;
    }

    .field-card:hover {
      border-color: #b7c9e8;
      box-shadow: 0 4px 14px rgba(15, 23, 42, .06);
    }

    .field-card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }

    .field-card .tipo-pill {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      height: 20px;
      padding: 0 8px;
      border-radius: 999px;
      background: #f1f5f9;
      color: #64748b;
      font-size: 9.5px;
      font-weight: 950;
      letter-spacing: .02em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .field-card .tipo-pill.obligatorio {
      background: #fef3c7;
      color: #92400e;
    }

    .field-card .testid-chip {
      display: inline-block;
      width: fit-content;
      max-width: 100%;
      padding: 4px 8px;
      border: 1px solid #e0e7ff;
      border-radius: 6px;
      background: #eef2ff;
      color: #4338ca;
      font-size: 10.5px;
      font-weight: 800;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .field-card .field-card-tipo {
      margin: 0;
      color: #64748b;
      font-size: 10.5px;
      font-weight: 800;
      text-transform: capitalize;
    }

    .empty-state,
    .empty-row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 80px;
      border: 1px dashed #cbd8ea;
      border-radius: 12px;
      padding: 14px;
      color: #64748b;
      font-size: 13px;
      font-weight: 850;
      background: #f8fbff;
    }

    .empty-state {
      flex-direction: column;
      align-items: flex-start;
    }

    .empty-state mat-icon,
    .empty-row mat-icon {
      color: #3157d5;
    }

    .empty-state span {
      font-size: 12px;
      line-height: 1.45;
    }

    .learned-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto auto;
      gap: 10px;
      align-items: center;
    }

    .learned-card button {
      height: 32px;
      border-radius: 9px;
      font-size: 11px;
      font-weight: 950;
    }

    .learned-card .delete-button {
      width: 32px;
      color: #b91c1c;
    }

    .learned-card .delete-button mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    @media (max-width: 760px) {
      .loom-page {
        padding: 16px 12px 24px;
      }

      .page-head {
        align-items: stretch;
        flex-direction: column;
      }

      .head-actions,
      .actions {
        justify-content: stretch;
      }

      .head-actions button,
      .actions button {
        flex: 1 1 150px;
      }

      .field-grid,
      .learned-grid {
        grid-template-columns: 1fr;
      }

      .learned-card {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class QaSopLoomComponent implements OnInit {
  private readonly storageKey = 'auditoria-ganancias.qa.sop-loom';

  form: FormularioLoom = this.formularioInicial();
  resultado: PantallaAprendida | null = null;
  aprendizajes: PantallaAprendida[] = [];
  mensaje = '';
  mensajeError = false;
  guardando = false;
  inspeccionando = false;
  firmando = false;
  ejecutando = false;
  eliminandoId = '';
  /** Se arrastró un paso del Plan ejecutable y todavía no se guardó el flujo. */
  ordenSinGuardar = false;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.cargarAprendizajes();
  }

  /** Pasos resueltos por el backend contra la navegación real del sandbox. */
  get planEjecutable(): PasoEjecutable[] {
    const definicion = this.objeto(this.resultado?.definicionEjecutable);
    return this.arrayObjetos(definicion['pasos_ejecutables']).map((paso, index) => ({
      orden: this.numero(paso['orden'], index + 1),
      tipo: this.texto(paso['tipo']),
      nombre: this.texto(paso['nombre']),
      selector: this.texto(paso['selector']),
      campo: this.texto(paso['campo']),
      valor: this.texto(paso['valor']),
      escribe: Boolean(paso['escribe']),
    }));
  }

  /**
   * Arrastrar una tarjeta de "Completar campo" cambia el orden en que el
   * agente carga ese campo. Solo esos pasos son arrastrables (ver
   * `cdkDragDisabled` en el template); navegar/click/verificar no se mueven.
   */
  onDropPlan(evento: CdkDragDrop<unknown>): void {
    if (!this.resultado || evento.previousIndex === evento.currentIndex) return;

    const definicion = this.objeto(this.resultado.definicionEjecutable);
    const pasos = this.arrayObjetos(definicion['pasos_ejecutables']);
    moveItemInArray(pasos, evento.previousIndex, evento.currentIndex);
    pasos.forEach((paso, index) => { paso['orden'] = index + 1; });

    this.resultado = {
      ...this.resultado,
      definicionEjecutable: { ...definicion, pasos_ejecutables: pasos },
    };
    this.ordenSinGuardar = true;
  }

  get casosAEjecutar(): CasoAEjecutar[] {
    const definicion = this.objeto(this.resultado?.definicionEjecutable);
    return this.arrayObjetos(definicion['casos']).map((caso) => {
      const datos = this.objeto(caso['datos']);
      const resumen = Object.keys(datos)
        .map((clave) => `${clave}: ${this.texto(datos[clave])}`)
        .join(' · ');
      return {
        id: this.texto(caso['id']),
        descripcion: this.texto(caso['descripcion']),
        idEsperado: this.texto(caso['id_esperado']),
        resumen: resumen || 'Sin datos legibles',
      };
    });
  }

  get pantallaObjetivo(): string {
    const definicion = this.objeto(this.resultado?.definicionEjecutable);
    return this.texto(this.objeto(definicion['rutas'])['pantalla_objetivo']) || 'sin resolver';
  }

  get firmas(): { negocio: FirmaAprendizaje | null; tecnica: FirmaAprendizaje | null } {
    const firmas = this.objeto(this.resultado?.firmas);
    const leer = (tipo: string): FirmaAprendizaje | null => {
      const firma = this.objeto(firmas[tipo]);
      const por = this.texto(firma['por']);
      if (!por) return null;
      return { por, en: this.texto(firma['en']), rol: this.texto(firma['rol']) };
    };
    return { negocio: leer('negocio'), tecnica: leer('tecnica') };
  }

  get guardas(): GuardaSop[] {
    return this.resultado?.consideraciones ?? [];
  }

  get requiereControlHumano(): boolean {
    return this.guardas.some((guarda) => guarda.control === 'humano');
  }

  get ultimaEjecucionTexto(): string {
    const ejecucion = this.objeto(this.resultado?.ultimaEjecucion);
    const estado = this.texto(ejecucion['estado']);
    if (!estado) return '';
    const detalle = this.texto(ejecucion['detalle']);
    return detalle ? `${estado.toUpperCase()} · ${detalle}` : estado.toUpperCase();
  }

  cargarEjemplo(): void {
    this.form = {
      descripcionVideo: [
        'Video Loom: QA - Pantalla 3.',
        'Ruta de trabajo: /qa/pantalla-3.',
        'El objetivo es dar de alta un cliente básico desde la pantalla de QA.',
        'Primero ingreso al menú QA y abro Pantalla 3.',
        'Completo el cliente con la razón social.',
        'Completo el área / sector al que pertenece.',
        'Completo el teléfono de contacto.',
        'Completo el número de documento.',
        'Completo el CUIL del titular.',
        'Completo la fecha de ingreso.',
        'Por último guardo el caso y confirmo que aparezca en el listado.',
        'El criterio de aceptación es que el alta quede registrada y visible en la tabla de casos de Pantalla 3.',
      ].join('\n'),
    };
    this.aprenderFlujo();
  }

  /**
   * Cada mitad la firma quien corresponde: técnica (QA/desarrollo) sobre
   * selectores y pasos, negocio (consultoría) sobre criterio y casos.
   */
  firmarAprendizaje(tipo: 'negocio' | 'tecnica'): void {
    if (!this.resultado) return;

    this.firmando = true;
    this.api.post<Record<string, unknown>>(
      `/qa/sop-loom/aprendizajes/${encodeURIComponent(this.resultado.id)}/firmar/${tipo}`,
      {},
    ).subscribe({
      next: (response) => {
        const aprendizaje = this.normalizarAprendizaje(response);
        this.resultado = aprendizaje;
        this.actualizarAprendizaje(aprendizaje);
        this.persistirAprendizajes();
        this.mensajeError = false;
        this.mensaje = aprendizaje.estado === 'aprobado'
          ? 'Las dos firmas están puestas: ya se puede ejecutar el agente.'
          : `Firma ${tipo} registrada. Falta la otra mitad para aprobar.`;
      },
      error: (error) => {
        this.firmando = false;
        this.mensajeError = true;
        this.mensaje = this.describirError(error, `No pude registrar la firma ${tipo}.`);
      },
      complete: () => {
        this.firmando = false;
      },
    });
  }

  /**
   * Resolver una guarda es una decisión humana: se guarda con el aprendizaje
   * para que quede asentado quién definió que el test la cubre o que no.
   */
  decidirGuarda(guarda: GuardaSop, testeable: boolean): void {
    if (!this.resultado) return;

    this.resultado = {
      ...this.resultado,
      consideraciones: this.resultado.consideraciones.map((item) => item.id === guarda.id
        ? { ...item, testeable, control: testeable ? 'automatico' as const : 'humano' as const }
        : item),
    };
    this.guardarAprendizaje();
  }

  ejecutarAprendizaje(modo: 'demo' | 'rapido'): void {
    if (!this.resultado) return;

    this.ejecutando = true;
    this.api.post<Record<string, unknown>>(
      `/qa/sop-loom/aprendizajes/${encodeURIComponent(this.resultado.id)}/ejecutar`,
      { modo },
    ).subscribe({
      next: (response) => {
        const aprendizaje = this.normalizarAprendizaje(response);
        this.resultado = aprendizaje;
        this.actualizarAprendizaje(aprendizaje);
        this.mensajeError = false;
        this.mensaje = `El agente arrancó sobre ${this.pantallaObjetivo}. Tocá Actualizar para ver el resultado.`;
      },
      error: (error) => {
        this.ejecutando = false;
        this.mensajeError = true;
        this.mensaje = this.describirError(error, 'No pude ejecutar el agente.');
      },
      complete: () => {
        this.ejecutando = false;
      },
    });
  }

  nuevoLimpio(): void {
    this.form = this.formularioInicial();
    this.resultado = null;
    this.mensaje = '';
    this.mensajeError = false;
    this.ordenSinGuardar = false;
  }

  actualizarAprendizajes(): void {
    this.cargarAprendizajes();
  }

  aprenderFlujo(): void {
    const pasos = this.detectarPasos();
    const campos = this.detectarCampos();
    const acciones = this.detectarAcciones();
    const descripcion = this.form.descripcionVideo.trim();
    const pendientes = this.detectarPendientes(pasos, campos);

    this.resultado = {
      id: this.crearId(this.detectarNombre()),
      nombre: this.detectarNombre(),
      modulo: this.detectarModulo(),
      ruta: this.detectarRutaDesdeTexto(),
      rol: 'qa',
      entorno: this.detectarEntorno(),
      estado: pendientes.length > 0 ? 'revisar' : 'listo',
      creadoEn: new Date().toISOString(),
      loomRef: this.detectarLinkLoom(),
      objetivo: this.detectarObjetivo(),
      criterioAceptacion: this.detectarCriterioAceptacion(),
      descripcionVideo: descripcion,
      pasos,
      campos,
      acciones,
      // Las guardas las detecta el backend al compilar contra el catálogo.
      consideraciones: [],
      pendientes,
      aprobacion: null,
      firmas: null,
      ultimaEjecucion: null,
      definicionEjecutable: null,
      inspeccionNavegacion: null,
    };

    this.mensajeError = pendientes.length > 0;
    this.mensaje = pendientes.length > 0
      ? `Flujo detectado con ${pendientes.length} pendiente(s) para revisar.`
      : 'Flujo aprendido sin pendientes obligatorios.';
  }

  inspeccionarPantalla(): void {
    if (!this.resultado?.ruta) return;

    this.inspeccionando = true;
    this.mensajeError = false;
    this.mensaje = `Inspeccionando ${this.resultado.ruta} con Playwright...`;
    this.api.post<Record<string, unknown>>('/qa/sop-loom/inspeccionar', {
      ruta: this.resultado.ruta,
    }).subscribe({
      next: (response) => {
        const inspeccion = this.normalizarInspeccion(response);
        if (!this.resultado) return;
        this.resultado = {
          ...this.resultado,
          estado: 'listo',
          inspeccionNavegacion: inspeccion,
          aprobacion: null,
          definicionEjecutable: null,
        };
        this.mensaje = `Pantalla inspeccionada: ${inspeccion.elementos.length} elemento(s) registrados con fuente navegación.`;
      },
      error: (error) => {
        this.inspeccionando = false;
        this.mensajeError = true;
        this.mensaje = this.describirError(error, 'No pude inspeccionar la pantalla del sandbox.');
      },
      complete: () => {
        this.inspeccionando = false;
      },
    });
  }

  guardarAprendizaje(): void {
    if (!this.resultado) return;

    this.guardando = true;
    this.api.post<Record<string, unknown>>('/qa/sop-loom/aprendizajes', this.payloadAprendizaje(this.resultado)).subscribe({
      next: (response) => {
        const aprendizaje = this.normalizarAprendizaje(response);
        this.resultado = aprendizaje;
        this.actualizarAprendizaje(aprendizaje);
        this.persistirAprendizajes();
        this.mensajeError = false;
        this.mensaje = 'Flujo guardado en MongoDB.';
        this.ordenSinGuardar = false;
      },
      error: (error) => {
        this.mensajeError = true;
        this.mensaje = this.describirError(error, 'No pude guardar el flujo en MongoDB.');
        this.guardando = false;
      },
      complete: () => {
        this.guardando = false;
      },
    });
  }

  eliminarAprendizaje(item: PantallaAprendida): void {
    const aviso = item.estado === 'aprobado'
      ? `El flujo "${item.nombre}" está aprobado. ¿Eliminarlo igual?`
      : `¿Eliminar el flujo "${item.nombre}"?`;
    if (!confirm(aviso)) return;

    this.eliminandoId = item.id;
    this.api.delete<{ id: string }>(`/qa/sop-loom/aprendizajes/${encodeURIComponent(item.id)}`).subscribe({
      next: () => {
        this.aprendizajes = this.aprendizajes.filter((actual) => actual.id !== item.id);
        if (this.resultado?.id === item.id) this.resultado = null;
        this.persistirAprendizajes();
        this.mensajeError = false;
        this.mensaje = `Flujo "${item.nombre}" eliminado.`;
      },
      error: (error) => {
        this.eliminandoId = '';
        this.mensajeError = true;
        this.mensaje = this.describirError(error, 'No pude eliminar el flujo.');
      },
      complete: () => {
        this.eliminandoId = '';
      },
    });
  }

  abrirAprendizaje(item: PantallaAprendida): void {
    this.resultado = item;
    this.form = {
      descripcionVideo: item.descripcionVideo || item.pasos.map((paso) => `${paso.orden}. ${paso.accion}`).join('\n'),
    };
    this.mensajeError = false;
    this.mensaje = `Flujo ${item.nombre} cargado.`;
    this.ordenSinGuardar = false;
  }

  estadoTexto(estado: EstadoAprendizaje): string {
    if (estado === 'aprobado') return 'Aprobado';
    if (estado === 'listo') return 'Listo';
    if (estado === 'revisar') return 'A revisar';
    return 'Borrador';
  }

  trackByPaso(_index: number, paso: PasoAprendido): number {
    return paso.orden;
  }

  trackByCampo(_index: number, campo: CampoAprendido): string {
    return campo.nombre;
  }

  trackByPlan(_index: number, paso: PasoEjecutable): number {
    return paso.orden;
  }

  trackByCaso(_index: number, caso: CasoAEjecutar): string {
    return caso.id;
  }

  trackByGuarda(_index: number, guarda: GuardaSop): string {
    return guarda.id;
  }

  trackByTexto(_index: number, texto: string): string {
    return texto;
  }

  trackByAprendizaje(_index: number, item: PantallaAprendida): string {
    return item.id;
  }

  private formularioInicial(): FormularioLoom {
    return {
      descripcionVideo: '',
    };
  }

  private detectarPasos(): PasoAprendido[] {
    const lineas = this.form.descripcionVideo
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter((linea) => linea.length > 0);

    const candidatas = lineas.filter((linea) => this.esPaso(linea));
    const base = candidatas.length > 0 ? candidatas : lineas.slice(0, 10);

    return base.slice(0, 16).map((linea, index) => {
      const accion = this.limpiarPaso(linea);
      return {
        orden: index + 1,
        accion,
        ruta: this.detectarRuta(accion),
        selectorSugerido: this.selectorDesdeAccion(accion),
      };
    });
  }

  private detectarCampos(): CampoAprendido[] {
    const texto = this.normalizar(this.form.descripcionVideo);
    const catalogo: CampoAprendido[] = [];
    // Vista previa desde el texto solo: todavía no hay testid, eso lo aporta
    // la inspección Playwright del sandbox más adelante.
    const agregar = (campo: Omit<CampoAprendido, 'etiqueta' | 'testid'>): void => {
      if (!catalogo.some((item) => item.nombre === campo.nombre)) {
        catalogo.push({ ...campo, etiqueta: this.etiquetaDesdeNombre(campo.nombre), testid: '' });
      }
    };

    // Vista previa semántica del texto. Los testids se obtienen después desde
    // la inspección Playwright del sandbox.
    [
      { patron: 'cliente', nombre: 'cliente', tipo: 'texto' as const },
      { patron: 'area', nombre: 'area_sector', tipo: 'texto' as const },
      { patron: 'sector', nombre: 'area_sector', tipo: 'texto' as const },
      { patron: 'telefono', nombre: 'telefono', tipo: 'texto' as const },
      { patron: 'documento', nombre: 'numero_documento', tipo: 'texto' as const },
      { patron: 'cuil', nombre: 'cuil', tipo: 'texto' as const },
      { patron: 'fecha de ingreso', nombre: 'fecha_ingreso', tipo: 'fecha' as const },
      { patron: 'fecha de fin', nombre: 'fecha_fin', tipo: 'fecha' as const },
      { patron: 'dataset', nombre: 'dataset', tipo: 'select' as const },
      { patron: 'periodo', nombre: 'periodo', tipo: 'texto' as const },
      { patron: 'excel', nombre: 'excel', tipo: 'archivo' as const },
      { patron: 'legajo', nombre: 'legajo', tipo: 'numero' as const },
      { patron: 'empleado', nombre: 'empleado', tipo: 'texto' as const },
      { patron: 'remuneracion', nombre: 'remuneracion_bruta', tipo: 'numero' as const },
      { patron: 'deduccion', nombre: 'deducciones', tipo: 'numero' as const },
      { patron: 'valor esperado', nombre: 'valor_esperado', tipo: 'numero' as const },
      { patron: 'tolerancia', nombre: 'tolerancia', tipo: 'numero' as const },
    ].forEach((item) => {
      if (texto.includes(item.patron)) {
        agregar({
          nombre: item.nombre,
          tipo: item.tipo,
          obligatorio: true,
          fuente: 'detectado',
        });
      }
    });

    if (catalogo.length === 0 && texto) {
      agregar({
        nombre: 'flujo_operativo',
        tipo: 'desconocido',
        obligatorio: true,
        fuente: 'inferido',
      });
    }

    return catalogo;
  }

  private detectarAcciones(): string[] {
    const texto = this.normalizar(this.form.descripcionVideo);
    const acciones: string[] = [];
    const agregar = (accion: string): void => {
      if (!acciones.includes(accion)) acciones.push(accion);
    };

    if (texto.includes('click') || texto.includes('tocar') || texto.includes('presiono')) agregar('click');
    if (texto.includes('guardar')) agregar('guardar');
    if (texto.includes('importar') || texto.includes('subir')) agregar('importar');
    if (texto.includes('cargar') || texto.includes('completo')) agregar('cargar');
    if (texto.includes('aprobar')) agregar('aprobar');
    if (texto.includes('ejecutar') || texto.includes('start')) agregar('ejecutar');
    if (texto.includes('validar') || texto.includes('verificar')) agregar('validar');

    return acciones;
  }

  private detectarPendientes(pasos: PasoAprendido[], campos: CampoAprendido[]): string[] {
    const pendientes: string[] = [];

    if (!this.form.descripcionVideo.trim()) pendientes.push('Pegá la descripción o transcripción del Loom.');
    if (!this.detectarRutaDesdeTexto()) pendientes.push('No se pudo detectar la ruta de la pantalla.');
    if (pasos.length === 0) pendientes.push('No se detectaron pasos operativos.');
    if (campos.length === 0) pendientes.push('No se detectaron campos o datos relevantes.');
    if (/produccion|productivo/i.test(this.form.descripcionVideo)) {
      pendientes.push('El texto menciona producción: validar que el aprendizaje corresponda a sandbox antes de usarlo.');
    }

    return pendientes;
  }

  private esPaso(linea: string): boolean {
    return /^(\d+[\).\-\s]|[-*]\s+)/.test(linea)
      || /(abr(o|e)|entro|ingreso|selecciono|completo|pego|cargo|cargar|hago click|click|guardo|genera|reviso|valido|ejecuto|presiono|aprende|importo)/i.test(linea);
  }

  private limpiarPaso(linea: string): string {
    return linea
      .replace(/^(\d+[\).\-\s]+|[-*]\s+)/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private detectarNombre(): string {
    const texto = this.form.descripcionVideo.trim();
    const directa = /(?:pantalla|m[oó]dulo)\s+(?:llamada|nombre|es|:)\s*["']?([^"'\n.]+)/i.exec(texto)?.[1]?.trim();
    if (directa) return directa.slice(0, 80);
    const codigo = /\bQA\s*-\s*Pantalla\s*\d+\b/i.exec(texto)?.[0];
    if (codigo) return codigo.replace(/\s+/g, ' ');
    if (/pantalla\s*3/i.test(texto)) return 'QA - Pantalla 3';
    if (/pantalla\s*2/i.test(texto)) return 'QA - Pantalla 2';
    if (/pantalla\s*1/i.test(texto)) return 'QA - Pantalla 1';
    return 'Flujo aprendido desde Loom';
  }

  private detectarModulo(): string {
    const texto = this.form.descripcionVideo.trim();
    const modulo = /m[oó]dulo\s+(?:llamado|es|:)?\s*["']?([A-Za-z0-9 _-]+)/i.exec(texto)?.[1]?.trim();
    if (modulo) return modulo.slice(0, 60);
    if (/\bQA\b/i.test(texto)) return 'QA';
    return 'QA';
  }

  private detectarRutaDesdeTexto(): string {
    const texto = this.form.descripcionVideo;
    const coincidencia = texto.match(/\/[a-z0-9_\-/]+/i);
    if (coincidencia?.[0]) return coincidencia[0];

    const normalizada = this.normalizar(texto);
    if (normalizada.includes('sop loom')) return '/qa/sop-loom';
    if (normalizada.includes('pantalla 3')) return '/qa/pantalla-3';
    if (normalizada.includes('pantalla 2')) return '/qa/pantalla-2';
    if (normalizada.includes('pantalla 1')) return '/qa/pantalla-1';
    if (normalizada.includes('asistente')) return '/qa/asistente';
    if (normalizada.includes('excel')) return '/cargar-excel';
    return '';
  }

  private detectarRuta(accion: string): string {
    const normalizada = this.normalizar(accion);
    if (normalizada.includes('sop loom')) return '/qa/sop-loom';
    if (normalizada.includes('pantalla 3')) return '/qa/pantalla-3';
    if (normalizada.includes('pantalla 2')) return '/qa/pantalla-2';
    if (normalizada.includes('pantalla 1')) return '/qa/pantalla-1';
    if (normalizada.includes('asistente')) return '/qa/asistente';
    if (normalizada.includes('excel')) return '/cargar-excel';
    return this.detectarRutaDesdeTexto() || 'pendiente';
  }

  private detectarEntorno(): string {
    const texto = this.normalizar(this.form.descripcionVideo);
    if (texto.includes('local')) return 'local';
    if (texto.includes('demo')) return 'demo';
    return 'sandbox';
  }

  private detectarObjetivo(): string {
    const texto = this.form.descripcionVideo.trim();
    const objetivo = /objetivo\s*(?:es|:)\s*([^\n]+)/i.exec(texto)?.[1]?.trim();
    if (objetivo) return objetivo.slice(0, 220);
    return `Aprender el flujo operativo de ${this.detectarNombre()} a partir del texto de Loom.`;
  }

  private detectarCriterioAceptacion(): string {
    const texto = this.form.descripcionVideo.trim();
    const criterio = /criterio(?:\s+de\s+aceptaci[oó]n)?\s*(?:es|:)\s*([^\n]+)/i.exec(texto)?.[1]?.trim();
    if (criterio) return criterio.slice(0, 260);
    return 'El flujo queda guardado con ruta, pasos principales, campos detectados, acciones y pendientes de revisión.';
  }

  private detectarLinkLoom(): string | null {
    return /https?:\/\/(?:www\.)?loom\.com\/\S+/i.exec(this.form.descripcionVideo)?.[0] ?? null;
  }

  private selectorDesdeAccion(accion: string): string {
    return accion ? 'pendiente de inspección' : 'sin acción';
  }

  private cargarAprendizajes(): void {
    this.api.get<Record<string, unknown>[]>('/qa/sop-loom/aprendizajes').subscribe({
      next: (response) => {
        this.aprendizajes = Array.isArray(response)
          ? response.map((item) => this.normalizarAprendizaje(item))
          : [];
        this.sincronizarResultadoSeleccionado();
        this.persistirAprendizajes();
      },
      error: () => {
        this.cargarAprendizajesLocales();
      },
    });
  }

  private cargarAprendizajesLocales(): void {
    try {
      const crudo = localStorage.getItem(this.storageKey);
      const parseado: unknown = crudo ? JSON.parse(crudo) : [];
      this.aprendizajes = Array.isArray(parseado)
        ? parseado.map((item) => this.normalizarAprendizaje(item))
        : [];
      this.sincronizarResultadoSeleccionado();
    } catch {
      this.aprendizajes = [];
    }
  }

  private persistirAprendizajes(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.aprendizajes));
    } catch {
      this.mensajeError = true;
      this.mensaje = 'No pude guardar una copia local del flujo.';
    }
  }

  private actualizarAprendizaje(aprendizaje: PantallaAprendida): void {
    const existente = this.aprendizajes.findIndex((item) => item.id === aprendizaje.id);
    if (existente >= 0) {
      this.aprendizajes = this.aprendizajes.map((item, index) => index === existente ? aprendizaje : item);
    } else {
      this.aprendizajes = [aprendizaje, ...this.aprendizajes];
    }
  }

  private sincronizarResultadoSeleccionado(): void {
    if (!this.resultado) return;
    const actualizado = this.aprendizajes.find((item) => item.id === this.resultado?.id);
    if (actualizado) this.resultado = actualizado;
  }

  private payloadAprendizaje(aprendizaje: PantallaAprendida): Record<string, unknown> {
    return {
      id: aprendizaje.id,
      nombre: aprendizaje.nombre,
      modulo: aprendizaje.modulo,
      ruta: aprendizaje.ruta,
      rol: aprendizaje.rol,
      entorno: aprendizaje.entorno,
      estado: aprendizaje.estado,
      creadoEn: aprendizaje.creadoEn,
      loomRef: aprendizaje.loomRef,
      objetivo: aprendizaje.objetivo,
      criterioAceptacion: aprendizaje.criterioAceptacion,
      descripcionVideo: aprendizaje.descripcionVideo,
      pasos: aprendizaje.pasos,
      campos: aprendizaje.campos,
      acciones: aprendizaje.acciones,
      // Se reenvían las decisiones humanas sobre las guardas para que el
      // backend las conserve al recompilar.
      consideraciones: aprendizaje.consideraciones,
      pendientes: aprendizaje.pendientes,
      inspeccionId: aprendizaje.inspeccionNavegacion?.id ?? '',
      // El orden visible del Plan ejecutable (tras un posible arrastre) se
      // reenvía para que el backend lo respete al recompilar los pasos.
      ordenManualPasos: this.ordenManualDesdeDefinicion(aprendizaje),
    };
  }

  /** Claves `completar:<campo>` en el orden actual del Plan ejecutable. */
  private ordenManualDesdeDefinicion(aprendizaje: PantallaAprendida): string[] {
    const definicion = this.objeto(aprendizaje.definicionEjecutable);
    return this.arrayObjetos(definicion['pasos_ejecutables'])
      .filter((paso) => this.texto(paso['tipo']) === 'completar' && this.texto(paso['campo']))
      .map((paso) => `completar:${this.texto(paso['campo'])}`);
  }

  private normalizarAprendizaje(valor: unknown): PantallaAprendida {
    const item = this.objeto(valor);
    const pasos = this.arrayObjetos(item['pasos']).map((paso, index) => ({
      orden: this.numero(paso['orden'], index + 1),
      accion: this.texto(paso['accion']),
      ruta: this.texto(paso['ruta']),
      selectorSugerido: this.texto(paso['selectorSugerido'] ?? paso['selector_sugerido']),
    }));
    const campos = this.arrayObjetos(item['campos']).map((campo) => ({
      nombre: this.texto(campo['nombre']),
      etiqueta: this.texto(campo['etiqueta']) || this.texto(campo['nombre']),
      testid: this.texto(campo['testid']),
      tipo: this.tipoCampo(campo['tipo']),
      obligatorio: Boolean(campo['obligatorio']),
      fuente: this.fuenteCampo(campo['fuente']),
    }));

    return {
      id: this.texto(item['id']) || this.crearId(this.texto(item['nombre']) || 'pantalla'),
      nombre: this.texto(item['nombre']) || 'Flujo aprendido desde Loom',
      modulo: this.texto(item['modulo']) || 'QA',
      ruta: this.texto(item['ruta']),
      rol: this.texto(item['rol']) || 'qa',
      entorno: this.texto(item['entorno']) || 'sandbox',
      estado: this.estadoAprendizaje(item['estado']),
      creadoEn: this.texto(item['creadoEn'] ?? item['creado_en']) || new Date().toISOString(),
      loomRef: this.texto(item['loomRef'] ?? item['loom_ref']) || null,
      objetivo: this.texto(item['objetivo']),
      criterioAceptacion: this.texto(item['criterioAceptacion'] ?? item['criterio_aceptacion']),
      descripcionVideo: this.texto(item['descripcionVideo'] ?? item['descripcion_video']),
      pasos,
      campos,
      acciones: this.arrayTexto(item['acciones']),
      consideraciones: this.arrayObjetos(item['consideraciones']).map((guarda) => ({
        id: this.texto(guarda['id']),
        texto: this.texto(guarda['texto']),
        testeable: guarda['testeable'] === null || guarda['testeable'] === undefined
          ? null
          : Boolean(guarda['testeable']),
        control: this.controlGuarda(guarda['control']),
      })),
      pendientes: this.arrayTexto(item['pendientes']),
      aprobacion: this.objetoOpcional(item['aprobacion']),
      firmas: this.objetoOpcional(item['firmas']),
      ultimaEjecucion: this.objetoOpcional(item['ultimaEjecucion'] ?? item['ultima_ejecucion']),
      definicionEjecutable: this.objetoOpcional(item['definicionEjecutable'] ?? item['definicion_ejecutable']),
      inspeccionNavegacion: this.normalizarInspeccionOpcional(
        item['inspeccionNavegacion'] ?? item['inspeccion_navegacion'],
      ),
    };
  }

  private describirError(error: unknown, fallback: string): string {
    const err = this.objeto(error);
    const body = err['error'];
    if (typeof body === 'string' && body.trim()) return body;

    const errorBody = this.objeto(body);
    const mensaje = errorBody['message'] ?? err['message'];
    const cabecera = Array.isArray(mensaje)
      ? mensaje.map((item) => this.texto(item)).filter(Boolean).join(' ')
      : this.texto(mensaje);

    // El backend acompaña el mensaje con la lista concreta de qué hay que
    // resolver (pendientes al aprobar, desvíos al ejecutar). Sin esto el
    // usuario ve el titular pero no la causa.
    const detalle = [
      ...this.arrayTexto(errorBody['desvios']),
      ...this.arrayTexto(errorBody['pendientes']),
      ...this.arrayTexto(errorBody['cambios']),
    ];
    if (cabecera && detalle.length > 0) return `${cabecera} ${detalle.join(' ')}`;
    if (detalle.length > 0) return detalle.join(' ');
    return cabecera || fallback;
  }

  private estadoAprendizaje(valor: unknown): EstadoAprendizaje {
    const estado = this.texto(valor) as EstadoAprendizaje;
    return ['borrador', 'revisar', 'listo', 'aprobado'].includes(estado) ? estado : 'borrador';
  }

  private tipoCampo(valor: unknown): CampoAprendido['tipo'] {
    const tipo = this.texto(valor) as CampoAprendido['tipo'];
    return ['texto', 'select', 'archivo', 'numero', 'fecha', 'desconocido'].includes(tipo) ? tipo : 'desconocido';
  }

  private controlGuarda(valor: unknown): GuardaSop['control'] {
    const control = this.texto(valor);
    return control === 'automatico' || control === 'humano' ? control : 'sin_definir';
  }

  private fuenteCampo(valor: unknown): CampoAprendido['fuente'] {
    const fuente = typeof valor === 'object'
      ? this.texto(this.objeto(valor)['tipo'])
      : this.texto(valor);
    if (fuente === 'navegacion' || fuente === 'catalogo') return 'navegacion';
    return fuente === 'detectado' ? 'detectado' : 'inferido';
  }

  private normalizarInspeccionOpcional(valor: unknown): InspeccionNavegacion | null {
    const item = this.objeto(valor);
    return this.texto(item['id']) ? this.normalizarInspeccion(item) : null;
  }

  private normalizarInspeccion(valor: unknown): InspeccionNavegacion {
    const item = this.objeto(valor);
    return {
      id: this.texto(item['id']),
      ruta: this.texto(item['ruta']),
      frontendUrl: this.texto(item['frontendUrl'] ?? item['frontend_url']),
      titulo: this.texto(item['titulo']),
      encabezado: this.texto(item['encabezado']),
      inspeccionadaEn: this.texto(item['inspeccionadaEn'] ?? item['inspeccionada_en']),
      solicitadaPor: this.texto(item['solicitadaPor'] ?? item['solicitada_por']),
      elementos: this.arrayObjetos(item['elementos']).map((elemento) => ({
        testid: this.texto(elemento['testid']),
        selector: this.texto(elemento['selector']),
        tag: this.texto(elemento['tag']),
        tipo: this.texto(elemento['tipo']),
        nombre: this.texto(elemento['nombre']),
        etiqueta: this.texto(elemento['etiqueta']),
        visible: Boolean(elemento['visible']),
        fuente: this.objeto(elemento['fuente']),
      })),
      capturaPath: this.texto(item['capturaPath'] ?? item['captura_path']),
      hash: this.texto(item['hash']),
    };
  }

  private objetoOpcional(valor: unknown): Record<string, unknown> | null {
    const objeto = this.objeto(valor);
    return Object.keys(objeto).length > 0 ? objeto : null;
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? valor as Record<string, unknown>
      : {};
  }

  private arrayObjetos(valor: unknown): Record<string, unknown>[] {
    return Array.isArray(valor)
      ? valor.map((item) => this.objeto(item)).filter((item) => Object.keys(item).length > 0)
      : [];
  }

  private arrayTexto(valor: unknown): string[] {
    return Array.isArray(valor)
      ? valor.map((item) => this.texto(item)).filter(Boolean)
      : [];
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }

  private numero(valor: unknown, fallback: number): number {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : fallback;
  }

  private crearId(valor: string): string {
    const slug = this.normalizar(valor)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'pantalla';
    return `${slug}-${Date.now()}`;
  }

  private normalizar(valor: string): string {
    return valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private etiquetaDesdeNombre(nombre: string): string {
    const texto = nombre.replace(/_/g, ' ').trim();
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }
}
