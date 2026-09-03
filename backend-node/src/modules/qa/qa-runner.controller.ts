import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
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

  @Get('ejecuciones/conteos')
  conteos() {
    return this.service.contarPorCaso();
  }

  @Get('ejecuciones/:id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Get('ejecuciones/:id/capturas/:index')
  async captura(@Param('id') id: string, @Param('index') index: string, @Res() response: Response) {
    const captura = await this.service.obtenerCaptura(id, index);
    response.type('image/png');
    response.setHeader('Cache-Control', 'private, max-age=60');
    response.setHeader('Content-Disposition', `inline; filename="${captura.nombre}"`);
    return response.sendFile(captura.path);
  }
}
