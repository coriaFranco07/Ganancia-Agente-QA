import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsString, ArrayMinSize } from 'class-validator';
import { Request } from 'express';
import { UsuarioSesion } from '../../auth/auth.service';
import { AuthGuard } from '../../auth/auth.guard';
import { QaSuiteRunnerService } from './qa-suite-runner.service';

class DispararCorridaDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  aprendizajes: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['funcional', 'seguridad', 'accesibilidad'], { each: true })
  categorias: ('funcional' | 'seguridad' | 'accesibilidad')[];

  @IsIn(['rapido', 'demo'])
  modo: 'rapido' | 'demo';
}

@Controller('qa/suite')
@UseGuards(AuthGuard)
export class QaSuiteController {
  constructor(private readonly service: QaSuiteRunnerService) {}

  @Get('aprendizajes')
  aprendizajes() {
    return this.service.listarAprendizajesAprobados();
  }

  @Post('vista-previa')
  vistaPrevia(@Body() body: DispararCorridaDto) {
    return this.service.previsualizar(body.aprendizajes, body.categorias);
  }

  @Post('corridas')
  dispararCorrida(@Body() body: DispararCorridaDto, @Req() request: Request & { usuario?: UsuarioSesion }) {
    const disparadoPor = request.usuario?.correo ?? 'desconocido';
    return this.service.dispararCorrida(body.aprendizajes, body.categorias, body.modo, disparadoPor);
  }

  @Get('corridas')
  listarCorridas() {
    return this.service.listarCorridas();
  }

  @Get('corridas/:id')
  obtenerCorrida(@Param('id') id: string) {
    return this.service.obtenerCorrida(id);
  }
}
