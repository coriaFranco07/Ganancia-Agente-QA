import { Body, Controller, Delete, Get, Param, Post, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { QaPantallaInspectorService } from './qa-pantalla-inspector.service';
import { QaSopLoomService } from './qa-sop-loom.service';

@Controller('qa/sop-loom')
@UseGuards(AuthGuard)
export class QaSopLoomController {
  constructor(
    private readonly service: QaSopLoomService,
    private readonly inspector: QaPantallaInspectorService,
  ) {}

  @Post('inspeccionar')
  inspeccionar(
    @Body('ruta') ruta: unknown,
    @Req() request: Request & { usuario?: unknown },
  ) {
    return this.inspector.inspeccionar(ruta, request.headers.cookie, request.usuario);
  }

  @Get('inspecciones/:id/captura')
  async captura(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const captura = await this.inspector.captura(id);
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Content-Disposition', `inline; filename="${captura.nombre}"`);
    response.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(captura.buffer);
  }

  @Get('aprendizajes')
  listar() {
    return this.service.listar();
  }

  @Get('aprendizajes/:id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Post('aprendizajes')
  guardar(@Body() body: unknown) {
    return this.service.guardar(body);
  }

  @Post('aprendizajes/:id/firmar/:tipo')
  firmar(
    @Param('id') id: string,
    @Param('tipo') tipo: string,
    @Req() request: Request & { usuario?: unknown },
  ) {
    return this.service.firmar(id, tipo, request.usuario);
  }

  @Post('aprendizajes/:id/ejecutar')
  ejecutar(
    @Param('id') id: string,
    @Body('modo') modo: unknown,
    @Req() request: Request & { usuario?: unknown },
  ) {
    return this.service.ejecutar(id, modo, request.headers.cookie);
  }

  @Delete('aprendizajes/:id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }
}
