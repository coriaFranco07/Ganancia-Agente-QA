import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { QaRunnerService } from './qa-runner.service';

@Controller('qa')
@UseGuards(AuthGuard)
export class QaRunnerController {
  constructor(private readonly service: QaRunnerService) {}

  @Post('casos/:id/ejecutar')
  ejecutar(@Param('id') id: string, @Body('modo') modo?: unknown) {
    return this.service.ejecutarCaso(id, modo);
  }

  @Get('ejecuciones/ultimas')
  ultimas() {
    return this.service.listarUltimas();
  }

  @Get('ejecuciones/:id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }
}
