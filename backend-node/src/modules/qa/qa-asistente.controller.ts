import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { UsuarioSesion } from '../auth/auth.service';
import { AuthGuard } from '../auth/auth.guard';
import { QaAsistenteService } from './qa-asistente.service';

@Controller('qa/asistente')
@UseGuards(AuthGuard)
export class QaAsistenteController {
  constructor(private readonly service: QaAsistenteService) {}

  @Get('contexto')
  contexto(): Promise<Record<string, unknown>> {
    return this.service.contexto();
  }

  @Post('mensajes')
  responder(@Body() body: unknown, @Req() req: Request & { usuario?: UsuarioSesion }): Promise<Record<string, unknown>> {
    return this.service.responder(body, req.usuario);
  }

  @Post('planes')
  crearPlan(@Body() body: unknown, @Req() req: Request & { usuario?: UsuarioSesion }): Promise<Record<string, unknown>> {
    return this.service.crearPlan(body, req.usuario);
  }

  @Get('planes/:id')
  obtenerPlan(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.service.obtenerPlan(id);
  }

  @Post('planes/:id/aprobar')
  aprobarPlan(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { usuario?: UsuarioSesion },
  ): Promise<Record<string, unknown>> {
    return this.service.aprobarPlan(id, body, req.usuario);
  }

  @Post('planes/:id/ejecutar')
  ejecutarPlan(
    @Param('id') id: string,
    @Req() req: Request & { usuario?: UsuarioSesion },
  ): Promise<Record<string, unknown>> {
    return this.service.ejecutarPlan(id, req.usuario);
  }
}
