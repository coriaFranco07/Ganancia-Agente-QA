import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { QaCasosService } from './qa-casos.service';

@Controller('qa/casos')
@UseGuards(AuthGuard)
export class QaCasosController {
  constructor(private readonly service: QaCasosService) {}

  @Get()
  listar(
    @Query('activo') activo?: string,
    @Query('pantalla_origen') pantallaOrigen?: string,
    @Query('pantalla') pantalla?: string,
  ) {
    if (pantalla) return this.service.listarPorPantalla(pantalla, activo !== 'false');
    return this.service.listar(activo !== 'false', pantallaOrigen);
  }

  @Get('fuentes')
  fuentes() {
    return this.service.fuentes();
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Post()
  guardar(@Body() body: unknown) {
    return this.service.guardar(body);
  }

  @Post('importar')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024 } }))
  importar(@UploadedFile() archivo?: Express.Multer.File, @Body() body?: unknown) {
    if (!archivo) throw new BadRequestException('Debe adjuntar un archivo de importación.');
    return this.service.importarDatos(archivo, body);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.service.desactivar(id);
  }
}
