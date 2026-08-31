import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AnalisisService } from '../../core/services/analisis.service';
import { EstadoAnalisisService } from '../../core/services/estado-analisis.service';

@Component({
  selector: 'app-cargar-excel',
  template: `
    <main class="carga-page" data-testid="carga-excel-page">
      <div *ngIf="animandoMotor" class="motor-overlay" data-testid="carga-excel-motor-overlay">
        <div class="motor-card">
          <div class="motor-loader" aria-label="Motor de análisis ejecutándose">
            <div class="orbita orbita-a"></div>
            <div class="orbita orbita-b"></div>
            <div class="documento">
              <div class="doblez"></div>
              <div class="linea linea-1"></div>
              <div class="linea linea-2"></div>
              <div class="check check-1">✓</div>
              <div class="check check-2">✓</div>
              <div class="escudo"><mat-icon>verified_user</mat-icon></div>
              <div class="calculadora">
                <div class="pantalla"></div>
                <span></span><span></span><span></span><span></span>
              </div>
            </div>
          </div>
          <h2>Ejecutando motor de análisis</h2>
          <p>Estamos leyendo el Excel, aplicando escala, topes y controles del legajo.</p>
          <div class="barra-progreso" aria-hidden="true"><span></span></div>
        </div>
      </div>

      <section class="titulo-seccion">
        <h1>
          <mat-icon>upload_file</mat-icon>
          Iniciar Auditoría
        </h1>
        <p>Cargue el reporte salarial para procesar y validar el Impuesto a las Ganancias.</p>
      </section>

      <mat-card class="upload-card" data-testid="carga-excel-upload-card">
        <div
          class="drop-zone"
          data-testid="carga-excel-dropzone"
          [class.drop-zone-activa]="isDragging || archivo"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave()"
          (drop)="soltar($event)"
          (click)="!archivo && fileInput.click()">
          <input #fileInput hidden type="file" accept=".xlsx" data-testid="carga-excel-file-input" (change)="seleccionar($event)">

          <ng-container *ngIf="!archivo; else archivoSeleccionado">
            <div class="upload-icon">
              <mat-icon>cloud_upload</mat-icon>
            </div>
            <h2>Subir archivo Excel</h2>
            <p>
              Arrastre y suelte su reporte corporativo (.xlsx aquí),<br>
              o haga clic para explorar sus carpetas locales.
            </p>
            <button
              mat-stroked-button
              color="primary"
              type="button"
              class="buscar-btn"
              data-testid="carga-excel-file-button"
              (click)="$event.stopPropagation(); fileInput.click()">
              <mat-icon>folder</mat-icon>
              Buscar Archivo
            </button>
          </ng-container>

          <ng-template #archivoSeleccionado>
            <div class="archivo-box">
              <div class="archivo-icon">
                <mat-icon>description</mat-icon>
              </div>
              <div class="archivo-info">
                <strong>{{ archivo?.name }}</strong>
                <span>{{ ((archivo?.size || 0) / 1024) | number:'1.0-1' }} KB</span>
              </div>
              <button
                mat-icon-button
                color="warn"
                type="button"
                data-testid="carga-excel-file-remove-button"
                (click)="$event.stopPropagation(); removerArchivo(fileInput)"
                title="Quitar archivo">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          </ng-template>
        </div>
      </mat-card>

      <mat-card class="datos-card" data-testid="carga-excel-context-card">
        <div class="datos-header">
          <div class="datos-icon">
            <mat-icon>badge</mat-icon>
          </div>
          <div>
            <h2>Datos del análisis</h2>
            <p>
              Estos datos identifican el legajo y el período a auditar. No hace falta que el archivo tenga un nombre especial.
            </p>
          </div>
        </div>

        <div class="form-grid">
          <label class="campo-auditoria">
            <mat-icon>person</mat-icon>
            <input
              [(ngModel)]="clienteNombre"
              name="clienteNombre"
              data-testid="carga-excel-cliente-input"
              placeholder="Cliente"
              aria-label="Cliente">
          </label>

          <label class="campo-auditoria">
            <mat-icon>work</mat-icon>
            <input
              [(ngModel)]="legajoNumero"
              name="legajoNumero"
              data-testid="carga-excel-legajo-input"
              placeholder="Legajo"
              aria-label="Legajo">
          </label>

          <label class="campo-auditoria">
            <mat-icon>calendar_month</mat-icon>
            <input
              type="number"
              min="2024"
              max="2035"
              [(ngModel)]="periodoFiscal"
              name="periodoFiscal"
              data-testid="carga-excel-periodo-fiscal-input"
              placeholder="Período fiscal"
              aria-label="Período fiscal">
          </label>

          <label class="campo-auditoria campo-select">
            <mat-icon>event</mat-icon>
            <select [(ngModel)]="mesLiquidacion" name="mesLiquidacion" data-testid="carga-excel-mes-liquidacion-select" aria-label="Mes de liquidación">
              <option [ngValue]="null">Mes de liquidación</option>
              <option *ngFor="let mes of meses" [ngValue]="mes.valor">{{ mes.nombre }}</option>
            </select>
            <mat-icon class="select-arrow">expand_more</mat-icon>
          </label>
        </div>

        <div class="info-box">
          <mat-icon>info</mat-icon>
          <span>
            Si el Excel ya trae alguno de estos datos, el formulario los confirma o completa.
            El motor usa estos valores antes de validar la entrada.
          </span>
        </div>

        <div *ngIf="periodoFiscal === 2026 && mesLiquidacion && mesLiquidacion > 6" class="warning-box">
          <mat-icon>warning</mat-icon>
          <span>
            La escala Art. 94 cargada actualmente cubre enero a junio de 2026. Si falta la escala del segundo semestre,
            el análisis quedará pendiente hasta completar la referencia normativa.
          </span>
        </div>

        <div *ngIf="archivo && faltanDatosParaAnalizar()" class="neutral-box">
          <mat-icon>edit_note</mat-icon>
          <span>
            Si conocés cliente, legajo, período fiscal y mes de liquidación, completalos para confirmar la auditoría.
            Si los dejás vacíos, el backend intentará inferirlos desde el Excel.
          </span>
        </div>
      </mat-card>

      <div *ngIf="error" class="error-box" data-testid="carga-excel-error">
        <mat-icon>error_outline</mat-icon>
        <span>{{ error }}</span>
      </div>

      <div class="acciones">
        <button
          mat-flat-button
          color="primary"
          type="button"
          class="ejecutar-btn"
          data-testid="carga-excel-run-button"
          [disabled]="!puedeAnalizar()"
          (click)="analizar()">
          <mat-spinner *ngIf="cargando" diameter="20" color="accent"></mat-spinner>
          <mat-icon *ngIf="!cargando">play_arrow</mat-icon>
          {{ cargando ? 'Procesando auditoría...' : 'Ejecutar Motor de Análisis' }}
        </button>
      </div>
    </main>
  `,
  styles: [`
    :host {
      display: block;
    }

    .carga-page {
      width: min(100%, 760px);
      margin: 0 auto;
      padding: 28px 20px 30px;
      display: grid;
      gap: 14px;
    }

    .titulo-seccion h1 {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0;
      color: #0f172a;
      font-size: 24px;
      line-height: 1.2;
      font-weight: 950;
      letter-spacing: -0.035em;
    }

    .titulo-seccion h1 mat-icon {
      color: #2563eb;
    }

    .titulo-seccion p {
      margin: 8px 0 0 36px;
      color: #64748b;
      font-size: 13px;
    }

    .upload-card,
    .datos-card {
      border: 1px solid #dce7f7;
      border-radius: 16px;
      background: #ffffff;
      box-shadow: 0 12px 34px rgba(15, 23, 42, 0.06);
    }

    .upload-card {
      padding: 16px;
    }

    .drop-zone {
      min-height: 210px;
      border: 1.5px dashed #bad2ff;
      border-radius: 14px;
      display: grid;
      place-items: center;
      align-content: center;
      gap: 12px;
      padding: 32px 20px;
      text-align: center;
      cursor: pointer;
      background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
      transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
    }

    .drop-zone:hover,
    .drop-zone-activa {
      border-color: #2563eb;
      background: #f6f9ff;
    }

    .upload-icon {
      width: 56px;
      height: 56px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: #eaf2ff;
      color: #2563eb;
    }

    .upload-icon mat-icon {
      font-size: 31px;
      width: 31px;
      height: 31px;
    }

    .drop-zone h2 {
      margin: 4px 0 0;
      color: #0f172a;
      font-size: 19px;
      font-weight: 950;
    }

    .drop-zone p {
      margin: 0;
      color: #64748b;
      font-size: 13px;
      line-height: 1.45;
    }

    .buscar-btn {
      height: 38px;
      padding: 0 16px;
      border-radius: 10px;
      font-weight: 900;
      color: #2563eb;
      background: #ffffff;
    }

    .buscar-btn mat-icon {
      margin-right: 6px;
    }

    .archivo-box {
      width: min(100%, 480px);
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border: 1px solid #dce7f7;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
      text-align: left;
    }

    .archivo-icon {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border-radius: 12px;
      background: #dcfce7;
      color: #16a34a;
      flex: 0 0 auto;
    }

    .archivo-info {
      min-width: 0;
      flex: 1;
      display: grid;
      gap: 2px;
    }

    .archivo-info strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #0f172a;
      font-size: 13px;
      font-weight: 900;
    }

    .archivo-info span {
      color: #94a3b8;
      font-size: 12px;
    }

    .datos-card {
      padding: 16px;
    }

    .datos-header {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }

    .datos-icon {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border-radius: 13px;
      background: #eaf2ff;
      color: #2563eb;
      flex: 0 0 auto;
    }

    .datos-header h2 {
      margin: 0;
      color: #0f172a;
      font-size: 16px;
      font-weight: 950;
    }

    .datos-header p {
      margin: 4px 0 0;
      color: #64748b;
      font-size: 12px;
      line-height: 1.45;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px 18px;
    }

    .campo-auditoria {
      min-height: 42px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 14px;
      border: 1px solid #cbd7ea;
      border-radius: 9px;
      background: #ffffff;
      color: #0f172a;
      box-shadow: 0 1px 0 rgba(15, 23, 42, 0.02);
      transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
    }

    .campo-auditoria:focus-within {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
      background: #ffffff;
    }

    .campo-auditoria mat-icon {
      flex: 0 0 auto;
      color: #64748b;
      font-size: 19px;
      width: 19px;
      height: 19px;
    }

    .campo-auditoria input,
    .campo-auditoria select {
      width: 100%;
      min-width: 0;
      height: 42px;
      border: 0;
      outline: 0;
      background: transparent;
      color: #0f172a;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
    }

    .campo-auditoria input::placeholder {
      color: #64748b;
      font-weight: 700;
      opacity: 1;
    }

    .campo-select {
      position: relative;
      padding-right: 42px;
    }

    .campo-select select {
      appearance: none;
      cursor: pointer;
      color: #64748b;
    }

    .campo-select select:valid {
      color: #0f172a;
    }

    .campo-select .select-arrow {
      position: absolute;
      right: 12px;
      color: #64748b;
      pointer-events: none;
    }

    .info-box,
    .warning-box,
    .neutral-box,
    .error-box {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      margin-top: 10px;
      padding: 11px 12px;
      border-radius: 12px;
      font-size: 12px;
      line-height: 1.45;
    }

    .info-box {
      border: 1px solid #bdd4ff;
      background: #f5f9ff;
      color: #2563eb;
    }

    .warning-box {
      border: 1px solid #fde68a;
      background: #fffbeb;
      color: #92400e;
    }

    .neutral-box {
      border: 1px solid #dce7f7;
      background: #f8fafc;
      color: #475569;
    }

    .error-box {
      margin-top: 0;
      border: 1px solid #fecaca;
      background: #fef2f2;
      color: #b91c1c;
    }

    .info-box mat-icon,
    .warning-box mat-icon,
    .neutral-box mat-icon,
    .error-box mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex: 0 0 auto;
    }

    .acciones {
      display: flex;
      justify-content: flex-end;
    }

    .ejecutar-btn {
      height: 44px;
      min-width: 240px;
      border-radius: 12px;
      font-weight: 950;
      box-shadow: 0 12px 28px rgba(37, 99, 235, 0.22);
    }

    .ejecutar-btn mat-icon,
    .ejecutar-btn mat-spinner {
      margin-right: 8px;
    }

    .motor-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(248, 251, 255, 0.94);
    }

    .motor-card {
      width: min(420px, calc(100vw - 32px));
      padding: 34px 30px 30px;
      border: 1px solid #dbe8ff;
      border-radius: 28px;
      background: #ffffff;
      box-shadow: 0 28px 70px rgba(15, 23, 42, 0.14);
      text-align: center;
      color: #0f2147;
    }

    .motor-card h2 {
      margin: 18px 0 6px;
      font-size: 22px;
      font-weight: 900;
      letter-spacing: -0.02em;
    }

    .motor-card p {
      margin: 0 auto;
      max-width: 320px;
      color: #64748b;
      font-size: 13px;
      line-height: 1.5;
    }

    .motor-loader {
      position: relative;
      width: 210px;
      height: 210px;
      margin: 0 auto;
      display: grid;
      place-items: center;
    }

    .orbita {
      position: absolute;
      inset: 0;
      border-radius: 999px;
    }

    .orbita-a {
      border: 14px solid #dbeafe;
      border-top-color: #2563eb;
      border-right-color: #60a5fa;
      border-bottom-color: transparent;
      border-left-color: #1d4ed8;
      animation: girar 1.25s linear infinite;
    }

    .orbita-b {
      inset: 20px;
      opacity: 0.36;
      border: 10px solid #bfdbfe;
      border-top-color: transparent;
      border-right-color: #60a5fa;
      border-bottom-color: #93c5fd;
      border-left-color: transparent;
      animation: girar 2.1s linear infinite reverse;
    }

    .documento {
      position: relative;
      width: 98px;
      height: 118px;
      border: 1px solid #cfe0ff;
      border-radius: 12px;
      background: #f8fbff;
      box-shadow: 0 18px 34px rgba(37, 99, 235, 0.18);
    }

    .doblez {
      position: absolute;
      top: -1px;
      right: -1px;
      width: 30px;
      height: 30px;
      border-left: 1px solid #cfe0ff;
      border-bottom: 1px solid #cfe0ff;
      border-radius: 0 12px 0 10px;
      background: #e7f0ff;
    }

    .linea {
      position: absolute;
      left: 24px;
      height: 4px;
      border-radius: 999px;
      background: #93bdf8;
    }

    .linea-1 { top: 30px; width: 43px; }
    .linea-2 { top: 44px; width: 58px; }

    .check {
      position: absolute;
      left: 14px;
      color: #2563eb;
      font-size: 12px;
      font-weight: 900;
    }

    .check-1 { top: 56px; }
    .check-2 { top: 72px; }

    .escudo {
      position: absolute;
      left: 18px;
      bottom: -18px;
      width: 58px;
      height: 62px;
      display: grid;
      place-items: center;
      color: white;
      background: #2563eb;
      box-shadow: 0 14px 24px rgba(37, 99, 235, 0.28);
      border-radius: 18px 18px 24px 24px;
    }

    .escudo mat-icon {
      font-size: 31px;
      width: 31px;
      height: 31px;
    }

    .calculadora {
      position: absolute;
      right: -27px;
      bottom: -13px;
      width: 46px;
      height: 58px;
      padding: 8px 7px;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 5px;
      border-radius: 11px;
      background: #3b82f6;
      box-shadow: 0 12px 22px rgba(37, 99, 235, 0.25);
    }

    .calculadora .pantalla {
      grid-column: 1 / -1;
      height: 10px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.9);
    }

    .calculadora span {
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.72);
    }

    .barra-progreso {
      overflow: hidden;
      width: 100%;
      height: 8px;
      margin-top: 22px;
      border-radius: 999px;
      background: #e6efff;
    }

    .barra-progreso span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: #2563eb;
      animation: avanzar 8s ease-out forwards;
    }

    @keyframes girar {
      to { transform: rotate(360deg); }
    }

    @keyframes avanzar {
      from { width: 6%; }
      to { width: 100%; }
    }

    @media (max-width: 720px) {
      .carga-page {
        padding: 20px 14px 28px;
      }

      .titulo-seccion p {
        margin-left: 0;
      }

      .form-grid {
        grid-template-columns: 1fr;
      }

      .acciones {
        justify-content: stretch;
      }

      .ejecutar-btn {
        width: 100%;
        min-width: 0;
      }
    }
  `]
})
export class CargarExcelComponent {
  archivo?: File;
  cargando = false;
  animandoMotor = false;
  error = '';
  isDragging = false;

