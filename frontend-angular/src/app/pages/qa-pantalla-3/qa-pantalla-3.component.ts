import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';

interface Pantalla3Form {
  cliente: string;
  areaSector: string;
  telefono: string;
  numeroDocumento: string;
  cuil: string;
  fechaIngreso: string;
  fechaFin: string;
}

interface CasoQaPayload {
  id: string;
  definicion_tecnica_codigo?: string;
  dataset_codigo: string;
  periodo: string;
  descripcion: string;
  archivo: Record<string, unknown> | null;
  contexto: {
    empleado?: Record<string, unknown>;
    liquidacion?: Record<string, unknown>;
    contexto_complementario: Record<string, unknown>;
  };
  resultado_esperado: Record<string, unknown>;
  assertions: Array<Record<string, unknown>>;
  origen: Record<string, unknown>;
}

interface ErrorImportacionQa {
  fila: number;
  id: string;
  error: string;
}

interface ResultadoImportacionQa {
  importados: number;
  fallidos: number;
  casos: CasoQaPayload[];
  errores?: ErrorImportacionQa[];
}

@Component({
  selector: 'app-qa-pantalla-3',
  template: `
    <main class="screen-page" data-testid="qa-screen3-page">
      <section class="screen-card" data-testid="qa-screen3-card">
        <header class="screen-head">
          <div class="head-title">
            <div class="title-mark">
              <mat-icon>person_add</mat-icon>
            </div>
            <div>
              <span>QA - Pantalla 3</span>
              <h1>Alta básica de cliente</h1>
            </div>
          </div>

          <div class="head-actions">
            <input #importInput hidden type="file" accept=".xlsx,.xls,.csv,.json" data-testid="qa-screen3-import-input" (change)="seleccionarImportacion($event)">
            <button mat-flat-button color="primary" type="button" data-testid="qa-screen3-import-button" [disabled]="importando" (click)="importInput.click()">
              <mat-icon>{{ importando ? 'hourglass_top' : 'upload_file' }}</mat-icon>
              {{ importando ? 'Importando...' : 'Importar Datos' }}
            </button>
            <a mat-stroked-button routerLink="/qa/casos" data-testid="qa-screen3-ver-casos-link">
              <mat-icon>table_view</mat-icon>
              Ver casos
            </a>
          </div>
        </header>

        <div *ngIf="editandoId" class="edit-banner" data-testid="qa-screen3-edit-banner">
          <mat-icon>edit</mat-icon>
          <span>Editando el caso <strong>{{ editandoId }}</strong></span>
          <a routerLink="/qa/casos">Volver a Casos</a>
        </div>

        <form class="simple-form" data-testid="qa-screen3-form" (submit)="$event.preventDefault(); guardarCaso()">
          <div class="form-grid">
            <label class="field">
              <span>Cliente</span>
              <input [(ngModel)]="form.cliente" name="cliente" data-testid="qa-screen3-cliente-input" placeholder="Nombre del cliente">
            </label>

            <label class="field">
              <span>Área / Sector</span>
              <input [(ngModel)]="form.areaSector" name="areaSector" data-testid="qa-screen3-area-sector-input" placeholder="Administración">
            </label>

            <label class="field">
              <span>Teléfono</span>
              <input [(ngModel)]="form.telefono" name="telefono" data-testid="qa-screen3-telefono-input" placeholder="11 5555-5555">
            </label>

            <label class="field">
              <span>Número de documento</span>
              <input [(ngModel)]="form.numeroDocumento" name="numeroDocumento" data-testid="qa-screen3-documento-input" placeholder="12345678">
            </label>

            <label class="field">
              <span>CUIL</span>
              <input [(ngModel)]="form.cuil" name="cuil" data-testid="qa-screen3-cuil-input" placeholder="20-12345678-4">
            </label>

            <label class="field">
              <span>Fecha de ingreso</span>
              <input type="date" [(ngModel)]="form.fechaIngreso" name="fechaIngreso" data-testid="qa-screen3-fecha-ingreso-input">
            </label>

            <label class="field">
              <span>Fecha de fin</span>
              <input type="date" [(ngModel)]="form.fechaFin" name="fechaFin" data-testid="qa-screen3-fecha-fin-input">
            </label>
          </div>

          <div *ngIf="mensaje" class="message" data-testid="qa-screen3-message" [class.error]="mensajeError">{{ mensaje }}</div>

          <div class="actions">
            <button mat-stroked-button type="button" data-testid="qa-screen3-reset-button" (click)="nuevoLimpio()">
              <mat-icon>refresh</mat-icon>
              Nuevo limpio
            </button>
            <button mat-flat-button color="primary" type="submit" data-testid="qa-screen3-save-button" [disabled]="guardando">
              <mat-icon>{{ guardando ? 'hourglass_top' : 'save' }}</mat-icon>
              {{ guardando ? 'Guardando...' : 'Guardar caso' }}
            </button>
          </div>
        </form>
      </section>

      <section class="link-card" data-testid="qa-screen3-cases-panel">
        <mat-icon>table_view</mat-icon>
        <div>
          <strong>Los casos de Pantalla 3 se ven, editan y eliminan en el módulo Casos.</strong>
          <span>Ahí podés buscarlos, revisar los de Pantalla 1 en el mismo lugar y borrar los que ya no sirvan.</span>
        </div>
        <a mat-flat-button color="primary" routerLink="/qa/casos" data-testid="qa-screen3-cases-link">
          Ir a Casos
        </a>
      </section>
    </main>
  `,
  styles: [`
    :host { display: block; }

    .screen-page {
      min-height: calc(100vh - 52px);
      display: grid;
      align-content: start;
      gap: 18px;
      padding: 24px;
      color: #0f172a;
      background: #f4f7fb;
    }

    .screen-card {
      width: 100%;
      border: 1px solid #dbe4f0;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 18px 44px rgba(15, 23, 42, .08);
      overflow: hidden;
    }

    .screen-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 20px 22px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fbff;
    }

    .head-title {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .title-mark {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 8px;
      color: #ffffff;
      background: #2563eb;
    }

    .title-mark mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .screen-head span {
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
    p {
      margin: 0;
    }

    .screen-head h1 {
      margin-top: 6px;
      font-size: 25px;
      line-height: 1.15;
      font-weight: 950;
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
    .head-actions a,
    .actions button {
      height: 40px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 950;
    }

    .head-actions mat-icon,
    .actions mat-icon {
      margin-right: 6px;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .edit-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 22px;
      padding: 12px 14px;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      background: #eff6ff;
      color: #1e40af;
      font-size: 12px;
      font-weight: 850;
    }

    .edit-banner mat-icon {
      color: #2563eb;
    }

    .edit-banner strong {
      font-weight: 950;
    }

    .edit-banner a {
      margin-left: auto;
      color: #1d4ed8;
      font-weight: 950;
      text-decoration: none;
    }

    .edit-banner a:hover {
      text-decoration: underline;
    }

    .link-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 22px;
      border: 1px solid #dbe4f0;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 18px 44px rgba(15, 23, 42, .08);
    }

    .link-card > mat-icon {
      flex: 0 0 auto;
      color: #2563eb;
    }

    .link-card > div {
      flex: 1;
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .link-card strong {
      font-size: 13px;
      font-weight: 900;
    }

    .link-card span {
      color: #64748b;
      font-size: 12px;
      font-weight: 750;
    }

    .link-card a {
      flex: 0 0 auto;
      height: 40px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 950;
    }

    .simple-form {
      display: grid;
      gap: 18px;
      padding: 22px;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .field {
      min-width: 0;
      display: grid;
      gap: 6px;
      color: #334155;
      font-size: 12px;
      font-weight: 950;
    }

    .field span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    input {
      width: 100%;
      height: 42px;
      min-width: 0;
      padding: 0 12px;
      border: 1px solid #cbd8ea;
      border-radius: 8px;
      background: #f8fbff;
      color: #0f172a;
      font: inherit;
      font-size: 13px;
      font-weight: 750;
      outline: none;
      box-sizing: border-box;
      transition: border 150ms ease, box-shadow 150ms ease, background 150ms ease;
    }

    input:focus {
      border-color: #2563eb;
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, .12);
    }

    .message {
      padding: 11px 12px;
      border: 1px solid #bbf7d0;
      border-radius: 8px;
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

    @media (max-width: 980px) {
      .form-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 720px) {
      .screen-page {
        padding: 16px 12px 24px;
      }

      .screen-head {
        align-items: stretch;
        flex-direction: column;
      }

      .head-title {
        align-items: flex-start;
      }

      .head-actions,
      .actions {
        align-items: stretch;
        flex-direction: column;
      }

      .head-actions button,
      .head-actions a,
      .actions button {
        width: 100%;
      }

      .link-card {
        flex-direction: column;
        align-items: flex-start;
      }

      .link-card a {
        width: 100%;
        text-align: center;
      }

      .simple-form {
        padding: 18px;
      }

      .form-grid {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class QaPantalla3Component implements OnInit {
  private readonly pantallaOrigen = 'QA - Pantalla 3';

  form: Pantalla3Form = this.crearForm();
  editandoId = '';
  mensaje = '';
  mensajeError = false;
  guardando = false;
  importando = false;

  constructor(private api: ApiService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    const id = this.texto(this.route.snapshot.queryParamMap.get('editar'));
    if (id) this.cargarCasoParaEditar(id);
  }

  seleccionarImportacion(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (!file) return;

    if (!/\.(xlsx|xls|csv|json)$/i.test(file.name)) {
      this.mostrarMensaje('Seleccioná un archivo de importación válido (.xlsx, .xls, .csv o .json).', true);
      input.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('archivo', file, file.name);
    formData.append('pantalla_origen', this.pantallaOrigen);
    formData.append('tipo_origen', 'importacion_qa_pantalla_3');
    input.value = '';
    this.importando = true;

    this.api.post<ResultadoImportacionQa>('/qa/casos/importar', formData).subscribe({
      next: (resultado) => {
        this.importando = false;
        this.mostrarMensaje(
          `Importación lista: ${resultado.importados} caso(s), ${resultado.fallidos} fila(s) con error.`,
          resultado.fallidos > 0,
        );
      },
      error: (error) => {
        this.importando = false;
        this.mostrarMensaje(this.mensajeErrorApi(error, 'No se pudo importar el archivo.'), true);
      },
    });
  }

  guardarCaso(): void {
    const pendientes = this.validarForm();
    if (pendientes.length > 0) {
      this.mostrarMensaje(pendientes.join(' '), true);
      return;
    }

    this.guardando = true;
    this.api.post<CasoQaPayload>('/qa/casos', this.construirPayload()).subscribe({
      next: () => {
        this.guardando = false;
        this.mostrarMensaje(
          this.editandoId ? `Caso ${this.editandoId} actualizado en MongoDB.` : 'Caso de Pantalla 3 guardado en MongoDB.',
        );
      },
      error: (error) => {
        this.guardando = false;
        this.mostrarMensaje(this.mensajeErrorApi(error, 'No se pudo guardar el caso de Pantalla 3.'), true);
      },
    });
  }

  nuevoLimpio(): void {
    this.form = this.crearForm();
    this.editandoId = '';
    this.mensaje = '';
    this.mensajeError = false;
  }

  private cargarCasoParaEditar(id: string): void {
    this.api.get<CasoQaPayload>(`/qa/casos/${encodeURIComponent(id)}`).subscribe({
      next: (caso) => {
        const datos = this.datosPantalla3(caso);
        this.form = {
          cliente: this.texto(datos['cliente']),
          areaSector: this.texto(datos['area_sector']),
          telefono: this.texto(datos['telefono']),
          numeroDocumento: this.texto(datos['numero_documento']),
          cuil: this.texto(datos['cuil']),
          fechaIngreso: this.texto(datos['fecha_ingreso']),
          fechaFin: this.texto(datos['fecha_fin']),
        };
        this.editandoId = caso.id;
        this.mostrarMensaje(`Caso ${caso.id} cargado para editar.`);
      },
      error: () => this.mostrarMensaje(`No pude cargar el caso ${id} para editar.`, true),
    });
  }

  private crearForm(): Pantalla3Form {
    return {
      cliente: '',
      areaSector: '',
      telefono: '',
      numeroDocumento: '',
      cuil: '',
      fechaIngreso: '',
      fechaFin: '',
    };
  }

  private construirPayload(): CasoQaPayload {
    const cliente = this.form.cliente.trim();
    const areaSector = this.form.areaSector.trim();
    const telefono = this.form.telefono.trim();
    const numeroDocumento = this.form.numeroDocumento.trim();
    const cuil = this.form.cuil.trim();
    const fechaIngreso = this.form.fechaIngreso;
    const fechaFin = this.form.fechaFin || null;

    return {
      // Si se está editando un caso existente, se conserva su id: si se
      // recalculara desde el formulario y cambió el documento o la fecha,
      // se crearía un caso nuevo en vez de actualizar el editado.
      id: this.editandoId || this.generarId(),
      definicion_tecnica_codigo: 'DEF-AUD-GAN-RETENCION-V1',
      dataset_codigo: '',
      periodo: '',
      descripcion: `Alta Pantalla 3 - ${cliente}`,
      archivo: null,
      contexto: {
        empleado: {
          cliente,
          area_sector: areaSector,
          telefono,
          numero_documento: numeroDocumento,
          cuil,
          fecha_ingreso: fechaIngreso,
          fecha_fin: fechaFin,
        },
        liquidacion: {},
        contexto_complementario: {
          pantalla_3: {
            cliente,
            area_sector: areaSector,
            telefono,
            numero_documento: numeroDocumento,
            cuil,
            fecha_ingreso: fechaIngreso,
            fecha_fin: fechaFin,
          },
          origen: {
            pantalla: this.pantallaOrigen,
            tipo: 'formulario_cliente_basico',
          },
        },
      },
      resultado_esperado: {
        campo: 'pantalla_3.registro',
        valor: 'registrado',
        tolerancia: 0,
        estado: 'registrado',
      },
      assertions: [
        {
          campo: 'pantalla_3.registro',
          operador: 'igual',
          esperado: 'registrado',
          tolerancia: 0,
        },
      ],
      origen: {
        pantalla: this.pantallaOrigen,
        tipo: 'formulario_cliente_basico',
        generado_en: new Date().toISOString(),
      },
    };
  }

  private validarForm(): string[] {
    const pendientes: string[] = [];
    const cuilNumerico = this.form.cuil.replace(/\D/g, '');
    const telefonoNumerico = this.form.telefono.replace(/\D/g, '');
    if (!this.form.cliente.trim()) pendientes.push('Completá el cliente.');
    if (!this.form.areaSector.trim()) pendientes.push('Completá el área/sector.');
    if (!this.form.telefono.trim()) pendientes.push('Completá el teléfono.');
    if (this.form.telefono.trim() && telefonoNumerico.length < 6) pendientes.push('El teléfono debe tener al menos 6 números.');
    if (!this.form.numeroDocumento.trim()) pendientes.push('Completá el número de documento.');
    if (!this.form.cuil.trim()) pendientes.push('Completá el CUIL.');
    if (this.form.cuil.trim() && cuilNumerico.length !== 11) pendientes.push('El CUIL debe tener 11 números.');
    if (!this.form.fechaIngreso) pendientes.push('Completá la fecha de ingreso.');
    if (this.form.fechaFin && this.form.fechaIngreso && this.form.fechaFin < this.form.fechaIngreso) {
      pendientes.push('La fecha de fin no puede ser anterior a la fecha de ingreso.');
    }
    return pendientes;
  }

  private datosPantalla3(caso: CasoQaPayload): Record<string, unknown> {
    const contexto = this.objeto(caso.contexto?.contexto_complementario);
    const datos = this.objeto(contexto['pantalla_3']);
    if (Object.keys(datos).length > 0) return datos;
    return this.objeto(caso.contexto?.empleado);
  }

  private generarId(): string {
    const documento = this.form.numeroDocumento.replace(/\D/g, '') || this.form.cuil.replace(/\D/g, '') || 'SINDOC';
    const fecha = this.form.fechaIngreso.replace(/\D/g, '') || 'SINFECHA';
    return `QA-P3-ALTA-${documento}-${fecha}`;
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? valor as Record<string, unknown>
      : {};
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }

  private mostrarMensaje(texto: string, error = false): void {
    this.mensaje = texto;
    this.mensajeError = error;
  }

  private mensajeErrorApi(error: unknown, fallback: string): string {
    const err = this.objeto(error);
    const body = this.objeto(err['error']);
    const mensaje = body['message'] ?? err['message'];
    if (Array.isArray(mensaje)) return mensaje.map((item) => this.texto(item)).filter(Boolean).join(' ');
    return mensaje ? this.texto(mensaje) : fallback;
  }
}
