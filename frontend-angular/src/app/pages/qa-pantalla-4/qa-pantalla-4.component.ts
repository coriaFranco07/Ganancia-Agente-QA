import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subscription, interval } from 'rxjs';
import {
  AprendizajeAprobado,
  AprendizajePrevia,
  CategoriaQaSuite,
  HallazgoInforme,
  InformeAprendizaje,
  ModoQaSuite,
  QaSuiteCorrida,
  QaSuiteService,
} from '../../core/services/qa-suite.service';

type Vista = 'preparar' | 'corridas' | 'informe';

interface DatosVistaPrevia {
  cargando: boolean;
  error: string | null;
  items: AprendizajePrevia[];
}

/**
 * Muestra, antes de correr nada, exactamente que valor va a escribir la Suite
 * en cada campo y por que. `data` se pasa por referencia: el padre la muta
 * cuando llega la respuesta del backend y Angular vuelve a pintar el dialogo
 * en el siguiente ciclo de deteccion de cambios, sin lógica extra acá.
 */
@Component({
  selector: 'app-qa-suite-vista-previa-dialog',
  template: `
    <div class="dialog-previa">
      <div class="dialog-head">
        <h2><mat-icon>visibility</mat-icon> Vista previa de datos de prueba</h2>
        <p>Así se va a completar cada campo. Ningún valor sale de datos de negocio: todos se calculan a partir de las restricciones reales declaradas para el campo.</p>
      </div>

      <div class="dialog-body">
        <div class="cargando" *ngIf="data.cargando"><mat-spinner diameter="22"></mat-spinner><span>Calculando los datos de prueba...</span></div>

        <div class="error" *ngIf="!data.cargando && data.error">
          <mat-icon>error_outline</mat-icon>
          <span>{{ data.error }}</span>
        </div>

        <ng-container *ngIf="!data.cargando && !data.error">
          <div class="bloque-aprendizaje" *ngFor="let flujo of data.items">
            <h3>{{ flujo.aprendizaje_nombre }}</h3>

            <div class="bloque-categoria" *ngFor="let cat of flujo.categorias">
              <span class="categoria-etiqueta">{{ etiquetaCategoria(cat.categoria) }}</span>

              <ng-container *ngIf="cat.categoria !== 'accesibilidad'; else soloDatos">
                <table class="tabla-valores" *ngIf="cat.escenarios.length; else sinEscenarios">
                  <thead><tr><th>Campo</th><th>Valor</th><th>Motivo</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let e of cat.escenarios">
                      <td>{{ e.campo }}</td>
                      <td><code>{{ e.valor === '' ? '(vacío)' : e.valor }}</code></td>
                      <td class="muted">{{ e.motivo }}</td>
                    </tr>
                  </tbody>
                </table>
                <ng-template #sinEscenarios><p class="muted">No hay campos de tipo texto/número/fecha para variar en este flujo.</p></ng-template>
              </ng-container>

              <ng-template #soloDatos>
                <p class="muted">Repite el flujo sin variar valores, solo para llegar a cada pantalla y auditarla:</p>
                <div class="datos-fijos" *ngIf="cat.escenarios[0] as base">
                  <span *ngFor="let clave of objectKeys(base.datos_completos)">{{ clave }}: <code>{{ base.datos_completos![clave] }}</code></span>
                </div>
              </ng-template>
            </div>
          </div>
        </ng-container>
      </div>

      <div class="dialog-actions">
        <button type="button" class="btn-cancelar" (click)="ref.close(false)">Cancelar</button>
        <button type="button" class="btn-confirmar" [disabled]="data.cargando || !!data.error" (click)="ref.close(true)">
          Confirmar y correr
        </button>
      </div>
    </div>
  `,
  styles: [`
    .dialog-previa { display: flex; flex-direction: column; max-height: 80vh; }
    .dialog-head { padding: 22px 24px 14px; }
    .dialog-head h2 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 950; color: #0f172a; }
    .dialog-head h2 mat-icon { color: #2563eb; }
    .dialog-head p { margin: 8px 0 0; font-size: 12px; color: #64748b; line-height: 1.5; }

    .dialog-body { padding: 4px 24px; overflow-y: auto; flex: 1; }
    .cargando, .error { display: flex; align-items: center; gap: 10px; color: #64748b; font-size: 13px; padding: 20px 0; }
    .error { color: #991b1b; }

    .bloque-aprendizaje + .bloque-aprendizaje { margin-top: 20px; padding-top: 20px; border-top: 1px solid #f1f5f9; }
    .bloque-aprendizaje h3 { margin: 0 0 10px; font-size: 14px; font-weight: 900; color: #0f172a; }
    .bloque-categoria { margin-bottom: 14px; }
    .categoria-etiqueta { display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-size: 9px; font-weight: 950; text-transform: uppercase; margin-bottom: 8px; }

    .tabla-valores { width: 100%; border-collapse: collapse; font-size: 12px; }
    .tabla-valores th { text-align: left; padding: 6px 8px; font-size: 10px; font-weight: 900; text-transform: uppercase; color: #94a3b8; border-bottom: 1px solid #eef2f7; }
    .tabla-valores td { padding: 8px; border-bottom: 1px solid #f8fafc; vertical-align: top; }
    .tabla-valores code { background: #f1f5f9; padding: 1px 6px; border-radius: 4px; word-break: break-all; }
    .muted { font-size: 11px; color: #64748b; margin: 4px 0; }

    .datos-fijos { display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; color: #334155; }
    .datos-fijos code { background: #f1f5f9; padding: 1px 6px; border-radius: 4px; }

    .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px 22px; border-top: 1px solid #f1f5f9; }
    .btn-cancelar, .btn-confirmar { height: 40px; padding: 0 18px; border-radius: 8px; border: none; font-size: 12px; font-weight: 900; cursor: pointer; }
    .btn-cancelar { background: #f8fafc; color: #475569; box-shadow: inset 0 0 0 1px #e2e8f0; }
    .btn-confirmar { background: #2563eb; color: #fff; }
    .btn-confirmar:disabled { background: #cbd5e1; cursor: not-allowed; }
  `],
})
export class QaSuiteVistaPreviaDialogComponent {
  constructor(
    public ref: MatDialogRef<QaSuiteVistaPreviaDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: DatosVistaPrevia,
  ) {}

