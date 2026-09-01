import { Component, Input, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  GuardarSpiderCaso,
  QaSpiderCasosService,
  SpiderCasoOperador,
  SpiderEjecucionResultado,
  SpiderHallazgo,
  SpiderPasoEjecutado,
} from '../../../../core/services/qa-spider-casos.service';
import { SpiderNivel, SpiderSeccion } from '../../../../core/services/qa-catalogo.service';

/** Formulario de alta/edición, separado del modelo persistido. */
interface FormularioCaso extends GuardarSpiderCaso {
  id: string | null;
}

/** Resultado del botón "Ejecutar" individual, con el detalle completo del runner. */
interface ResultadoIndividual {
  estado: string;
  duracion_ms: number;
  detalle?: string;
  pasos?: SpiderPasoEjecutado[];
  hallazgos?: SpiderHallazgo[];
}

/** Casos generados juntos desde el mismo spec (comparten `grupo_generado`). */
interface GrupoCasosGenerados {
  grupoId: string;
  nombreBase: string;
  generadoDesde: string | null;
  casos: SpiderCasoOperador[];
}

type ItemLista =
  | { tipo: 'grupo'; grupo: GrupoCasosGenerados; fecha: string }
  | { tipo: 'individual'; caso: SpiderCasoOperador; fecha: string };

const ORDEN_NIVEL: { [nivel: string]: number } = { funcional: 0, seguridad: 1, accesibilidad: 2 };

const FORMULARIO_VACIO = (nivelesPorDefecto: string[]): FormularioCaso => ({
  id: null,
  nombre: '',
  descripcion: '',
  transcripcion: '',
  codigo_playwright: '',
  niveles: [...nivelesPorDefecto],
  ambito: 'global',
  aplica_a: [],
  activo: true,
});

