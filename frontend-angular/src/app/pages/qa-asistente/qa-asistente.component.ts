import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';

type RolMensaje = 'user' | 'assistant';
type EstadoEjecucion = 'corriendo' | 'verde' | 'rojo';
type TipoAccionAsistente = 'preguntar' | 'navegar' | 'aprobar_plan' | 'ejecutar_plan' | 'ver_evidencia';

interface AccionAsistenteQa {
  tipo: TipoAccionAsistente;
  etiqueta: string;
  mensaje?: string;
  ruta?: string;
  plan_id?: string;
  hash_plan?: string;
}

interface EjecucionAsistenteQa {
  id: string;
  caso_id: string;
  modo: string;
  estado: EstadoEjecucion;
  iniciado_en: string;
  finalizado_en?: string;
  detalle?: string;
  evidencia_path?: string;
}

interface CasoAsistenteQa {
  id: string;
  definicion_tecnica_codigo: string;
  dataset_codigo: string;
  periodo: string;
  descripcion: string;
  excel: string;
  legajo: string;
  empleado: string;
  campo: string;
  esperado: unknown;
  tolerancia: unknown;
  estado_esperado: string;
  ultima_ejecucion?: EjecucionAsistenteQa | null;
  ultimo_plan?: PlanAsistenteQa | null;
}

interface ResumenAsistenteQa {
  casos_activos: number;
  datasets_validos: number;
  ejecuciones_verdes: number;
  ejecuciones_rojas: number;
  ejecuciones_corriendo: number;
  planes_pendientes?: number;
  planes_aprobados?: number;
}

interface ContextoAsistenteQa {
  generado_en: string;
  politica_registro: string;
  resumen: ResumenAsistenteQa;
  casos: CasoAsistenteQa[];
  sugerencias: string[];
}

interface RespuestaAsistenteQa {
  id: string;
  rol: 'assistant';
  generado_en: string;
  tipo: string;
  caso_id?: string;
  texto: string;
  acciones: AccionAsistenteQa[];
  plan?: PlanAsistenteQa | null;
  correccion?: CorreccionAsistidaQa | null;
  politica_registro: string;
}

interface MensajeChat {
  id: string;
  rol: RolMensaje;
  texto: string;
  generado_en: string;
  acciones: AccionAsistenteQa[];
  tipo?: string;
  caso_id?: string;
  plan?: PlanAsistenteQa | null;
  correccion?: CorreccionAsistidaQa | null;
}

interface CorreccionAsistidaQa {
  estado: string;
  proveedor: 'gemini' | 'local';
  modelo?: string | null;
  caso_id: string;
  titulo: string;
  resumen: string;
  causa_probable: string;
  accion_recomendada: string;
  pasos?: string[];
  datos_a_revisar?: Array<Record<string, unknown>>;
  cambios_sugeridos?: Array<Record<string, unknown>>;
  ticket_sugerido?: Record<string, unknown>;
  prueba_regresion?: Record<string, unknown>;
  preguntas_para_responsable?: string[];
  limites?: string[];
  advertencias?: string[];
  politica?: string;
}

interface PlanAsistenteQa {
  id: string;
  caso_id: string;
  modo: 'rapido' | 'demo';
  estado: string;
  parametros?: Record<string, unknown>;
  parametros_pendientes?: string[];
  plan?: {
    tarea?: Record<string, unknown>;
    objetivo?: string;
    alcance?: string;
    parametros_resueltos?: Array<Record<string, unknown>>;
    precondiciones?: Array<Record<string, unknown>>;
    impacto_real?: string;
    pasos?: Array<string | Record<string, unknown>>;
    verificacion?: string;
    riesgo?: string;
    requiere_aprobacion?: boolean;
    gate_aprobacion?: Record<string, unknown>;
    politica_registro?: string;
    vence_en?: string;
  } | Record<string, unknown>;
  hash_plan: string;
  vence_en: string;
  aprobacion?: Record<string, unknown> | null;
  ejecucion_id?: string;
  verificacion?: Record<string, unknown> | null;
  abortado_motivo?: string;
}

interface ParametroPlanVista {
  id: string;
  nombre: string;
  valor: string;
  origen: string;
  requiereConfirmacion: boolean;
}

interface PrecondicionPlanVista {
  id: string;
  texto: string;
  estado: string;
  origen: string;
}

interface PasoPlanVista {
  id: string;
  orden: string;
  descripcion: string;
  escribe: boolean;
  irreversible: boolean;
}