  etiquetaCategoria(cat: CategoriaQaSuite): string {
    const mapa: Record<CategoriaQaSuite, string> = { funcional: 'Funcional', seguridad: 'Seguridad', accesibilidad: 'Accesibilidad' };
    return mapa[cat] ?? cat;
  }

  objectKeys(obj: Record<string, string> | null): string[] {
    return obj ? Object.keys(obj) : [];
  }
}

const CATEGORIAS: { id: CategoriaQaSuite; etiqueta: string; descripcion: string }[] = [
  { id: 'funcional', etiqueta: 'Funcional', descripcion: 'Casos límite calculados sobre las restricciones reales de cada campo.' },
  { id: 'seguridad', etiqueta: 'Seguridad', descripcion: 'Sesión, inyección y manipulación de parámetros.' },
  { id: 'accesibilidad', etiqueta: 'Accesibilidad', descripcion: 'Auditoría WCAG de la pantalla en cada estado del flujo.' },
];

@Component({
  selector: 'app-qa-pantalla-4',
  template: `
    <main class="qa-page">
      <section class="titulo-seccion">
        <h1><mat-icon>rule</mat-icon> Suite de Calidad</h1>
        <p>Corré pasadas automatizadas de funcionalidad, seguridad y accesibilidad sobre flujos aprendidos en SOP Loom. Los valores de prueba se generan a partir de las restricciones reales de cada campo — nunca se usan datos de negocio.</p>
      </section>

      <nav class="tabs" *ngIf="vista !== 'informe'">
        <button type="button" class="tab" [class.activa]="vista === 'preparar'" (click)="irA('preparar')">Correr suite</button>
        <button type="button" class="tab" [class.activa]="vista === 'corridas'" (click)="irA('corridas')">Corridas</button>
      </nav>

      <!-- ── Vista: preparar ─────────────────────────────────────────── -->
      <ng-container *ngIf="vista === 'preparar'">
        <div class="cargando" *ngIf="cargandoAprendizajes"><mat-spinner diameter="20"></mat-spinner><span>Cargando flujos...</span></div>

        <div class="panel empty-state" *ngIf="!cargandoAprendizajes && aprendizajes.length === 0">
          <mat-icon>inventory_2</mat-icon>
          <div>
            <h2>Todavía no hay flujos cargados</h2>
            <p>La Suite corre sobre cualquier aprendizaje de SOP Loom ya compilado, este aprobado o no. Andá a <a routerLink="/qa/sop-loom">QA / SOP Loom</a> para grabar y guardar un flujo.</p>
          </div>
        </div>

        <ng-container *ngIf="!cargandoAprendizajes && aprendizajes.length > 0">
          <div class="panel">
            <div class="panel-head">
              <div>
                <span class="paso">Paso 1</span>
                <h2>Elegí los flujos a testear</h2>
              </div>
              <span class="contador">{{ seleccionAprendizajes.size }} de {{ aprendizajes.length }} seleccionados</span>
            </div>
            <div class="grid-3">
              <div class="card-check" *ngFor="let flujo of aprendizajes" [class.activa]="seleccionAprendizajes.has(flujo.id)" (click)="toggleAprendizaje(flujo.id)">
                <div class="card-head">
                  <div class="check-row">
                    <span class="checkbox" [class.marcado]="seleccionAprendizajes.has(flujo.id)"><mat-icon *ngIf="seleccionAprendizajes.has(flujo.id)">check</mat-icon></span>
                    <div>
                      <strong>{{ flujo.nombre }}</strong>
                      <div class="sub">{{ flujo.modulo }} · {{ flujo.ruta }}</div>
                    </div>
                  </div>
                  <span class="estado-pill" [ngClass]="flujo.estado === 'aprobado' ? 'verde' : 'sin-correr'">{{ textoEstadoAprendizaje(flujo.estado) }}</span>
                </div>
                <div class="firmas">
                  <span class="firma"><mat-icon>{{ flujo.firmas.negocio ? 'check' : 'schedule' }}</mat-icon> Negocio</span>
                  <span class="firma"><mat-icon>{{ flujo.firmas.tecnica ? 'check' : 'schedule' }}</mat-icon> Técnica</span>
                </div>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><div><span class="paso">Paso 2</span><h2>Elegí las categorías a correr</h2></div></div>
            <div class="grid-3">
              <div class="card-check" *ngFor="let cat of categorias" [class.activa]="seleccionCategorias.has(cat.id)" (click)="toggleCategoria(cat.id)">
                <div class="check-row">
                  <span class="checkbox" [class.marcado]="seleccionCategorias.has(cat.id)"><mat-icon *ngIf="seleccionCategorias.has(cat.id)">check</mat-icon></span>
                  <div>
                    <strong>{{ cat.etiqueta }}</strong>
                    <p>{{ cat.descripcion }}</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="modo-row">
              <span class="modo-label">Modo</span>
              <div class="segmented">
                <button type="button" [class.activo]="modo === 'rapido'" (click)="modo = 'rapido'">Rápido</button>
                <button type="button" [class.activo]="modo === 'demo'" (click)="modo = 'demo'">Demo</button>
              </div>
              <span class="hint">Rápido: headless, sin pausas. Demo: visual, para revisar paso a paso.</span>
            </div>
          </div>

          <div class="panel cta">
            <div class="cta-texto">Se van a disparar <strong>{{ seleccionAprendizajes.size * seleccionCategorias.size }} ejecuciones</strong> — {{ seleccionAprendizajes.size }} flujo(s) × {{ seleccionCategorias.size }} categoría(s).</div>
            <button mat-flat-button class="btn-correr" [disabled]="disparando || !seleccionAprendizajes.size || !seleccionCategorias.size" (click)="dispararCorrida()">
              <mat-icon>{{ disparando ? 'hourglass_top' : 'play_arrow' }}</mat-icon>
              {{ disparando ? 'Disparando...' : 'Correr suite' }}
            </button>
          </div>
        </ng-container>
      </ng-container>

      <!-- ── Vista: corridas (matriz) ────────────────────────────────── -->
      <ng-container *ngIf="vista === 'corridas'">
        <div class="cargando" *ngIf="cargandoCorridas"><mat-spinner diameter="20"></mat-spinner><span>Cargando corridas...</span></div>

        <div class="panel empty-state" *ngIf="!cargandoCorridas && corridas.length === 0">
          <mat-icon>inventory_2</mat-icon>
          <div><h2>Todavía no corriste ninguna suite</h2><p>Andá a "Correr suite" para lanzar la primera.</p></div>
        </div>

        <ng-container *ngFor="let corrida of corridas">
          <div class="panel corrida-ficha">
            <div class="corrida-info">
              <span class="estado-pill" [ngClass]="claseSemaforo(corrida.estado_consolidado)">{{ textoSemaforo(corrida.estado_consolidado) }}</span>
              <div>
                <div class="corrida-titulo">{{ corrida.id }} · modo {{ corrida.modo }}</div>
                <div class="corrida-sub">Disparada por {{ corrida.disparado_por }} · {{ formatearFecha(corrida.disparado_en) }}</div>
              </div>
            </div>
            <div class="corrida-resumen">{{ corrida.aprendizajes.length }} flujo(s) · {{ corrida.categorias.length }} categoría(s) · {{ corrida.ejecuciones.length }} ejecuciones</div>
          </div>

          <div class="panel tabla-wrap">
            <table class="matriz">
              <thead>
                <tr>
                  <th>Flujo</th>
                  <th *ngFor="let cat of corrida.categorias">{{ etiquetaCategoria(cat) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let aprendizajeId of corrida.aprendizajes">
                  <td>
                    <strong>{{ nombreAprendizaje(aprendizajeId) }}</strong>
                    <a class="ver-informe" *ngIf="corrida.informe?.por_aprendizaje?.[aprendizajeId]" (click)="verInforme(corrida, aprendizajeId)">Ver informe →</a>
                  </td>
                  <td *ngFor="let cat of corrida.categorias">
                    <span class="estado-pill" [ngClass]="claseEstadoCelda(corrida, aprendizajeId, cat)">{{ textoEstadoCelda(corrida, aprendizajeId, cat) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </ng-container>
      </ng-container>

      <!-- ── Vista: informe ──────────────────────────────────────────── -->
      <ng-container *ngIf="vista === 'informe' && informeActual as informe">
        <button type="button" class="volver" (click)="irA('corridas')"><mat-icon>arrow_back</mat-icon> Volver a corridas</button>

        <div class="panel ficha-informe">
          <div class="ficha-icono" [ngClass]="claseSemaforo(informe.semaforo)"><mat-icon>{{ iconoSemaforo(informe.semaforo) }}</mat-icon></div>
          <div class="ficha-texto">
            <div class="ficha-titulo" [ngClass]="'texto-' + informe.semaforo">{{ textoSemaforo(informe.semaforo) }} — {{ informe.ficha.nombre }}</div>
            <div class="ficha-sub">{{ informe.ficha.modulo }} · {{ informe.ficha.ruta }} · disparado por {{ informe.ficha.disparado_por }} · {{ formatearFecha(informe.ficha.disparado_en) }} · modo {{ informe.ficha.modo }}</div>
          </div>
          <div class="ficha-metricas">
            <div><strong>{{ informe.tabla_categorias.length }}</strong><span>Categorías</span></div>
            <div><strong>{{ totalHallazgos(informe) }}</strong><span>Hallazgos</span></div>
          </div>
        </div>

        <div class="panel">
          <span class="seccion-titulo">Resultado por categoría</span>
          <div class="fila-categoria" *ngFor="let fila of informe.tabla_categorias">
            <strong>{{ etiquetaCategoria(fila.categoria) }}</strong>
            <span class="muted">{{ formatearDuracion(fila.duracion_ms) }}</span>
            <span class="muted">{{ totalPorFila(fila) }} hallazgos</span>
            <span class="estado-pill" [ngClass]="fila.estado === 'verde' ? 'verde' : (fila.estado === 'rojo' ? 'rojo' : 'corriendo')">{{ fila.estado === 'verde' ? 'Verde' : (fila.estado === 'rojo' ? 'Rojo' : 'Corriendo') }}</span>
          </div>
        </div>

        <div class="panel" *ngIf="informe.hallazgos_priorizados.length > 0">
          <span class="seccion-titulo">Hallazgos priorizados</span>
          <div class="hallazgo" *ngFor="let h of informe.hallazgos_priorizados">
            <div class="hallazgo-head">
              <div class="badges">
                <span class="estado-pill" [ngClass]="claseSeveridad(h.severidad)">{{ h.severidad }}</span>
                <span class="estado-pill corriendo">{{ etiquetaCategoria(h.categoria_prueba) }}</span>
              </div>
              <span class="muted" *ngIf="h.campo">campo: {{ h.campo }}</span>
            </div>
            <strong>{{ h.titulo }}</strong>
            <p>{{ h.detalle }}</p>
            <div class="esperado-actual" *ngIf="h.esperado !== undefined || h.actual !== undefined">
              <span *ngIf="h.esperado !== undefined && h.esperado !== null"><strong>Esperado:</strong> {{ h.esperado }}</span>
              <span *ngIf="h.actual !== undefined && h.actual !== null"><strong>Actual:</strong> {{ h.actual }}</span>
            </div>
          </div>
        </div>

        <div class="panel" *ngIf="!informe.hallazgos_priorizados.length">
          <div class="empty-state sin-borde">
            <mat-icon>check_circle</mat-icon>
            <div><h2>Sin hallazgos</h2><p>Las categorías corridas no encontraron problemas en este flujo.</p></div>
          </div>
        </div>

        <div class="panel" *ngIf="informe.comparacion_historica as comp">
          <span class="seccion-titulo">Comparación histórica</span>
          <p class="muted">Corrida anterior ({{ formatearFecha(comp.disparado_en) }}): <span class="estado-pill" [ngClass]="claseSemaforo(comp.semaforo)">{{ textoSemaforo(comp.semaforo) }}</span> con {{ comp.hallazgos_total_anterior }} hallazgo(s). Esta corrida tiene {{ informe.hallazgos_priorizados.length }}.</p>
        </div>
      </ng-container>
    </main>
  `,
  styles: [`
    :host { display: block; }
    .qa-page { padding: 24px; display: grid; gap: 16px; max-width: 1200px; }

    .titulo-seccion h1 { margin: 0; display: flex; align-items: center; gap: 10px; color: #0f172a; font-size: 24px; font-weight: 950; }
    .titulo-seccion h1 mat-icon { color: #2563eb; }
    .titulo-seccion p { margin: 6px 0 0 34px; color: #64748b; font-size: 13px; max-width: 720px; line-height: 1.5; }

    .tabs { display: flex; gap: 8px; }
    .tab { height: 38px; padding: 0 16px; border-radius: 999px; border: 1px solid #dbe4f0; background: #fff; color: #334155; font-size: 12px; font-weight: 900; cursor: pointer; }
    .tab.activa { background: #2563eb; border-color: #2563eb; color: #fff; }

    .cargando { display: flex; align-items: center; gap: 10px; color: #64748b; font-size: 13px; }

    .panel { background: #fff; border: 1px solid #dbe3f0; border-radius: 14px; box-shadow: 0 8px 24px rgba(15,27,61,.05); padding: 20px; display: flex; flex-direction: column; gap: 14px; }

    .empty-state { display: flex; align-items: flex-start; gap: 12px; }
    .empty-state.sin-borde { border: none; box-shadow: none; padding: 4px; }
    .empty-state mat-icon { color: #94a3b8; }
    .empty-state h2 { margin: 0 0 4px; font-size: 15px; color: #0f172a; }
    .empty-state p { margin: 0; font-size: 13px; color: #64748b; }
    .empty-state a { color: #2563eb; }

    .panel-head { display: flex; align-items: center; justify-content: space-between; }
    .paso { font-size: 10px; font-weight: 950; letter-spacing: .05em; text-transform: uppercase; color: #94a3b8; }
    .panel-head h2 { margin: 2px 0 0; font-size: 16px; font-weight: 900; color: #0f172a; }
    .contador { font-size: 12px; color: #64748b; font-weight: 700; }

    .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
    .card-check { border: 1px solid #dbe3f0; border-radius: 11px; padding: 14px; cursor: pointer; display: flex; flex-direction: column; gap: 10px; transition: border-color .15s, background .15s; }
    .card-check:hover { border-color: #94a3b8; }
    .card-check.activa { border-color: #2563eb; background: #eff6ff; }
    .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .check-row { display: flex; align-items: flex-start; gap: 8px; }
    .check-row strong { font-size: 13px; color: #0f172a; }
    .check-row .sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .check-row p { margin: 6px 0 0; font-size: 11px; color: #64748b; line-height: 1.5; }
    .checkbox { width: 18px; height: 18px; border-radius: 4px; border: 1.5px solid #cbd5e1; background: #fff; flex-shrink: 0; margin-top: 1px; display: flex; align-items: center; justify-content: center; }
    .checkbox.marcado { background: #2563eb; border-color: #2563eb; }
    .checkbox mat-icon { font-size: 13px; width: 13px; height: 13px; color: #fff; }
    .firmas { display: flex; gap: 6px; }
    .firma { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 800; color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 999px; padding: 3px 8px; }
    .firma mat-icon { font-size: 11px; width: 11px; height: 11px; }

    .modo-row { display: flex; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid #f1f5f9; flex-wrap: wrap; }
    .modo-label { font-size: 12px; font-weight: 800; color: #334155; }
    .segmented { display: inline-flex; border: 1px solid #dbe4f0; border-radius: 999px; padding: 3px; background: #f8fafc; }
    .segmented button { height: 30px; padding: 0 16px; border: none; border-radius: 999px; background: transparent; color: #64748b; font-size: 12px; font-weight: 900; cursor: pointer; }
    .segmented button.activo { background: #2563eb; color: #fff; }
    .hint { font-size: 11px; color: #94a3b8; }

    .cta { flex-direction: row; align-items: center; justify-content: space-between; }
    .cta-texto { font-size: 12px; color: #334155; font-weight: 700; }
    .btn-correr { height: 44px; padding: 0 22px; border-radius: 10px; background: #2563eb; color: #fff; font-weight: 900; }

    .estado-pill { display: inline-flex; align-items: center; justify-content: center; min-width: 74px; height: 26px; padding: 0 10px; border-radius: 999px; font-size: 10px; font-weight: 950; text-transform: uppercase; }
    .estado-pill.sin-correr { background: #f1f5f9; color: #64748b; }
    .estado-pill.corriendo { background: #eff6ff; color: #1d4ed8; }
    .estado-pill.verde { background: #dcfce7; color: #166534; }
    .estado-pill.amarillo { background: #fff2dc; color: #dc7200; }
    .estado-pill.rojo { background: #fee2e2; color: #991b1b; }
    .estado-pill.info { background: #eff6ff; color: #1d4ed8; }
    .estado-pill.baja { background: #f1f5f9; color: #64748b; }
    .estado-pill.media { background: #fff2dc; color: #dc7200; }
    .estado-pill.alta { background: #ffe7ea; color: #d82435; }
    .estado-pill.critica { background: #fee2e2; color: #991b1b; }

    .corrida-ficha { flex-direction: row; align-items: center; justify-content: space-between; }
    .corrida-info { display: flex; align-items: center; gap: 16px; }
    .corrida-titulo { font-size: 13px; font-weight: 900; color: #0f172a; }
    .corrida-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .corrida-resumen { font-size: 12px; color: #334155; font-weight: 700; }

    .tabla-wrap { padding: 6px; overflow-x: auto; }
    table.matriz { width: 100%; border-collapse: collapse; }
    table.matriz th { text-align: left; padding: 14px 16px; font-size: 10px; font-weight: 950; letter-spacing: .04em; text-transform: uppercase; color: #94a3b8; border-bottom: 1px solid #eef2f7; }
    table.matriz td { padding: 16px; border-bottom: 1px solid #f1f5f9; }
    table.matriz tr:last-child td { border-bottom: none; }
    .ver-informe { display: block; margin-top: 4px; font-size: 11px; color: #2563eb; font-weight: 800; cursor: pointer; }

    .volver { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; background: none; border: none; color: #334155; font-size: 12px; font-weight: 800; cursor: pointer; padding: 0; }

    .ficha-informe { flex-direction: row; align-items: center; justify-content: space-between; }
    .ficha-icono { width: 54px; height: 54px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .ficha-icono.verde { background: #dcfce7; } .ficha-icono.verde mat-icon { color: #166534; }
    .ficha-icono.amarillo { background: #fff2dc; } .ficha-icono.amarillo mat-icon { color: #dc7200; }
    .ficha-icono.rojo { background: #fee2e2; } .ficha-icono.rojo mat-icon { color: #991b1b; }
    .ficha-texto { display: flex; flex-direction: column; gap: 4px; flex: 1; margin-left: 16px; }
    .ficha-titulo { font-size: 16px; font-weight: 950; }
    .ficha-titulo.texto-verde { color: #166534; }
    .ficha-titulo.texto-amarillo { color: #dc7200; }
    .ficha-titulo.texto-rojo { color: #991b1b; }
    .ficha-sub { font-size: 12px; color: #64748b; }
    .ficha-metricas { display: flex; gap: 24px; padding-left: 20px; border-left: 1px solid #eef2f7; }
    .ficha-metricas div { text-align: center; }
    .ficha-metricas strong { display: block; font-size: 20px; font-weight: 950; color: #0f172a; }
    .ficha-metricas span { font-size: 10px; color: #94a3b8; font-weight: 800; text-transform: uppercase; }

    .seccion-titulo { font-size: 10px; font-weight: 950; letter-spacing: .05em; text-transform: uppercase; color: #94a3b8; }
    .fila-categoria { display: flex; align-items: center; justify-content: space-between; padding: 12px 4px; border-top: 1px solid #f1f5f9; }
    .fila-categoria:first-of-type { border-top: none; }
    .muted { font-size: 11px; color: #64748b; }

    .hallazgo { border: 1px solid #dbe3f0; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
    .hallazgo + .hallazgo { margin-top: 12px; }
    .hallazgo-head { display: flex; align-items: center; justify-content: space-between; }
    .badges { display: flex; gap: 8px; }
    .hallazgo strong { font-size: 13px; color: #0f172a; }
    .hallazgo p { margin: 0; font-size: 12px; color: #475569; line-height: 1.5; }
    .esperado-actual { display: flex; gap: 16px; font-size: 11px; color: #64748b; }

    @media (max-width: 900px) { .grid-3 { grid-template-columns: 1fr; } }
  `],
})
export class QaPantalla4Component implements OnInit, OnDestroy {
  vista: Vista = 'preparar';
  categorias = CATEGORIAS;

