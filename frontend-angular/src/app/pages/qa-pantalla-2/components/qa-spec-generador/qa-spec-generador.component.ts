import { Component, EventEmitter, Output } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  AnalisisSpecResultado,
  GenerarDesdeSpecResultado,
  QaSpecGeneradorService,
} from '../../../../core/services/qa-spec-generador.service';

const ICONO_FAMILIA: { [familia: string]: string } = {
  texto: 'text_fields',
  numero: 'pin',
  email: 'alternate_email',
  fecha: 'event',
};

@Component({
  selector: 'app-qa-spec-generador',
  template: `
    <div class="lab-panel">
      <div class="panel-header">
        <h2 class="panel-title"><mat-icon class="title-icon">auto_fix_high</mat-icon> Generador desde Spec</h2>
        <p class="panel-desc">
          Subí (o pegá) un spec grabado con Playwright Codegen de un módulo nuevo. Se generan automáticamente
          3 casos —funcional, seguridad y accesibilidad— sustituyendo lo que se escribe en cada campo según la
          categoría. Quedan guardados en <b>Casos propios</b>, dentro de Spider QA, con su propio botón de ejecutar.
        </p>
      </div>

      <div class="config-card">
        <label class="config-label">Archivo o código del spec</label>
        <div class="upload-fila">
          <input #fileInput type="file" accept=".ts,.spec.ts,.txt" hidden (change)="onArchivoSeleccionado($event)">
          <button mat-stroked-button (click)="fileInput.click()">
            <mat-icon>upload_file</mat-icon> Subir archivo .spec.ts
          </button>
          <span class="nombre-archivo" *ngIf="nombreArchivo">{{ nombreArchivo }}</span>
        </div>
        <mat-form-field appearance="outline" class="campo-full">
          <mat-label>O pegá el código acá</mat-label>
          <textarea matInput [(ngModel)]="codigo" (ngModelChange)="invalidarAnalisis()" rows="10" spellcheck="false"
                    class="campo-codigo-textarea"
                    placeholder="import { test, expect } from '@playwright/test';&#10;&#10;test('test', async ({ page }) => {&#10;  await page.goto('http://localhost:4200/login');&#10;  ...&#10;});"></textarea>
        </mat-form-field>

        <mat-form-field appearance="outline" class="campo-full">
          <mat-label>Nombre del grupo de casos *</mat-label>
          <input matInput [(ngModel)]="nombreBase" maxlength="150" placeholder="Ej: Alta de proveedor">
          <mat-hint>Se van a crear 3 casos: "{{ nombreBase || '…' }} (funcional)", "(seguridad)" y "(accesibilidad)".</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="campo-full">
          <mat-label>Transcripción del proceso</mat-label>
          <textarea matInput [(ngModel)]="transcripcion" rows="6" maxlength="20000" spellcheck="false"
                    placeholder="Describí en prosa qué hace la automatización, paso a paso.&#10;&#10;Ej: El operador entra a Nuevo Usuario, carga nombre y correo, elige el rol Desarrollador y lo crea. Después va a Facturación, selecciona ese cliente, agrega un ítem con descripción, cantidad y precio, y emite la factura."></textarea>
          <mat-hint>
            Se guarda igual en los 3 casos, junto al código. Sirve para documentar la automatización
            y para que después se puedan responder preguntas sobre ella.
          </mat-hint>
        </mat-form-field>

        <div class="toggle-guardar" [class.activo]="permitirGuardar">
          <mat-checkbox [(ngModel)]="permitirGuardar" color="warn">
            Permitir click en botones de guardar/confirmar
          </mat-checkbox>
          <p>
            Apagado (recomendado): al llegar a un botón como "Crear", "Guardar" o "Emitir", el caso solo
            verifica que existe y está habilitado, y se detiene ahí. Prendido: hace el click real y sigue el
            flujo completo — en los 3 niveles, en cada corrida. Va a crear datos reales.
          </p>
        </div>

        <div class="acciones-generador">
          <button mat-stroked-button [disabled]="analizando || !codigo.trim()" (click)="analizarSpec()">
            <span *ngIf="analizando" class="spinner-mini"></span>
            {{ analizando ? 'Analizando…' : 'Analizar' }}
          </button>
          <button mat-flat-button class="btn-generar"
                  [disabled]="!analisis || generando || !nombreBase.trim()"
                  (click)="generarCasos()">
            <span *ngIf="generando" class="spinner-mini"></span>
            {{ generando ? 'Generando…' : 'Generar 3 casos' }}
          </button>
        </div>
      </div>

      <!-- Preview del analisis -->
      <div class="config-card preview-card" *ngIf="analisis">
        <label class="config-label">Vista previa</label>

        <div class="preview-fila" *ngIf="analisis.login_detectado_y_omitido">
          <mat-icon>verified_user</mat-icon>
          Se detectó y omitió el login inicial: los 3 casos reutilizan la sesión que ya inicia el Spider.
        </div>

        <div class="preview-fila alerta" *ngIf="analisis.corte_sin_permitir_guardar && !permitirGuardar">
          <mat-icon>warning</mat-icon>
          Con "permitir guardar" apagado, el flujo se corta después de verificar
          <b>"{{ analisis.corte_sin_permitir_guardar }}"</b>. Los pasos posteriores del spec no se incluyen.
        </div>

        <div class="preview-fila" *ngIf="analisis.lineas_no_reconocidas > 0">
          <mat-icon>help_outline</mat-icon>
          {{ analisis.lineas_no_reconocidas }} línea(s) del spec no se pudieron interpretar; se descartan.
        </div>

        <div class="preview-columnas">
          <div class="preview-columna">
            <span class="preview-titulo">{{ analisis.total_campos }} campo(s) detectado(s)</span>
            <div class="campo-chip" *ngFor="let c of analisis.campos">
              <mat-icon>{{ iconoFamilia(c.familia) }}</mat-icon>
              <div>
                <b>{{ c.nombre }}</b>
                <span>{{ c.familia }} · valor grabado: "{{ c.valor_original }}"</span>
              </div>
            </div>
          </div>
          <div class="preview-columna">
            <span class="preview-titulo">{{ analisis.total_botones_guardado }} botón(es) de guardado</span>
            <div class="campo-chip guardado" *ngFor="let b of analisis.botones_guardado">
              <mat-icon>{{ permitirGuardar ? 'touch_app' : 'shield' }}</mat-icon>
              <div>
                <b>{{ b.nombre }}</b>
                <span>{{ permitirGuardar ? 'se va a clickear de verdad' : 'solo se verifica que está habilitado' }}</span>
              </div>
            </div>
            <p class="sin-datos" *ngIf="!analisis.botones_guardado.length">No se detectó ninguno.</p>
          </div>
        </div>
      </div>

      <!-- Resultado de la generacion -->
      <div class="config-card resultado-card" *ngIf="resultado">
        <mat-icon>check_circle</mat-icon>
        <div>
          <b>Se crearon 3 casos en "Casos propios"</b>
          <ul>
            <li *ngFor="let c of resultado.casos">{{ c.nombre }}</li>
          </ul>
          <p>Andá a la pestaña <b>Spider QA</b> para verlos, ejecutarlos individualmente o editarlos.</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .lab-panel { max-width: 900px; margin: 0 auto; }
    .panel-header { margin-bottom: 24px; }
    .panel-title { display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 8px; }
    .title-icon { color: #8b5cf6; }
    .panel-desc { font-size: 13px; color: #64748b; line-height: 1.5; margin: 0; }

    .config-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin-bottom: 16px; }
    .config-label { display: block; font-size: 12px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
    .campo-full { width: 100%; }
    .campo-codigo-textarea { font-family: Consolas, 'SFMono-Regular', monospace; font-size: 12.5px; line-height: 1.5; }

    .upload-fila { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .nombre-archivo { font-size: 12px; color: #475569; font-weight: 600; }

    .toggle-guardar { margin: 8px 0 16px; padding: 12px 16px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; }
    .toggle-guardar.activo { background: #fef2f2; border-color: #fecaca; }
    .toggle-guardar p { margin: 6px 0 0 32px; font-size: 11.5px; color: #64748b; line-height: 1.5; }

    .acciones-generador { display: flex; gap: 12px; }
    .btn-generar { background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: white; font-weight: 700; border-radius: 10px; }
    .spinner-mini { display: inline-block; width: 13px; height: 13px; margin-right: 6px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: giro 1s linear infinite; vertical-align: middle; }
    @keyframes giro { to { transform: rotate(360deg); } }

    .preview-fila { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 8px; background: #f0fdf4; color: #166534; font-size: 12.5px; margin-bottom: 10px; }
    .preview-fila mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .preview-fila.alerta { background: #fffbeb; color: #854d0e; }

    .preview-columnas { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
    .preview-titulo { display: block; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 10px; }
    .campo-chip { display: flex; gap: 10px; padding: 8px 10px; border-radius: 8px; background: #f8fafc; margin-bottom: 6px; }
    .campo-chip mat-icon { font-size: 16px; width: 16px; height: 16px; color: #8b5cf6; flex-shrink: 0; margin-top: 2px; }
    .campo-chip.guardado mat-icon { color: #f59e0b; }
    .campo-chip b { display: block; font-size: 12px; color: #0f172a; }
    .campo-chip span { display: block; font-size: 11px; color: #64748b; }
    .sin-datos { font-size: 12px; color: #94a3b8; }

    .resultado-card { display: flex; gap: 12px; background: #f0fdf4; border-color: #bbf7d0; }
    .resultado-card > mat-icon { color: #16a34a; }
    .resultado-card b { color: #166534; }
    .resultado-card ul { margin: 8px 0; padding-left: 18px; font-size: 12.5px; }
    .resultado-card p { margin: 0; font-size: 12px; color: #475569; }

    @media (max-width: 768px) { .preview-columnas { grid-template-columns: 1fr; } }
  `],
})
export class QaSpecGeneradorComponent {
  /** Avisa al contenedor que se crearon casos nuevos, para refrescar la lista. */
  @Output() casosGenerados = new EventEmitter<void>();

