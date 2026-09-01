import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AuthGuard } from '../../auth/auth.guard';
import { GuardarQaSpiderCasoDto, QaSpiderCasosService } from './qa-spider-casos.service';

class GuardarCasoBody implements GuardarQaSpiderCasoDto {
  @IsString() @MinLength(1) @MaxLength(200) nombre: string;
  @IsString() @IsOptional() @MaxLength(1000) descripcion?: string;
  @IsString() @IsOptional() @MaxLength(20_000) transcripcion?: string;
  @IsString() @MinLength(1) @MaxLength(100_000) codigo_playwright: string;
  @IsArray() @IsOptional() @ArrayNotEmpty() @IsString({ each: true }) niveles?: string[];
  @IsIn(['global', 'ruta']) @IsOptional() ambito?: string;
  @IsArray() @IsOptional() @IsString({ each: true }) aplica_a?: string[];
  @IsBoolean() @IsOptional() activo?: boolean;
}

class EstadoCasoBody {
  @IsBoolean() activo: boolean;
}

/**
 * Casos del Spider cargados por el operador: codigo Playwright + transcripcion
 * de la pasada. Quedan guardados y se ejecutan dentro de las corridas del Spider.
 */
@Controller('qa/spider/casos')
@UseGuards(AuthGuard)
export class QaSpiderCasosController {
  constructor(private readonly service: QaSpiderCasosService) {}

  @Get()
  listar(@Query('activos') activos?: string) {
    return this.service.listar(activos === 'true');
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Post()
  crear(@Body() body: GuardarCasoBody) {
    return this.service.crear(body);
  }

  @Put(':id')
  actualizar(@Param('id') id: string, @Body() body: GuardarCasoBody) {
    return this.service.actualizar(id, body);
  }

  @Patch(':id/estado')
  cambiarEstado(@Param('id') id: string, @Body() body: EstadoCasoBody) {
    return this.service.alternarActivo(id, body.activo);
  }

  /** Corre este caso ahora mismo, aislado del resto de la corrida del Spider. */
  @Post(':id/ejecutar')
  ejecutar(@Param('id') id: string) {
    return this.service.ejecutar(id);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }
}