  aprendizajes: AprendizajeAprobado[] = [];
  cargandoAprendizajes = false;
  seleccionAprendizajes = new Set<string>();
  seleccionCategorias = new Set<CategoriaQaSuite>(['funcional', 'seguridad']);
  modo: ModoQaSuite = 'rapido';
  disparando = false;

  corridas: QaSuiteCorrida[] = [];
  cargandoCorridas = false;

  informeActual: InformeAprendizaje | null = null;

  private polling?: Subscription;

  constructor(private suite: QaSuiteService, private snackBar: MatSnackBar, private dialog: MatDialog) {}

  ngOnInit(): void {
    this.cargarAprendizajes();
    this.cargarCorridas();
  }

  ngOnDestroy(): void {
    this.polling?.unsubscribe();
  }

  irA(vista: Vista): void {
    this.vista = vista;
    if (vista === 'corridas') this.cargarCorridas();
  }

  toggleAprendizaje(id: string): void {
    if (this.seleccionAprendizajes.has(id)) this.seleccionAprendizajes.delete(id);
    else this.seleccionAprendizajes.add(id);
  }

  toggleCategoria(id: CategoriaQaSuite): void {
    if (this.seleccionCategorias.has(id)) this.seleccionCategorias.delete(id);
    else this.seleccionCategorias.add(id);
  }