@Component({
  selector: 'app-qa-asistente',
  template: `
    <main class="qa-chat-page" data-testid="qa-chat-page">
      <aside class="context-card" data-testid="qa-chat-context">
        <header class="context-head">
          <div>
            <h2>Resumen del análisis</h2>
          </div>
        </header>

        <section class="summary-grid" data-testid="qa-chat-summary-grid" *ngIf="contexto">
          <article class="summary-tile fixed" data-testid="qa-chat-summary-fixed">
            <mat-icon>check_circle</mat-icon>
            <strong>{{ casosCorregidos }}</strong>
            <span>Corregidos</span>
          </article>
          <article class="summary-tile fail" data-testid="qa-chat-summary-fail">
            <mat-icon>cancel</mat-icon>
            <strong>{{ casosFallos }}</strong>
            <span>Fallos</span>
          </article>
        </section>

        <section class="cases-block">
          <div class="case-search">
            <mat-icon>search</mat-icon>
            <input [(ngModel)]="busquedaCasos" name="busquedaCasosQa" data-testid="qa-chat-case-search-input" placeholder="Buscar casos...">
            <button mat-icon-button type="button" data-testid="qa-chat-case-filter-button" matTooltip="Filtros">
              <mat-icon>filter_list</mat-icon>
            </button>
          </div>

          <div class="section-label">
            <span>Casos</span>
            <small>{{ casosFiltrados.length }}</small>
          </div>

          <div *ngIf="cargando" class="empty-state">
            <mat-icon>sync</mat-icon>
            Cargando contexto QA...
          </div>

          <div *ngIf="!cargando && casosFiltrados.length === 0" class="empty-state">
            <mat-icon>inventory_2</mat-icon>
            Sin casos para mostrar.
          </div>

          <div class="cases-list" data-testid="qa-chat-cases-list" *ngIf="casosFiltrados.length > 0">
            <button
              *ngFor="let caso of casosFiltrados; trackBy: trackByCaso"
              type="button"
              class="case-row"
              [attr.data-testid]="'qa-chat-case-row-' + caso.id"
              [class.active]="casoSeleccionado === caso.id"
              (click)="seleccionarCaso(caso)">
              <span class="row-icon">
                <mat-icon>description</mat-icon>
              </span>
              <span class="row-copy">
                <strong>{{ caso.id }}</strong>
                <small>Planilla: {{ caso.excel || '-' }}</small>
                <small>Campo: {{ caso.campo || '-' }}</small>
              </span>
              <span class="row-side">
                <span class="status-badge compact" [ngClass]="estadoBadgeClase(caso.ultima_ejecucion)">
                  {{ estadoBadgeTexto(caso.ultima_ejecucion) }}
                </span>
                <small>{{ fechaCaso(caso) }}</small>
              </span>
            </button>
          </div>
        </section>
      </aside>

      <section class="chat-shell" data-testid="qa-chat-shell">
        <header class="chat-head" data-testid="qa-chat-selected-case" *ngIf="casoActual as caso; else chatHeadVacio">
          <div class="chat-case-title">
            <span class="chat-case-icon">
              <mat-icon>description</mat-icon>
            </span>
            <div>
              <h2>
                {{ caso.id }}
                <span class="status-badge" [ngClass]="estadoBadgeClase(caso.ultima_ejecucion)">
                  {{ estadoBadgeTexto(caso.ultima_ejecucion) }}
                </span>
              </h2>
              <p>Planilla: {{ caso.excel || '-' }} <span>•</span> Campo: {{ caso.campo || '-' }}</p>
            </div>
          </div>

          <div class="head-actions">
            <button mat-stroked-button type="button" class="refresh-btn" data-testid="qa-chat-refresh-button" [disabled]="cargando" (click)="cargarContexto()">
              <mat-icon>{{ cargando ? 'hourglass_top' : 'refresh' }}</mat-icon>
              Actualizar
            </button>
            <button mat-icon-button type="button" class="more-btn" data-testid="qa-chat-more-button" matTooltip="Más opciones">
              <mat-icon>more_horiz</mat-icon>
            </button>
          </div>
        </header>

        <ng-template #chatHeadVacio>
          <header class="chat-head empty">
            <div class="chat-case-title">
              <span class="chat-case-icon">
                <mat-icon>support_agent</mat-icon>
              </span>
              <div>
                <h2>Asistente QA</h2>
                <p>Seleccioná un caso para trabajar con contexto.</p>
              </div>
            </div>
            <button mat-stroked-button type="button" class="refresh-btn" data-testid="qa-chat-refresh-button" [disabled]="cargando" (click)="cargarContexto()">
              <mat-icon>{{ cargando ? 'hourglass_top' : 'refresh' }}</mat-icon>
              Actualizar
            </button>
          </header>
        </ng-template>

        <div class="chat-actions" aria-label="Acciones rápidas del chat">
          <button mat-flat-button color="primary" type="button" data-testid="qa-chat-summary-button" (click)="preguntar('Mostrame el resumen de casos QA activos.')">
            <mat-icon>explore</mat-icon>
            Resumen
          </button>
          <button mat-stroked-button type="button" data-testid="qa-chat-diagnosis-button" [disabled]="!casoSeleccionado" (click)="preguntarCaso('Por qué falló')">
            <mat-icon>track_changes</mat-icon>
            Diagnóstico
          </button>
          <button mat-stroked-button type="button" data-testid="qa-chat-plan-button" [disabled]="!casoSeleccionado" (click)="preguntarCaso('Armame el plan de ejecución para')">
            <mat-icon>event_note</mat-icon>
            Plan
          </button>
          <button mat-stroked-button type="button" data-testid="qa-chat-import-button" (click)="preguntar('Cómo importo datos masivos para QA.')">
            <mat-icon>upload_file</mat-icon>
            Importar
          </button>

          <span class="pinned-case" data-testid="qa-chat-pinned-case" *ngIf="casoSeleccionado">
            <mat-icon>push_pin</mat-icon>
            {{ casoSeleccionado }}
          </span>
        </div>

        <section class="messages-panel" data-testid="qa-chat-messages">
          <div *ngFor="let mensaje of mensajes; trackBy: trackByMensaje" class="message-line" [attr.data-testid]="'qa-chat-message-' + mensaje.id" [class.user]="mensaje.rol === 'user'">
            <span class="message-avatar">
              <mat-icon>{{ mensaje.rol === 'user' ? 'person' : 'support_agent' }}</mat-icon>
            </span>

            <article class="message-card">
              <header>
                <strong>{{ mensaje.rol === 'user' ? 'Tú' : 'Asistente QA' }}</strong>
                <span>{{ fechaMensaje(mensaje.generado_en) }}</span>
              </header>
              <p>{{ mensaje.texto }}</p>

              <section class="missing-card" data-testid="qa-chat-missing-params" *ngIf="parametrosPendientesMensaje(mensaje).length > 0">
                <header>
                  <mat-icon>rule</mat-icon>
                  <div>
                    <strong>Faltan datos para construir el plan</strong>
                    <span>El agente no ejecuta ni aprueba con parámetros incompletos.</span>
                  </div>
                </header>
                <div class="missing-list">
                  <span *ngFor="let pendiente of parametrosPendientesMensaje(mensaje); trackBy: trackByPendiente">
                    {{ pendiente }}
                  </span>
                </div>
              </section>

              <section class="correction-card" [attr.data-testid]="'qa-chat-correction-card-' + correccion.caso_id" *ngIf="correccionMensaje(mensaje) as correccion">
                <header>
                  <div>
                    <span>Corrección asistida</span>
                    <strong>{{ correccion.titulo || ('Corrección ' + correccion.caso_id) }}</strong>
                  </div>
                  <em [ngClass]="correccion.proveedor === 'gemini' ? 'ia' : 'local'">
                    {{ correccion.proveedor === 'gemini' ? 'Gemini' : 'Local' }}
                  </em>
                </header>

                <div class="correction-main">
                  <article>
                    <span>Causa probable</span>
                    <strong>{{ correccion.causa_probable }}</strong>
                  </article>
                  <article>
                    <span>Acción recomendada</span>
                    <strong>{{ correccion.accion_recomendada }}</strong>
                  </article>
                </div>
              </section>

              <section class="plan-card" [attr.data-testid]="'qa-chat-plan-card-' + plan.id" *ngIf="planTrabajoMensaje(mensaje) as plan">
                <header>
                  <div>
                    <span>Plan de trabajo</span>
                    <strong>{{ plan.id }}</strong>
                  </div>
                  <em [ngClass]="estadoPlanClase(plan.estado)">{{ estadoPlanTexto(plan.estado) }}</em>
                </header>

                <div class="plan-meta">
                  <span>
                    <mat-icon>fingerprint</mat-icon>
                    {{ hashCorto(plan.hash_plan) }}
                  </span>
                  <span>
                    <mat-icon>schedule</mat-icon>
                    vence {{ fechaMensaje(plan.vence_en) }}
                  </span>
                  <span>
                    <mat-icon>{{ plan.modo === 'demo' ? 'slideshow' : 'bolt' }}</mat-icon>
                    {{ plan.modo === 'demo' ? 'Demo' : 'Rápido' }}
                  </span>
                </div>

                <div class="plan-sections">
                  <section class="plan-section">
                    <h4>
                      <mat-icon>assignment</mat-icon>
                      Tarea y definición
                    </h4>
                    <dl class="plan-params">
                      <div class="wide">
                        <dt>Tarea</dt>
                        <dd>{{ tareaPlan(plan) }}</dd>
                      </div>
                      <div>
                        <dt>Caso</dt>
                        <dd>{{ valorParametro(plan, 'caso_id') }}</dd>
                      </div>
                      <div>
                        <dt>Definición</dt>
                        <dd>{{ valorParametro(plan, 'definicion_tecnica_codigo') }}</dd>
                      </div>
                      <div>
                        <dt>Dataset</dt>
                        <dd>{{ valorParametro(plan, 'dataset_codigo') }}</dd>
                      </div>
                      <div>
                        <dt>Período</dt>
                        <dd>{{ valorParametro(plan, 'periodo') }}</dd>
                      </div>
                      <div>
                        <dt>Modo</dt>
                        <dd>{{ plan.modo === 'demo' ? 'Demo visible' : 'Rápido' }}</dd>
                      </div>
                    </dl>
                  </section>

                  <section class="plan-section" *ngIf="parametrosResueltosPlan(plan).length > 0">
                    <h4>
                      <mat-icon>manage_search</mat-icon>
                      Parámetros resueltos
                    </h4>
                    <div class="resolved-list">
                      <article *ngFor="let parametro of parametrosResueltosPlan(plan); trackBy: trackByParametroPlan">
                        <span>{{ parametro.nombre }}</span>
                        <strong>{{ parametro.valor }}</strong>
                        <em [class.confirm]="parametro.requiereConfirmacion">{{ parametro.origen }}</em>
                      </article>
                    </div>
                  </section>

                  <section class="plan-section" *ngIf="precondicionesPlan(plan).length > 0">
                    <h4>
                      <mat-icon>fact_check</mat-icon>
                      Precondiciones verificadas
                    </h4>
                    <div class="preconditions-list">
                      <article *ngFor="let precondicion of precondicionesPlan(plan); trackBy: trackByPrecondicionPlan">
                        <mat-icon>{{ precondicion.estado === 'verificado' ? 'check_circle' : 'report_problem' }}</mat-icon>
                        <span>{{ precondicion.texto }}</span>
                        <em>{{ precondicion.estado }}</em>
                      </article>
                    </div>
                  </section>

                  <section class="plan-section" *ngIf="pasosPlan(plan).length > 0">
                    <h4>
                      <mat-icon>route</mat-icon>
                      Pasos que ejecutará
                    </h4>
                    <ol class="steps-list">
                      <li *ngFor="let paso of pasosPlan(plan); trackBy: trackByPasoPlan">
                        <span>{{ paso.descripcion }}</span>
                        <em *ngIf="paso.escribe">escribe registro</em>
                        <em *ngIf="paso.irreversible" class="danger">irreversible</em>
                      </li>
                    </ol>
                  </section>

                  <section class="plan-section">
                    <h4>
                      <mat-icon>policy</mat-icon>
                      Control de aprobación
                    </h4>
                    <dl class="plan-params">
                      <div class="wide">
                        <dt>Impacto real</dt>
                        <dd class="wrap">{{ valorPlan(plan, 'impacto_real') }}</dd>
                      </div>
                      <div>
                        <dt>Riesgo</dt>
                        <dd>{{ valorPlan(plan, 'riesgo') }}</dd>
                      </div>
                      <div class="wide approval-control">
                        <dt>Aprobación</dt>
                        <dd class="approval-value">
                          <span>{{ requiereAprobacion(plan) }}</span>
                          <span>{{ gateAprobacion(plan) }}</span>
                        </dd>
                      </div>
                      <div class="wide">
                        <dt>Verificación</dt>
                        <dd class="wrap">{{ valorPlan(plan, 'verificacion') }}</dd>
                      </div>
                    </dl>
                  </section>

                  <section class="plan-section" *ngIf="plan.verificacion || plan.abortado_motivo">
                    <h4>
                      <mat-icon>receipt_long</mat-icon>
                      Resultado y evidencia
                    </h4>
                    <dl class="plan-params">
                      <div>
                        <dt>Ejecución</dt>
                        <dd>{{ plan.ejecucion_id || '-' }}</dd>
                      </div>
                      <div>
                        <dt>Estado</dt>
                        <dd>{{ estadoVerificacion(plan) }}</dd>
                      </div>
                      <div class="wide">
                        <dt>Evidencia</dt>
                        <dd class="wrap">{{ evidenciaPlan(plan) }}</dd>
                      </div>
                      <div class="wide" *ngIf="plan.abortado_motivo">
                        <dt>Motivo</dt>
                        <dd class="wrap">{{ plan.abortado_motivo }}</dd>
                      </div>
                    </dl>
                  </section>
                </div>

                <div class="approval-note" *ngIf="plan.aprobacion">
                  <mat-icon>verified_user</mat-icon>
                  Aprobado por {{ texto(plan.aprobacion['correo']) || 'usuario' }} con hash {{ hashCorto(plan.hash_plan) }}.
                </div>
              </section>

              <div class="message-actions" *ngIf="mensaje.acciones.length > 0">
                <button
                  *ngFor="let accion of mensaje.acciones; trackBy: trackByAccion"
                  mat-stroked-button
                  type="button"
                  [attr.data-testid]="dataTestIdAccion(accion)"
                  [disabled]="accionDeshabilitada(accion)"
                  (click)="ejecutarAccion(accion)">
                  <mat-icon>{{ iconoAccion(accion) }}</mat-icon>
                  {{ accion.etiqueta }}
                </button>
              </div>
            </article>
          </div>

          <div *ngIf="enviando" class="message-line">
            <span class="message-avatar">
              <mat-icon>support_agent</mat-icon>
            </span>
            <article class="message-card typing">
              <span></span>
              <span></span>
              <span></span>
            </article>
          </div>
        </section>

        <div *ngIf="error" class="error-box" data-testid="qa-chat-error">
          <mat-icon>error</mat-icon>
          {{ error }}
        </div>

        <form class="composer" data-testid="qa-chat-composer" (submit)="$event.preventDefault(); enviar()">
          <button mat-icon-button type="button" data-testid="qa-chat-attach-button" matTooltip="Adjuntar referencia">
            <mat-icon>attach_file</mat-icon>
          </button>
          <input
            [(ngModel)]="pregunta"
            name="preguntaQa"
            data-testid="qa-chat-input"
            autocomplete="off"
            placeholder="Escribí tu pregunta o solicitá una acción al asistente QA..."
            [disabled]="enviando">
          <button mat-flat-button color="primary" type="submit" class="send-btn" data-testid="qa-chat-send-button" [disabled]="enviando || !pregunta.trim()">
            <mat-icon>{{ enviando ? 'hourglass_top' : 'send' }}</mat-icon>
          </button>
        </form>

        <p class="examples">
          Ejemplos: "Por qué falló QA-GAN-IMP-010", "Cómo corregir QA-GAN-IMP-010", "Mostrar plan de ejecución".
        </p>
      </section>
    </main>
  `,
  styles: [`
    :host { display: block; }
    .qa-chat-page {
      height: calc(100vh - 52px);
      display: grid;
      grid-template-columns: 292px minmax(0, 1fr);
      gap: 14px;
      padding: 12px 14px 10px;
      overflow: hidden;
      background: #f7faff;
    }
    .context-card,
    .chat-shell {
      min-width: 0;
      min-height: 0;
      border: 1px solid #dfe8f5;
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 16px 38px rgba(15, 23, 42, 0.06);
    }
    .context-card {
      display: grid;
      grid-template-rows: auto auto auto minmax(0, 1fr);
      gap: 11px;
      padding: 14px 13px;
      overflow: hidden;
    }
    .context-head,
    .chat-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .context-head h2,
    .chat-head h2 {
      margin: 0;
      color: #122033;
      font-size: 16px;
      line-height: 1.2;
      font-weight: 950;
      letter-spacing: 0;
    }
    .context-head p,
    .chat-head p {
      margin: 3px 0 0;
      color: #64748b;
      font-size: 10px;
      line-height: 1.35;
      font-weight: 700;
    }
    .context-head button { width: 34px; height: 34px; color: #1e293b; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
    }
    .summary-tile {
      min-height: 68px;
      display: grid;
      align-content: center;
      gap: 3px;
      padding: 9px;
      border: 1px solid #dce7f7;
      border-radius: 7px;
      background: #ffffff;
    }
    .summary-tile mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .summary-tile strong { color: #0f172a; font-size: 20px; line-height: 1; font-weight: 950; }
    .summary-tile span { color: #334155; font-size: 10px; font-weight: 850; }
    .summary-tile.valid mat-icon { color: #16a34a; }
    .summary-tile.fail mat-icon { color: #dc2626; }
    .summary-tile.fixed mat-icon { color: #2563eb; }
    .section-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 7px;
      color: #0f172a;
      font-size: 11px;
      font-weight: 950;
    }
    .section-label small {
      min-width: 22px;
      padding: 3px 7px;
      border-radius: 999px;
      background: #eef4ff;
      color: #2563eb;
      text-align: center;
      font-size: 11px;
      font-weight: 950;
    }
    .selected-case {
      display: grid;
      gap: 9px;
      padding: 11px;
      border: 1px solid #9fc6ff;
      border-radius: 8px;
      background: linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
      box-shadow: inset 3px 0 0 #2b6de9;
    }
    .case-main {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr) auto;
      gap: 9px;
      align-items: center;
    }
    .case-file,
    .row-icon,
    .bot-icon,
    .message-avatar {
      display: grid;
      place-items: center;
      border-radius: 8px;
    }
    .case-file {
      width: 36px;
      height: 36px;
      background: #dbeafe;
      color: #2563eb;
    }
    .case-file { width: 34px; height: 34px; }
    .case-file mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .case-main h3 {
      margin: 0;
      overflow: hidden;
      color: #0f172a;
      font-size: 12px;
      font-weight: 950;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .case-main p {
      margin: 3px 0 0;
      overflow: hidden;
      color: #334155;
      font-size: 10px;
      font-weight: 850;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status-badge {
      padding: 5px 7px;
      border-radius: 6px;
      font-size: 9px;
      font-weight: 950;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .status-badge.valido { background: #dcfce7; color: #15803d; }
    .status-badge.fallo { background: #fee2e2; color: #dc2626; }
    .status-badge.corriendo { background: #dbeafe; color: #1d4ed8; }
    .status-badge.pendiente { background: #eef2f7; color: #475569; }
    .status-badge.compact { justify-self: end; }
    .selected-plan {
      display: grid;
      gap: 8px;
      padding: 9px;
      border: 1px solid #cfe0f7;
      border-radius: 8px;
      background: #ffffff;
    }
    .selected-plan-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .selected-plan-head span {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      overflow: hidden;
      color: #1e3a8a;
      font-size: 10px;
      font-weight: 950;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .selected-plan-head mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .selected-plan-head em {
      padding: 4px 7px;
      border-radius: 999px;
      font-style: normal;
      font-size: 9px;
      font-weight: 950;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .selected-plan-head em.recolectando { background: #ffedd5; color: #c2410c; }
    .selected-plan-head em.propuesto { background: #fef3c7; color: #92400e; }
    .selected-plan-head em.aprobado { background: #dbeafe; color: #1d4ed8; }
    .selected-plan-head em.ejecutando { background: #ede9fe; color: #6d28d9; }
    .selected-plan-head em.ok { background: #dcfce7; color: #15803d; }
    .selected-plan-head em.error { background: #fee2e2; color: #b91c1c; }
    .selected-plan-data {
      gap: 5px;
      padding-top: 0;
    }
    .selected-plan-data div {
      grid-template-columns: 62px minmax(0, 1fr);
      gap: 6px;
    }
    .selected-plan-data dt,
    .selected-plan-data dd {
      font-size: 9px;
    }
    .selected-plan-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .mini-action {
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 0 10px;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      background: #ffffff;
      color: #1e3a8a;
      font: inherit;
      font-size: 10px;
      font-weight: 950;
      cursor: pointer;
    }
    .mini-action.primary {
      border-color: #2563eb;
      background: #2563eb;
      color: #ffffff;
    }
    .mini-action:disabled {
      cursor: progress;
      opacity: 0.65;
    }
    .mini-action mat-icon { font-size: 15px; width: 15px; height: 15px; }
    dl {
      display: grid;
      gap: 5px;
      margin: 0;
      padding-top: 4px;
    }
    dl div {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr);
      gap: 8px;
    }
    dt { color: #64748b; font-size: 10px; font-weight: 950; }
    dd {
      margin: 0;
      overflow: hidden;
      color: #0f172a;
      font-size: 10px;
      font-weight: 850;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail-link {
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0;
      border: 0;
      border-top: 1px solid #cfe0f7;
      background: transparent;
      color: #2563eb;
      font: inherit;
      font-size: 11px;
      font-weight: 950;
      cursor: pointer;
    }
    .detail-link mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .selected-case.empty {
      min-height: 104px;
      place-items: center;
      text-align: center;
      border-style: dashed;
      box-shadow: none;
      background: #ffffff;
    }
    .selected-case.empty mat-icon { color: #2563eb; }
    .selected-case.empty strong { color: #0f172a; font-size: 13px; font-weight: 950; }
    .selected-case.empty span { color: #64748b; font-size: 11px; font-weight: 800; }
    .cases-block {
      min-height: 0;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      overflow: hidden;
    }
    .case-search {
      height: 34px;
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) 30px;
      align-items: center;
      gap: 4px;
      margin-bottom: 8px;
      padding: 0 4px 0 8px;
      border: 1px solid #dce7f7;
      border-radius: 8px;
      background: #ffffff;
    }
    .case-search mat-icon { color: #64748b; font-size: 18px; width: 18px; height: 18px; }
    .case-search input {
      width: 100%;
      border: 0;
      outline: 0;
      color: #0f172a;
      font: inherit;
      font-size: 12px;
      font-weight: 750;
    }
    .case-search button { width: 28px; height: 28px; }
    .empty-state {
      min-height: 72px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      color: #64748b;
      font-size: 12px;
      font-weight: 850;
    }
    .cases-list {
      min-height: 0;
      display: grid;
      align-content: start;
      gap: 5px;
      overflow: auto;
      padding-right: 3px;
    }
    .case-row {
      width: 100%;
      min-height: 48px;
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) auto;
      align-items: center;
      gap: 6px;
      padding: 7px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: #ffffff;
      color: #0f172a;
      text-align: left;
      cursor: pointer;
    }
    .case-row.active,
    .case-row:hover {
      border-color: #b9d5ff;
      background: #f1f6ff;
      box-shadow: inset 3px 0 0 #2563eb;
    }
    .row-icon {
      width: 26px;
      height: 26px;
      background: #eaf2ff;
      color: #2563eb;
    }
    .row-icon mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .row-copy { min-width: 0; display: grid; gap: 2px; }
    .row-copy strong,
    .row-copy small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row-copy strong { color: #0f172a; font-size: 10px; font-weight: 950; }
    .row-copy small { color: #475569; font-size: 9px; font-weight: 800; }
    .approval-badge {
      padding: 5px 7px;
      border-radius: 7px;
      font-size: 9px;
      font-weight: 950;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .approval-badge.aprobado {
      background: #dcfce7;
      color: #15803d;
    }
    .approval-badge.sin-aprobar {
      background: #fff7ed;
      color: #c2410c;
    }
    .approval-badge.compact { justify-self: end; }
    .chat-shell {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto auto;
      overflow: hidden;
    }
    .chat-head {
      min-height: 56px;
      align-items: center;
      padding: 11px 16px;
      border-bottom: 1px solid #dbe5f3;
      background: #ffffff;
    }
    .bot-title {
      min-width: 0;
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
    }
    .bot-icon {
      width: 38px;
      height: 38px;
      background: #0f172a;
      color: #ffffff;
      box-shadow: 0 10px 20px rgba(15, 23, 42, 0.15);
    }
    .bot-icon mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .bot-title h2 { color: #0f172a; font-size: 16px; }
    .bot-title p {
      overflow: hidden;
      max-width: 700px;
      color: #475569;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .refresh-btn {
      min-height: 34px;
      min-width: 112px;
      border-radius: 8px;
      background: #ffffff;
      font-size: 11px;
      font-weight: 950;
    }
    .refresh-btn mat-icon { margin-right: 5px; font-size: 18px; width: 18px; height: 18px; }
    .chat-actions {
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
      border-bottom: 1px solid #dbe5f3;
      background: #fbfdff;
    }
    .chat-actions button,
    .message-actions button {
      min-width: 104px;
      height: 30px;
      border-radius: 8px;
      font-size: 10px;
      font-weight: 950;
    }
    .chat-actions mat-icon,
    .message-actions mat-icon {
      margin-right: 5px;
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .pinned-case {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 240px;
      overflow: hidden;
      padding: 6px 10px;
      border-radius: 7px;
      background: #dcfce7;
      color: #15803d;
      font-size: 10px;
      font-weight: 950;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pinned-case mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .messages-panel {
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 24px;
      padding: 12px 16px 22px;
      background:
        linear-gradient(90deg, rgba(37, 99, 235, 0.025), rgba(255, 255, 255, 0) 23%, rgba(255, 255, 255, 0) 77%, rgba(37, 99, 235, 0.025)),
        #ffffff;
    }
    .message-line {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 10px;
      align-items: flex-start;
    }
    .message-line.user {
      grid-template-columns: minmax(0, 1fr) 28px;
    }
    .message-line.user .message-avatar {
      grid-column: 2;
      grid-row: 1;
      background: #eaf2ff;
      color: #2563eb;
    }
    .message-line.user .message-card {
      grid-column: 1;
      grid-row: 1;
      justify-self: end;
      max-width: min(340px, 44%);
      border-color: #9fc6ff;
      background: #f4f8ff;
    }
    .message-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #eaf2ff;
      color: #2563eb;
    }
    .message-avatar mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .message-card {
      width: fit-content;
      max-width: min(640px, 62%);
      padding: 11px 13px;
      border: 1px solid #dbe5f3;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.045);
    }
    .message-card header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }
    .message-card header strong { color: #0f172a; font-size: 10px; font-weight: 950; }
    .message-card header span { color: #64748b; font-size: 10px; font-weight: 800; white-space: nowrap; }
    .message-card p {
      margin: 0;
      color: #122033;
      font-size: 11px;
      line-height: 1.5;
      font-weight: 650;
      white-space: pre-line;
    }
    .missing-card {
      display: grid;
      gap: 10px;
      margin-top: 12px;
      padding: 11px;
      border: 1px solid #fed7aa;
      border-radius: 8px;
      background: #fff7ed;
    }
    .missing-card header {
      display: grid;
      grid-template-columns: 26px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      margin: 0;
    }
    .missing-card header mat-icon { color: #f97316; font-size: 20px; width: 20px; height: 20px; }
    .missing-card header strong { color: #7c2d12; font-size: 11px; font-weight: 950; }
    .missing-card header span { color: #9a3412; font-size: 10px; font-weight: 800; }
    .missing-list {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }
    .missing-list span {
      padding: 5px 8px;
      border: 1px solid #fdba74;
      border-radius: 999px;
      background: #ffffff;
      color: #9a3412;
      font-size: 10px;
      font-weight: 950;
    }
    .correction-card {
      display: grid;
      gap: 11px;
      margin-top: 12px;
      padding: 12px;
      border: 1px solid #c7d2fe;
      border-radius: 8px;
      background: #f8fbff;
    }
    .correction-card header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin: 0;
    }
    .correction-card header div {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .correction-card header span {
      color: #475569;
      font-size: 10px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .correction-card header strong {
      overflow: hidden;
      color: #0f172a;
      font-size: 12px;
      font-weight: 950;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .correction-card header em {
      flex: 0 0 auto;
      padding: 5px 8px;
      border-radius: 7px;
      font-size: 10px;
      font-style: normal;
      font-weight: 950;
      text-transform: uppercase;
    }
    .correction-card header em.ia { background: #dbeafe; color: #1d4ed8; }
    .correction-card header em.local { background: #f1f5f9; color: #334155; }
    .correction-main {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .correction-main article,
    .correction-data-list article,
    .correction-change-list article,
    .correction-section.ticket,
    .correction-section.regression {
      border: 1px solid #dbe5f3;
      border-radius: 7px;
      background: #ffffff;
    }
    .correction-main article {
      display: grid;
      gap: 5px;
      padding: 10px;
    }
    .correction-main span,
    .correction-section h4,
    .correction-data-list span,
    .correction-change-list span {
      color: #64748b;
      font-size: 10px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .correction-main strong {
      color: #0f172a;
      font-size: 11px;
      line-height: 1.35;
      font-weight: 850;
    }
    .correction-section {
      display: grid;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
    }
    .correction-section h4 {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0;
    }
    .correction-section h4 mat-icon {
      color: #2563eb;
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .correction-data-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
    }
    .correction-data-list article {
      display: grid;
      grid-template-columns: minmax(88px, 0.72fr) minmax(0, 1fr) auto;
      align-items: center;
      gap: 6px;
      padding: 8px;
    }
    .correction-data-list strong,
    .correction-change-list strong,
    .correction-section.ticket strong {
      min-width: 0;
      overflow: hidden;
      color: #0f172a;
      font-size: 10px;
      font-weight: 950;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .correction-data-list em,
    .correction-change-list em {
      padding: 3px 6px;
      border-radius: 999px;
      background: #eef2ff;
      color: #3730a3;
      font-size: 9px;
      font-style: normal;
      font-weight: 950;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .correction-data-list small {
      grid-column: 1 / -1;
      color: #475569;
      font-size: 10px;
      font-weight: 750;
      line-height: 1.35;
    }
    .correction-steps {
      display: grid;
      gap: 6px;
      margin: 0;
      padding-left: 18px;
      color: #334155;
      font-size: 11px;
      line-height: 1.4;
      font-weight: 750;
    }
    .correction-change-list {
      display: grid;
      gap: 7px;
    }
    .correction-change-list article {
      display: grid;
      grid-template-columns: minmax(88px, 0.5fr) auto auto;
      align-items: center;
      gap: 7px;
      padding: 8px;
    }
    .correction-change-list p,
    .correction-section.ticket p,
    .correction-section.regression span {
      grid-column: 1 / -1;
      margin: 0;
      color: #334155;
      font-size: 10px;
      line-height: 1.4;
      font-weight: 750;
      white-space: normal;
    }
    .correction-section.ticket,
    .correction-section.regression {
      padding: 9px;
    }
    .correction-section ul {
      display: grid;
      gap: 5px;
      margin: 0;
      padding-left: 17px;
      color: #334155;
      font-size: 10px;
      line-height: 1.35;
      font-weight: 750;
    }
    .correction-section.regression code {
      display: block;
      padding: 8px;
      border: 1px solid #dbeafe;
      border-radius: 7px;
      background: #eff6ff;
      color: #1e3a8a;
      font-size: 10px;
      font-weight: 850;
      line-height: 1.35;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .correction-card footer {
      display: grid;
      gap: 5px;
      padding-top: 9px;
      border-top: 1px solid #e2e8f0;
      color: #475569;
      font-size: 10px;
      line-height: 1.35;
      font-weight: 800;
    }
    .correction-card footer small {
      color: #92400e;
      font-size: 10px;
      font-weight: 850;
    }
    .plan-card {
      display: grid;
      gap: 10px;
      margin-top: 12px;
      padding: 12px;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      background: #f8fbff;
    }
    .plan-card header {
      margin: 0;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .plan-card header div { min-width: 0; display: grid; gap: 2px; }
    .plan-card header span {
      color: #64748b;
      font-size: 10px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .plan-card header strong {
      overflow: hidden;
      color: #0f172a;
      font-size: 12px;
      font-weight: 950;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .plan-card header em {
      flex: 0 0 auto;
      padding: 5px 8px;
      border-radius: 7px;
      font-size: 10px;
      font-style: normal;
      font-weight: 950;
      text-transform: uppercase;
    }
    .plan-card header em.recolectando { background: #ffedd5; color: #c2410c; }
    .plan-card header em.propuesto { background: #fef3c7; color: #92400e; }
    .plan-card header em.aprobado { background: #dbeafe; color: #1d4ed8; }
    .plan-card header em.ejecutando { background: #ede9fe; color: #6d28d9; }
    .plan-card header em.ok { background: #dcfce7; color: #15803d; }
    .plan-card header em.error { background: #fee2e2; color: #b91c1c; }
    .plan-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }
    .plan-meta span {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 24px;
      padding: 4px 7px;
      border: 1px solid #dbeafe;
      border-radius: 7px;
      background: #ffffff;
      color: #334155;
      font-size: 10px;
      font-weight: 900;
    }
    .plan-meta mat-icon {
      color: #2563eb;
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .plan-sections {
      display: grid;
      gap: 9px;
    }
    .plan-section {
      display: grid;
      gap: 8px;
      padding: 9px;
      border: 1px solid #dbeafe;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.78);
    }
    .plan-section h4 {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      color: #1e3a8a;
      font-size: 11px;
      font-weight: 950;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .plan-section h4 mat-icon {
      color: #2563eb;
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .plan-params {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
      margin: 0;
      padding: 0;
    }
    .plan-params div {
      display: grid;
      gap: 2px;
      padding: 7px;
      border: 1px solid #e2e8f0;
      border-radius: 7px;
      background: #ffffff;
    }
    .plan-params div.wide { grid-column: 1 / -1; }
    .plan-params dt {
      color: #64748b;
      font-size: 9px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .plan-params dd {
      margin: 0;
      overflow: hidden;
      color: #0f172a;
      font-size: 11px;
      font-weight: 900;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .plan-params dd.wrap {
      overflow: visible;
      line-height: 1.35;
      text-overflow: clip;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .plan-params .approval-control {
      gap: 5px;
    }
    .approval-value {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      overflow: visible;
      text-overflow: clip;
      white-space: normal;
    }
    .approval-value span {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 3px 7px;
      border-radius: 999px;
      background: #eef2ff;
      color: #3730a3;
      line-height: 1.2;
    }
    .resolved-list,
    .preconditions-list {
      display: grid;
      gap: 6px;
    }
    .resolved-list article {
      display: grid;
      grid-template-columns: minmax(96px, 0.48fr) minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
      padding: 7px;
      border: 1px solid #e2e8f0;
      border-radius: 7px;
      background: #ffffff;
    }
    .resolved-list span,
    .preconditions-list span {
      min-width: 0;
      overflow: hidden;
      color: #475569;
      font-size: 10px;
      font-weight: 950;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .resolved-list strong {
      min-width: 0;
      overflow: hidden;
      color: #0f172a;
      font-size: 10px;
      font-weight: 900;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .resolved-list em,
    .preconditions-list em,
    .steps-list em {
      padding: 3px 6px;
      border-radius: 999px;
      background: #eef2ff;
      color: #3730a3;
      font-style: normal;
      font-size: 9px;
      font-weight: 950;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .resolved-list em.confirm { background: #ffedd5; color: #c2410c; }
    .preconditions-list article {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
      padding: 7px;
      border: 1px solid #e2e8f0;
      border-radius: 7px;
      background: #ffffff;
    }
    .preconditions-list mat-icon {
      color: #16a34a;
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .steps-list {
      display: grid;
      gap: 6px;
      margin: 0;
      padding-left: 18px;
      color: #334155;
      font-size: 11px;
      line-height: 1.4;
      font-weight: 750;
    }
    .steps-list li { padding-left: 3px; }
    .steps-list li span { display: inline; }
    .steps-list em { margin-left: 6px; background: #ecfeff; color: #0e7490; }
    .steps-list em.danger { background: #fee2e2; color: #991b1b; }
    .approval-note {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 8px;
      border-radius: 7px;
      background: #ecfdf5;
      color: #047857;
      font-size: 11px;
      font-weight: 900;
    }
    .approval-note mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .message-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .message-actions button {
      min-width: 136px;
      background: #ffffff;
      color: #0f172a;
    }
    .typing {
      width: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 14px;
    }
    .typing span {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #2563eb;
      animation: typingPulse 900ms infinite ease-in-out;
    }
    .typing span:nth-child(2) { animation-delay: 120ms; }
    .typing span:nth-child(3) { animation-delay: 240ms; }
    .error-box {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 16px 8px;
      padding: 10px 12px;
      border: 1px solid #fecaca;
      border-radius: 8px;
      background: #fef2f2;
      color: #b91c1c;
      font-size: 12px;
      font-weight: 900;
    }
    .error-box mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .composer {
      min-height: 42px;
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr) 40px;
      align-items: center;
      gap: 7px;
      margin: 0 16px;
      padding: 4px 5px;
      border: 1px solid #d0deef;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
    }
    .composer button { border-radius: 8px; }
    .composer > button:first-child {
      width: 32px;
      height: 32px;
      color: #64748b;
    }
    .composer input {
      width: 100%;
      border: 0;
      outline: 0;
      color: #0f172a;
      font: inherit;
      font-size: 11px;
      font-weight: 750;
    }
    .send-btn {
      min-width: 40px;
      width: 40px;
      height: 34px;
      padding: 0;
    }
    .send-btn mat-icon { margin: 0; font-size: 20px; width: 20px; height: 20px; }
    .examples {
      margin: 6px 16px 9px;
      color: #64748b;
      font-size: 10px;
      font-weight: 750;
    }
    @keyframes typingPulse {
      0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-3px); }
    }
    @media (max-width: 1100px) {
      .qa-chat-page {
        height: auto;
        min-height: calc(100vh - 52px);
        grid-template-columns: 1fr;
        overflow: visible;
      }
      .context-card { max-height: none; }
      .cases-list { max-height: 360px; }
      .chat-shell { min-height: 660px; }
      .message-card,
      .message-line.user .message-card {
        max-width: min(760px, 88%);
      }
      .correction-data-list {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 680px) {
      .qa-chat-page { padding: 10px; }
      .summary-grid { grid-template-columns: 1fr; }
      .case-main { grid-template-columns: 36px minmax(0, 1fr); }
      .case-main .status-badge { grid-column: 2; justify-self: start; }
      .chat-head { align-items: stretch; flex-direction: column; }
      .bot-title p { white-space: normal; }
      .chat-actions { align-items: stretch; flex-direction: column; }
      .chat-actions button { width: 100%; }
      .pinned-case { width: 100%; max-width: none; margin-left: 0; }
      .message-line,
      .message-line.user { grid-template-columns: 32px minmax(0, 1fr); }
      .message-line.user .message-avatar { grid-column: 1; }
      .message-line.user .message-card { grid-column: 2; justify-self: start; }
      .message-card,
      .message-line.user .message-card { max-width: 100%; }
      .correction-main,
      .correction-data-list {
        grid-template-columns: 1fr;
      }
      .correction-data-list article,
      .correction-change-list article {
        grid-template-columns: 1fr;
      }
      .correction-data-list em,
      .correction-change-list em {
        justify-self: start;
      }
    }

    /* Diseño profesional Asistente QA */
    :host {
      --qa-page: #eef1f5;
      --qa-surface: #ffffff;
      --qa-surface-soft: #f8fafc;
      --qa-line: #d6dee9;
      --qa-line-strong: #bfccd9;
      --qa-ink: #111827;
      --qa-copy: #334155;
      --qa-muted: #64748b;
      --qa-primary: #3157d5;
      --qa-primary-soft: #e8efff;
      --qa-teal: #0f766e;
      --qa-teal-soft: #ccfbf1;
      --qa-green: #15803d;
      --qa-green-soft: #dcfce7;
      --qa-red: #b91c1c;
      --qa-red-soft: #fee2e2;
      --qa-amber: #b45309;
      --qa-amber-soft: #fef3c7;
      --qa-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
      display: block;
      color: var(--qa-ink);
      background: var(--qa-page);
    }
    .qa-chat-page {
      height: calc(100vh - 52px);
      grid-template-columns: 336px minmax(0, 1fr);
      gap: 16px;
      padding: 16px;
      background: var(--qa-page);
    }
    .context-card,
    .chat-shell {
      border: 1px solid var(--qa-line);
      border-radius: 8px;
      background: var(--qa-surface);
      box-shadow: var(--qa-shadow);
    }
    .context-card {
      gap: 14px;
      padding: 14px;
      background: var(--qa-surface-soft);
    }
    .context-head {
      align-items: center;
      padding-bottom: 11px;
      border-bottom: 1px solid var(--qa-line);
    }
    .context-head h2,
    .chat-head h2 {
      color: var(--qa-ink);
      font-size: 15px;
      line-height: 1.2;
      font-weight: 900;
    }
    .context-head p,
    .chat-head p {
      color: var(--qa-muted);
      font-size: 11px;
      font-weight: 650;
    }
    .context-head button {
      border: 1px solid var(--qa-line);
      background: var(--qa-surface);
      color: var(--qa-copy);
    }
    .summary-grid {
      gap: 8px;
    }
    .summary-tile {
      min-height: 76px;
      gap: 4px;
      padding: 10px;
      border-color: var(--qa-line);
      border-radius: 8px;
      background: var(--qa-surface);
      box-shadow: none;
    }
    .summary-tile.valid { border-top: 3px solid var(--qa-green); }
    .summary-tile.fail { border-top: 3px solid var(--qa-red); }
    .summary-tile.fixed { border-top: 3px solid var(--qa-primary); }
    .summary-tile strong {
      color: var(--qa-ink);
      font-size: 22px;
      font-weight: 900;
    }
    .summary-tile span,
    .section-label {
      color: var(--qa-copy);
      font-size: 11px;
      font-weight: 800;
    }
    .section-label {
      margin-bottom: 8px;
    }
    .section-label small {
      background: #e2e8f0;
      color: var(--qa-copy);
    }
    .selected-case {
      gap: 11px;
      padding: 12px;
      border: 1px solid var(--qa-line);
      border-left: 4px solid var(--qa-primary);
      border-radius: 8px;
      background: var(--qa-surface);
      box-shadow: none;
    }
    .case-file,
    .row-icon {
      border: 1px solid #c8d8ff;
      background: var(--qa-primary-soft);
      color: var(--qa-primary);
    }
    .case-main h3,
    .row-copy strong,
    .message-card header strong,
    .plan-card header strong,
    .correction-card header strong {
      color: var(--qa-ink);
      font-weight: 900;
    }
    .case-main p,
    .row-copy small,
    dt,
    .message-card header span {
      color: var(--qa-muted);
    }
    .status-badge,
    .approval-badge {
      border-radius: 999px;
      font-size: 9px;
      letter-spacing: 0;
    }
    .status-badge.valido,
    .approval-badge.aprobado {
      background: var(--qa-green-soft);
      color: var(--qa-green);
    }
    .status-badge.fallo {
      background: var(--qa-red-soft);
      color: var(--qa-red);
    }
    .status-badge.corriendo {
      background: var(--qa-primary-soft);
      color: var(--qa-primary);
    }
    .status-badge.pendiente,
    .approval-badge.sin-aprobar {
      background: var(--qa-amber-soft);
      color: var(--qa-amber);
    }
    .selected-plan,
    .case-search,
    .empty-state {
      border-color: var(--qa-line);
      border-radius: 8px;
      background: var(--qa-surface);
    }
    .case-search {
      height: 38px;
      padding-inline: 9px 4px;
    }
    .case-search input,
    .composer input {
      color: var(--qa-ink);
      font-size: 12px;
      font-weight: 650;
    }
    .case-search input::placeholder,
    .composer input::placeholder {
      color: #94a3b8;
    }
    .cases-list {
      gap: 7px;
      padding-right: 4px;
    }
    .case-row {
      min-height: 52px;
      padding: 8px;
      border: 1px solid var(--qa-line);
      border-radius: 8px;
      background: var(--qa-surface);
      transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
    }
    .case-row.active,
    .case-row:hover {
      border-color: #b8cdf5;
      background: var(--qa-primary-soft);
      box-shadow: inset 3px 0 0 var(--qa-primary);
    }
    .chat-shell {
      grid-template-rows: auto auto minmax(0, 1fr) auto auto;
      background: var(--qa-surface);
    }
    .chat-head {
      min-height: 72px;
      align-items: center;
      padding: 14px 18px;
      border-bottom: 1px solid #222b3a;
      background: #111827;
    }
    .bot-title {
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 12px;
    }
    .bot-icon {
      width: 44px;
      height: 44px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      background: #ffffff;
      color: #111827;
      box-shadow: none;
    }
    .bot-title h2 {
      margin: 0;
      color: #ffffff;
      font-size: 18px;
      font-weight: 900;
    }
    .bot-title p {
      max-width: 860px;
      color: #cbd5e1;
      font-size: 11px;
      font-weight: 650;
    }
    .refresh-btn {
      min-height: 34px;
      min-width: 118px;
      border-color: rgba(255, 255, 255, 0.24);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
      font-weight: 850;
    }
    .chat-actions {
      min-height: 52px;
      gap: 8px;
      padding: 9px 18px;
      border-bottom: 1px solid var(--qa-line);
      background: var(--qa-surface);
    }
    .chat-actions button,
    .message-actions button {
      height: 32px;
      min-width: 112px;
      border-color: var(--qa-line-strong);
      border-radius: 6px;
      color: var(--qa-copy);
      background: var(--qa-surface);
      font-size: 10px;
      font-weight: 850;
    }
    .chat-actions button[color='primary'] {
      background: var(--qa-primary);
      color: #ffffff;
    }
    .pinned-case {
      border: 1px solid #99f6e4;
      border-radius: 999px;
      background: var(--qa-teal-soft);
      color: var(--qa-teal);
    }
    .messages-panel {
      gap: 20px;
      padding: 18px 20px 24px;
      background: #f6f8fb;
    }
    .message-line {
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 11px;
    }
    .message-line.user {
      grid-template-columns: minmax(0, 1fr) 34px;
    }
    .message-avatar {
      width: 34px;
      height: 34px;
      border: 1px solid #c8d8ff;
      border-radius: 8px;
      background: var(--qa-primary-soft);
      color: var(--qa-primary);
    }
    .message-line.user .message-avatar {
      border-color: var(--qa-line);
      background: var(--qa-surface);
      color: var(--qa-copy);
    }
    .message-card,
    .message-line.user .message-card {
      width: auto;
      border: 1px solid var(--qa-line);
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .message-card {
      max-width: min(780px, 70%);
      padding: 12px 14px;
      border-left: 3px solid var(--qa-primary);
      background: var(--qa-surface);
    }
    .message-line.user .message-card {
      max-width: min(560px, 56%);
      border-left-width: 1px;
      border-color: #bfdbfe;
      background: var(--qa-primary-soft);
    }
    .message-card p {
      color: var(--qa-copy);
      font-size: 12px;
      line-height: 1.55;
      font-weight: 600;
    }
    .missing-card,
    .correction-card,
    .plan-card {
      border-radius: 8px;
      box-shadow: none;
    }
    .missing-card {
      border-color: #fed7aa;
      background: #fffbeb;
    }
    .correction-card {
      border-color: #c7d2fe;
      background: #f9fbff;
    }
    .plan-card {
      border-color: #bcd2f5;
      background: #f8fbff;
    }
    .correction-main article,
    .correction-data-list article,
    .correction-change-list article,
    .correction-section.ticket,
    .correction-section.regression,
    .plan-section,
    .plan-params div,
    .resolved-list article,
    .preconditions-list article {
      border-color: var(--qa-line);
      border-radius: 8px;
      background: var(--qa-surface);
    }
    .plan-section h4,
    .correction-section h4 {
      color: var(--qa-copy);
      font-size: 10px;
      font-weight: 900;
    }
    .plan-section h4 mat-icon,
    .correction-section h4 mat-icon,
    .plan-meta mat-icon {
      color: var(--qa-primary);
    }
    .plan-card header em.recolectando,
    .selected-plan-head em.recolectando {
      background: var(--qa-amber-soft);
      color: var(--qa-amber);
    }
    .plan-card header em.propuesto,
    .selected-plan-head em.propuesto {
      background: var(--qa-amber-soft);
      color: var(--qa-amber);
    }
    .plan-card header em.aprobado,
    .selected-plan-head em.aprobado {
      background: var(--qa-primary-soft);
      color: var(--qa-primary);
    }
    .plan-card header em.ok,
    .selected-plan-head em.ok {
      background: var(--qa-green-soft);
      color: var(--qa-green);
    }
    .plan-card header em.error,
    .selected-plan-head em.error {
      background: var(--qa-red-soft);
      color: var(--qa-red);
    }
    .plan-meta span,
    .approval-value span,
    .resolved-list em,
    .preconditions-list em,
    .steps-list em,
    .correction-data-list em,
    .correction-change-list em {
      border-radius: 999px;
      background: var(--qa-surface-soft);
      color: var(--qa-copy);
    }
    .approval-note {
      border: 1px solid #bbf7d0;
      border-radius: 8px;
      background: var(--qa-green-soft);
      color: var(--qa-green);
    }
    .error-box {
      border-color: #fecaca;
      border-radius: 8px;
      background: #fff1f2;
      color: var(--qa-red);
    }
    .composer {
      min-height: 48px;
      grid-template-columns: 36px minmax(0, 1fr) 42px;
      gap: 8px;
      margin: 12px 18px 0;
      padding: 5px;
      border: 1px solid var(--qa-line-strong);
      border-radius: 8px;
      background: var(--qa-surface);
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
    }
    .composer > button:first-child {
      width: 36px;
      height: 36px;
      color: var(--qa-muted);
    }
    .send-btn {
      min-width: 42px;
      width: 42px;
      height: 36px;
      background: var(--qa-primary);
      color: #ffffff;
    }
    .examples {
      margin: 7px 18px 12px;
      color: var(--qa-muted);
      font-size: 10px;
      font-weight: 650;
    }
    .cases-list::-webkit-scrollbar,
    .messages-panel::-webkit-scrollbar {
      width: 8px;
    }
    .cases-list::-webkit-scrollbar-thumb,
    .messages-panel::-webkit-scrollbar-thumb {
      border-radius: 999px;
      background: #cbd5e1;
    }
    @media (max-width: 1100px) {
      .qa-chat-page {
        grid-template-columns: 1fr;
        padding: 12px;
      }
      .message-card,
      .message-line.user .message-card {
        max-width: min(780px, 90%);
      }
    }
    @media (max-width: 680px) {
      .qa-chat-page {
        padding: 10px;
      }
      .chat-head,
      .chat-actions {
        padding-inline: 12px;
      }
      .messages-panel {
        padding: 14px 12px 18px;
      }
      .message-card,
      .message-line.user .message-card {
        max-width: 100%;
      }
      .composer {
        margin-inline: 12px;
      }
      .examples {
        margin-inline: 12px;
      }
    }

    /* Referencia visual: layout tipo mensajería operativa */
    :host {
      --ref-blue: #2f63e6;
      --ref-blue-soft: #edf4ff;
      --ref-ink: #111c3a;
      --ref-copy: #33456b;
      --ref-muted: #7182a6;
      --ref-line: #d9e3f2;
      --ref-bg: #ffffff;
      --ref-chat-bg: #fbfdff;
      --ref-green: #1f9d47;
      --ref-red: #d81928;
      --ref-yellow: #c27700;
      background: #ffffff;
    }
    .qa-chat-page {
      height: calc(100vh - 52px);
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 0;
      padding: 0;
      background: #ffffff;
    }
    .context-card {
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 16px;
      padding: 20px 18px 16px;
      border: 0;
      border-right: 1px solid var(--ref-line);
      border-radius: 0;
      background: #ffffff;
      box-shadow: none;
    }
    .context-head {
      display: block;
      padding: 0;
      border: 0;
    }
    .context-head h2 {
      margin: 0;
      color: var(--ref-ink);
      font-size: 14px;
      font-weight: 950;
      line-height: 1.2;
    }
    .summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 9px;
    }
    .summary-tile {
      min-height: 88px;
      align-content: start;
      gap: 3px;
      padding: 14px;
      border: 1px solid var(--ref-line);
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 8px 22px rgba(17, 28, 58, 0.04);
    }
    .summary-tile.valid { display: none; }
    .summary-tile.fixed,
    .summary-tile.fail {
      border-top: 1px solid var(--ref-line);
    }
    .summary-tile mat-icon {
      display: grid;
      place-items: center;
      width: 20px;
      height: 20px;
      margin-bottom: 5px;
      border-radius: 50%;
      color: #ffffff;
      font-size: 14px;
      line-height: 20px;
    }
    .summary-tile.fixed mat-icon { background: var(--ref-blue); }
    .summary-tile.fail mat-icon { background: var(--ref-red); }
    .summary-tile strong {
      color: var(--ref-ink);
      font-size: 28px;
      line-height: 1;
      font-weight: 950;
    }
    .summary-tile span {
      color: var(--ref-ink);
      font-size: 11px;
      font-weight: 900;
    }
    .cases-block {
      grid-template-rows: auto auto minmax(0, 1fr);
      min-height: 0;
    }
    .case-search {
      order: 0;
      height: 36px;
      grid-template-columns: 26px minmax(0, 1fr) 28px;
      gap: 6px;
      margin: 0 0 16px;
      padding: 0 8px 0 11px;
      border: 1px solid var(--ref-line);
      border-radius: 999px;
      background: #ffffff;
      box-shadow: 0 4px 12px rgba(17, 28, 58, 0.025);
    }
    .case-search mat-icon {
      color: var(--ref-muted);
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .case-search input {
      color: var(--ref-copy);
      font-size: 11px;
      font-weight: 700;
    }
    .case-search button {
      width: 28px;
      height: 28px;
      color: var(--ref-muted);
    }
    .section-label {
      order: 1;
      margin: 0 0 10px;
      color: var(--ref-copy);
      font-size: 10px;
      font-weight: 950;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .section-label small {
      min-width: 26px;
      padding: 4px 8px;
      border-radius: 999px;
      background: #eef3fb;
      color: var(--ref-copy);
      font-size: 10px;
      font-weight: 950;
    }
    .cases-list {
      order: 2;
      gap: 8px;
      padding: 0 4px 0 0;
    }
    .case-row {
      min-height: 74px;
      grid-template-columns: 34px minmax(0, 1fr) auto;
      gap: 10px;
      padding: 10px 11px;
      border: 1px solid transparent;
      border-radius: 9px;
      background: #ffffff;
      box-shadow: none;
    }
    .case-row.active,
    .case-row:hover {
      border-color: #c4d5ff;
      background: #f1f6ff;
      box-shadow: inset 3px 0 0 var(--ref-blue);
    }
    .row-icon {
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 8px;
      background: #e9f1ff;
      color: var(--ref-blue);
    }
    .row-icon mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .row-copy {
      gap: 3px;
      align-content: center;
    }
    .row-copy strong {
      color: var(--ref-ink);
      font-size: 12px;
      font-weight: 950;
    }
    .row-copy small {
      color: var(--ref-copy);
      font-size: 10px;
      line-height: 1.25;
      font-weight: 800;
    }
    .row-side {
      display: grid;
      justify-items: end;
      gap: 7px;
    }
    .row-side small {
      color: var(--ref-muted);
      font-size: 9px;
      font-weight: 850;
      white-space: nowrap;
    }
    .status-badge {
      padding: 5px 9px;
      border-radius: 999px;
      font-size: 9px;
      line-height: 1;
      font-weight: 950;
    }
    .status-badge.valido {
      background: #dff8e7;
      color: var(--ref-green);
    }
    .status-badge.fallo {
      background: #ffe4e8;
      color: var(--ref-red);
    }
    .status-badge.pendiente {
      background: #fff1d6;
      color: var(--ref-yellow);
    }
    .status-badge.corriendo {
      background: #e4eeff;
      color: var(--ref-blue);
    }
    .chat-shell {
      grid-template-rows: 70px minmax(0, 1fr) auto auto;
      border: 0;
      border-radius: 0;
      background: #ffffff;
      box-shadow: none;
    }
    .chat-head {
      min-height: 70px;
      align-items: center;
      padding: 0 20px 0 16px;
      border-bottom: 1px solid var(--ref-line);
      background: #ffffff;
    }
    .chat-case-title {
      min-width: 0;
      display: grid;
      grid-template-columns: 46px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
    }
    .chat-case-icon {
      display: grid;
      place-items: center;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: var(--ref-blue);
      color: #ffffff;
      box-shadow: 0 10px 24px rgba(47, 99, 230, 0.24);
    }
    .chat-case-icon mat-icon {
      font-size: 23px;
      width: 23px;
      height: 23px;
    }
    .chat-case-title h2 {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0;
      color: var(--ref-ink);
      font-size: 20px;
      line-height: 1.2;
      font-weight: 950;
      letter-spacing: 0;
    }
    .chat-case-title p {
      margin: 4px 0 0;
      overflow: hidden;
      color: var(--ref-muted);
      font-size: 11px;
      font-weight: 800;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat-case-title p span {
      margin: 0 7px;
      color: #9aa9c3;
    }
    .head-actions {
      display: inline-flex;
      align-items: center;
      gap: 12px;
    }
    .refresh-btn {
      min-height: 36px;
      min-width: 106px;
      border: 1px solid var(--ref-line);
      border-radius: 18px;
      background: #ffffff;
      color: var(--ref-blue);
      box-shadow: 0 8px 20px rgba(17, 28, 58, 0.04);
      font-size: 10px;
      font-weight: 950;
    }
    .refresh-btn mat-icon {
      color: var(--ref-blue);
    }
    .more-btn {
      width: 36px;
      height: 36px;
      border: 1px solid var(--ref-line);
      border-radius: 14px;
      background: #ffffff;
      color: var(--ref-muted);
      box-shadow: 0 8px 20px rgba(17, 28, 58, 0.04);
    }
    .chat-actions {
      display: none;
    }
    .messages-panel {
      position: relative;
      gap: 24px;
      padding: 20px 28px 28px;
      background-color: var(--ref-chat-bg);
      background-image:
        url("data:image/svg+xml,%3Csvg width='140' height='140' viewBox='0 0 140 140' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23dfe7f3' stroke-width='1.3' opacity='.36'%3E%3Cpath d='M24 28h22v28H24zM30 34h10M30 43h10M77 18l22 12-22 12-22-12zM55 78h30v22H55zM61 84h18M61 92h12M100 78a15 15 0 1 0 0 .1M30 104l18 18M48 104l-18 18'/%3E%3C/g%3E%3C/svg%3E");
      background-size: 170px 170px;
    }
    .message-line {
      grid-template-columns: 42px minmax(0, 1fr);
      gap: 14px;
      align-items: flex-start;
    }
    .message-line.user {
      grid-template-columns: minmax(0, 1fr) 42px;
    }
    .message-avatar {
      position: relative;
      width: 42px;
      height: 42px;
      border: 1px solid #cfe0ff;
      border-radius: 50%;
      background: #eaf2ff;
      color: var(--ref-blue);
      box-shadow: 0 8px 20px rgba(17, 28, 58, 0.08);
    }
    .message-line:not(.user) .message-avatar::after {
      content: "";
      position: absolute;
      right: 1px;
      bottom: 2px;
      width: 9px;
      height: 9px;
      border: 2px solid #ffffff;
      border-radius: 50%;
      background: #35c65a;
    }
    .message-avatar mat-icon {
      font-size: 23px;
      width: 23px;
      height: 23px;
    }
    .message-line.user .message-avatar {
      border-color: #dbe5f3;
      background: #ffffff;
      color: var(--ref-blue);
    }
    .message-card {
      width: min(680px, 100%);
      max-width: min(680px, 86%);
      padding: 17px 18px 15px;
      border: 1px solid var(--ref-line);
      border-left: 1px solid var(--ref-line);
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 10px 28px rgba(17, 28, 58, 0.045);
    }
    .message-line.user .message-card {
      justify-self: end;
      width: min(520px, 100%);
      max-width: min(520px, 72%);
      border-color: #cbdcff;
      background: #eef5ff;
    }
    .message-card header {
      margin-bottom: 12px;
    }
    .message-card header strong {
      color: var(--ref-blue);
      font-size: 11px;
      font-weight: 950;
    }
    .message-card header span {
      color: var(--ref-muted);
      font-size: 10px;
      font-weight: 750;
    }
    .message-card p {
      color: var(--ref-copy);
      font-size: 12px;
      line-height: 1.65;
      font-weight: 750;
    }
    .message-actions {
      gap: 12px;
      margin-top: 18px;
    }
    .message-actions button {
      min-width: 156px;
      height: 38px;
      border: 1px solid var(--ref-line);
      border-radius: 8px;
      background: #ffffff;
      color: var(--ref-blue);
      font-size: 11px;
      font-weight: 950;
      box-shadow: 0 4px 12px rgba(17, 28, 58, 0.025);
    }
    .message-actions mat-icon {
      color: var(--ref-blue);
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .missing-card,
    .correction-card,
    .plan-card {
      margin-top: 14px;
      border-radius: 10px;
      background: #ffffff;
    }
    .composer {
      min-height: 84px;
      grid-template-columns: 54px minmax(0, 1fr) 58px;
      gap: 12px;
      margin: 0 16px 0;
      padding: 14px 12px;
      border: 1px solid var(--ref-line);
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 -8px 30px rgba(17, 28, 58, 0.06);
    }
    .composer > button:first-child {
      width: 54px;
      height: 54px;
      border: 1px solid var(--ref-line);
      border-radius: 12px;
      color: var(--ref-blue);
      background: #ffffff;
    }
    .composer > button:first-child mat-icon {
      font-size: 26px;
      width: 26px;
      height: 26px;
    }
    .composer input {
      height: 54px;
      padding: 0 18px;
      border: 1px solid var(--ref-line);
      border-radius: 999px;
      color: var(--ref-copy);
      background: #ffffff;
      font-size: 12px;
      font-weight: 700;
    }
    .send-btn {
      min-width: 54px;
      width: 54px;
      height: 54px;
      border-radius: 50%;
      background: var(--ref-blue);
      color: #ffffff;
      box-shadow: 0 12px 24px rgba(47, 99, 230, 0.28);
    }
    .send-btn mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }
    .examples {
      margin: 7px 34px 12px;
      color: var(--ref-muted);
      font-size: 9px;
      font-weight: 750;
    }
    @media (max-width: 1100px) {
      .qa-chat-page {
        grid-template-columns: 1fr;
      }
      .context-card {
        border-right: 0;
        border-bottom: 1px solid var(--ref-line);
      }
      .chat-shell {
        min-height: 680px;
      }
      .message-card,
      .message-line.user .message-card {
        max-width: min(560px, 88%);
      }
    }
    @media (max-width: 680px) {
      .chat-head {
        min-height: auto;
        padding: 12px;
      }
      .chat-case-title {
        grid-template-columns: 40px minmax(0, 1fr);
      }
      .chat-case-icon {
        width: 40px;
        height: 40px;
      }
      .chat-case-title h2 {
        flex-wrap: wrap;
        font-size: 16px;
      }
      .messages-panel {
        padding: 16px 12px 18px;
      }
      .message-card,
      .message-line.user .message-card {
        max-width: 100%;
      }
      .composer {
        grid-template-columns: 44px minmax(0, 1fr) 48px;
        margin-inline: 10px;
        padding: 10px;
      }
      .composer > button:first-child,
      .send-btn {
        width: 44px;
        height: 44px;
        min-width: 44px;
      }
      .composer input {
        height: 44px;
        padding-inline: 12px;
      }
    }
  `],
})
export class QaAsistenteComponent implements OnInit, OnDestroy {
  contexto: ContextoAsistenteQa | null = null;
  casos: CasoAsistenteQa[] = [];
  casoSeleccionado = '';
  mensajes: MensajeChat[] = [];
  pregunta = '';
  busquedaCasos = '';
  cargando = false;
  enviando = false;
  error = '';