@Component({
  selector: 'app-qa-spider-casos',
  template: `
    <div class="casos-panel">
      <div class="casos-header">
        <div>
          <label class="config-label">
            Casos propios
            <small class="config-hint">{{ casos.length }} guardado(s) · {{ activos }} activo(s)</small>
          </label>
          <p class="casos-desc">
            Casos generados desde un spec. Se ejecutan de a uno sobre la sesión ya iniciada, y
            cada uno se puede editar, activar o borrar.
          </p>
        </div>
      </div>

      <!-- ── Formulario ─────────────────────────────────────────────────── -->
      <div class="form-caso" *ngIf="formularioAbierto">
        <div class="form-titulo">
          <mat-icon>{{ form.id ? 'edit' : 'post_add' }}</mat-icon>
          {{ form.id ? 'Editar caso' : 'Nuevo caso del Spider' }}
        </div>

        <div class="form-fila">
          <mat-form-field appearance="outline" class="campo-ancho">
            <mat-label>Nombre del caso *</mat-label>
            <input matInput [(ngModel)]="form.nombre" maxlength="200"
                   placeholder="Ej: Carga de Excel con legajo sin período">
          </mat-form-field>

          <mat-form-field appearance="outline" class="campo-ancho">
            <mat-label>Descripción corta</mat-label>
            <input matInput [(ngModel)]="form.descripcion" maxlength="1000"
                   placeholder="Una línea sobre qué controla el caso">
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline" class="campo-full">
          <mat-label>Transcripción de la pasada</mat-label>
          <textarea matInput [(ngModel)]="form.transcripcion" rows="4" spellcheck="false"
                    placeholder="Dado que el operador está en Cargar Excel…&#10;Cuando sube un archivo sin período…&#10;Entonces el sistema marca el análisis como no procesable."></textarea>
          <mat-hint>En prosa: qué hace la pasada, paso a paso. Queda guardada junto al código.</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="campo-full campo-codigo">
          <mat-label>Código Playwright *</mat-label>
          <textarea matInput [(ngModel)]="form.codigo_playwright" rows="10" spellcheck="false"
                    placeholder="await page.goto('http://localhost:4200/cargar-excel');&#10;await expect(page.locator('h1')).toContainText('Auditoría');"></textarea>
          <mat-hint>
            Se ejecuta con <code>page</code> y <code>expect</code> ya disponibles y la sesión iniciada.
            Se acepta el cuerpo suelto o un <code>test('…', async ({{ '{' }} page {{ '}' }}) => {{ '{' }} … {{ '}' }})</code> completo.
          </mat-hint>
        </mat-form-field>

        <div class="form-fila">
          <div class="campo-ancho">
            <label class="mini-label">Niveles en los que corre</label>
            <div class="niveles-check">
              <mat-checkbox *ngFor="let nivel of niveles" color="primary"
                            [checked]="form.niveles.includes(nivel.id)"
                            (change)="alternarNivel(nivel.id, $event.checked)">
                {{ nivel.etiqueta }}
              </mat-checkbox>
            </div>
          </div>

          <div class="campo-ancho">
            <label class="mini-label">Alcance</label>
            <mat-form-field appearance="outline" class="campo-full">
              <mat-label>Ámbito</mat-label>
              <mat-select [(ngModel)]="form.ambito">
                <mat-option value="global">Global — corre una vez por corrida</mat-option>
                <mat-option value="ruta">Por ruta — corre en cada sección elegida</mat-option>
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" class="campo-full" *ngIf="form.ambito === 'ruta'">
              <mat-label>Rutas donde aplica</mat-label>
              <mat-select [(ngModel)]="form.aplica_a" multiple>
                <mat-option *ngFor="let seccion of secciones" [value]="seccion.ruta">
                  {{ seccion.etiqueta }} <small>({{ seccion.ruta }})</small>
                </mat-option>
              </mat-select>
              <mat-hint>Sin selección corre en todas las secciones de la corrida.</mat-hint>
            </mat-form-field>
          </div>
        </div>

        <div class="form-acciones">
          <mat-checkbox [(ngModel)]="form.activo" color="primary">Activo</mat-checkbox>
          <span class="spacer"></span>
          <button mat-button (click)="cerrarFormulario()">Cancelar</button>
          <button mat-flat-button class="btn-guardar" [disabled]="guardando || !esValido()" (click)="guardar()">
            <span *ngIf="guardando" class="spinner-mini"></span>
            {{ guardando ? 'Guardando…' : (form.id ? 'Guardar cambios' : 'Crear caso') }}
          </button>
        </div>
      </div>

      <!-- ── Listado ────────────────────────────────────────────────────── -->
      <div class="casos-vacio" *ngIf="!cargando && !casos.length && !formularioAbierto">
        <mat-icon>science</mat-icon>
        <p>Todavía no hay casos propios. Creá uno para que el Spider lo ejecute en cada corrida.</p>
      </div>

      <p class="casos-cargando" *ngIf="cargando">Cargando casos…</p>

      <div class="casos-lista" *ngIf="casos.length">
        <ng-container *ngFor="let item of itemsLista; trackBy: trackItem">
          <!-- ── Grupo de casos generados juntos desde un mismo spec ────────── -->
          <div class="grupo-generado" *ngIf="item.tipo === 'grupo'">
            <div class="grupo-header" (click)="alternarGrupo(item.grupo.grupoId)">
              <mat-icon class="grupo-flecha">{{ gruposAbiertos.has(item.grupo.grupoId) ? 'expand_less' : 'expand_more' }}</mat-icon>
              <mat-icon class="grupo-icono">auto_fix_high</mat-icon>
              <div class="grupo-info">
                <b>{{ item.grupo.nombreBase }}</b>
                <span class="grupo-sub">
                  {{ item.grupo.casos.length }} caso(s) generado(s)<ng-container *ngIf="item.grupo.generadoDesde"> desde {{ item.grupo.generadoDesde }}</ng-container>
                </span>
              </div>
              <span class="badge-nivel" *ngFor="let c of item.grupo.casos">{{ c.niveles[0] }}</span>
            </div>

            <div class="grupo-contenido" *ngIf="gruposAbiertos.has(item.grupo.grupoId)">
              <ng-container *ngFor="let caso of item.grupo.casos; trackBy: trackCaso">
                <ng-container *ngTemplateOutlet="filaCaso; context: { caso: caso }"></ng-container>
              </ng-container>
            </div>
          </div>

          <!-- ── Caso suelto, cargado a mano ──────────────────────────────── -->
          <ng-container *ngIf="item.tipo === 'individual'">
            <ng-container *ngTemplateOutlet="filaCaso; context: { caso: item.caso }"></ng-container>
          </ng-container>
        </ng-container>
      </div>

      <!-- Fila de un caso: se reusa igual para casos sueltos y para los que estan dentro de un grupo -->
      <ng-template #filaCaso let-caso="caso">
        <div class="caso-fila" [class.inactivo]="!caso.activo">
          <div class="caso-info">
            <div class="caso-titulo">
              <b>{{ caso.nombre }}</b>
              <span class="badge-nivel" *ngFor="let n of caso.niveles">{{ n }}</span>
              <span class="badge-ambito">{{ caso.ambito === 'ruta' ? 'por ruta' : 'global' }}</span>
              <span class="badge-inactivo" *ngIf="!caso.activo">inactivo</span>
              <span class="badge-ejecucion" *ngIf="caso.ultima_ejecucion as u" [ngClass]="'ej-' + u.estado">
                <mat-icon>{{ iconoEjecucion(u.estado) }}</mat-icon>
                {{ u.estado }} · {{ u.fecha | date:'short' }}
              </span>
            </div>
            <p class="caso-sub" *ngIf="caso.descripcion || caso.transcripcion">
              {{ caso.descripcion || (caso.transcripcion | slice:0:140) }}
            </p>
            <p class="caso-rutas" *ngIf="caso.ambito === 'ruta' && caso.aplica_a?.length">
              <mat-icon>alt_route</mat-icon> {{ caso.aplica_a.join(' · ') }}
            </p>
          </div>

          <div class="caso-acciones">
            <button mat-icon-button class="jugar" matTooltip="Ejecutar este caso ahora, solo"
                    [disabled]="ejecutandoIndividual === caso.id" (click)="ejecutarIndividual(caso)">
              <span *ngIf="ejecutandoIndividual === caso.id" class="spinner-mini"></span>
              <mat-icon *ngIf="ejecutandoIndividual !== caso.id">play_circle</mat-icon>
            </button>
            <button mat-icon-button matTooltip="Ver transcripción y código" (click)="alternarDetalle(caso.id)">
              <mat-icon>{{ detalleAbierto === caso.id ? 'expand_less' : 'code' }}</mat-icon>
            </button>
            <button mat-icon-button matTooltip="Editar" (click)="editar(caso)">
              <mat-icon>edit</mat-icon>
            </button>
            <button mat-icon-button [matTooltip]="caso.activo ? 'Desactivar' : 'Activar'"
                    (click)="cambiarEstado(caso)">
              <mat-icon>{{ caso.activo ? 'toggle_on' : 'toggle_off' }}</mat-icon>
            </button>
            <button mat-icon-button class="borrar" matTooltip="Eliminar" (click)="eliminar(caso)">
              <mat-icon>delete_outline</mat-icon>
            </button>
          </div>

          <div class="caso-resultado-individual" *ngIf="resultadosIndividuales.get(caso.id) as r" [ngClass]="'res-' + r.estado">
            <mat-icon>{{ iconoEjecucion(r.estado) }}</mat-icon>
            <div class="resultado-cuerpo">
              <div class="resultado-resumen">
                <b>{{ r.estado === 'pass' ? 'Corrió bien' : r.estado === 'omitido' ? 'Sin nada que probar' : 'Encontró un problema' }}</b>
                <span class="res-duracion">{{ (r.duracion_ms / 1000).toFixed(1) }}s</span>
              </div>
              <p class="resultado-detalle-simple" *ngIf="r.detalle && !r.hallazgos?.length">{{ r.detalle }}</p>

              <!-- Informe detallado: solo aparece si hubo algo que reportar -->
              <div class="informe-caso" *ngIf="r.hallazgos?.length">
                <table class="pasos-table" *ngIf="r.pasos?.length">
                  <thead><tr><th>Paso</th><th>Estado</th><th>Detalle</th><th>Tiempo</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let paso of r.pasos" class="hover-row">
                      <td class="font-mono">{{ paso.accion }}</td>
                      <td><span class="paso-badge" [ngClass]="'paso-' + paso.estado">{{ paso.estado }}</span></td>
                      <td>{{ paso.detalle }}</td>
                      <td>{{ paso.duracion_ms }}ms</td>
                    </tr>
                  </tbody>
                </table>

                <div class="hallazgos-lista">
                  <div class="hallazgo-item" *ngFor="let h of r.hallazgos" [ngClass]="'grav-' + h.gravedad">
                    <mat-icon>report_problem</mat-icon>
                    <div>
                      <b>{{ h.tipo }}</b> — {{ h.detalle }}
                      <pre *ngIf="h.datos">{{ h.datos | json }}</pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="caso-detalle" *ngIf="detalleAbierto === caso.id">
            <div class="detalle-bloque" *ngIf="caso.transcripcion">
              <span class="detalle-titulo">Transcripción de la pasada</span>
              <pre class="detalle-texto">{{ caso.transcripcion }}</pre>
            </div>
            <div class="detalle-bloque">
              <span class="detalle-titulo">Código Playwright</span>
              <pre class="detalle-codigo">{{ caso.codigo_playwright }}</pre>
            </div>
          </div>
        </div>
      </ng-template>

      <p class="casos-nota" *ngIf="casos.length">
        <mat-icon>info</mat-icon>
        Cada caso se ejecuta de a uno con el botón de reproducir. Los casos inactivos quedan
        guardados pero no se ejecutan.
      </p>
    </div>
  `,
  styles: [`
    .casos-panel { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin-bottom: 20px; }
    .casos-header { display: flex; align-items: flex-start; gap: 16px; }
    .casos-header > div:first-child { flex: 1; }
    .config-label { display: block; font-size: 12px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .config-hint { float: none; margin-left: 8px; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: none; letter-spacing: 0; }
    .casos-desc { margin: 0 0 12px; font-size: 12px; color: #64748b; max-width: 640px; }

    .form-caso { margin-top: 12px; padding: 18px; border: 1px dashed #c4b5fd; border-radius: 12px; background: #faf5ff; }
    .form-titulo { display: flex; align-items: center; gap: 8px; font-weight: 800; color: #5b21b6; margin-bottom: 16px; }
    .form-fila { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .campo-ancho { width: 100%; }
    .campo-full { width: 100%; }
    .campo-codigo textarea { font-family: Consolas, 'SFMono-Regular', monospace; font-size: 13px; line-height: 1.5; }
    .mini-label { display: block; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 8px; }
    .niveles-check { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    .form-acciones { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
    .spacer { flex: 1; }
    .btn-guardar { background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: white; font-weight: 700; border-radius: 10px; }
    .spinner-mini { display: inline-block; width: 13px; height: 13px; margin-right: 6px; border: 2px solid white; border-top-color: transparent; border-radius: 50%; animation: giro 1s linear infinite; vertical-align: middle; }
    @keyframes giro { to { transform: rotate(360deg); } }

    .casos-vacio { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px; color: #94a3b8; }
    .casos-vacio mat-icon { font-size: 32px; width: 32px; height: 32px; }
    .casos-vacio p { margin: 0; font-size: 13px; }
    .casos-cargando { font-size: 12px; color: #94a3b8; }

    .casos-lista { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .caso-fila { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 10px; transition: border-color 0.15s; }
    .caso-fila:hover { border-color: #c4b5fd; }
    .caso-fila.inactivo { opacity: 0.55; background: #f8fafc; }
    .caso-info { min-width: 0; }
    .caso-titulo { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
    .caso-titulo b { font-size: 13px; color: #0f172a; }
    .badge-nivel { font-size: 10px; font-weight: 800; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: #ede9fe; color: #5b21b6; }
    .badge-ambito { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #475569; }
    .badge-inactivo { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: #fee2e2; color: #991b1b; }
    .badge-ejecucion { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #64748b; }
    .badge-ejecucion mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .badge-ejecucion.ej-pass { background: #dcfce7; color: #166534; }
    .badge-ejecucion.ej-fail { background: #fef9c3; color: #854d0e; }
    .badge-ejecucion.ej-error { background: #fee2e2; color: #991b1b; }
    .caso-sub { margin: 4px 0 0; font-size: 12px; color: #64748b; }
    .caso-rutas { display: flex; align-items: center; gap: 4px; margin: 4px 0 0; font-size: 11px; color: #94a3b8; font-family: Consolas, monospace; }
    .caso-rutas mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .caso-acciones { display: flex; gap: 2px; align-items: center; }
    .caso-acciones .jugar { color: #16a34a; }
    .caso-acciones .jugar[disabled] { color: #94a3b8; }
    .caso-acciones .borrar { color: #ef4444; }
    .caso-resultado-individual { grid-column: 1 / -1; display: flex; gap: 10px; padding: 10px 14px; border-radius: 8px; background: #f8fafc; font-size: 12px; color: #475569; }
    .caso-resultado-individual b { display: block; font-size: 12px; }
    .caso-resultado-individual mat-icon { flex-shrink: 0; }
    .caso-resultado-individual.res-pass { background: #f0fdf4; color: #166534; }
    .caso-resultado-individual.res-pass mat-icon { color: #16a34a; }
    .caso-resultado-individual.res-fail { background: #fffbeb; color: #854d0e; }
    .caso-resultado-individual.res-fail mat-icon { color: #f59e0b; }
    .caso-resultado-individual.res-error { background: #fef2f2; color: #991b1b; }
    .caso-resultado-individual.res-error mat-icon { color: #ef4444; }
    .resultado-cuerpo { flex: 1; min-width: 0; }
    .resultado-resumen { display: flex; align-items: baseline; }
    .res-duracion { margin-left: 8px; font-size: 11px; font-weight: 700; opacity: 0.7; }
    .resultado-detalle-simple { margin: 4px 0 0; font-size: 12px; }
    .caso-detalle { grid-column: 1 / -1; margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }

    /* ── Informe detallado de una ejecución individual con hallazgos ─────── */
    .informe-caso { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(0,0,0,0.08); }
    .font-mono { font-family: Consolas, 'SFMono-Regular', monospace; }
    .pasos-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; }
    .pasos-table th { text-align: left; padding: 6px 8px; font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; border-bottom: 1px solid #e2e8f0; }
    .pasos-table td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; color: #475569; }
    .pasos-table .hover-row:hover { background: rgba(0,0,0,0.02); }
    .paso-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .paso-ok { background: #dcfce7; color: #166534; }
    .paso-hallazgo { background: #fef9c3; color: #854d0e; }
    .paso-error { background: #fee2e2; color: #991b1b; }
    .paso-omitido { background: #f1f5f9; color: #64748b; }
    .hallazgos-lista { display: flex; flex-direction: column; gap: 8px; }
    .hallazgo-item { display: flex; gap: 10px; padding: 10px 14px; border-radius: 8px; background: #fffbeb; border-left: 3px solid #f59e0b; font-size: 12px; color: #475569; }
    .hallazgo-item.grav-alta { background: #fef2f2; border-left-color: #ef4444; }
    .hallazgo-item mat-icon { font-size: 18px; width: 18px; height: 18px; color: #f59e0b; flex-shrink: 0; }
    .hallazgo-item.grav-alta mat-icon { color: #ef4444; }
    .hallazgo-item pre { margin: 6px 0 0; font-size: 11px; color: #64748b; white-space: pre-wrap; word-break: break-word; }

    /* ── Grupo de casos generados juntos desde un mismo spec ─────────────── */
    .grupo-generado { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
    .grupo-header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; cursor: pointer; background: #faf5ff; transition: background 0.15s; }
    .grupo-header:hover { background: #f5f3ff; }
    .grupo-flecha { color: #8b5cf6; flex-shrink: 0; }
    .grupo-icono { color: #8b5cf6; font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .grupo-info { flex: 1; min-width: 0; }
    .grupo-info b { display: block; font-size: 13px; color: #0f172a; }
    .grupo-sub { display: block; font-size: 11px; color: #64748b; margin-top: 2px; }
    .grupo-contenido { display: flex; flex-direction: column; gap: 8px; padding: 8px; background: #fbfaff; }
    .grupo-contenido .caso-fila { border-color: #ede9fe; }
    .detalle-bloque { display: flex; flex-direction: column; gap: 4px; }
    .detalle-titulo { font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em; }
    .detalle-texto { margin: 0; padding: 10px 12px; background: #f8fafc; border-radius: 8px; font-size: 12px; color: #475569; white-space: pre-wrap; font-family: inherit; }
    .detalle-codigo { margin: 0; padding: 12px; background: #0f172a; color: #e2e8f0; border-radius: 8px; font-size: 12px; font-family: Consolas, monospace; overflow-x: auto; white-space: pre; }

    .casos-nota { display: flex; align-items: center; gap: 6px; margin: 14px 0 0; font-size: 11px; color: #94a3b8; }
    .casos-nota mat-icon { font-size: 15px; width: 15px; height: 15px; }

    @media (max-width: 768px) { .form-fila { grid-template-columns: 1fr; } }
  `],
})
export class QaSpiderCasosComponent implements OnInit {
  /** Niveles y secciones del catálogo, para no duplicarlos acá. */
  @Input() niveles: SpiderNivel[] = [];
  @Input() secciones: SpiderSeccion[] = [];