  /** Abre la vista previa de datos antes de correr nada; recién dispara la corrida si el usuario confirma. */
  dispararCorrida(): void {
    const seleccion = {
      aprendizajes: [...this.seleccionAprendizajes],
      categorias: [...this.seleccionCategorias],
      modo: this.modo,
    };

    const datosDialogo: { cargando: boolean; error: string | null; items: AprendizajePrevia[] } = {
      cargando: true,
      error: null,
      items: [],
    };

    const ref = this.dialog.open(QaSuiteVistaPreviaDialogComponent, {
      width: 'min(92vw, 720px)',
      maxWidth: '92vw',
      autoFocus: false,
      restoreFocus: true,
      data: datosDialogo,
    });

    this.suite.vistaPrevia(seleccion).subscribe({
      next: (items) => {
        datosDialogo.cargando = false;
        datosDialogo.items = items;
      },
      error: (error) => {
        datosDialogo.cargando = false;
        datosDialogo.error = 'No se pudo calcular la vista previa: ' + this.mensajeError(error);
      },
    });

    ref.afterClosed().subscribe((confirmado) => {
      if (confirmado) this.confirmarYCorrer(seleccion);
    });
  }

  private confirmarYCorrer(seleccion: { aprendizajes: string[]; categorias: CategoriaQaSuite[]; modo: ModoQaSuite }): void {
    this.disparando = true;
    this.suite.dispararCorrida(seleccion).subscribe({
      next: () => {
        this.disparando = false;
        this.avisar('Suite disparada. Se está corriendo en segundo plano.');
        this.irA('corridas');
        this.iniciarPolling();
      },
      error: (error) => {
        this.disparando = false;
        this.avisar('No se pudo disparar la suite: ' + this.mensajeError(error), true);
      },
    });
  }

