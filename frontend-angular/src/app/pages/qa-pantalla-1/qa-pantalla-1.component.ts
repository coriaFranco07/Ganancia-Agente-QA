import { Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

type EstadoEsperado = 'validado' | 'observado' | 'pendiente';
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
            <h2>Casos guardados</h2>
            <p>Casos activos disponibles para el runner Playwright.</p>
          </div>
          <span *ngIf="cargandoCasos" class="estado-carga">Cargando...</span>
        </div>

        <div *ngIf="!cargandoCasos && casos.length === 0" class="empty-state">
          <mat-icon>inventory_2</mat-icon>
          <span>Sin casos guardados todavía.</span>
        </div>

        <div *ngFor="let caso of casos; trackBy: trackByCaso" class="caso-row">
          <button type="button" class="caso-main" (click)="cargarCaso(caso)">
            <mat-icon>assignment</mat-icon>
            <span>
              <strong>{{ caso.id }}</strong>
              <small>{{ caso.dataset_codigo || 'Sin dataset' }} · {{ caso.periodo || 'Sin período' }}</small>
            </span>
          </button>

          <span class="caso-estado">{{ caso.resultado_esperado.estado }}</span>

          <button mat-icon-button type="button" title="Eliminar caso" (click)="eliminarCaso(caso.id)">
            <mat-icon>delete</mat-icon>
          </button>
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
    .casos-panel { display: grid; gap: 8px; }
    .empty-state { display: flex; align-items: center; gap: 8px; padding: 14px; border: 1px dashed #cbd7ea; border-radius: 10px; color: #64748b; font-size: 13px; font-weight: 800; }
    .caso-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 8px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; }
    .caso-main { min-width: 0; display: flex; align-items: center; gap: 10px; border: 0; padding: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .caso-main mat-icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 9px; background: #eff6ff; color: #2563eb; font-size: 20px; flex: 0 0 auto; }
    .caso-main span { min-width: 0; display: grid; gap: 2px; }
    .caso-main strong, .caso-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .caso-main strong { color: #0f172a; font-size: 13px; font-weight: 950; }
    .caso-main small { color: #64748b; font-size: 11px; font-weight: 800; }
    .caso-estado { padding: 5px 9px; border-radius: 999px; background: #ecfdf5; color: #15803d; font-size: 11px; font-weight: 900; }
    @media (max-width: 1120px) {
      .qa-grid { grid-template-columns: 1fr; }
      .preview-panel pre { min-height: 260px; }
    }
    @media (max-width: 720px) {
      .qa-page { padding: 16px 12px 24px; }
      .titulo-seccion { align-items: flex-start; flex-direction: column; }
      .titulo-seccion p { margin-left: 0; }
      .form-grid { grid-template-columns: 1fr; }
      .field-wide { grid-column: auto; }
      .excel-box, .acciones { align-items: stretch; flex-direction: column; }
      .caso-row { grid-template-columns: minmax(0, 1fr) auto; }
      .caso-estado { display: none; }
    }
  `]
})
export class QaPantalla1Component implements OnInit {
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
  mensaje = '';
  mensajeError = false;
  cargandoDatasets = false;
  cargandoCasos = false;
  guardando = false;

  private readonly storageKeyLegacy = 'auditoria-ganancias.qa.casos';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.cargarDatasets();
    this.cargarCasos(true);
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
        this.mostrarMensaje('Caso desactivado.');
      },
      error: () => this.mostrarMensaje('No se pudo eliminar el caso.', true),
    });
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