  casos: SpiderCasoOperador[] = [];
  cargando = false;
  guardando = false;
  formularioAbierto = false;
  detalleAbierto: string | null = null;
  form: FormularioCaso = FORMULARIO_VACIO([]);

  /** Id del caso corriendo ahora mismo por el botón individual, si hay alguno. */
  ejecutandoIndividual: string | null = null;
  /** Último resultado del botón individual por caso, para mostrarlo inline. */
  resultadosIndividuales = new Map<string, ResultadoIndividual>();
  /** Ids de grupo (`grupo_generado`) actualmente desplegados. */
  gruposAbiertos = new Set<string>();
  /** Lista combinada (grupos + casos sueltos), memoizada — ver `recalcularItemsLista`. */
  itemsLista: ItemLista[] = [];

  constructor(
    private service: QaSpiderCasosService,
    private snackBar: MatSnackBar,
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  get activos(): number {
    return this.casos.filter((caso) => caso.activo).length;
  }

  /**
   * Agrupa los casos que comparten `grupo_generado` (los generados juntos
   * desde un mismo spec) en un solo item colapsable; el resto se lista suelto,
   * tal como antes. El orden combinado sigue la fecha de actividad más
   * reciente de cada item, igual que el orden plano de siempre.
   *
   * IMPORTANTE: se recalcula sólo cuando cambian los casos, nunca en un getter.
   * Un getter devuelve identidades de objeto nuevas en cada ciclo de detección
   * de cambios, y el `*ngFor` entonces destruye y recrea todo el DOM cada vez.
   * Eso rompe los clicks reales del usuario: el ripple de Material dispara
   * detección de cambios en el `mousedown`, el nodo desaparece, y el `mouseup`
   * cae sobre otro nodo — con lo cual el navegador nunca emite el `click`.
   */
  private recalcularItemsLista(): void {
    const grupos = new Map<string, GrupoCasosGenerados>();
    const sueltos: SpiderCasoOperador[] = [];

    for (const caso of this.casos) {
      if (!caso.grupo_generado) {
        sueltos.push(caso);
        continue;
      }
      if (!grupos.has(caso.grupo_generado)) {
        grupos.set(caso.grupo_generado, {
          grupoId: caso.grupo_generado,
          nombreBase: this.nombreBaseDeGrupo(caso.nombre),
          generadoDesde: caso.generado_desde ?? null,
          casos: [],
        });
      }
      grupos.get(caso.grupo_generado)!.casos.push(caso);
    }

    const items: ItemLista[] = [];
    for (const grupo of grupos.values()) {
      grupo.casos.sort((a, b) => this.ordenNivel(a) - this.ordenNivel(b));
      const fecha = grupo.casos.reduce((max, c) => ((c.updatedAt ?? '') > max ? c.updatedAt ?? '' : max), '');
      items.push({ tipo: 'grupo', grupo, fecha });
    }
    for (const caso of sueltos) {
      items.push({ tipo: 'individual', caso, fecha: caso.updatedAt ?? '' });
    }

    this.itemsLista = items.sort((a, b) => (b.fecha > a.fecha ? 1 : b.fecha < a.fecha ? -1 : 0));
  }

  /** Identidad estable para el *ngFor de la lista combinada. */
  trackItem = (_indice: number, item: ItemLista): string =>
    item.tipo === 'grupo' ? `g:${item.grupo.grupoId}` : `c:${item.caso.id}`;

  /** Identidad estable para el *ngFor de los casos dentro de un grupo. */
  trackCaso = (_indice: number, caso: SpiderCasoOperador): string => caso.id;

  alternarGrupo(grupoId: string): void {
    if (this.gruposAbiertos.has(grupoId)) this.gruposAbiertos.delete(grupoId);
    else this.gruposAbiertos.add(grupoId);
  }

  private nombreBaseDeGrupo(nombre: string): string {
    return nombre.replace(/\s*\((funcional|seguridad|accesibilidad)\)\s*$/i, '');
  }

  private ordenNivel(caso: SpiderCasoOperador): number {
    return ORDEN_NIVEL[caso.niveles[0]] ?? 99;
  }

  cargar(): void {
    this.cargando = true;
    this.service.listar().subscribe({
      next: (casos) => {
        this.casos = Array.isArray(casos) ? casos : [];
        this.recalcularItemsLista();
        this.cargando = false;
      },
      error: (err) => {
        this.cargando = false;
        this.avisar('No se pudieron cargar los casos: ' + this.mensajeError(err));
      },
    });
  }

  cerrarFormulario(): void {
    this.formularioAbierto = false;
    this.form = FORMULARIO_VACIO(this.niveles.map((nivel) => nivel.id));
  }

  editar(caso: SpiderCasoOperador): void {
    this.form = {
      id: caso.id,
      nombre: caso.nombre,
      descripcion: caso.descripcion,
      transcripcion: caso.transcripcion,
      codigo_playwright: caso.codigo_playwright,
      niveles: [...caso.niveles],
      ambito: caso.ambito,
      aplica_a: [...(caso.aplica_a ?? [])],
      activo: caso.activo,
    };
    this.formularioAbierto = true;
  }

  esValido(): boolean {
    return (
      this.form.nombre.trim().length > 0 &&
      this.form.codigo_playwright.trim().length > 0 &&
      this.form.niveles.length > 0
    );
  }

  alternarNivel(nivelId: string, marcado: boolean): void {
    const sinNivel = this.form.niveles.filter((nivel) => nivel !== nivelId);
    this.form.niveles = marcado ? [...sinNivel, nivelId] : sinNivel;
  }

  guardar(): void {
    if (!this.esValido()) return;
    this.guardando = true;

    const { id, ...datos } = this.form;
    const peticion = id ? this.service.actualizar(id, datos) : this.service.crear(datos);

    peticion.subscribe({
      next: () => {
        this.guardando = false;
        this.avisar(id ? 'Caso actualizado.' : 'Caso creado y guardado.');
        this.cerrarFormulario();
        this.cargar();
      },
      error: (err) => {
        this.guardando = false;
        this.avisar('No se pudo guardar: ' + this.mensajeError(err));
      },
    });
  }

  /**
   * Corre este caso solo, sin recorrer secciones ni el resto del catálogo.
   * Ignora si está activo o si el nivel coincide: el operador lo pidió ahora.
   */
  ejecutarIndividual(caso: SpiderCasoOperador): void {
    this.ejecutandoIndividual = caso.id;
    this.resultadosIndividuales.delete(caso.id);

    this.service.ejecutar(caso.id).subscribe({
      next: (res: SpiderEjecucionResultado) => {
        this.ejecutandoIndividual = null;
        this.resultadosIndividuales.set(caso.id, this.leerResultadoCaso(res, caso));
        this.cargar();
      },
      error: (err) => {
        this.ejecutandoIndividual = null;
        this.resultadosIndividuales.set(caso.id, {
          estado: 'error',
          duracion_ms: 0,
          detalle: this.mensajeError(err),
        });
      },
    });
  }

  private leerResultadoCaso(res: SpiderEjecucionResultado, caso: SpiderCasoOperador): ResultadoIndividual {
    const match = res.stdout?.match(/===JSON_REPORT_START===\n([\s\S]*?)\n===JSON_REPORT_END===/);
    if (!match) {
      return { estado: 'error', duracion_ms: res.duracion_ms, detalle: 'No se pudo leer el resultado del caso.' };
    }
    try {
      const reporte = JSON.parse(match[1]);
      const propio = reporte.casos?.find((c: any) => c.id === caso.id);
      if (!propio) {
        return { estado: 'error', duracion_ms: res.duracion_ms, detalle: 'El caso no aparece en el reporte.' };
      }
      const detalle = propio.hallazgos?.[0]?.detalle ?? propio.pasos?.find((p: any) => p.detalle)?.detalle;
      return {
        estado: propio.estado,
        duracion_ms: propio.duracion_ms,
        detalle,
        pasos: propio.pasos,
        hallazgos: propio.hallazgos,
      };
    } catch {
      return { estado: 'error', duracion_ms: res.duracion_ms, detalle: 'No se pudo interpretar el reporte.' };
    }
  }

  iconoEjecucion(estado: string): string {
    return { pass: 'check_circle', fail: 'report_problem', error: 'cancel', omitido: 'remove_circle_outline' }[
      estado
    ] ?? 'help_outline';
  }

  cambiarEstado(caso: SpiderCasoOperador): void {
    this.service.cambiarEstado(caso.id, !caso.activo).subscribe({
      next: () => this.cargar(),
      error: (err) => this.avisar('No se pudo cambiar el estado: ' + this.mensajeError(err)),
    });
  }

  eliminar(caso: SpiderCasoOperador): void {
    if (!window.confirm(`¿Eliminar el caso "${caso.nombre}"? No se puede deshacer.`)) return;
    this.service.eliminar(caso.id).subscribe({
      next: () => {
        this.avisar('Caso eliminado.');
        this.cargar();
      },
      error: (err) => this.avisar('No se pudo eliminar: ' + this.mensajeError(err)),
    });
  }

  alternarDetalle(id: string): void {
    this.detalleAbierto = this.detalleAbierto === id ? null : id;
  }

  private mensajeError(err: any): string {
    return err?.error?.message ?? err?.message ?? 'error desconocido';
  }

  private avisar(mensaje: string): void {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 4000 });
  }
}