  verInforme(corrida: QaSuiteCorrida, aprendizajeId: string): void {
    const informe = corrida.informe?.por_aprendizaje?.[aprendizajeId];
    if (!informe) return;
    this.informeActual = informe;
    this.vista = 'informe';
  }

  nombreAprendizaje(id: string): string {
    return this.aprendizajes.find((a) => a.id === id)?.nombre ?? id;
  }

  etiquetaCategoria(cat: CategoriaQaSuite): string {
    return CATEGORIAS.find((c) => c.id === cat)?.etiqueta ?? cat;
  }

  claseSemaforo(estado: string): string {
    return estado;
  }

  textoSemaforo(estado: string): string {
    const mapa: Record<string, string> = { verde: 'Verde', amarillo: 'Amarillo', rojo: 'Rojo', corriendo: 'Corriendo' };
    return mapa[estado] ?? estado;
  }

  textoEstadoAprendizaje(estado: string): string {
    const mapa: Record<string, string> = { borrador: 'Borrador', revisar: 'A revisar', listo: 'Listo', aprobado: 'Aprobado' };
    return mapa[estado] ?? estado;
  }

  iconoSemaforo(estado: string): string {
    const mapa: Record<string, string> = { verde: 'check_circle', amarillo: 'warning', rojo: 'error', corriendo: 'hourglass_top' };
    return mapa[estado] ?? 'help';
  }

