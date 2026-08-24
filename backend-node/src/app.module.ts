import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthController } from './modules/health/health.controller';
import { VersionController } from './modules/version/version.controller';
import { NormalizadorService } from './modules/normalizacion/normalizador.service';
import { SheetjsExcelService } from './modules/excel/sheetjs-excel.service';
import { ParserReporteExtendidoService } from './modules/excel/parser-reporte-extendido.service';
import { EscalaArt94Service } from './modules/motor-ganancias/escala-art94.service';
import { DetectorSacService } from './modules/motor-ganancias/detector-sac.service';
import { MotorGananciasService } from './modules/motor-ganancias/motor-ganancias.service';
import { MotorReferenciaGananciasService } from './modules/motor-ganancias/motor-referencia-ganancias.service';
import { ValidacionesService } from './modules/motor-ganancias/validaciones.service';
import { CatalogoValidacionesService } from './modules/motor-ganancias/catalogo-validaciones.service';
import { DetalleMensualService } from './modules/motor-ganancias/detalle-mensual.service';
import { SnapshotService } from './modules/motor-ganancias/snapshot.service';
import { ReporteService } from './modules/motor-ganancias/reporte.service';
import { ContextoComplementarioService } from './modules/contexto-complementario/contexto-complementario.service';
import { AnalisisController } from './modules/analisis/analisis.controller';
import { AnalisisService } from './modules/analisis/analisis.service';
import { AnalisisSnapshot, AnalisisSnapshotSchema } from './modules/analisis/schemas/analisis-snapshot.schema';
import { ArchivoProcesado, ArchivoProcesadoSchema } from './modules/archivos/schemas/archivo-procesado.schema';
import { Cliente, ClienteSchema, EscalaArt94, EscalaArt94Schema, Legajo, LegajoSchema, ParametroNormativo, ParametroNormativoSchema } from './modules/normativa/schemas/normativa.schema';
import { DiagnosticosController } from './modules/diagnosticos/diagnosticos.controller';
import { ConfiguracionController } from './modules/configuracion/configuracion.controller';
import { ExplicacionesIaService } from './modules/explicaciones/explicaciones-ia.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthService } from './modules/auth/auth.service';
import { Usuario, UsuarioSchema } from './modules/auth/schemas/usuario.schema';
import { QaCasosController } from './modules/qa/qa-casos.controller';
import { QaCasosService } from './modules/qa/qa-casos.service';
import { QaDatasetsController } from './modules/qa/qa-datasets.controller';
import { QaDatasetsService } from './modules/qa/qa-datasets.service';
import { QaRunnerController } from './modules/qa/qa-runner.controller';
import { QaRunnerService } from './modules/qa/qa-runner.service';
import { QaCaso, QaCasoSchema } from './modules/qa/schemas/qa-caso.schema';
import { QaEjecucion, QaEjecucionSchema } from './modules/qa/schemas/qa-ejecucion.schema';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/auditoria_ganancias', { serverSelectionTimeoutMS: 5000 }),
    MongooseModule.forFeature([
      {name:AnalisisSnapshot.name,schema:AnalisisSnapshotSchema},{name:ArchivoProcesado.name,schema:ArchivoProcesadoSchema},
      {name:Cliente.name,schema:ClienteSchema},{name:Legajo.name,schema:LegajoSchema},{name:ParametroNormativo.name,schema:ParametroNormativoSchema},{name:EscalaArt94.name,schema:EscalaArt94Schema},
      {name:Usuario.name,schema:UsuarioSchema},
      {name:QaCaso.name,schema:QaCasoSchema},
      {name:QaEjecucion.name,schema:QaEjecucionSchema},
    ]),
  ],
  controllers: [HealthController, VersionController, AuthController, AnalisisController, DiagnosticosController, ConfiguracionController, QaCasosController, QaDatasetsController, QaRunnerController],
  providers: [
    AuthService,
    AuthGuard,
    NormalizadorService,
    SheetjsExcelService,
    ParserReporteExtendidoService,
    EscalaArt94Service,
    DetectorSacService,
    MotorGananciasService,
    MotorReferenciaGananciasService,
    ValidacionesService,
    CatalogoValidacionesService,
    DetalleMensualService,
    SnapshotService,
    ContextoComplementarioService,
    ExplicacionesIaService,
    ReporteService,
    AnalisisService,
    QaCasosService,
    QaDatasetsService,
    QaRunnerService,
  ],
})
export class AppModule {}
