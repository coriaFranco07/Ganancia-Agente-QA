import { Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

type AlcanceRegla = 'global' | 'pantalla';
type PasoWizard = 'pantallas' | 'campos';
/** Mismos tipos que `TipoCampoCatalogo` en el backend: de esto depende qué restricciones tienen sentido. */
type TipoCampo = 'texto' | 'numero' | 'fecha' | 'archivo' | 'select';

interface CampoCatalogoDto {
  clave: string;
  etiqueta: string;
  tipo: TipoCampo;
}

interface PantallaCatalogoDto {
  ruta: string;
  nombre: string;
  campos: CampoCatalogoDto[];
}

interface ReglaValidacion {
  id: string;
  campo: string;
  alcance: AlcanceRegla;
  ruta: string;
  obligatorio: boolean | null;
  largo_exacto: number | null;
  largo_minimo: number | null;
  largo_maximo: number | null;
  patron: string;
  patron_mensaje: string;
  valor_minimo: number | null;
  valor_maximo: number | null;
  dias_atras_max: number | null;
  dias_adelante_max: number | null;
  nota: string;
}

/**
 * Fila editable del paso 2: un campo del catálogo con sus restricciones en
 * edición. Trae su `tipo` para que el template muestre solo los controles
 * que tienen sentido para ese tipo de dato (ver ng-template `camposForm`).
 */
interface CampoEdicion {
  clave: string;
  etiqueta: string;
  tipo: TipoCampo;
  obligatorio: '' | 'true' | 'false';
  largoExacto: number | null;
  largoMinimo: number | null;
  largoMaximo: number | null;
  valorMinimo: number | null;
  valorMaximo: number | null;
  diasAtrasMax: number | null;
  diasAdelanteMax: number | null;
}

/** Grupo de campos de una pantalla puntual, cuando se eligieron pantallas específicas (no "Todas"). */
interface GrupoPantallaEdicion {
  ruta: string;
  nombre: string;
  campos: CampoEdicion[];
}

@Component({
  selector: 'app-qa-reglas-validacion',
  template: `
    <main class="reglas-page" data-testid="qa-reglas-page">
      <section class="page-head">
        <div>
          <span class="eyebrow">QA / Datos</span>
          <h1>
            <mat-icon>rule</mat-icon>
            Validaciones
          </h1>
          <p>Reglas de obligatoriedad y formato por campo: para todas las pantallas o para algunas en particular.</p>
        </div>
        <button mat-stroked-button type="button" data-testid="qa-reglas-refresh-button" [disabled]="cargando" (click)="refrescar()">
          <mat-icon>sync</mat-icon>
          Actualizar
        </button>
      </section>

      <section class="panel form-panel" data-testid="qa-reglas-wizard">
        <div class="panel-head wizard-head">
          <div>
            <span class="kicker">Nueva regla</span>
            <h2>Agregar restricción</h2>
          </div>
          <div class="wizard-steps">
            <div class="wizard-step" [class.activo]="paso === 'pantallas'" [class.hecho]="paso === 'campos'">
              <span class="numero">
                <mat-icon *ngIf="paso === 'campos'">check</mat-icon>
                <ng-container *ngIf="paso !== 'campos'">1</ng-container>
              </span>
              <span class="texto">Pantallas</span>
            </div>
            <span class="wizard-conector"></span>
            <div class="wizard-step" [class.activo]="paso === 'campos'">
              <span class="numero">2</span>
              <span class="texto">Campos</span>
            </div>
          </div>
        </div>

        <div class="wizard-body" *ngIf="paso === 'pantallas'" data-testid="qa-reglas-paso-pantallas">
          <p class="block-hint">Elegí a qué pantallas va a aplicar esta regla: todas, o marcá solo algunas.</p>

          <label class="checkbox-row todas" data-testid="qa-reglas-todas">
            <input type="checkbox" [(ngModel)]="todasSeleccionadas" (ngModelChange)="onCambioTodas()">
            <span class="checkbox-visual"></span>
            <span class="checkbox-texto">
              <strong>Todas las pantallas</strong>
              <small>La regla se aplica en cualquier pantalla que tenga el campo.</small>
            </span>
          </label>

          <div class="pantallas-grid" [class.disabled]="todasSeleccionadas">
            <label
              class="checkbox-row"
              *ngFor="let pantalla of catalogo"
              [attr.data-testid]="'qa-reglas-pantalla-' + slug(pantalla.ruta)">
              <input
                type="checkbox"
                [checked]="todasSeleccionadas || pantallasSeleccionadas.has(pantalla.ruta)"
                [disabled]="todasSeleccionadas"
                (change)="togglePantalla(pantalla.ruta)">
              <span class="checkbox-visual"></span>
              <span class="checkbox-texto">
                <strong>{{ pantalla.nombre }}</strong>
                <small>{{ pantalla.campos.length }} campo(s)</small>
              </span>
            </label>
          </div>

          <div class="wizard-actions">
            <span></span>
            <button
              mat-flat-button
              color="primary"
              type="button"
              data-testid="qa-reglas-siguiente-button"
              [disabled]="!puedeAvanzar"
              (click)="siguiente()">
              Siguiente
              <mat-icon>arrow_forward</mat-icon>
            </button>
          </div>
        </div>

        <div class="wizard-body" *ngIf="paso === 'campos'" data-testid="qa-reglas-paso-campos">
          <p class="block-hint">
            Se aplica a <strong>{{ resumenDestino }}</strong>. Tocá un campo para configurar sus restricciones;
            los que no toques quedan como están.
          </p>

          <ng-container *ngIf="todasSeleccionadas; else porPantalla">
            <mat-accordion multi class="campos-accordion" *ngIf="camposEdicion.length > 0">
              <mat-expansion-panel
                *ngFor="let campo of camposEdicion; trackBy: trackByCampoEdicion"
                [attr.data-testid]="'qa-reglas-campo-' + campo.clave">
                <mat-expansion-panel-header>
                  <mat-panel-title>{{ campo.etiqueta }}</mat-panel-title>
                  <mat-panel-description>
                    <span class="badge" *ngIf="estaConfigurado(campo)">Configurado</span>
                  </mat-panel-description>
                </mat-expansion-panel-header>
                <ng-container *ngTemplateOutlet="camposForm; context: { campo: campo, prefijo: 'todas' }"></ng-container>
              </mat-expansion-panel>
            </mat-accordion>
          </ng-container>

          <ng-template #porPantalla>
            <div class="grupo-pantalla" *ngFor="let grupo of gruposEdicion; trackBy: trackByGrupo" [attr.data-testid]="'qa-reglas-grupo-' + slug(grupo.ruta)">
              <div class="grupo-titulo">
                <mat-icon>desktop_windows</mat-icon>
                <strong>{{ grupo.nombre }}</strong>
                <span class="grupo-contador">{{ grupo.campos.length }} campo(s)</span>
              </div>
              <mat-accordion multi class="campos-accordion">
                <mat-expansion-panel
                  *ngFor="let campo of grupo.campos; trackBy: trackByCampoEdicion"
                  [attr.data-testid]="'qa-reglas-campo-' + slug(grupo.ruta) + '-' + campo.clave">
                  <mat-expansion-panel-header>
                    <mat-panel-title>{{ campo.etiqueta }}</mat-panel-title>
                    <mat-panel-description>
                      <span class="badge" *ngIf="estaConfigurado(campo)">Configurado</span>
                    </mat-panel-description>
                  </mat-expansion-panel-header>
                  <ng-container *ngTemplateOutlet="camposForm; context: { campo: campo, prefijo: grupo.ruta }"></ng-container>
                </mat-expansion-panel>
              </mat-accordion>
            </div>
          </ng-template>

          <ng-template #camposForm let-campo="campo" let-prefijo="prefijo">
            <div class="campo-grid">
              <label class="field">
                <span>Obligatorio</span>
                <select [(ngModel)]="campo.obligatorio" [name]="'obligatorio-' + prefijo + '-' + campo.clave">
                  <option value="">Sin cambio</option>
                  <option value="true">Sí, obligatorio</option>
                  <option value="false">No, opcional</option>
                </select>
              </label>

              <ng-container [ngSwitch]="campo.tipo">
                <ng-container *ngSwitchCase="'texto'">
                  <label class="field">
                    <span>Largo exacto (dígitos)</span>
                    <input type="number" min="0" [(ngModel)]="campo.largoExacto" [name]="'exacto-' + prefijo + '-' + campo.clave" placeholder="Ej: 11">
                  </label>
                  <label class="field">
                    <span>Largo mínimo (dígitos)</span>
                    <input type="number" min="0" [(ngModel)]="campo.largoMinimo" [name]="'minimo-' + prefijo + '-' + campo.clave" placeholder="Ej: 6">
                  </label>
                  <label class="field">
                    <span>Largo máximo (dígitos)</span>
                    <input type="number" min="0" [(ngModel)]="campo.largoMaximo" [name]="'maximo-' + prefijo + '-' + campo.clave">
                  </label>
                </ng-container>

                <ng-container *ngSwitchCase="'numero'">
                  <label class="field">
                    <span>Valor mínimo</span>
                    <input type="number" [(ngModel)]="campo.valorMinimo" [name]="'valorMin-' + prefijo + '-' + campo.clave" placeholder="Ej: 0">
                  </label>
                  <label class="field">
                    <span>Valor máximo</span>
                    <input type="number" [(ngModel)]="campo.valorMaximo" [name]="'valorMax-' + prefijo + '-' + campo.clave">
                  </label>
                </ng-container>

                <ng-container *ngSwitchCase="'fecha'">
                  <label class="field">
                    <span>Días hacia atrás permitidos</span>
                    <input type="number" min="0" [(ngModel)]="campo.diasAtrasMax" [name]="'diasAtras-' + prefijo + '-' + campo.clave" placeholder="Vacío = sin límite">
                    <small class="field-hint">¿Se puede cargar una fecha anterior a hoy? 0 = no permite fechas pasadas.</small>
                  </label>
                  <label class="field">
                    <span>Días hacia adelante permitidos</span>
                    <input type="number" min="0" [(ngModel)]="campo.diasAdelanteMax" [name]="'diasAdelante-' + prefijo + '-' + campo.clave" placeholder="Vacío = sin límite">
                    <small class="field-hint">¿Se puede cargar una fecha posterior a hoy? 0 = no permite fechas futuras.</small>
                  </label>
                </ng-container>

                <ng-container *ngSwitchDefault>
                  <p class="campo-sin-formato">Este tipo de campo no tiene restricciones de formato: solo se puede marcar obligatorio.</p>
                </ng-container>
              </ng-container>
            </div>
          </ng-template>

          <div *ngIf="mensaje" class="mensaje" [class.error]="mensajeError" data-testid="qa-reglas-mensaje">{{ mensaje }}</div>

          <div class="wizard-actions">
            <button mat-stroked-button type="button" (click)="volver()">
              <mat-icon>arrow_back</mat-icon>
              Volver
            </button>
            <div class="wizard-actions-derecha">
              <span class="contador-configurados">{{ contadorConfigurados }} campo(s) configurado(s)</span>
              <button
                mat-flat-button
                color="primary"
                type="button"
                data-testid="qa-reglas-guardar-lote-button"
                [disabled]="guardandoLote"
                (click)="guardarLote()">
                <mat-icon>{{ guardandoLote ? 'hourglass_top' : 'save' }}</mat-icon>
                {{ guardandoLote ? 'Guardando...' : 'Guardar reglas' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <span class="kicker">Reglas activas</span>
            <h2>{{ reglas.length }} regla(s)</h2>
          </div>
        </div>

        <div *ngIf="cargando" class="loading-row">
          <mat-icon class="girando">autorenew</mat-icon>
          <span>Cargando reglas...</span>
        </div>

        <div *ngIf="!cargando && reglas.length === 0" class="empty-state">
          <mat-icon>inventory_2</mat-icon>
          <span>Todavía no hay reglas: los campos usan el default del catálogo.</span>
        </div>

        <div class="table-wrap" *ngIf="!cargando && reglas.length > 0">
          <table data-testid="qa-reglas-table">
            <thead>
              <tr>
                <th>Campo</th>
                <th>Alcance</th>
                <th>Obligatorio</th>
                <th>Formato</th>
                <th>Nota</th>
                <th class="col-acciones">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let regla of reglas; trackBy: trackByRegla" [attr.data-testid]="'qa-reglas-row-' + regla.id">
                <td><strong>{{ etiquetaCampo(regla) }}</strong></td>
                <td>{{ regla.alcance === 'global' ? 'Todas las pantallas' : nombrePantalla(regla.ruta) }}</td>
                <td>
                  <span class="pill" [ngClass]="claseObligatorio(regla.obligatorio)">{{ textoObligatorio(regla.obligatorio) }}</span>
                </td>
                <td>{{ resumenFormato(regla) || '-' }}</td>
                <td>{{ regla.nota || '-' }}</td>
                <td class="col-acciones">
                  <button
                    mat-icon-button
                    type="button"
                    class="delete-button"
                    title="Eliminar regla"
                    [attr.data-testid]="'qa-reglas-delete-' + regla.id"
                    [disabled]="eliminandoId === regla.id"
                    (click)="eliminar(regla)">
                    <mat-icon>{{ eliminandoId === regla.id ? 'hourglass_top' : 'delete' }}</mat-icon>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  `,
  styles: [`
    :host { display: block; }

    .reglas-page {
      min-height: calc(100vh - 52px);
      padding: 24px;
      display: grid;
      align-content: start;
      gap: 18px;
      color: #0f172a;
      background: #f4f7fb;
    }

    .page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .eyebrow { display: block; color: #64748b; font-size: 11px; font-weight: 950; letter-spacing: .04em; text-transform: uppercase; }
    h1 { margin: 6px 0 0; display: flex; align-items: center; gap: 10px; font-size: 26px; font-weight: 950; }
    .page-head p { margin: 8px 0 0; max-width: 640px; color: #64748b; font-size: 13px; font-weight: 750; line-height: 1.5; }
    .page-head > button { height: 40px; border-radius: 8px; font-size: 12px; font-weight: 950; }

    .panel { border: 1px solid #dbe4f0; border-radius: 8px; background: #ffffff; box-shadow: 0 18px 44px rgba(15, 23, 42, .08); overflow: hidden; }
    .panel-head { padding: 20px 22px; border-bottom: 1px solid #e2e8f0; background: #f8fbff; }
    .kicker { display: block; color: #64748b; font-size: 11px; font-weight: 950; letter-spacing: .03em; text-transform: uppercase; }
    .panel-head h2 { margin: 5px 0 0; font-size: 18px; font-weight: 950; }

    .wizard-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }

    .wizard-steps { display: flex; align-items: center; gap: 10px; }
    .wizard-step { display: flex; align-items: center; gap: 8px; opacity: .5; transition: opacity 150ms ease; }
    .wizard-step.activo, .wizard-step.hecho { opacity: 1; }
    .wizard-step .numero {
      display: grid; place-items: center; width: 26px; height: 26px; border-radius: 999px;
      background: #e2e8f0; color: #475569; font-size: 12px; font-weight: 950;
    }
    .wizard-step.activo .numero { background: #2563eb; color: #ffffff; }
    .wizard-step.hecho .numero { background: #16a34a; color: #ffffff; }
    .wizard-step .numero mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .wizard-step .texto { font-size: 12px; font-weight: 900; color: #334155; white-space: nowrap; }
    .wizard-conector { width: 28px; height: 2px; background: #dbe4f0; }

    .wizard-body { display: grid; gap: 16px; padding: 20px 22px; }
    .block-hint { margin: 0; color: #64748b; font-size: 12px; font-weight: 750; line-height: 1.5; }

    .checkbox-row {
      display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border: 1px solid #dbe4f0; border-radius: 10px;
      background: #ffffff; cursor: pointer; transition: border 150ms ease, background 150ms ease;
    }
    .checkbox-row:hover { border-color: #94a3b8; }
    .checkbox-row input { position: absolute; opacity: 0; width: 0; height: 0; }
    .checkbox-visual {
      flex: 0 0 auto; width: 18px; height: 18px; margin-top: 1px; border: 2px solid #cbd7ea; border-radius: 5px;
      background: #ffffff; position: relative; transition: border 150ms ease, background 150ms ease;
    }
    .checkbox-row input:checked + .checkbox-visual { background: #2563eb; border-color: #2563eb; }
    .checkbox-row input:checked + .checkbox-visual::after {
      content: ''; position: absolute; left: 5px; top: 1px; width: 4px; height: 9px;
      border: solid #ffffff; border-width: 0 2px 2px 0; transform: rotate(45deg);
    }
    .checkbox-row input:disabled + .checkbox-visual { background: #eef2f8; border-color: #dbe4f0; }
    .checkbox-texto { display: grid; gap: 2px; min-width: 0; }
    .checkbox-texto strong { font-size: 13px; font-weight: 900; color: #0f172a; }
    .checkbox-texto small { font-size: 11px; font-weight: 750; color: #64748b; }

    .checkbox-row.todas { background: #eff6ff; border-color: #bfdbfe; }

    .pantallas-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; transition: opacity 150ms ease; }
    .pantallas-grid.disabled { opacity: .55; }
    .pantallas-grid.disabled .checkbox-row { cursor: not-allowed; }

    .wizard-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .wizard-actions-derecha { display: flex; align-items: center; gap: 14px; }
    .wizard-actions button { height: 40px; border-radius: 8px; font-weight: 950; }
    .wizard-actions mat-icon { margin: 0 0 0 6px; vertical-align: middle; }
    .wizard-actions button mat-icon:first-child { margin: 0 6px 0 0; }
    .contador-configurados { color: #64748b; font-size: 11px; font-weight: 900; white-space: nowrap; }

    .campos-accordion .mat-expansion-panel {
      margin-bottom: 8px; border: 1px solid #dbe4f0; border-radius: 8px !important; box-shadow: none !important;
    }
    .campos-accordion .mat-expansion-panel-header { height: auto; min-height: 46px; padding: 0 14px; }
    .campos-accordion .mat-panel-title { font-size: 12px; font-weight: 950; color: #0f172a; flex-grow: 0; }
    .campos-accordion .mat-panel-description { justify-content: flex-end; align-items: center; }
    .campos-accordion .mat-expansion-panel-body { padding: 0 14px 16px; }

    .badge {
      display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px;
      background: #dcfce7; color: #166534; font-size: 10px; font-weight: 950; text-transform: uppercase;
    }

    .grupo-pantalla { display: grid; gap: 10px; }
    .grupo-pantalla + .grupo-pantalla { margin-top: 6px; padding-top: 16px; border-top: 1px dashed #dbe4f0; }
    .grupo-titulo { display: flex; align-items: center; gap: 8px; }
    .grupo-titulo mat-icon { color: #2563eb; font-size: 18px; width: 18px; height: 18px; }
    .grupo-titulo strong { font-size: 13px; font-weight: 950; color: #0f172a; }
    .grupo-contador {
      margin-left: 2px; padding: 2px 9px; border-radius: 999px; background: #eff6ff; color: #2563eb;
      font-size: 10px; font-weight: 950;
    }

    .campo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .field { display: grid; gap: 5px; min-width: 0; }
    .field-wide { grid-column: span 3; }
    .field span { color: #475569; font-size: 11px; font-weight: 900; }
    .field input, .field select {
      width: 100%; min-width: 0; height: 38px; padding: 0 10px; border: 1px solid #cbd7ea; border-radius: 8px;
      outline: 0; background: #ffffff; color: #0f172a; font: inherit; font-size: 12px; font-weight: 750; box-sizing: border-box;
    }
    .field input:focus, .field select:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12); }
    .field-hint { margin: 0; color: #64748b; font-size: 10px; font-weight: 700; line-height: 1.35; }

    .campo-sin-formato {
      grid-column: 1 / -1; margin: 2px 0 0; padding: 8px 10px; border-radius: 8px; background: #f8fafc;
      color: #64748b; font-size: 11px; font-weight: 750; font-style: italic;
    }

    .mensaje { padding: 10px 12px; border: 1px solid #bbf7d0; border-radius: 10px; background: #f0fdf4; color: #166534; font-size: 12px; font-weight: 800; }
    .mensaje.error { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }

    .loading-row { display: flex; align-items: center; gap: 10px; padding: 40px 22px; color: #64748b; font-size: 13px; font-weight: 850; }
    .girando { animation: girar 1.1s linear infinite; }
    @keyframes girar { to { transform: rotate(360deg); } }

    .empty-state {
      display: flex; align-items: center; gap: 10px; min-height: 84px; margin: 18px; padding: 14px;
      border: 1px dashed #cbd8ea; border-radius: 8px; background: #f8fbff; color: #64748b; font-size: 13px; font-weight: 850;
    }
    .empty-state mat-icon { color: #2563eb; }

    .table-wrap { overflow-x: auto; }
    table { width: 100%; min-width: 760px; border-collapse: collapse; }
    th, td { padding: 13px 14px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: middle; font-size: 12px; font-weight: 800; }
    th { color: #475569; background: #f8fbff; font-size: 10px; font-weight: 950; letter-spacing: .03em; text-transform: uppercase; white-space: nowrap; }
    td { color: #0f172a; }

    .pill {
      display: inline-flex; align-items: center; justify-content: center; min-width: 74px; height: 24px; padding: 0 10px;
      border-radius: 999px; font-size: 10px; font-weight: 950; text-transform: uppercase;
    }
    .pill.si { background: #dcfce7; color: #166534; }
    .pill.no { background: #fee2e2; color: #991b1b; }
    .pill.heredado { background: #f1f5f9; color: #64748b; }

    .col-acciones { width: 90px; white-space: nowrap; }
    .col-acciones button { width: 34px; height: 34px; }
    .delete-button mat-icon { color: #b91c1c; }

    @media (max-width: 900px) {
      .campo-grid { grid-template-columns: 1fr; }
      .field-wide { grid-column: auto; }
    }
    @media (max-width: 720px) {
      .reglas-page { padding: 16px 12px 24px; }
      .panel-head { padding: 16px; }
      .wizard-actions { flex-direction: column; align-items: stretch; }
      .wizard-actions-derecha { justify-content: space-between; }
    }
  `],
})
export class QaReglasValidacionComponent implements OnInit {
  catalogo: PantallaCatalogoDto[] = [];
  reglas: ReglaValidacion[] = [];
  cargando = false;
  guardandoLote = false;
  eliminandoId = '';
  mensaje = '';
  mensajeError = false;

  paso: PasoWizard = 'pantallas';
  todasSeleccionadas = false;
  pantallasSeleccionadas = new Set<string>();
  camposEdicion: CampoEdicion[] = [];
  gruposEdicion: GrupoPantallaEdicion[] = [];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.cargarCatalogo();
    this.cargarReglas();
  }

  get puedeAvanzar(): boolean {
    return this.todasSeleccionadas || this.pantallasSeleccionadas.size > 0;
  }

  get contadorConfigurados(): number {
    if (this.todasSeleccionadas) return this.camposEdicion.filter((campo) => this.estaConfigurado(campo)).length;
    return this.gruposEdicion.reduce((acc, grupo) => acc + grupo.campos.filter((campo) => this.estaConfigurado(campo)).length, 0);
  }

  get resumenDestino(): string {
    if (this.todasSeleccionadas) return 'todas las pantallas';
    const nombres = this.catalogo
      .filter((pantalla) => this.pantallasSeleccionadas.has(pantalla.ruta))
      .map((pantalla) => pantalla.nombre);
    return nombres.join(', ') || 'ninguna pantalla';
  }

  refrescar(): void {
    this.cargarCatalogo();
    this.cargarReglas();
  }

  onCambioTodas(): void {
    if (this.todasSeleccionadas) this.pantallasSeleccionadas.clear();
  }

  togglePantalla(ruta: string): void {
    if (this.pantallasSeleccionadas.has(ruta)) this.pantallasSeleccionadas.delete(ruta);
    else this.pantallasSeleccionadas.add(ruta);
  }

  /**
   * "Todas las pantallas" arma una unica lista (la regla es global, no tiene
   * sentido separarla por pantalla). Pantallas puntuales arman un grupo por
   * cada una, con su propia copia de cada campo: CUIL en Pantalla 1 se
   * configura aparte de CUIL en Pantalla 3.
   */
  siguiente(): void {
    if (!this.puedeAvanzar) return;

    if (this.todasSeleccionadas) {
      const vistos = new Set<string>();
      const campos: CampoEdicion[] = [];
      for (const pantalla of this.catalogo) {
        for (const campo of pantalla.campos) {
          if (vistos.has(campo.clave)) continue;
          vistos.add(campo.clave);
          campos.push(this.campoEdicionInicial(campo));
        }
      }
      this.camposEdicion = campos;
      this.gruposEdicion = [];
    } else {
      this.gruposEdicion = this.catalogo
        .filter((pantalla) => this.pantallasSeleccionadas.has(pantalla.ruta))
        .map((pantalla) => ({
          ruta: pantalla.ruta,
          nombre: pantalla.nombre,
          campos: pantalla.campos.map((campo) => this.campoEdicionInicial(campo)),
        }));
      this.camposEdicion = [];
    }

    this.paso = 'campos';
    this.mensaje = '';
  }

  volver(): void {
    this.paso = 'pantallas';
    this.mensaje = '';
  }

  estaConfigurado(campo: CampoEdicion): boolean {
    return campo.obligatorio !== ''
      || campo.largoExacto != null
      || campo.largoMinimo != null
      || campo.largoMaximo != null
      || campo.valorMinimo != null
      || campo.valorMaximo != null
      || campo.diasAtrasMax != null
      || campo.diasAdelanteMax != null;
  }

  /** Guarda una regla por cada campo configurado (global, o uno por pantalla y campo si se eligieron puntuales). */
  guardarLote(): void {
    const payloads: Record<string, unknown>[] = [];
    if (this.todasSeleccionadas) {
      for (const campo of this.camposEdicion.filter((item) => this.estaConfigurado(item))) {
        payloads.push(this.payloadDesdeCampo(campo, 'global', ''));
      }
    } else {
      for (const grupo of this.gruposEdicion) {
        for (const campo of grupo.campos.filter((item) => this.estaConfigurado(item))) {
          payloads.push(this.payloadDesdeCampo(campo, 'pantalla', grupo.ruta));
        }
      }
    }

    if (payloads.length === 0) {
      this.mostrarMensaje('Configurá al menos un campo antes de guardar.', true);
      return;
    }

    this.guardandoLote = true;
    forkJoin(payloads.map((payload) => this.api.post<ReglaValidacion>('/qa/reglas-validacion', payload))).subscribe({
      next: (guardadas) => {
        this.guardandoLote = false;
        this.mostrarMensaje(`${guardadas.length} regla(s) guardada(s).`);
        this.reiniciarWizard();
        this.cargarReglas();
      },
      error: (error) => {
        this.guardandoLote = false;
        this.mostrarMensaje(this.mensajeErrorApi(error, 'No se pudieron guardar las reglas.'), true);
      },
    });
  }

  eliminar(regla: ReglaValidacion): void {
    if (!confirm(`¿Eliminar la regla de "${this.etiquetaCampo(regla)}"?`)) return;

    this.eliminandoId = regla.id;
    this.api.delete<{ id: string }>(`/qa/reglas-validacion/${encodeURIComponent(regla.id)}`).subscribe({
      next: () => {
        this.reglas = this.reglas.filter((item) => item.id !== regla.id);
        this.mostrarMensaje('Regla eliminada.');
      },
      error: () => {
        this.mostrarMensaje('No pude eliminar la regla. Probá de nuevo.', true);
      },
      complete: () => {
        this.eliminandoId = '';
      },
    });
  }

  etiquetaCampo(regla: ReglaValidacion): string {
    for (const pantalla of this.catalogo) {
      const campo = pantalla.campos.find((item) => item.clave === regla.campo);
      if (campo) return campo.etiqueta;
    }
    return regla.campo;
  }

  nombrePantalla(ruta: string): string {
    return this.catalogo.find((pantalla) => pantalla.ruta === ruta)?.nombre ?? ruta;
  }

  claseObligatorio(obligatorio: boolean | null): string {
    if (obligatorio === true) return 'si';
    if (obligatorio === false) return 'no';
    return 'heredado';
  }

  textoObligatorio(obligatorio: boolean | null): string {
    if (obligatorio === true) return 'Sí';
    if (obligatorio === false) return 'No';
    return 'Sin cambio';
  }

  resumenFormato(regla: ReglaValidacion): string {
    const partes: string[] = [];
    if (regla.largo_exacto != null) partes.push(`Exacto: ${regla.largo_exacto}`);
    if (regla.largo_minimo != null) partes.push(`Mín: ${regla.largo_minimo}`);
    if (regla.largo_maximo != null) partes.push(`Máx: ${regla.largo_maximo}`);
    if (regla.patron) partes.push(`Patrón: ${regla.patron}`);
    if (regla.valor_minimo != null) partes.push(`Valor mín: ${regla.valor_minimo}`);
    if (regla.valor_maximo != null) partes.push(`Valor máx: ${regla.valor_maximo}`);
    if (regla.dias_atras_max != null) partes.push(`Hasta ${regla.dias_atras_max}d atrás`);
    if (regla.dias_adelante_max != null) partes.push(`Hasta ${regla.dias_adelante_max}d adelante`);
    return partes.join(' · ');
  }

  trackByRegla(_index: number, regla: ReglaValidacion): string {
    return regla.id;
  }

  trackByCampoEdicion(_index: number, campo: CampoEdicion): string {
    return campo.clave;
  }

  trackByGrupo(_index: number, grupo: GrupoPantallaEdicion): string {
    return grupo.ruta;
  }

  slug(valor: string): string {
    return valor.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  }

  private payloadDesdeCampo(campo: CampoEdicion, alcance: AlcanceRegla, ruta: string): Record<string, unknown> {
    return {
      campo: campo.clave,
      alcance,
      ruta,
      obligatorio: campo.obligatorio === '' ? null : campo.obligatorio === 'true',
      largoExacto: campo.largoExacto,
      largoMinimo: campo.largoMinimo,
      largoMaximo: campo.largoMaximo,
      valorMinimo: campo.valorMinimo,
      valorMaximo: campo.valorMaximo,
      diasAtrasMax: campo.diasAtrasMax,
      diasAdelanteMax: campo.diasAdelanteMax,
    };
  }

  private campoEdicionInicial(campo: CampoCatalogoDto): CampoEdicion {
    return {
      clave: campo.clave,
      etiqueta: campo.etiqueta,
      tipo: campo.tipo,
      obligatorio: '',
      largoExacto: null,
      largoMinimo: null,
      largoMaximo: null,
      valorMinimo: null,
      valorMaximo: null,
      diasAtrasMax: null,
      diasAdelanteMax: null,
    };
  }

  private reiniciarWizard(): void {
    this.paso = 'pantallas';
    this.todasSeleccionadas = false;
    this.pantallasSeleccionadas.clear();
    this.camposEdicion = [];
    this.gruposEdicion = [];
  }

  private cargarCatalogo(): void {
    this.api.get<PantallaCatalogoDto[]>('/qa/reglas-validacion/catalogo').subscribe({
      next: (catalogo) => { this.catalogo = Array.isArray(catalogo) ? catalogo : []; },
      error: () => { this.catalogo = []; },
    });
  }

  private cargarReglas(): void {
    this.cargando = true;
    this.api.get<ReglaValidacion[]>('/qa/reglas-validacion').subscribe({
      next: (reglas) => {
        this.reglas = Array.isArray(reglas) ? reglas : [];
        this.cargando = false;
      },
      error: () => {
        this.reglas = [];
        this.cargando = false;
      },
    });
  }

  private mostrarMensaje(mensaje: string, error = false): void {
    this.mensaje = mensaje;
    this.mensajeError = error;
  }

  private mensajeErrorApi(error: unknown, fallback: string): string {
    const err = this.objeto(error);
    const body = this.objeto(err['error']);
    const mensaje = body['message'] ?? err['message'];
    const errores = Array.isArray(body['errores']) ? body['errores'] as string[] : [];
    const partes = [mensaje ? String(mensaje) : '', ...errores].filter(Boolean);
    return partes.length > 0 ? partes.join(' ') : fallback;
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? valor as Record<string, unknown>
      : {};
  }
}