  claseSeveridad(severidad: string): string {
    return severidad;
  }

  claseEstadoCelda(corrida: QaSuiteCorrida, aprendizajeId: string, categoria: CategoriaQaSuite): string {
    const fila = corrida.informe?.por_aprendizaje?.[aprendizajeId]?.tabla_categorias.find((t) => t.categoria === categoria);
    if (!fila) return corrida.estado_consolidado === 'corriendo' ? 'corriendo' : 'sin-correr';
    return fila.estado;
  }

  textoEstadoCelda(corrida: QaSuiteCorrida, aprendizajeId: string, categoria: CategoriaQaSuite): string {
    const fila = corrida.informe?.por_aprendizaje?.[aprendizajeId]?.tabla_categorias.find((t) => t.categoria === categoria);
    if (!fila) return corrida.estado_consolidado === 'corriendo' ? 'Corriendo' : 'Sin correr';
    return fila.estado === 'verde' ? 'Verde' : fila.estado === 'rojo' ? 'Rojo' : 'Corriendo';
  }

  totalHallazgos(informe: InformeAprendizaje): number {
    return informe.hallazgos_priorizados.length;
  }

  totalPorFila(fila: { hallazgos_por_severidad: Record<string, number> }): number {
    return Object.values(fila.hallazgos_por_severidad ?? {}).reduce((a, b) => a + b, 0);
  }