  private readonly planPollingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private api: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.cargarContexto();
  }

  ngOnDestroy(): void {
    for (const timer of this.planPollingTimers.values()) clearTimeout(timer);
    this.planPollingTimers.clear();
  }

  get casoActual(): CasoAsistenteQa | null {
    return this.casos.find((caso) => caso.id === this.casoSeleccionado) ?? null;
  }

  get casosFiltrados(): CasoAsistenteQa[] {
    const filtro = this.busquedaCasos.trim().toLowerCase();
    if (!filtro) return this.casos;
    return this.casos.filter((caso) => {
      return [
        caso.id,
        caso.dataset_codigo,
        caso.excel,
        caso.periodo,
        caso.legajo,
      ].some((valor) => String(valor ?? '').toLowerCase().includes(filtro));
    });
  }

  get casosValidos(): number {
    return this.contexto?.resumen.ejecuciones_verdes ?? 0;
  }

  get casosFallos(): number {
    return this.contexto?.resumen.ejecuciones_rojas ?? 0;
  }

  get casosCorregidos(): number {
    return 0;
  }

  get resumenTexto(): string {
    if (!this.contexto) return 'QA';
    return `${this.contexto.resumen.casos_activos} casos · ${this.contexto.resumen.datasets_validos} datasets`;
  }

  cargarContexto(): void {
    this.cargando = true;
    this.error = '';
    this.api.get<ContextoAsistenteQa>('/qa/asistente/contexto').subscribe({
      next: (contexto) => {
        this.contexto = contexto;
        this.casos = contexto.casos;
        this.cargando = false;
        if (!this.casoSeleccionado && this.casos.length > 0) this.casoSeleccionado = this.casos[0].id;
        if (this.casoSeleccionado && !this.casoActual) this.casoSeleccionado = this.casos[0]?.id ?? '';
        if (this.mensajes.length === 0) {
          this.agregarMensaje({
            id: 'ASIS-QA-BIENVENIDA',
            rol: 'assistant',
            generado_en: new Date().toISOString(),
            tipo: 'guia',
            texto: 'Hola. Ya cargué el contexto QA. Elegí un caso o preguntame directamente por un ID, por ejemplo: por qué falló QA-GAN-IMP-010.',
            acciones: [
              { tipo: 'preguntar', etiqueta: 'Resumen de casos', mensaje: 'Mostrame el resumen de casos QA activos.' },
              { tipo: 'preguntar', etiqueta: 'Importar datos', mensaje: 'Cómo importo datos masivos para QA.' },
            ],
            politica_registro: contexto.politica_registro,
          });
          this.agregarMensaje({
            id: 'ASIS-QA-PRESENTACION',
            rol: 'assistant',
            generado_en: new Date().toISOString(),
            tipo: 'guia',
            texto: '¡Hola! Soy tu Asistente QA.\n\nPuedo ayudarte a entender fallos, proponer correcciones y generar planes de ejecución.',
            acciones: [
              { tipo: 'preguntar', etiqueta: 'Resumen de casos', mensaje: 'Mostrame el resumen de casos QA activos.' },
              { tipo: 'preguntar', etiqueta: 'Importar datos', mensaje: 'Cómo importo datos masivos para QA.' },
            ],
            politica_registro: contexto.politica_registro,
          });
        }
      },
      error: (error) => {
        this.cargando = false;
        this.error = this.mensajeErrorApi(error, 'No pude cargar el contexto del asistente QA. Revisá que el backend esté levantado.');
      },
    });
  }

  seleccionarCaso(caso: CasoAsistenteQa): void {
    this.casoSeleccionado = caso.id;
    this.agregarMensajeLocal('assistant', `Contexto cargado. Hay ${this.casos.length} casos activos. El caso seleccionado es ${caso.id}.`);
  }

  preguntar(texto: string): void {
    if (this.enviando) return;
    this.pregunta = texto;
    this.enviar();
  }

  preguntarCaso(prefijo: string): void {
    if (!this.casoSeleccionado) return;
    this.preguntar(`${prefijo} ${this.casoSeleccionado}`);
  }

  enviar(): void {
    const texto = this.pregunta.trim();
    if (!texto || this.enviando) return;

    this.agregarMensajeLocal('user', texto);
    this.pregunta = '';
    this.enviando = true;
    this.error = '';

    this.api.post<RespuestaAsistenteQa>('/qa/asistente/mensajes', {
      mensaje: texto,
      caso_id: this.casoIdParaMensaje(texto),
    }).subscribe({
      next: (respuesta) => {
        this.enviando = false;
        this.agregarMensaje(respuesta);
      },
      error: (error) => {
        this.enviando = false;
        this.error = this.mensajeErrorApi(error, 'No pude responder la consulta del asistente QA.');
      },
    });
  }

  private casoIdParaMensaje(texto: string): string | undefined {
    const casoExplicito = texto.match(/\bQA-GAN-[A-Z0-9-]+\b/i)?.[0]?.toUpperCase();
    if (casoExplicito) return casoExplicito;

    const normalizado = this.normalizarTexto(texto);
    const esPreguntaGeneral =
      normalizado.includes('resumen') ||
      normalizado.includes('casos activos') ||
      normalizado.includes('importar datos') ||
      normalizado.includes('importo datos') ||
      normalizado.includes('datos masivos') ||
      normalizado.includes('dataset') ||
      normalizado.includes('datasets');

    return esPreguntaGeneral ? undefined : this.casoSeleccionado || undefined;
  }

  ejecutarAccion(accion: AccionAsistenteQa): void {
    if (accion.tipo === 'aprobar_plan') {
      this.aprobarPlan(accion);
      return;
    }
    if (accion.tipo === 'ejecutar_plan') {
      this.ejecutarPlan(accion);
      return;
    }
    if (accion.tipo === 'ver_evidencia') {
      this.agregarMensajeLocal('assistant', accion.mensaje ? `Evidencia registrada en:\n${accion.mensaje}` : 'La ejecución no tiene evidencia registrada.');
      return;
    }
    if (accion.tipo === 'navegar' && accion.ruta) {
      void this.router.navigateByUrl(accion.ruta);
      return;
    }
    if (accion.mensaje) this.preguntar(accion.mensaje);
  }

  abrirPantalla1(): void {
    void this.router.navigateByUrl('/qa/pantalla-1');
  }

  aprobarPlanDesdePanel(plan: PlanAsistenteQa): void {
    this.aprobarPlan({
      tipo: 'aprobar_plan',
      etiqueta: 'Aprobar plan',
      plan_id: plan.id,
      hash_plan: plan.hash_plan,
    });
  }

  aprobarPlan(accion: AccionAsistenteQa): void {
    if (!accion.plan_id || this.enviando) return;
    this.agregarMensajeLocal('user', `Apruebo el plan ${accion.plan_id} con hash ${this.hashCorto(accion.hash_plan || '')}.`);
    this.enviando = true;
    this.error = '';

    this.api.post<PlanAsistenteQa>(`/qa/asistente/planes/${encodeURIComponent(accion.plan_id)}/aprobar`, {
      hash_plan: accion.hash_plan,
    }).subscribe({
      next: (plan) => {
        this.enviando = false;
        this.actualizarPlanEnMensajes(plan);
        this.agregarMensaje({
          id: `ASIS-QA-APROBADO-${Date.now()}`,
          rol: 'assistant',
          generado_en: new Date().toISOString(),
          tipo: 'aprobacion',
          caso_id: plan.caso_id,
          texto: `Plan aprobado. La aprobación quedó registrada con usuario, fecha y hash. Ahora puede ejecutarse ${plan.modo === 'demo' ? 'en Demo' : 'en modo rápido'}.`,
          acciones: [
            {
              tipo: 'ejecutar_plan',
              etiqueta: plan.modo === 'demo' ? 'Ejecutar Demo' : 'Ejecutar Start',
              plan_id: plan.id,
              hash_plan: plan.hash_plan,
            },
          ],
          plan,
          politica_registro: this.contexto?.politica_registro || '',
        });
        this.cargarContexto();
      },
      error: (error) => {
        this.enviando = false;
        this.error = this.mensajeErrorApi(error, 'No pude aprobar el plan QA.');
      },
    });
  }

  ejecutarPlanDesdePanel(plan: PlanAsistenteQa): void {
    this.ejecutarPlan({
      tipo: 'ejecutar_plan',
      etiqueta: plan.modo === 'demo' ? 'Ejecutar Demo' : 'Ejecutar Start',
      plan_id: plan.id,
      hash_plan: plan.hash_plan,
    });
  }

  ejecutarPlan(accion: AccionAsistenteQa): void {
    if (!accion.plan_id || this.enviando) return;
    this.agregarMensajeLocal('user', `Ejecutar el plan aprobado ${accion.plan_id}.`);
    this.enviando = true;
    this.error = '';

    this.api.post<PlanAsistenteQa>(`/qa/asistente/planes/${encodeURIComponent(accion.plan_id)}/ejecutar`, {}).subscribe({
      next: (plan) => {
        this.enviando = false;
        this.actualizarPlanEnMensajes(plan);
        this.agregarMensaje({
          id: `ASIS-QA-EJECUCION-${Date.now()}`,
          rol: 'assistant',
          generado_en: new Date().toISOString(),
          tipo: 'ejecucion',
          caso_id: plan.caso_id,
          texto: `Ejecución iniciada desde plan aprobado. El plan quedó en estado ${this.estadoPlanTexto(plan.estado)} y se registró la ejecución ${plan.ejecucion_id || '-'}.`,
          acciones: [
            { tipo: 'preguntar', etiqueta: 'Diagnóstico', mensaje: `Por qué falló ${plan.caso_id}` },
            { tipo: 'navegar', etiqueta: 'Abrir Pantalla 1', ruta: '/qa/pantalla-1' },
          ],
          plan,
          politica_registro: this.contexto?.politica_registro || '',
        });
        this.cargarContexto();
        this.esperarCierrePlan(plan.id, 0);
      },
      error: (error) => {
        this.enviando = false;
        this.error = this.mensajeErrorApi(error, 'No pude ejecutar el plan QA.');
      },
    });
  }

  estadoBadgeClase(ejecucion: EjecucionAsistenteQa | null | undefined): string {
    if (!ejecucion) return 'pendiente';
    if (ejecucion.estado === 'verde') return 'valido';
    if (ejecucion.estado === 'rojo') return 'fallo';
    return 'corriendo';
  }

  estadoBadgeTexto(ejecucion: EjecucionAsistenteQa | null | undefined): string {
    if (!ejecucion) return 'Sin corregir';
    if (ejecucion.estado === 'verde') return 'Válido';
    if (ejecucion.estado === 'rojo') return 'Fallo';
    return 'Corriendo';
  }

  estadoAprobacionPlanClase(plan: PlanAsistenteQa | null | undefined): string {
    return this.planEstaAprobado(plan) ? 'aprobado' : 'sin-aprobar';
  }

  estadoAprobacionPlanTexto(plan: PlanAsistenteQa | null | undefined): string {
    return this.planEstaAprobado(plan) ? 'Plan aprobado' : 'Plan sin aprobar';
  }

  estadoPlanClase(estado: string): string {
    if (estado === 'recolectando') return 'recolectando';
    if (estado === 'plan_propuesto') return 'propuesto';
    if (estado === 'aprobado') return 'aprobado';
    if (estado === 'ejecutando') return 'ejecutando';
    if (estado === 'verificado') return 'ok';
    return 'error';
  }

  estadoPlanTexto(estado: string): string {
    const textos: Record<string, string> = {
      recolectando: 'Recolectando',
      plan_propuesto: 'Propuesto',
      aprobado: 'Aprobado',
      ejecutando: 'Ejecutando',
      verificado: 'Verificado',
      fallido: 'Fallido',
      abortado: 'Abortado',
      vencido: 'Vencido',
    };
    return textos[estado] ?? estado;
  }

  hashCorto(hash: string): string {
    return hash ? hash.slice(0, 12) : '-';
  }

  valorParametro(plan: PlanAsistenteQa, nombre: string): string {
    return this.texto(plan.parametros?.[nombre]) || '-';
  }

  valorPlan(plan: PlanAsistenteQa, nombre: string): string {
    const datosPlan = this.objeto(plan.plan);
    return this.texto(datosPlan[nombre]) || '-';
  }

  planTrabajoMensaje(mensaje: MensajeChat): PlanAsistenteQa | null {
    const plan = mensaje.plan;
    return plan && this.texto(plan.id) && this.texto(plan.hash_plan) ? plan : null;
  }

  parametrosPendientesMensaje(mensaje: MensajeChat): string[] {
    const pendientes = mensaje.plan?.parametros_pendientes;
    return Array.isArray(pendientes) ? pendientes.map((item) => this.texto(item)).filter(Boolean) : [];
  }

  correccionMensaje(mensaje: MensajeChat): CorreccionAsistidaQa | null {
    const correccion = mensaje.correccion;
    return correccion && this.texto(correccion.caso_id) ? correccion : null;
  }

  datosCorreccion(correccion: CorreccionAsistidaQa): Array<Record<string, unknown>> {
    return Array.isArray(correccion.datos_a_revisar) ? correccion.datos_a_revisar : [];
  }

  pasosCorreccion(correccion: CorreccionAsistidaQa): string[] {
    return Array.isArray(correccion.pasos) ? correccion.pasos.map((paso) => this.texto(paso)).filter(Boolean) : [];
  }

  cambiosCorreccion(correccion: CorreccionAsistidaQa): Array<Record<string, unknown>> {
    return Array.isArray(correccion.cambios_sugeridos) ? correccion.cambios_sugeridos : [];
  }

  ticketCorreccion(correccion: CorreccionAsistidaQa): Record<string, unknown> | null {
    const ticket = this.objeto(correccion.ticket_sugerido);
    return this.texto(ticket['asunto']) ? ticket : null;
  }

  criteriosCorreccion(correccion: CorreccionAsistidaQa): string[] {
    const ticket = this.objeto(correccion.ticket_sugerido);
    const criterios = ticket['criterios_aceptacion'];
    return Array.isArray(criterios) ? criterios.map((criterio) => this.texto(criterio)).filter(Boolean) : [];
  }

  pruebaCorreccion(correccion: CorreccionAsistidaQa): Record<string, unknown> | null {
    const prueba = this.objeto(correccion.prueba_regresion);
    return this.texto(prueba['comando']) ? prueba : null;
  }

  preguntasCorreccion(correccion: CorreccionAsistidaQa): string[] {
    return Array.isArray(correccion.preguntas_para_responsable)
      ? correccion.preguntas_para_responsable.map((pregunta) => this.texto(pregunta)).filter(Boolean)
      : [];
  }

  advertenciasCorreccion(correccion: CorreccionAsistidaQa): string[] {
    return Array.isArray(correccion.advertencias)
      ? correccion.advertencias.map((advertencia) => this.texto(advertencia)).filter(Boolean)
      : [];
  }

  tareaPlan(plan: PlanAsistenteQa): string {
    const datosPlan = this.objeto(plan.plan);
    const tarea = this.objeto(datosPlan['tarea']);
    return this.texto(tarea['nombre']) || this.valorPlan(plan, 'objetivo');
  }

  parametrosResueltosPlan(plan: PlanAsistenteQa): ParametroPlanVista[] {
    const datosPlan = this.objeto(plan.plan);
    const parametros = datosPlan['parametros_resueltos'];
    if (!Array.isArray(parametros)) return [];
    return parametros.map((parametro, index) => {
      const item = this.objeto(parametro);
      const nombre = this.texto(item['nombre']) || `parametro_${index + 1}`;
      return {
        id: `${nombre}-${index}`,
        nombre,
        valor: this.texto(item['valor_display']) || this.texto(item['valor']) || '-',
        origen: this.texto(item['origen']) || 'sin_origen',
        requiereConfirmacion: item['requiere_confirmacion'] === true,
      };
    });
  }

  precondicionesPlan(plan: PlanAsistenteQa): PrecondicionPlanVista[] {
    const datosPlan = this.objeto(plan.plan);
    const precondiciones = datosPlan['precondiciones'];
    if (!Array.isArray(precondiciones)) return [];
    return precondiciones.map((precondicion, index) => {
      const item = this.objeto(precondicion);
      const id = this.texto(item['codigo']) || `precondicion_${index + 1}`;
      return {
        id,
        texto: this.texto(item['texto']) || id,
        estado: this.texto(item['estado']) || 'pendiente',
        origen: this.texto(item['origen']) || 'leido',
      };
    });
  }

  requiereAprobacion(plan: PlanAsistenteQa): string {
    const datosPlan = this.objeto(plan.plan);
    return datosPlan['requiere_aprobacion'] === false ? 'No' : 'Sí';
  }

  gateAprobacion(plan: PlanAsistenteQa): string {
    const datosPlan = this.objeto(plan.plan);
    const gate = this.objeto(datosPlan['gate_aprobacion']);
    return this.texto(gate['tipo']) || 'confirmacion_simple';
  }

  pasosPlan(plan: PlanAsistenteQa): PasoPlanVista[] {
    const pasos = (plan.plan as { pasos?: unknown })?.pasos;
    if (!Array.isArray(pasos)) return [];
    return pasos.map((paso, index) => {
      if (typeof paso === 'string') {
        return {
          id: `${index}-${paso}`,
          orden: String(index + 1),
          descripcion: paso,
          escribe: false,
          irreversible: false,
        };
      }
      const item = this.objeto(paso);
      const descripcion = this.texto(item['descripcion']) || this.texto(item['texto']) || `Paso ${index + 1}`;
      return {
        id: `${this.texto(item['orden']) || index + 1}-${descripcion}`,
        orden: this.texto(item['orden']) || String(index + 1),
        descripcion,
        escribe: item['escribe'] === true,
        irreversible: item['irreversible'] === true,
      };
    });
  }

  estadoVerificacion(plan: PlanAsistenteQa): string {
    const verificacion = this.objeto(plan.verificacion);
    return this.texto(verificacion['estado']) || this.estadoPlanTexto(plan.estado);
  }

  evidenciaPlan(plan: PlanAsistenteQa): string {
    const verificacion = this.objeto(plan.verificacion);
    return this.texto(verificacion['evidencia_path']) || '-';
  }

  iconoAccion(accion: AccionAsistenteQa): string {
    if (accion.tipo === 'navegar') return 'open_in_new';
    if (accion.tipo === 'aprobar_plan') return 'verified_user';
    if (accion.tipo === 'ejecutar_plan') return 'play_arrow';
    if (accion.tipo === 'ver_evidencia') return 'receipt_long';
    return 'folder';
  }

  dataTestIdAccion(accion: AccionAsistenteQa): string {
    if (accion.tipo === 'aprobar_plan') return 'qa-chat-plan-approve-button';
    if (accion.tipo === 'ejecutar_plan') return 'qa-chat-plan-run-button';
    if (accion.tipo === 'ver_evidencia') return 'qa-chat-evidence-button';
    if (accion.tipo === 'navegar') return 'qa-chat-navigate-button';
    return `qa-chat-question-${this.slugTestId(accion.etiqueta || accion.mensaje || 'accion')}`;
  }

  fechaMensaje(valor: string): string {
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return '';
    return new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(fecha);
  }

  fechaCaso(caso: CasoAsistenteQa): string {
    const ejecucion = caso.ultima_ejecucion;
    const valor = ejecucion?.finalizado_en || ejecucion?.iniciado_en;
    return valor ? this.fechaMensaje(valor) : '';
  }

  trackByCaso(_index: number, caso: CasoAsistenteQa): string {
    return caso.id;
  }

  trackByMensaje(_index: number, mensaje: MensajeChat): string {
    return mensaje.id;
  }

  trackByAccion(index: number, accion: AccionAsistenteQa): string {
    return `${accion.tipo}-${accion.etiqueta}-${index}`;
  }

  trackByPendiente(_index: number, pendiente: string): string {
    return pendiente;
  }

  trackByTexto(_index: number, texto: string): string {
    return texto;
  }

  trackByDatoCorreccion(index: number, dato: Record<string, unknown>): string {
    return `${this.texto(dato['nombre'])}-${index}`;
  }

  trackByCambioCorreccion(index: number, cambio: Record<string, unknown>): string {
    return `${this.texto(cambio['area'])}-${this.texto(cambio['tipo'])}-${index}`;
  }

  trackByParametroPlan(_index: number, parametro: ParametroPlanVista): string {
    return parametro.id;
  }

  trackByPrecondicionPlan(_index: number, precondicion: PrecondicionPlanVista): string {
    return precondicion.id;
  }

  trackByPasoPlan(_index: number, paso: PasoPlanVista): string {
    return paso.id;
  }

  accionDeshabilitada(accion: AccionAsistenteQa): boolean {
    if (!accion.plan_id) return false;
    const plan = this.planActualPorId(accion.plan_id);
    if (!plan) return false;
    if (accion.tipo === 'aprobar_plan') return plan.estado !== 'plan_propuesto';
    if (accion.tipo === 'ejecutar_plan') return plan.estado !== 'aprobado';
    return false;
  }

  private actualizarPlanEnMensajes(plan: PlanAsistenteQa): void {
    this.mensajes = this.mensajes.map((mensaje) => {
      if (mensaje.plan?.id !== plan.id) return mensaje;
      return {
        ...mensaje,
        plan,
        acciones: this.accionesSegunPlanVista(plan),
      };
    });
  }

  private planActualPorId(planId: string): PlanAsistenteQa | null {
    for (let index = this.mensajes.length - 1; index >= 0; index--) {
      const plan = this.mensajes[index].plan;
      if (plan?.id === planId) return plan;
    }
    return null;
  }

  private accionesSegunPlanVista(plan: PlanAsistenteQa): AccionAsistenteQa[] {
    if (plan.estado === 'plan_propuesto') {
      return [
        { tipo: 'aprobar_plan', etiqueta: 'Aprobar plan', plan_id: plan.id, hash_plan: plan.hash_plan },
        { tipo: 'preguntar', etiqueta: 'Qué valida', mensaje: `Qué valida el dataset del caso ${plan.caso_id}` },
        { tipo: 'navegar', etiqueta: 'Abrir Pantalla 1', ruta: '/qa/pantalla-1' },
      ];
    }

    if (plan.estado === 'aprobado') {
      return [
        {
          tipo: 'ejecutar_plan',
          etiqueta: plan.modo === 'demo' ? 'Ejecutar Demo' : 'Ejecutar Start',
          plan_id: plan.id,
          hash_plan: plan.hash_plan,
        },
        { tipo: 'preguntar', etiqueta: 'Ver plan', mensaje: `Mostrame el plan ${plan.id}` },
      ];
    }

    return this.accionesCierrePlan(plan);
  }

  private planEstaAprobado(plan: PlanAsistenteQa | null | undefined): boolean {
    if (!plan) return false;
    return Boolean(plan.aprobacion) || ['aprobado', 'ejecutando', 'verificado', 'fallido'].includes(plan.estado);
  }

  private esperarCierrePlan(planId: string, intento: number): void {
    if (!planId || intento >= 36) return;
    const previo = this.planPollingTimers.get(planId);
    if (previo) clearTimeout(previo);

    const timer = setTimeout(() => {
      this.api.get<PlanAsistenteQa>(`/qa/asistente/planes/${encodeURIComponent(planId)}`).subscribe({
        next: (plan) => {
          if (!this.planEnEstadoFinal(plan)) {
            this.esperarCierrePlan(planId, intento + 1);
            return;
          }

          this.planPollingTimers.delete(planId);
          this.actualizarPlanEnMensajes(plan);
          this.agregarMensaje({
            id: `ASIS-QA-CIERRE-${Date.now()}`,
            rol: 'assistant',
            generado_en: new Date().toISOString(),
            tipo: 'ejecucion',
            caso_id: plan.caso_id,
            texto: this.textoCierrePlan(plan),
            acciones: this.accionesCierrePlan(plan),
            plan,
            politica_registro: this.contexto?.politica_registro || '',
          });
          this.cargarContexto();
        },
        error: () => {
          this.planPollingTimers.delete(planId);
        },
      });
    }, intento === 0 ? 4000 : 5000);

    this.planPollingTimers.set(planId, timer);
  }

  private planEnEstadoFinal(plan: PlanAsistenteQa): boolean {
    return ['verificado', 'fallido', 'abortado', 'vencido'].includes(plan.estado);
  }

  private textoCierrePlan(plan: PlanAsistenteQa): string {
    const evidencia = this.evidenciaPlan(plan);
    return [
      `La ejecución del plan ${plan.id} terminó en estado ${this.estadoPlanTexto(plan.estado)}.`,
      `Caso: ${plan.caso_id}.`,
      `Verificación: ${this.estadoVerificacion(plan)}.`,
      evidencia !== '-' ? `Evidencia: ${evidencia}.` : '',
      plan.abortado_motivo ? `Motivo: ${plan.abortado_motivo}.` : '',
    ].filter(Boolean).join('\n\n');
  }

  private accionesCierrePlan(plan: PlanAsistenteQa): AccionAsistenteQa[] {
    const acciones: AccionAsistenteQa[] = [
      { tipo: 'preguntar', etiqueta: 'Diagnóstico', mensaje: `Por qué falló ${plan.caso_id}` },
      { tipo: 'preguntar', etiqueta: 'Ver plan', mensaje: `Mostrame el plan ${plan.id}` },
    ];
    const evidencia = this.evidenciaPlan(plan);
    if (evidencia !== '-') acciones.unshift({ tipo: 'ver_evidencia', etiqueta: 'Ver evidencia', mensaje: evidencia });
    return acciones;
  }

  private agregarMensajeLocal(rol: RolMensaje, texto: string): void {
    this.agregarMensaje({
      id: `LOCAL-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      rol,
      texto,
      generado_en: new Date().toISOString(),
      acciones: [],
    });
  }

  private agregarMensaje(mensaje: RespuestaAsistenteQa | MensajeChat): void {
    this.mensajes = [
      ...this.mensajes,
      {
        id: mensaje.id,
        rol: mensaje.rol,
        texto: mensaje.texto,
        generado_en: mensaje.generado_en,
        acciones: mensaje.acciones ?? [],
        tipo: mensaje.tipo,
        caso_id: mensaje.caso_id,
        plan: mensaje.plan ?? null,
        correccion: mensaje.correccion ?? null,
      },
    ];
  }

  private mensajeErrorApi(error: unknown, fallback: string): string {
    const respuesta = this.objeto((error as { error?: unknown })['error']);
    const mensaje = this.texto(respuesta['message']);
    if (mensaje) return mensaje;
    return fallback;
  }

  private normalizarTexto(valor: string): string {
    return valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private slugTestId(valor: string): string {
    return this.normalizarTexto(valor).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'accion';
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? valor as Record<string, unknown>
      : {};
  }

  texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }
}