  clienteCuit = '';
  clienteNombre = '';
  legajoNumero = '';
  periodoFiscal: number | null = null;
  mesLiquidacion: number | null = null;
  empleadoCuil = '';
  modoSaldo = 'desconocido';
  observaciones = '';
  meses = [
    { valor: 1, nombre: 'Enero' },
    { valor: 2, nombre: 'Febrero' },
    { valor: 3, nombre: 'Marzo' },
    { valor: 4, nombre: 'Abril' },
    { valor: 5, nombre: 'Mayo' },
    { valor: 6, nombre: 'Junio' },
    { valor: 7, nombre: 'Julio' },
    { valor: 8, nombre: 'Agosto' },
    { valor: 9, nombre: 'Septiembre' },
    { valor: 10, nombre: 'Octubre' },
    { valor: 11, nombre: 'Noviembre' },
    { valor: 12, nombre: 'Diciembre' },
  ];

  constructor(
    private service: AnalisisService,
    private estado: EstadoAnalisisService,
    private router: Router
  ) {}

  seleccionar(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) this.validar(f);
  }

  onDragOver(e: DragEvent) {
    e.preventDefault();
    this.isDragging = true;
  }

  onDragLeave() {
    this.isDragging = false;
  }

  soltar(e: DragEvent) {
    e.preventDefault();
    this.isDragging = false;
    const f = e.dataTransfer?.files[0];
    if (f) this.validar(f);
  }

  validar(f: File) {
    this.error = f.name.toLowerCase().endsWith('.xlsx')
      ? ''
      : 'Estructura no soportada. Solo se admiten hojas de cálculo con extensión (.xlsx)';

    if (!this.error) {
      this.archivo = f;
      this.prellenarDesdeNombre(f.name);
    }
  }

  removerArchivo(fileInput: HTMLInputElement) {
    this.archivo = undefined;
    fileInput.value = '';
    this.error = '';
  }

  analizar() {
    if (!this.archivo) return;
    this.cargando = true;
    this.animandoMotor = true;
    this.error = '';
    const inicioAnimacion = Date.now();

    const contexto = {
      datos_cliente: {
        cliente_nombre: this.clienteNombre.trim(),
        ...(this.clienteCuit ? { cliente_cuit: this.clienteCuit } : {}),
        ...(this.modoSaldo !== 'desconocido' ? { modo_saldo_favor: this.modoSaldo } : {})
      },
      datos_legajo: {
        legajo_numero: this.legajoNumero.trim(),
        ...(this.empleadoCuil ? { empleado_cuil: this.empleadoCuil } : {})
      },
      datos_contexto: {
        periodo_fiscal: this.periodoFiscal,
        mes_liquidacion: this.mesLiquidacion,
        observaciones: this.observaciones,
        fuente_datos: 'manual'
      }
    };

    this.service.cargar(this.archivo, contexto).subscribe({
      next: (r) => {
        this.esperarAnimacion(inicioAnimacion, () => {
          this.estado.actual = r;
          this.router.navigate(['/analisis', r.id]);
        });
      },
      error: (e) => {
        this.esperarAnimacion(inicioAnimacion, () => {
          this.error = e.error?.message ?? 'Error crítico: No se pudo establecer conexión con el backend de Node.';
          this.cargando = false;
          this.animandoMotor = false;
        });
      }
    });
  }

  private esperarAnimacion(inicioAnimacion: number, accion: () => void) {
    const duracionMinimaMs = 8000;
    const transcurrido = Date.now() - inicioAnimacion;
    const restante = Math.max(duracionMinimaMs - transcurrido, 0);
    setTimeout(accion, restante);
  }

  puedeAnalizar() {
    return !!this.archivo &&
      !this.cargando;
  }

  faltanDatosParaAnalizar() {
    return !!this.archivo &&
      (
        !this.clienteNombre.trim() ||
        !this.legajoNumero.trim() ||
        !Number.isInteger(this.periodoFiscal) ||
        !Number.isInteger(this.mesLiquidacion)
      );
  }

  private prellenarDesdeNombre(nombre: string) {
    const stem = nombre.replace(/\.xlsx$/i, '');
    const match = /(?:(?:review|auditoria)_)?(.+?)_legajo_?(\d+)_m?(0[1-9]|1[0-2])[-_]?(\d{4})(?:_|$)/i.exec(stem);
    if (match) {
      if (!this.clienteNombre) this.clienteNombre = match[1].replace(/_/g, ' ').trim();
      if (!this.legajoNumero) this.legajoNumero = match[2];
      if (!this.mesLiquidacion) this.mesLiquidacion = Number(match[3]);
      if (!this.periodoFiscal) this.periodoFiscal = Number(match[4]);
      return;
    }

    const periodo = /(0[1-9]|1[0-2])[-_\s]?((?:20)?\d{2})(?!\d)/.exec(stem);
    const legajo = /legajo(?:\s*nro\.?|\s*num(?:ero)?\.?|\s*n\.?|_)?\s*_?(\d+)/i.exec(stem);
    const cliente = this.clienteDesdeNombreLibre(stem);

    if (!this.clienteNombre && cliente) this.clienteNombre = cliente;
    if (!this.legajoNumero && legajo) this.legajoNumero = legajo[1];
    if (!this.mesLiquidacion && periodo) this.mesLiquidacion = Number(periodo[1]);
    if (!this.periodoFiscal && periodo) this.periodoFiscal = this.normalizarAnio(periodo[2]);
  }

  private normalizarAnio(valor: string): number {
    return valor.length === 2 ? Number(`20${valor}`) : Number(valor);
  }

  private clienteDesdeNombreLibre(stem: string): string {
    return stem
      .replace(/^(review|auditoria|proyeccion)[_\s-]*/i, '')
      .replace(/[_\s-]*legajo[_\s-]*\d+.*$/i, '')
      .replace(/[_\s-]*control[_\s-]*ganancias.*$/i, '')
      .replace(/[_\s-]*ganancias?.*$/i, '')
      .replace(/[_\s-]*(0[1-9]|1[0-2])[-_\s]?(?:20)?\d{2}.*$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim();
  }
}