  formatearFecha(iso: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString('es-AR');
  }

  formatearDuracion(ms: number | null): string {
    if (ms === null || ms === undefined) return '—';
    const segundos = Math.round(ms / 1000);
    if (segundos < 60) return `${segundos}s`;
    return `${Math.floor(segundos / 60)}m ${segundos % 60}s`;
  }

  private cargarAprendizajes(): void {
    this.cargandoAprendizajes = true;
    this.suite.listarAprendizajes().subscribe({
      next: (aprendizajes) => {
        this.aprendizajes = aprendizajes;
        this.cargandoAprendizajes = false;
      },
      error: (error) => {
        this.cargandoAprendizajes = false;
        this.avisar('No se pudieron cargar los flujos: ' + this.mensajeError(error), true);
      },
    });
  }

  private cargarCorridas(): void {
    this.cargandoCorridas = true;
    this.suite.listarCorridas().subscribe({
      next: (corridas) => {
        this.corridas = corridas;
        this.cargandoCorridas = false;
        if (corridas.some((c) => c.estado_consolidado === 'corriendo')) this.iniciarPolling();
      },
      error: (error) => {
        this.cargandoCorridas = false;
        this.avisar('No se pudieron cargar las corridas: ' + this.mensajeError(error), true);
      },
    });
  }

  private iniciarPolling(): void {
    this.polling?.unsubscribe();
    this.polling = interval(4000).subscribe(() => {
      this.suite.listarCorridas().subscribe((corridas) => {
        this.corridas = corridas;
        if (!corridas.some((c) => c.estado_consolidado === 'corriendo')) this.polling?.unsubscribe();
      });
    });
  }

  private mensajeError(err: any): string {
    return err?.error?.message ?? err?.message ?? 'error desconocido';
  }

  private avisar(mensaje: string, esError = false): void {
    this.snackBar.open(mensaje, 'Cerrar', { duration: esError ? 6000 : 4000 });
  }
}
