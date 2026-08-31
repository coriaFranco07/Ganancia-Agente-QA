import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { UsuarioSesion } from '../auth/auth.service';
import { AuthGuard } from '../auth/auth.guard';
import { QaHallazgosService } from './qa-hallazgos.service';

@Controller('qa/hallazgos')
@UseGuards(AuthGuard)
export class QaHallazgosController {
  constructor(private readonly service: QaHallazgosService) {}

  @Get()
  listar(@Query() query: Record<string, unknown>) {
    return this.service.listar(query);
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Post(':id/estado')
  cambiarEstado(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { usuario?: UsuarioSesion },
  ) {
    return this.service.cambiarEstado(id, body, req.usuario);
  }
}
