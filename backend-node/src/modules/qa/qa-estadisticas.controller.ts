import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { QaEstadisticasService } from './qa-estadisticas.service';

@Controller('qa/estadisticas')
@UseGuards(AuthGuard)
export class QaEstadisticasController {
  constructor(private readonly service: QaEstadisticasService) {}

  @Get()
  resumen() {
    return this.service.resumen();
  }
}
