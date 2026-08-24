import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, forkJoin, timer } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

type EstadoEsperado = 'validado' | 'observado' | 'pendiente';
type ModoQaEjecucion = 'rapido' | 'demo';
type EstadoQaEjecucion = 'corriendo' | 'verde' | 'rojo';
type CampoResultado =
  | 'calculo.retencion_excel'
  | 'calculo.retencion_calculada'
  | 'calculo.diferencia_retencion'
  | 'validaciones.V10_RETENCION.retencion_efectiva_esperada';

interface CasoQaForm {
  idCaso: string;
  datasetCodigo: string;
  periodo: string;
  descripcion: string;
  clienteNombre: string;
  modoSaldoFavor: string;
  empleado: {
    legajo: string;
    nombre: string;
    cuil: string;
  };
  liquidacion: {
    remuneracionBruta: number | null;
    deducciones: number | null;
  };
  resultado: {
    campo: CampoResultado;
    valorEsperado: number | null;
    tolerancia: number;
  };
  estadoEsperado: EstadoEsperado;
}

interface ArchivoExcelRef {
  nombre: string;
  size_bytes: number | null;
  mime: string;
  seleccionado_en: string;
}

interface DatasetQaRef {
  codigo: string;
  convenio: string;
  periodo: string;
  vigencia: Record<string, unknown>;
  validado_por: string;
  validado_en: string;
  fuente_normativa: Record<string, unknown>;
  estado: string;
}

interface AssertionQa {
  campo: string;
  operador: 'igual';
  esperado: unknown;
  tolerancia: number;
}

interface CasoQaPayload {
  id: string;
  dataset_codigo: string;
  dataset?: DatasetQaRef | null;
  periodo: string;
  descripcion: string;
  archivo: ArchivoExcelRef | null;
  contexto: {
    empleado: {
      legajo: string;
      nombre: string;
      cuil: string;
    };
    liquidacion: {
      remuneracion_bruta: number | null;
      deducciones: number | null;
    };
    contexto_complementario: Record<string, unknown>;
  };
  resultado_esperado: {
    campo: string;
    valor: unknown;
    tolerancia: number;
    estado: EstadoEsperado;
    retencion_ganancias?: number | null;
  };
  assertions: AssertionQa[];
  origen: {
    tipo: string;
    generado_en: string;
  };
  activo?: boolean;
}

interface CasoGuardadoLegacy {
  id: string;
  creadoEn: string;
  payload: Record<string, unknown>;
}

interface QaEjecucionPayload {
  id: string;
  caso_id: string;
  modo: ModoQaEjecucion;
  estado: EstadoQaEjecucion;
  iniciado_en: string;
  finalizado_en?: string;
  exit_code?: number | null;
  detalle?: string;
  evidencia_path?: string;
  resultado?: Record<string, unknown> | null;
  stdout_tail?: string;
  stderr_tail?: string;
}

