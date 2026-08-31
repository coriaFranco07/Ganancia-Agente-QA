import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { QaDefinicionesTecnicasService } from './qa-definiciones-tecnicas.service';

@Controller('qa/definiciones-tecnicas')
@UseGuards(AuthGuard)
export class QaDefinicionesTecnicasController {
  constructor(private readonly service: QaDefinicionesTecnicasService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Get(':codigo/estado')
  estado(@Param('codigo') codigo: string) {
    return this.service.estado(codigo);
  }

  @Get(':codigo')
  obtener(@Param('codigo') codigo: string) {
    return this.service.obtener(codigo);
  }

  @Post()
  guardar(@Body() body: unknown) {
    return this.service.guardar(body);
  }
}
