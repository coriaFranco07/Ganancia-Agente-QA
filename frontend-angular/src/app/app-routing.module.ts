import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { InicioComponent } from './pages/inicio/inicio.component';
import { CargarExcelComponent } from './pages/cargar-excel/cargar-excel.component';
import { AnalisisComponent } from './pages/analisis/analisis.component';
import { CalculoComponent } from './pages/calculo/calculo.component';
import { DiagnosticosComponent } from './pages/diagnosticos/diagnosticos.component';
import { HistorialComponent } from './pages/historial/historial.component';
import { ConfiguracionComponent } from './pages/configuracion/configuracion.component';
import { DatosComplementariosComponent } from './pages/datos-complementarios/datos-complementarios.component';
import { LoginComponent } from './pages/login/login.component';
import { QaAsistenteComponent } from './pages/qa-asistente/qa-asistente.component';
import { QaPantalla1Component } from './pages/qa-pantalla-1/qa-pantalla-1.component';
import { QaPantalla2Component } from './pages/qa-pantalla-2/qa-pantalla-2.component';
import { QaPantalla3Component } from './pages/qa-pantalla-3/qa-pantalla-3.component';
import { QaSopLoomComponent } from './pages/qa-sop-loom/qa-sop-loom.component';
import { QaCasosComponent } from './pages/qa-casos/qa-casos.component';
import { AuthGuard } from './core/guards/auth.guard';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'inicio', component: InicioComponent, canActivate: [AuthGuard] },
  { path: 'cargar-excel', component: CargarExcelComponent, canActivate: [AuthGuard] },
  { path: 'analisis', component: AnalisisComponent, canActivate: [AuthGuard] },
  { path: 'analisis/:id', component: AnalisisComponent, canActivate: [AuthGuard] },
  { path: 'analisis/:id/datos-complementarios', component: DatosComplementariosComponent, canActivate: [AuthGuard] },
  { path: 'calculo', component: CalculoComponent, canActivate: [AuthGuard] },
  { path: 'calculo/:id', component: CalculoComponent, canActivate: [AuthGuard] },
  { path: 'diagnosticos', component: DiagnosticosComponent, canActivate: [AuthGuard] },
  { path: 'diagnosticos/:id', component: DiagnosticosComponent, canActivate: [AuthGuard] },
  { path: 'historial', component: HistorialComponent, canActivate: [AuthGuard] },
  { path: 'configuracion', component: ConfiguracionComponent, canActivate: [AuthGuard] },
  { path: 'qa/asistente', component: QaAsistenteComponent, canActivate: [AuthGuard] },
  { path: 'qa/pantalla-1', component: QaPantalla1Component, canActivate: [AuthGuard] },
  { path: 'qa/pantalla-2', component: QaPantalla2Component, canActivate: [AuthGuard] },
  { path: 'qa/pantalla-3', component: QaPantalla3Component, canActivate: [AuthGuard] },
  { path: 'qa/sop-loom', component: QaSopLoomComponent, canActivate: [AuthGuard] },
  { path: 'qa/casos', component: QaCasosComponent, canActivate: [AuthGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'inicio' },
  { path: '**', redirectTo: 'inicio' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'enabled' })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
