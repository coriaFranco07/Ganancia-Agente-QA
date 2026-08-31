import { Component } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  template: `
    <main class="login-page">
      <section class="login-left">
        <div class="login-panel">
          <img class="logo" src="/assets/logo-esueldos-login.png" alt="e-Sueldos" />

          <div class="bienvenida">
            <h1>Bienvenido</h1>
            <p>Accedé a la plataforma de Auditoría de Ganancias de e-Sueldos</p>
          </div>

          <form [formGroup]="form" (ngSubmit)="ingresar()" class="formulario">
            <label class="campo-login">
              <mat-icon>mail</mat-icon>
              <input
                data-testid="auth-email-input"
                type="email"
                formControlName="correo"
                autocomplete="username"
                placeholder="Correo electrónico"
                aria-label="Correo electrónico" />
            </label>

            <label class="campo-login">
              <mat-icon>lock</mat-icon>
              <input
                data-testid="auth-password-input"
                [type]="mostrarContrasena ? 'text' : 'password'"
                formControlName="contrasena"
                autocomplete="current-password"
                placeholder="Contraseña"
                aria-label="Contraseña" />
              <button
                data-testid="auth-password-toggle"
                type="button"
                class="ver-password"
                (click)="mostrarContrasena = !mostrarContrasena"
                [attr.aria-label]="mostrarContrasena ? 'Ocultar contraseña' : 'Mostrar contraseña'">
                <mat-icon>{{ mostrarContrasena ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
            </label>

            <div *ngIf="error" class="error-login" data-testid="auth-error">
              <mat-icon>error_outline</mat-icon>
              <span>{{ error }}</span>
            </div>

            <button data-testid="auth-submit-button" type="submit" class="btn-login" [disabled]="form.invalid || cargando">
              <mat-spinner *ngIf="cargando" diameter="18"></mat-spinner>
              <mat-icon *ngIf="!cargando">lock</mat-icon>
              {{ cargando ? 'Ingresando...' : 'Iniciar sesión' }}
            </button>
          </form>

          <footer>e-Sueldos © 2026 · Todos los derechos reservados</footer>
        </div>
      </section>

      <section class="login-right" aria-hidden="true">
        <div class="right-overlay"></div>
        <div class="auditoria-copy">
          <div class="titulo-derecha">
            <div class="shield">
              <mat-icon>verified_user</mat-icon>
            </div>
            <div>
              <h2>Auditoría de Ganancias</h2>
              <p>Precisión, control y confianza en cada auditoría.</p>
            </div>
          </div>

          <div class="beneficios">
            <div class="beneficio">
              <span><mat-icon>fact_check</mat-icon></span>
              <div>
                <strong>Validación automática</strong>
                <p>Verificá cálculos e inconsistencias</p>
              </div>
            </div>

            <div class="beneficio">
              <span><mat-icon>assignment_turned_in</mat-icon></span>
              <div>
                <strong>Reportes confiables</strong>
                <p>Generá informes precisos y trazables</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  `,
  styles: [`
    :host {
      display: block;
    }

    .login-page {
      min-height: 100vh;
      display: grid;
      grid-template-columns: minmax(360px, 48%) minmax(420px, 52%);
      background: #f8fafc;
      color: #0f172a;
    }

    .login-left {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 36px;
      background:
        radial-gradient(circle at 20% 10%, rgba(37, 99, 235, 0.08), transparent 30%),
        linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
    }

    .login-panel {
      width: min(100%, 390px);
      min-height: min(100vh - 72px, 700px);
      display: grid;
      align-content: center;
      gap: 24px;
    }

    .logo {
      width: 250px;
      justify-self: center;
      border-radius: 0;
    }

    .bienvenida {
      text-align: center;
    }

    .bienvenida h1 {
      margin: 0;
      color: #172554;
      font-size: 30px;
      font-weight: 950;
      letter-spacing: -0.035em;
    }

    .bienvenida p {
      width: min(100%, 300px);
      margin: 10px auto 0;
      color: #475569;
      font-size: 15px;
      line-height: 1.55;
    }

    .formulario {
      display: grid;
      gap: 14px;
    }

    .campo-login {
      height: 50px;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 13px;
      border: 1px solid #cbd7ea;
      border-radius: 10px;
      background: #ffffff;
      color: #0f172a;
      transition: border-color 160ms ease, box-shadow 160ms ease;
    }

    .campo-login:focus-within {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
    }

    .campo-login > mat-icon {
      color: #64748b;
      font-size: 19px;
      width: 19px;
      height: 19px;
      flex: 0 0 auto;
    }

    .campo-login input {
      width: 100%;
      min-width: 0;
      height: 42px;
      border: 0;
      outline: 0;
      background: transparent;
      color: #0f172a;
      font: inherit;
      font-size: 15px;
      font-weight: 650;
    }

    .campo-login input::placeholder {
      color: #64748b;
      opacity: 1;
    }

    .ver-password {
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #64748b;
      cursor: pointer;
    }

    .ver-password:hover {
      background: #f1f5f9;
      color: #2563eb;
    }

    .ver-password mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }

    .error-login {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid #fecaca;
      border-radius: 10px;
      background: #fff1f2;
      color: #be123c;
      font-size: 13px;
      font-weight: 750;
    }

    .error-login mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .btn-login {
      height: 50px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 0;
      border-radius: 10px;
      background: #2457e6;
      color: #ffffff;
      font: inherit;
      font-size: 15px;
      font-weight: 900;
      cursor: pointer;
      box-shadow: 0 14px 28px rgba(37, 99, 235, 0.24);
      transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
    }

    .btn-login:hover:not(:disabled) {
      transform: translateY(-1px);
      background: #1d4ed8;
      box-shadow: 0 18px 34px rgba(37, 99, 235, 0.28);
    }

    .btn-login:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      box-shadow: none;
    }

    .btn-login mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    footer {
      align-self: end;
      justify-self: center;
      margin-top: 46px;
      color: #64748b;
      font-size: 11px;
    }

    .login-right {
      position: relative;
      min-height: 100vh;
      overflow: hidden;
      display: grid;
      place-items: start center;
      padding: 72px 84px;
      color: #ffffff;
      background:
        linear-gradient(rgba(9, 37, 92, 0.78), rgba(9, 37, 92, 0.78)),
        radial-gradient(circle at 78% 70%, rgba(255,255,255,0.22), transparent 10%),
        linear-gradient(135deg, #0f2d62 0%, #1e4a9b 52%, #14366f 100%);
    }

    .login-right::before {
      content: '';
      position: absolute;
      inset: 0;
      opacity: 0.33;
      background:
        linear-gradient(110deg, transparent 0 38%, rgba(255,255,255,0.08) 39% 42%, transparent 43%),
        radial-gradient(ellipse at 70% 70%, transparent 0 26%, rgba(255,255,255,.12) 27%, transparent 29%),
        repeating-linear-gradient(90deg, rgba(255,255,255,.06) 0 1px, transparent 1px 110px);
      filter: blur(0.3px);
    }

    .login-right::after {
      content: '';
      position: absolute;
      right: 8%;
      bottom: 7%;
      width: 360px;
      height: 240px;
      border-radius: 36px;
      opacity: 0.22;
      background:
        linear-gradient(90deg, transparent 0 34%, rgba(255,255,255,.55) 35% 36%, transparent 37%),
        linear-gradient(0deg, transparent 0 72%, rgba(255,255,255,.48) 73% 75%, transparent 76%),
        linear-gradient(135deg, rgba(255,255,255,.12), rgba(255,255,255,.03));
      transform: perspective(700px) rotateX(58deg) rotateZ(-8deg);
      box-shadow: 0 30px 90px rgba(0,0,0,.28);
    }

    .auditoria-copy {
      position: relative;
      z-index: 1;
      width: min(100%, 520px);
      display: grid;
      gap: 42px;
      justify-self: center;
      margin-top: 6vh;
    }

    .titulo-derecha {
      display: flex;
      align-items: flex-start;
      gap: 20px;
    }

    .shield {
      width: 56px;
      height: 56px;
      display: grid;
      place-items: center;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.55);
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
      flex: 0 0 auto;
    }

    .shield mat-icon {
      font-size: 34px;
      width: 34px;
      height: 34px;
    }

    .titulo-derecha h2 {
      margin: 0;
      font-size: 34px;
      line-height: 1.2;
      font-weight: 950;
      letter-spacing: -0.035em;
    }

    .titulo-derecha p {
      margin: 14px 0 0;
      color: rgba(255, 255, 255, 0.86);
      font-size: 17px;
      line-height: 1.45;
    }

    .beneficios {
      display: grid;
      gap: 28px;
      padding-left: 8px;
    }

    .beneficio {
      display: flex;
      align-items: flex-start;
      gap: 18px;
    }

    .beneficio span {
      width: 46px;
      height: 46px;
      display: grid;
      place-items: center;
      border-radius: 15px;
      background: rgba(255,255,255,.10);
      color: #ffffff;
    }

    .beneficio mat-icon {
      font-size: 25px;
      width: 25px;
      height: 25px;
    }

    .beneficio strong {
      display: block;
      color: #ffffff;
      font-size: 18px;
      font-weight: 900;
    }

    .beneficio p {
      margin: 6px 0 0;
      color: rgba(255, 255, 255, 0.76);
      font-size: 15px;
      line-height: 1.45;
    }

    @media (max-width: 900px) {
      .login-page {
        grid-template-columns: 1fr;
      }

      .login-right {
        display: none;
      }
    }

    @media (max-width: 520px) {
      .login-left {
        padding: 24px 18px;
      }

      .login-panel {
        min-height: calc(100vh - 48px);
      }

      .logo {
        width: 210px;
      }
    }
  `],
})
export class LoginComponent {
  mostrarContrasena = false;
  cargando = false;
  error = '';

  form = this.fb.group({
    correo: ['', [Validators.required, Validators.email]],
    contrasena: ['', [Validators.required, Validators.minLength(6)]],
  });

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router) {}

  ingresar(): void {
    if (this.form.invalid || this.cargando) return;

    const { correo, contrasena } = this.form.getRawValue();
    this.cargando = true;
    this.error = '';

    this.auth
      .login(correo ?? '', contrasena ?? '')
      .pipe(finalize(() => (this.cargando = false)))
      .subscribe({
        next: () => void this.router.navigate(['/inicio']),
        error: () => {
          this.error = 'Correo o contraseña incorrectos.';
        },
      });
  }
}