@Component({
  selector: 'app-qa-pantalla-1',
  template: `
    <main class="qa-page">
      <section class="titulo-seccion">
        <div>
          <h1>
            <mat-icon>science</mat-icon>
            QA - Pantalla 1
          </h1>
          <p>Alta de casos para probar la auditoría de ganancias con Playwright.</p>
        </div>
        <span class="contador">{{ casos.length }} casos activos</span>
      </section>

      <section class="qa-grid">
        <mat-card class="panel form-panel">
          <div class="panel-header">
            <div>
              <h2>Caso de prueba</h2>
              <p>Asociá dataset, Excel, datos de ejecución y resultado esperado.</p>
            </div>
            <span class="tag">MongoDB</span>
          </div>

          <div class="form-grid">
            <label class="field">
              <span>ID caso</span>
              <input [(ngModel)]="form.idCaso" name="idCaso" placeholder="QA-GAN-RET-001">
            </label>

            <label class="field">
              <span>Código dataset</span>
              <select
                [(ngModel)]="form.datasetCodigo"
                name="datasetCodigo"
                [disabled]="cargandoDatasets || datasets.length === 0"
                (ngModelChange)="aplicarDatasetSeleccionado($event)"
              >
                <option value="">{{ cargandoDatasets ? 'Cargando datasets...' : 'Seleccioná dataset' }}</option>
                <option *ngFor="let dataset of datasets; trackBy: trackByDataset" [ngValue]="dataset.codigo">
                  {{ dataset.codigo }} · {{ dataset.periodo }} · {{ dataset.convenio }}
                </option>
              </select>
              <small *ngIf="datasetSeleccionado" class="field-help">
                {{ datasetFuenteNormativa }}
              </small>
            </label>

            <label class="field">
              <span>Período</span>
              <input [(ngModel)]="form.periodo" name="periodo" placeholder="06/2026" [readonly]="!!datasetSeleccionado">
            </label>

            <label class="field">
              <span>Cliente</span>
              <input [(ngModel)]="form.clienteNombre" name="clienteNombre" placeholder="NETSER S.A.">
            </label>

            <label class="field">
              <span>Modo saldo favor</span>
              <select [(ngModel)]="form.modoSaldoFavor" name="modoSaldoFavor">
                <option value="">Usar dato del Excel</option>
                <option value="compensar">Compensar</option>
                <option value="devolver">Devolver</option>
                <option value="saldo_para_siradig">Saldo para SIRADIG</option>
              </select>
            </label>

            <label class="field field-wide">
              <span>Descripción</span>
              <input [(ngModel)]="form.descripcion" name="descripcion" placeholder="Validar retención de ganancias del legajo">
            </label>

            <label class="field">
              <span>Legajo</span>
              <input [(ngModel)]="form.empleado.legajo" name="legajo" placeholder="6">
            </label>

            <label class="field">
              <span>Empleado</span>
              <input [(ngModel)]="form.empleado.nombre" name="empleadoNombre" placeholder="Apellido y nombre">
            </label>

            <label class="field">
              <span>CUIL</span>
              <input [(ngModel)]="form.empleado.cuil" name="cuil" placeholder="20-00000000-0">
            </label>

            <label class="field">
              <span>Remuneración bruta</span>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.liquidacion.remuneracionBruta" name="remuneracionBruta" placeholder="0.00">
            </label>

            <label class="field">
              <span>Deducciones</span>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.liquidacion.deducciones" name="deducciones" placeholder="0.00">
            </label>

            <label class="field">
              <span>Estado esperado</span>
              <select [(ngModel)]="form.estadoEsperado" name="estadoEsperado">
                <option *ngFor="let estado of estados" [ngValue]="estado.valor">{{ estado.texto }}</option>
              </select>
            </label>

            <label class="field field-wide">
              <span>Campo a validar</span>
              <select [(ngModel)]="form.resultado.campo" name="campoResultado">
                <option *ngFor="let campo of camposResultado" [ngValue]="campo.valor">{{ campo.texto }}</option>
              </select>
            </label>

            <label class="field">
              <span>Valor esperado</span>
              <input type="number" step="0.01" [(ngModel)]="form.resultado.valorEsperado" name="valorEsperado" placeholder="0.00">
            </label>

            <label class="field">
              <span>Tolerancia</span>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.resultado.tolerancia" name="tolerancia" placeholder="0.05">
            </label>
          </div>

          <div class="excel-box">
            <input #excelInput hidden type="file" accept=".xlsx,.xls" (change)="seleccionarExcel($event)">
            <button mat-stroked-button color="primary" type="button" class="excel-btn" (click)="excelInput.click()">
              <mat-icon>attach_file</mat-icon>
              Agregar Excel
            </button>

            <ng-container *ngIf="archivoExcel; else sinExcel">
              <div class="archivo-ref">
                <mat-icon>description</mat-icon>
                <div>
                  <strong>{{ archivoExcel.nombre }}</strong>
                  <span>{{ (archivoExcel.size_bytes || 0) / 1024 | number:'1.0-1' }} KB</span>
                </div>
                <button mat-icon-button type="button" title="Quitar Excel" (click)="quitarExcel()">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            </ng-container>

            <ng-template #sinExcel>
              <p class="ayuda-excel">El Excel no se copia al repositorio; el caso guarda solo la referencia del archivo.</p>
            </ng-template>
          </div>

          <div *ngIf="mensaje" class="mensaje" [class.error]="mensajeError">{{ mensaje }}</div>

          <div class="acciones">
            <button mat-stroked-button type="button" (click)="cargarEjemplo()">
              <mat-icon>auto_fix_high</mat-icon>
              Ejemplo
            </button>
            <button mat-stroked-button type="button" (click)="nuevoLimpio()">
              <mat-icon>refresh</mat-icon>
              Nuevo limpio
            </button>
            <button mat-flat-button color="primary" type="button" [disabled]="guardando" (click)="guardarCaso()">
              <mat-icon>{{ guardando ? 'hourglass_top' : 'save' }}</mat-icon>
              {{ guardando ? 'Guardando...' : 'Guardar caso' }}
            </button>
          </div>
        </mat-card>

        <mat-card class="panel preview-panel">
          <div class="panel-header">
            <div>
              <h2>Vista previa</h2>
              <p>JSON que va a consumir Playwright.</p>
            </div>
            <mat-icon>data_object</mat-icon>
          </div>
          <pre>{{ previewJson }}</pre>
        </mat-card>
      </section>

      <mat-card class="panel casos-panel">
        <div class="panel-header">
          <div>
            <h2>Operación QA</h2>
            <p>Casos activos, ejecución Playwright y resultado de la última corrida.</p>
          </div>
          <button
            mat-stroked-button
            type="button"
            class="refresh-btn"
            [disabled]="cargandoCasos || cargandoEjecuciones"
            (click)="refrescarOperacion()">
            <mat-icon>refresh</mat-icon>
            Actualizar
          </button>
          <button
            mat-stroked-button
            type="button"
            class="negative-test-btn"
            [disabled]="probandoValidacion || datasets.length === 0"
            (click)="probarBloqueoPeriodoDataset()">
            <mat-icon>{{ probandoValidacion ? 'hourglass_top' : 'report_problem' }}</mat-icon>
            Probar error dataset
          </button>
        </div>

        <div *ngIf="!cargandoCasos && casos.length === 0" class="empty-state">
          <mat-icon>inventory_2</mat-icon>
          <span>Sin casos guardados todavía.</span>
        </div>

        <div *ngIf="casos.length > 0" class="casos-table">
          <div class="casos-head">
            <span>Caso</span>
            <span>Dataset</span>
            <span>Excel</span>
            <span>Última corrida</span>
            <span>Resultado</span>
            <span>Acciones</span>
          </div>

          <div *ngFor="let caso of casos; trackBy: trackByCaso" class="caso-row">
            <button type="button" class="caso-main" (click)="cargarCaso(caso)">
              <mat-icon>assignment</mat-icon>
              <span>
                <strong>{{ caso.id }}</strong>
                <small>{{ caso.periodo || 'Sin período' }} · Legajo {{ legajoCaso(caso) }}</small>
              </span>
            </button>

            <span class="cell-text">{{ caso.dataset_codigo || 'Sin dataset' }}</span>
            <span class="cell-text">{{ nombreExcel(caso) }}</span>
            <span class="cell-text">{{ fechaEjecucion(ultimaEjecucion(caso.id)) }}</span>
            <span class="resultado-pill" [ngClass]="estadoClase(ultimaEjecucion(caso.id))">
              {{ estadoTexto(ultimaEjecucion(caso.id)) }}
            </span>

            <div class="acciones-tabla">
              <button
                mat-stroked-button
                type="button"
                class="run-btn"
                matTooltip="Ejecutar rápido"
                [disabled]="casoBloqueado(caso.id)"
                (click)="ejecutarCaso(caso, 'rapido')">
                <mat-icon>{{ casoBloqueado(caso.id) ? 'hourglass_top' : 'play_arrow' }}</mat-icon>
                Start
              </button>

              <button
                mat-stroked-button
                type="button"
                class="run-btn demo"
                matTooltip="Ver demo lento"
                [disabled]="casoBloqueado(caso.id)"
                (click)="ejecutarCaso(caso, 'demo')">
                <mat-icon>slideshow</mat-icon>
                Demo
              </button>

              <button
                mat-icon-button
                type="button"
                matTooltip="Ver resultado"
                [disabled]="!ultimaEjecucion(caso.id)"
                (click)="verEjecucion(caso.id)">
                <mat-icon>receipt_long</mat-icon>
              </button>

              <button mat-icon-button type="button" matTooltip="Eliminar caso" (click)="eliminarCaso(caso.id)">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          </div>
        </div>

        <div *ngIf="ejecucionSeleccionada" class="ejecucion-detalle" [ngClass]="estadoClase(ejecucionSeleccionada)">
          <div>
            <span class="detalle-label">Ejecución</span>
            <strong>{{ ejecucionSeleccionada.id }}</strong>
          </div>
          <div>
            <span class="detalle-label">Caso</span>
            <strong>{{ ejecucionSeleccionada.caso_id }}</strong>
          </div>
          <div>
            <span class="detalle-label">Modo</span>
            <strong>{{ modoTexto(ejecucionSeleccionada.modo) }}</strong>
          </div>
          <div>
            <span class="detalle-label">Detalle</span>
            <strong>{{ ejecucionSeleccionada.detalle || estadoTexto(ejecucionSeleccionada) }}</strong>
          </div>
          <div *ngIf="ejecucionSeleccionada.evidencia_path" class="detalle-wide">
            <span class="detalle-label">Evidencia</span>
            <code>{{ ejecucionSeleccionada.evidencia_path }}</code>
          </div>
        </div>
      </mat-card>
    </main>
  `,
  styles: [`
    :host { display: block; }
    .qa-page { padding: 24px; display: grid; gap: 16px; }
    .titulo-seccion { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
    .titulo-seccion h1 { display: flex; align-items: center; gap: 10px; margin: 0; color: #0f172a; font-size: 24px; line-height: 1.2; font-weight: 950; }
    .titulo-seccion h1 mat-icon { color: #2563eb; }
    .titulo-seccion p { margin: 6px 0 0 34px; color: #64748b; font-size: 13px; }
    .contador { padding: 7px 10px; border-radius: 999px; background: #eff6ff; color: #2563eb; font-size: 12px; font-weight: 900; white-space: nowrap; }
    .qa-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr); gap: 16px; align-items: start; }
    .panel { border: 1px solid #dce7f7; border-radius: 12px; background: #ffffff; box-shadow: 0 12px 34px rgba(15, 23, 42, 0.06); }
    .form-panel, .preview-panel, .casos-panel { padding: 16px; }
    .panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .panel-header h2 { margin: 0; color: #0f172a; font-size: 16px; font-weight: 950; }
    .panel-header p { margin: 4px 0 0; color: #64748b; font-size: 12px; }
    .panel-header mat-icon { color: #2563eb; }
    .tag, .estado-carga { padding: 5px 9px; border-radius: 999px; background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 900; white-space: nowrap; }
    .estado-carga { background: #eff6ff; color: #2563eb; }
    .form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .field { display: grid; gap: 5px; min-width: 0; }
    .field-wide { grid-column: span 2; }
    .field span { color: #475569; font-size: 11px; font-weight: 900; }
    .field input, .field select { width: 100%; min-width: 0; height: 38px; padding: 0 10px; border: 1px solid #cbd7ea; border-radius: 8px; outline: 0; background: #ffffff; color: #0f172a; font: inherit; font-size: 12px; font-weight: 750; box-sizing: border-box; }
    .field input[readonly] { background: #f1f5f9; color: #334155; }
    .field input:focus, .field select:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12); }
    .field-help { min-height: 14px; overflow: hidden; color: #64748b; font-size: 10px; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
    .excel-box { display: flex; align-items: center; gap: 12px; margin-top: 14px; padding: 12px; border: 1px dashed #bad2ff; border-radius: 10px; background: #f8fbff; }
    .excel-btn { height: 38px; border-radius: 8px; font-weight: 900; white-space: nowrap; }
    .excel-btn mat-icon { margin-right: 6px; }
    .archivo-ref { min-width: 0; flex: 1; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid #dce7f7; border-radius: 9px; background: #ffffff; }
    .archivo-ref > mat-icon { color: #16a34a; flex: 0 0 auto; }
    .archivo-ref div { min-width: 0; flex: 1; display: grid; gap: 2px; }
    .archivo-ref strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #0f172a; font-size: 12px; font-weight: 900; }
    .archivo-ref span, .ayuda-excel { margin: 0; color: #64748b; font-size: 12px; line-height: 1.35; }
    .mensaje { margin-top: 12px; padding: 10px 12px; border: 1px solid #bbf7d0; border-radius: 10px; background: #f0fdf4; color: #166534; font-size: 12px; font-weight: 800; }
    .mensaje.error { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
    .acciones { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
    .acciones button { height: 38px; border-radius: 8px; font-weight: 900; }
    .acciones mat-icon { margin-right: 6px; }
    .preview-panel pre { max-height: 560px; min-height: 432px; overflow: auto; margin: 0; padding: 14px; border-radius: 10px; background: #111827; color: #e5edff; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
    .casos-panel { display: grid; gap: 10px; overflow: hidden; }
    .empty-state { display: flex; align-items: center; gap: 8px; padding: 14px; border: 1px dashed #cbd7ea; border-radius: 10px; color: #64748b; font-size: 13px; font-weight: 800; }
    .refresh-btn, .negative-test-btn { height: 36px; border-radius: 8px; font-size: 12px; font-weight: 900; }
    .refresh-btn mat-icon, .negative-test-btn mat-icon { margin-right: 6px; }
    .negative-test-btn { color: #b45309; border-color: #fcd34d; }
    .casos-table { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; }
    .casos-head, .caso-row { display: grid; grid-template-columns: minmax(220px, 1.2fr) minmax(180px, 0.9fr) minmax(210px, 1fr) minmax(145px, 0.7fr) 112px 250px; align-items: center; min-width: 1120px; }
    .casos-head { min-height: 38px; padding: 0 12px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; color: #475569; font-size: 11px; font-weight: 950; text-transform: uppercase; }
    .caso-row { min-height: 64px; padding: 8px 12px; gap: 0; border-bottom: 1px solid #eef2f7; background: #ffffff; }
    .caso-row:last-child { border-bottom: 0; }
    .caso-main { min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; padding: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .caso-main mat-icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 9px; background: #eff6ff; color: #2563eb; font-size: 20px; flex: 0 0 auto; }
    .caso-main span { min-width: 0; display: grid; gap: 2px; }
    .caso-main strong, .caso-main small, .cell-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .caso-main strong { color: #0f172a; font-size: 13px; font-weight: 950; }
    .caso-main small { color: #64748b; font-size: 11px; font-weight: 800; }
    .cell-text { min-width: 0; padding-right: 12px; color: #334155; font-size: 12px; font-weight: 850; }
    .resultado-pill { justify-self: start; min-width: 86px; height: 28px; display: inline-grid; place-items: center; padding: 0 10px; border-radius: 999px; font-size: 11px; font-weight: 950; text-transform: uppercase; }
    .resultado-pill.sin-correr { background: #f1f5f9; color: #64748b; }
    .resultado-pill.corriendo { background: #eff6ff; color: #1d4ed8; }
    .resultado-pill.verde { background: #dcfce7; color: #166534; }
    .resultado-pill.rojo { background: #fee2e2; color: #991b1b; }
    .acciones-tabla { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
    .run-btn { height: 34px; min-width: 74px; padding: 0 10px; border-radius: 8px; font-size: 12px; font-weight: 950; }
    .run-btn mat-icon { margin-right: 4px; font-size: 18px; width: 18px; height: 18px; }
    .run-btn.demo { color: #4338ca; border-color: #c7d2fe; }
    .ejecucion-detalle { display: grid; grid-template-columns: minmax(150px, 0.65fr) minmax(150px, 0.65fr) minmax(120px, 0.4fr) minmax(260px, 1.3fr); gap: 10px; padding: 12px; border-radius: 10px; border: 1px solid #e2e8f0; background: #f8fafc; }
    .ejecucion-detalle.verde { border-color: #bbf7d0; background: #f0fdf4; }
    .ejecucion-detalle.rojo { border-color: #fecaca; background: #fff7f7; }
    .ejecucion-detalle.corriendo { border-color: #bfdbfe; background: #eff6ff; }
    .detalle-label { display: block; margin-bottom: 4px; color: #64748b; font-size: 10px; font-weight: 950; text-transform: uppercase; }
    .ejecucion-detalle strong, .ejecucion-detalle code { color: #0f172a; font-size: 12px; font-weight: 900; overflow-wrap: anywhere; }
    .detalle-wide { grid-column: 1 / -1; }
    @media (max-width: 1120px) {
      .qa-grid { grid-template-columns: 1fr; }
      .preview-panel pre { min-height: 260px; }
      .ejecucion-detalle { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 720px) {
      .qa-page { padding: 16px 12px 24px; }
      .titulo-seccion { align-items: flex-start; flex-direction: column; }
      .titulo-seccion p { margin-left: 0; }
      .form-grid { grid-template-columns: 1fr; }
      .field-wide { grid-column: auto; }
      .excel-box, .acciones { align-items: stretch; flex-direction: column; }
      .panel-header { flex-direction: column; }
      .refresh-btn, .negative-test-btn { width: 100%; }
      .ejecucion-detalle { grid-template-columns: 1fr; }
    }
  `]
})
export class QaPantalla1Component implements OnInit, OnDestroy {
  readonly estados: { valor: EstadoEsperado; texto: string }[] = [
    { valor: 'validado', texto: 'Validado' },
    { valor: 'observado', texto: 'Observado' },
    { valor: 'pendiente', texto: 'Pendiente' },
  ];

