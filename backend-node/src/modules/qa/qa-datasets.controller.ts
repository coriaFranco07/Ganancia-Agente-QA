import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { QaDatasetsService } from './qa-datasets.service';

@Controller('qa/datasets')
@UseGuards(AuthGuard)
export class QaDatasetsController {
  constructor(private readonly service: QaDatasetsService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Get(':codigo')
  obtener(@Param('codigo') codigo: string) {
    return this.service.obtener(codigo);
  }
}
