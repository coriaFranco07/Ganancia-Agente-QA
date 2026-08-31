import { Component } from '@angular/core';

@Component({
  selector: 'app-qa-pantalla-2',
  template: `
    <main class="qa-page">
      <section class="titulo-seccion">
        <h1>
          <mat-icon>rule</mat-icon>
          QA - Pantalla 2
        </h1>
        <p>Espacio reservado para el próximo flujo de pruebas.</p>
      </section>

      <mat-card class="panel">
        <mat-icon>pending_actions</mat-icon>
        <div>
          <h2>Pantalla 2</h2>
          <p>Queda creada en el menú para separar los casos QA del módulo de datasets.</p>
        </div>
      </mat-card>
    </main>
  `,
  styles: [`
    :host {
      display: block;
    }

    .qa-page {
      padding: 24px;
      display: grid;
      gap: 16px;
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
    }

    .titulo-seccion h1 mat-icon {
      color: #2563eb;
    }

    .titulo-seccion p {
      margin: 6px 0 0 34px;
      color: #64748b;
      font-size: 13px;
    }

    .panel {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      max-width: 680px;
      padding: 18px;
      border: 1px solid #dce7f7;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 12px 34px rgba(15, 23, 42, 0.06);
    }

    .panel > mat-icon {
      color: #2563eb;
    }

    .panel h2 {
      margin: 0;
      color: #0f172a;
      font-size: 16px;
      font-weight: 950;
    }

    .panel p {
      margin: 5px 0 0;
      color: #64748b;
      font-size: 13px;
      line-height: 1.45;
    }

    @media (max-width: 720px) {
      .qa-page {
        padding: 16px 12px 24px;
      }

      .titulo-seccion p {
        margin-left: 0;
      }
    }
  `]
})
export class QaPantalla2Component {}