  codigo = '';
  nombreBase = '';
  transcripcion = '';
  nombreArchivo = '';
  permitirGuardar = false;

  analizando = false;
  generando = false;
  analisis: AnalisisSpecResultado | null = null;
  resultado: GenerarDesdeSpecResultado | null = null;

  constructor(
    private service: QaSpecGeneradorService,
    private snackBar: MatSnackBar,
  ) {}

  onArchivoSeleccionado(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;

    this.nombreArchivo = archivo.name;
    if (!this.nombreBase) this.nombreBase = archivo.name.replace(/\.spec\.ts$|\.ts$|\.txt$/i, '');

    const lector = new FileReader();
    lector.onload = () => {
      this.codigo = String(lector.result ?? '');
      this.invalidarAnalisis();
    };
    lector.readAsText(archivo);
  }

  invalidarAnalisis(): void {
    this.analisis = null;
    this.resultado = null;
  }

  iconoFamilia(familia: string): string {
    return ICONO_FAMILIA[familia] ?? 'help_outline';
  }

  analizarSpec(): void {
    this.analizando = true;
    this.resultado = null;
    this.service.analizar(this.codigo).subscribe({
      next: (analisis) => {
        this.analizando = false;
        this.analisis = analisis;
      },
      error: (err) => {
        this.analizando = false;
        this.avisar('No se pudo analizar: ' + this.mensajeError(err));
      },
    });
  }

  generarCasos(): void {
    if (!this.analisis) return;
    this.generando = true;
    this.service
      .generar({
        codigo: this.codigo,
        nombreBase: this.nombreBase.trim(),
        transcripcion: this.transcripcion.trim() || undefined,
        nombreArchivo: this.nombreArchivo || undefined,
        permitirGuardar: this.permitirGuardar,
      })
      .subscribe({
        next: (resultado) => {
          this.generando = false;
          this.resultado = resultado;
          this.avisar('Se crearon 3 casos. Andá a Spider QA → Casos propios para ejecutarlos.');
          this.casosGenerados.emit();
        },
        error: (err) => {
          this.generando = false;
          this.avisar('No se pudo generar: ' + this.mensajeError(err));
        },
      });
  }

  private mensajeError(err: any): string {
    return err?.error?.message ?? err?.message ?? 'error desconocido';
  }

  private avisar(mensaje: string): void {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 5000 });
  }
}