  readonly camposResultado: { valor: CampoResultado; texto: string }[] = [
    { valor: 'calculo.retencion_excel', texto: 'Retención informada/liquidada' },
    { valor: 'calculo.retencion_calculada', texto: 'Retención calculada por motor' },
    { valor: 'validaciones.V10_RETENCION.retencion_efectiva_esperada', texto: 'V10 retención efectiva esperada' },
    { valor: 'calculo.diferencia_retencion', texto: 'Diferencia de retención' },
  ];

  form: CasoQaForm = this.crearForm();
  archivoExcel: ArchivoExcelRef | null = null;
  datasets: DatasetQaRef[] = [];
  casos: CasoQaPayload[] = [];
  ejecucionesPorCaso = new Map<string, QaEjecucionPayload>();
  ejecucionSeleccionada: QaEjecucionPayload | null = null;
  mensaje = '';
  mensajeError = false;
  cargandoDatasets = false;
  cargandoCasos = false;
  cargandoEjecuciones = false;
  guardando = false;
  probandoValidacion = false;

  private readonly storageKeyLegacy = 'auditoria-ganancias.qa.casos';
  private readonly casosEjecutando = new Set<string>();
  private polling?: Subscription;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.cargarDatasets();
    this.cargarCasos(true);
    this.cargarEjecuciones();
    this.polling = timer(5000, 5000).subscribe(() => {
      if (this.hayEjecucionesCorriendo()) this.cargarEjecuciones(false);
    });
  }

  ngOnDestroy(): void {
    this.polling?.unsubscribe();
  }

  get datasetSeleccionado(): DatasetQaRef | null {
    return this.datasets.find((dataset) => dataset.codigo === this.form.datasetCodigo) ?? null;
  }

  get datasetFuenteNormativa(): string {
    return this.texto(this.datasetSeleccionado?.fuente_normativa?.['ref']) || 'Sin fuente normativa';
  }

  get previewJson(): string {
    return JSON.stringify(this.construirPayload(), null, 2);
  }

  aplicarDatasetSeleccionado(codigo: string): void {
    const dataset = this.datasets.find((item) => item.codigo === codigo);
    if (!dataset) return;
    this.form.periodo = dataset.periodo;
    this.mostrarMensaje(`Dataset conectado: ${dataset.codigo}. Período tomado del dataset.`);
  }

  seleccionarExcel(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (!file) return;

    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      this.mostrarMensaje('Seleccioná un archivo Excel válido (.xlsx o .xls).', true);
      input.value = '';
      return;
    }

    this.archivoExcel = {
      nombre: file.name,
      size_bytes: file.size,
      mime: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      seleccionado_en: new Date().toISOString(),
    };
    this.mostrarMensaje('Excel agregado como referencia del caso.');
    input.value = '';
  }

  quitarExcel(): void {
    this.archivoExcel = null;
    this.mostrarMensaje('Referencia de Excel quitada.');
  }

  guardarCaso(): void {
    const payload = this.construirPayload();
    this.guardando = true;

    this.api.post<CasoQaPayload>('/qa/casos', payload).subscribe({
      next: (caso) => {
        this.guardando = false;
        this.upsertCaso(caso);
        this.cargarEjecuciones(false);
        this.mostrarMensaje('Caso guardado en MongoDB para Playwright.');
      },
      error: (error) => {
        this.guardando = false;
        this.mostrarMensaje(this.mensajeErrorApi(error, 'No se pudo guardar el caso. Revisá dataset, período y backend.'), true);
      },
    });
  }

  nuevoLimpio(): void {
    this.form = this.crearForm();
    this.archivoExcel = null;
    this.mensaje = '';
    this.mensajeError = false;
  }

  cargarEjemplo(): void {
    const periodo = '06/2026';
    const dataset = this.datasetParaPeriodo(periodo);
    this.form = {
      idCaso: 'QA-GAN-RET-001',
      datasetCodigo: dataset?.codigo ?? '',
      periodo: dataset?.periodo ?? periodo,
      descripcion: 'Validar que el legajo 6 no tenga retención liquidada en junio porque el cálculo da saldo negativo.',
      clienteNombre: 'NETSER S.A.',
      modoSaldoFavor: 'compensar',
      empleado: {
        legajo: '6',
        nombre: '',
        cuil: '',
      },
      liquidacion: {
        remuneracionBruta: 5629211.28,
        deducciones: 956965.92,
      },
      resultado: {
        campo: 'calculo.retencion_excel',
        valorEsperado: 0,
        tolerancia: 0.05,
      },
      estadoEsperado: 'validado',
    };
    this.mostrarMensaje(dataset
      ? `Ejemplo cargado con dataset ${dataset.codigo}. Agregá el Excel y guardá el caso.`
      : 'Ejemplo cargado. Primero seleccioná un dataset compatible y después agregá el Excel.');
  }

  cargarCaso(caso: CasoQaPayload): void {
    const contexto = caso.contexto?.contexto_complementario ?? {};
    const datosCliente = this.objeto(contexto['datos_cliente']);
    const resultado = caso.resultado_esperado ?? {};

    this.form = {
      idCaso: caso.id,
      datasetCodigo: caso.dataset_codigo,
      periodo: caso.periodo,
      descripcion: caso.descripcion,
      clienteNombre: this.texto(datosCliente['cliente_nombre']),
      modoSaldoFavor: this.texto(datosCliente['modo_saldo_favor']),
      empleado: {
        legajo: caso.contexto?.empleado?.legajo ?? '',
        nombre: caso.contexto?.empleado?.nombre ?? '',
        cuil: caso.contexto?.empleado?.cuil ?? '',
      },
      liquidacion: {
        remuneracionBruta: this.numero(caso.contexto?.liquidacion?.remuneracion_bruta),
        deducciones: this.numero(caso.contexto?.liquidacion?.deducciones),
      },
      resultado: {
        campo: this.campoValido(resultado.campo),
        valorEsperado: this.numero(resultado.valor ?? resultado.retencion_ganancias),
        tolerancia: this.numero(resultado.tolerancia) ?? 0.05,
      },
      estadoEsperado: this.estadoValido(resultado.estado),
    };
    this.archivoExcel = caso.archivo;
    this.mostrarMensaje('Caso cargado para editar.');
  }

  eliminarCaso(id: string): void {
    this.api.delete<{ id: string; activo: false }>(`/qa/casos/${encodeURIComponent(id)}`).subscribe({
      next: () => {
        this.casos = this.casos.filter((caso) => caso.id !== id);
        const ejecuciones = new Map(this.ejecucionesPorCaso);
        ejecuciones.delete(id);
        this.ejecucionesPorCaso = ejecuciones;
        if (this.ejecucionSeleccionada?.caso_id === id) this.ejecucionSeleccionada = null;
        this.mostrarMensaje('Caso desactivado.');
      },
      error: () => this.mostrarMensaje('No se pudo eliminar el caso.', true),
    });
  }

  ejecutarCaso(caso: CasoQaPayload, modo: ModoQaEjecucion): void {
    if (this.casoBloqueado(caso.id)) return;

    this.casosEjecutando.add(caso.id);
    this.mostrarMensaje(modo === 'demo'
      ? `Demo lento iniciado para ${caso.id}.`
      : `Ejecución iniciada para ${caso.id}.`);

    this.api.post<QaEjecucionPayload>(`/qa/casos/${encodeURIComponent(caso.id)}/ejecutar`, { modo }).subscribe({
      next: (ejecucion) => {
        this.casosEjecutando.delete(caso.id);
        this.upsertEjecucion(ejecucion);
        this.ejecucionSeleccionada = ejecucion;
      },
      error: (error) => {
        this.casosEjecutando.delete(caso.id);
        this.mostrarMensaje(this.mensajeErrorApi(error, `No se pudo ejecutar ${caso.id}. Revisá backend, frontend y Excel.`), true);
      },
    });
  }

  refrescarOperacion(): void {
    this.cargarDatasets();
    this.cargarCasos(false);
    this.cargarEjecuciones();
  }

  probarBloqueoPeriodoDataset(): void {
    const dataset = this.datasetSeleccionado ?? this.datasets.find((item) => item.codigo === 'DS-AUD-GAN-082026') ?? this.datasets[0];
    if (!dataset) {
      this.mostrarMensaje('No hay datasets disponibles para probar la validación.', true);
      return;
    }

    const periodoInvalido = this.periodoDistinto(dataset.periodo);
    const payload = this.construirPayloadPruebaNegativa(dataset, periodoInvalido);
    this.probandoValidacion = true;

    this.api.post<CasoQaPayload>('/qa/casos', payload).subscribe({
      next: (caso) => {
        this.probandoValidacion = false;
        this.api.delete<{ id: string; activo: false }>(`/qa/casos/${encodeURIComponent(caso.id)}`).subscribe();
        this.mostrarMensaje(
          `ALERTA: el backend permitió guardar ${caso.id} aunque el dataset era ${dataset.periodo} y el caso ${periodoInvalido}. Lo desactivé para no ensuciar la tabla.`,
          true,
        );
      },
      error: (error) => {
        this.probandoValidacion = false;
        this.mostrarMensaje(
          `Validación OK: el backend rechazó ${dataset.codigo} con período de caso ${periodoInvalido}. ${this.mensajeErrorApi(error, '')}`,
        );
      },
    });
  }

  verEjecucion(casoId: string): void {
    const ejecucion = this.ultimaEjecucion(casoId);
    if (!ejecucion) return;
    this.ejecucionSeleccionada = ejecucion;
  }

  ultimaEjecucion(casoId: string): QaEjecucionPayload | null {
    return this.ejecucionesPorCaso.get(casoId) ?? null;
  }

  casoBloqueado(casoId: string): boolean {
    return this.casosEjecutando.has(casoId) || this.ultimaEjecucion(casoId)?.estado === 'corriendo';
  }

  estadoClase(ejecucion: QaEjecucionPayload | null): string {
    return ejecucion?.estado ?? 'sin-correr';
  }

  estadoTexto(ejecucion: QaEjecucionPayload | null): string {
    if (!ejecucion) return 'Sin correr';
    if (ejecucion.estado === 'verde') return 'Verde';
    if (ejecucion.estado === 'rojo') return 'Rojo';
    return 'Corriendo';
  }

  modoTexto(modo: ModoQaEjecucion): string {
    return modo === 'demo' ? 'Demo lento' : 'Rápido';
  }

  fechaEjecucion(ejecucion: QaEjecucionPayload | null): string {
    const fecha = ejecucion?.finalizado_en || ejecucion?.iniciado_en;
    if (!fecha) return '-';
    const date = new Date(fecha);
    if (Number.isNaN(date.getTime())) return fecha;
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  nombreExcel(caso: CasoQaPayload): string {
    return caso.archivo?.nombre || 'Sin Excel';
  }

  legajoCaso(caso: CasoQaPayload): string {
    return caso.contexto?.empleado?.legajo || '-';
  }

  trackByCaso(_index: number, caso: CasoQaPayload): string {
    return caso.id;
  }

  trackByDataset(_index: number, dataset: DatasetQaRef): string {
    return dataset.codigo;
  }

  private cargarDatasets(): void {
    this.cargandoDatasets = true;
    this.api.get<DatasetQaRef[]>('/qa/datasets').subscribe({
      next: (datasets) => {
        this.datasets = datasets;
        this.cargandoDatasets = false;
      },
      error: (error) => {
        this.datasets = [];
        this.cargandoDatasets = false;
        this.mostrarMensaje(this.mensajeErrorApi(error, 'No se pudieron cargar los datasets del catálogo QA.'), true);
      },
    });
  }

  private cargarCasos(migrarLegacy: boolean): void {
    this.cargandoCasos = true;
    this.api.get<CasoQaPayload[]>('/qa/casos').subscribe({
      next: (casos) => {
        this.casos = casos;
        this.cargandoCasos = false;
        if (migrarLegacy) this.migrarCasosLocales();
      },
      error: () => {
        this.cargandoCasos = false;
        this.mostrarMensaje('No se pudieron cargar los casos QA desde el backend.', true);
      },
    });
  }

  private cargarEjecuciones(mostrarCarga = true): void {
    if (mostrarCarga) this.cargandoEjecuciones = true;
    this.api.get<QaEjecucionPayload[]>('/qa/ejecuciones/ultimas').subscribe({
      next: (ejecuciones) => {
        this.cargandoEjecuciones = false;
        this.ejecucionesPorCaso = new Map(ejecuciones.map((ejecucion) => [ejecucion.caso_id, ejecucion]));
        if (this.ejecucionSeleccionada) {
          this.ejecucionSeleccionada = this.ejecucionesPorCaso.get(this.ejecucionSeleccionada.caso_id) ?? this.ejecucionSeleccionada;
        }
      },
      error: () => {
        this.cargandoEjecuciones = false;
      },
    });
  }

  private migrarCasosLocales(): void {
    const locales = this.leerCasosLegacy();
    if (locales.length === 0) return;

    const existentes = new Set(this.casos.map((caso) => caso.id));
    const pendientes = locales
      .map((caso) => this.normalizarPayloadLegacy(caso.payload))
      .filter((caso) => caso && !existentes.has(caso.id)) as CasoQaPayload[];

    if (pendientes.length === 0) {
      this.borrarLegacy();
      return;
    }

    forkJoin(pendientes.map((caso) => this.api.post<CasoQaPayload>('/qa/casos', caso))).subscribe({
      next: (migrados) => {
        migrados.forEach((caso) => this.upsertCaso(caso));
        this.borrarLegacy();
        this.mostrarMensaje(`Migré ${migrados.length} caso(s) locales a MongoDB.`);
      },
      error: () => this.mostrarMensaje('No se pudieron migrar los casos locales a MongoDB.', true),
    });
  }

  private crearForm(): CasoQaForm {
    return {
      idCaso: '',
      datasetCodigo: '',
      periodo: '',
      descripcion: '',
      clienteNombre: '',
      modoSaldoFavor: '',
      empleado: {
        legajo: '',
        nombre: '',
        cuil: '',
      },
      liquidacion: {
        remuneracionBruta: null,
        deducciones: null,
      },
      resultado: {
        campo: 'calculo.retencion_excel',
        valorEsperado: null,
        tolerancia: 0.05,
      },
      estadoEsperado: 'validado',
    };
  }

  private construirPayload(): CasoQaPayload {
    const campo = this.form.resultado.campo;
    const esperado = this.importe(this.form.resultado.valorEsperado);
    const tolerancia = this.importe(this.form.resultado.tolerancia) ?? 0.05;

    return {
      id: this.form.idCaso.trim() || this.generarId(),
      dataset_codigo: this.form.datasetCodigo.trim(),
      periodo: this.form.periodo.trim(),
      descripcion: this.form.descripcion.trim(),
      archivo: this.archivoExcel,
      contexto: {
        empleado: {
          legajo: this.form.empleado.legajo.trim(),
          nombre: this.form.empleado.nombre.trim(),
          cuil: this.form.empleado.cuil.trim(),
        },
        liquidacion: {
          remuneracion_bruta: this.importe(this.form.liquidacion.remuneracionBruta),
          deducciones: this.importe(this.form.liquidacion.deducciones),
        },
        contexto_complementario: this.contextoComplementario(),
      },
      resultado_esperado: {
        campo,
        valor: esperado,
        tolerancia,
        estado: this.form.estadoEsperado,
      },
      assertions: [
        {
          campo,
          operador: 'igual',
          esperado,
          tolerancia,
        },
      ],
      origen: {
        tipo: 'formulario_qa_pantalla_1',
        generado_en: new Date().toISOString(),
      },
    };
  }

  private construirPayloadPruebaNegativa(dataset: DatasetQaRef, periodoInvalido: string): CasoQaPayload {
    return {
      id: `QA-NEG-DATASET-${Date.now()}`,
      dataset_codigo: dataset.codigo,
      periodo: periodoInvalido,
      descripcion: `Prueba negativa: dataset ${dataset.codigo} (${dataset.periodo}) no debe aceptar caso ${periodoInvalido}.`,
      archivo: null,
      contexto: {
        empleado: {
          legajo: 'NEG-DATASET',
          nombre: 'Prueba negativa dataset',
          cuil: '',
        },
        liquidacion: {
          remuneracion_bruta: null,
          deducciones: null,
        },
        contexto_complementario: {
          datos_cliente: {},
          datos_legajo: { legajo_numero: 'NEG-DATASET' },
          datos_contexto: {
            fuente_datos: 'qa_negative_dataset_period',
            periodo_fiscal: this.parsearPeriodo(periodoInvalido).anio,
            mes_liquidacion: this.parsearPeriodo(periodoInvalido).mes,
          },
        },
      },
      resultado_esperado: {
        campo: 'calculo.retencion_excel',
        valor: 0,
        tolerancia: 0.05,
        estado: 'validado',
      },
      assertions: [
        {
          campo: 'calculo.retencion_excel',
          operador: 'igual',
          esperado: 0,
          tolerancia: 0.05,
        },
      ],
      origen: {
        tipo: 'prueba_negativa_dataset_periodo',
        generado_en: new Date().toISOString(),
      },
    };
  }

  private contextoComplementario(): Record<string, unknown> {
    const periodo = this.parsearPeriodo(this.form.periodo);
    const datosCliente: Record<string, unknown> = {};
    const datosLegajo: Record<string, unknown> = {};
    const datosContexto: Record<string, unknown> = { fuente_datos: 'qa_case' };

    if (this.form.clienteNombre.trim()) datosCliente['cliente_nombre'] = this.form.clienteNombre.trim();
    if (this.form.modoSaldoFavor) datosCliente['modo_saldo_favor'] = this.form.modoSaldoFavor;
    if (this.form.empleado.legajo.trim()) datosLegajo['legajo_numero'] = this.form.empleado.legajo.trim();
    if (this.form.empleado.cuil.trim()) datosLegajo['empleado_cuil'] = this.form.empleado.cuil.trim();
    if (periodo.anio) datosContexto['periodo_fiscal'] = periodo.anio;
    if (periodo.mes) datosContexto['mes_liquidacion'] = periodo.mes;

    return {
      datos_cliente: datosCliente,
      datos_legajo: datosLegajo,
      datos_contexto: datosContexto,
    };
  }

  private normalizarPayloadLegacy(payload: Record<string, unknown>): CasoQaPayload | null {
    const id = this.texto(payload['id']);
    if (!id) return null;

    const contextoLegacy = this.objeto(payload['contexto']);
    const empleado = this.objeto(contextoLegacy['empleado']);
    const liquidacion = this.objeto(contextoLegacy['liquidacion']);
    const resultadoLegacy = this.objeto(payload['resultado_esperado']);
    const campo = this.campoValido(resultadoLegacy['campo']);
    const valor = this.numero(resultadoLegacy['valor'] ?? resultadoLegacy['retencion_ganancias']);
    const tolerancia = this.numero(resultadoLegacy['tolerancia']) ?? 0.05;
    const periodo = this.texto(payload['periodo']);
    const periodoParseado = this.parsearPeriodo(periodo);

    return {
      id,
      dataset_codigo: this.texto(payload['dataset_codigo']),
      periodo,
      descripcion: this.texto(payload['descripcion']),
      archivo: this.normalizarArchivoLegacy(payload['archivo']),
      contexto: {
        empleado: {
          legajo: this.texto(empleado['legajo']),
          nombre: this.texto(empleado['nombre']),
          cuil: this.texto(empleado['cuil']),
        },
        liquidacion: {
          remuneracion_bruta: this.numero(liquidacion['remuneracion_bruta']),
          deducciones: this.numero(liquidacion['deducciones']),
        },
        contexto_complementario: {
          datos_cliente: {},
          datos_legajo: {
            legajo_numero: this.texto(empleado['legajo']),
            empleado_cuil: this.texto(empleado['cuil']),
          },
          datos_contexto: {
            fuente_datos: 'qa_case',
            periodo_fiscal: periodoParseado.anio,
            mes_liquidacion: periodoParseado.mes,
          },
        },
      },
      resultado_esperado: {
        campo,
        valor,
        tolerancia,
        estado: this.estadoValido(resultadoLegacy['estado']),
      },
      assertions: [{ campo, operador: 'igual', esperado: valor, tolerancia }],
      origen: this.objeto(payload['origen']) as { tipo: string; generado_en: string },
    };
  }

  private normalizarArchivoLegacy(archivo: unknown): ArchivoExcelRef | null {
    if (!archivo || typeof archivo !== 'object' || Array.isArray(archivo)) return null;
    const ref = archivo as Record<string, unknown>;
    const nombre = this.texto(ref['nombre']);
    if (!nombre) return null;
    return {
      nombre,
      size_bytes: this.numero(ref['size_bytes'] ?? ref['sizeBytes']),
      mime: this.texto(ref['mime']),
      seleccionado_en: this.texto(ref['seleccionado_en'] ?? ref['seleccionadoEn']),
    };
  }

  private parsearPeriodo(periodo: string): { mes: number | null; anio: number | null } {
    const match = /^(0?[1-9]|1[0-2])\D+((?:20)?\d{2})$/.exec(periodo.trim());
    if (!match) return { mes: null, anio: null };
    const anio = match[2].length === 2 ? Number(`20${match[2]}`) : Number(match[2]);
    return { mes: Number(match[1]), anio };
  }

  private periodoDistinto(periodo: string): string {
    const parsed = this.parsearPeriodo(periodo);
    if (!parsed.mes || !parsed.anio) return '06/2026';

    let mes = parsed.mes === 1 ? 12 : parsed.mes - 1;
    let anio = parsed.mes === 1 ? parsed.anio - 1 : parsed.anio;

    if (mes === parsed.mes && anio === parsed.anio) {
      mes = parsed.mes === 12 ? 11 : parsed.mes + 1;
      anio = parsed.anio;
    }

    return `${String(mes).padStart(2, '0')}/${anio}`;
  }

  private importe(valor: number | null): number | null {
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
  }

  private generarId(): string {
    const legajo = this.form.empleado.legajo.trim() || 'SIN-LEGAJO';
    const periodo = this.form.periodo.trim().replace(/\D/g, '') || 'SIN-PERIODO';
    return `QA-GAN-${legajo}-${periodo}`;
  }

  private upsertCaso(caso: CasoQaPayload): void {
    this.casos = [caso, ...this.casos.filter((actual) => actual.id !== caso.id)];
  }

  private upsertEjecucion(ejecucion: QaEjecucionPayload): void {
    const ejecuciones = new Map(this.ejecucionesPorCaso);
    ejecuciones.set(ejecucion.caso_id, ejecucion);
    this.ejecucionesPorCaso = ejecuciones;
  }

  private hayEjecucionesCorriendo(): boolean {
    return this.casosEjecutando.size > 0 ||
      Array.from(this.ejecucionesPorCaso.values()).some((ejecucion) => ejecucion.estado === 'corriendo');
  }

  private mostrarMensaje(mensaje: string, error = false): void {
    this.mensaje = mensaje;
    this.mensajeError = error;
  }

  private datasetParaPeriodo(periodo: string): DatasetQaRef | null {
    return this.datasets.find((dataset) => dataset.periodo === periodo) ?? null;
  }

  private mensajeErrorApi(error: unknown, fallback: string): string {
    const respuesta = this.objeto((error as { error?: unknown })?.error);
    const mensaje = this.texto(respuesta['message']);
    const errores = Array.isArray(respuesta['errores'])
      ? respuesta['errores'].map((item) => this.texto(item)).filter(Boolean)
      : [];
    if (mensaje && errores.length) return `${mensaje} ${errores.join(' ')}`;
    if (mensaje) return mensaje;
    return fallback;
  }

  private campoValido(valor: unknown): CampoResultado {
    return this.camposResultado.some((campo) => campo.valor === valor)
      ? valor as CampoResultado
      : 'calculo.retencion_excel';
  }

  private estadoValido(valor: unknown): EstadoEsperado {
    return valor === 'observado' || valor === 'pendiente' || valor === 'validado'
      ? valor
      : 'validado';
  }

  private numero(valor: unknown): number | null {
    if (valor === undefined || valor === null || valor === '') return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? valor as Record<string, unknown>
      : {};
  }

  private leerCasosLegacy(): CasoGuardadoLegacy[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(this.storageKeyLegacy);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((caso): caso is CasoGuardadoLegacy => this.esCasoGuardadoLegacy(caso));
    } catch {
      return [];
    }
  }

  private borrarLegacy(): void {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(this.storageKeyLegacy);
  }

  private esCasoGuardadoLegacy(valor: unknown): valor is CasoGuardadoLegacy {
    if (!valor || typeof valor !== 'object') return false;
    const registro = valor as Record<string, unknown>;
    return typeof registro['id'] === 'string' &&
      typeof registro['creadoEn'] === 'string' &&
      !!registro['payload'] &&
      typeof registro['payload'] === 'object';
  }
}
