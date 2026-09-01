import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { QaReglasValidacionService } from './qa-reglas-validacion.service';

@Controller('qa/reglas-validacion')
@UseGuards(AuthGuard)
export class QaReglasValidacionController {
  constructor(private readonly service: QaReglasValidacionService) {}

  @Get('catalogo')
  catalogo() {
    return this.service.catalogo();
  }

  @Get()
  listar() {
    return this.service.listar();
  }

  @Post()
  guardar(@Body() body: unknown) {
    return this.service.guardar(body);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }
}
