import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthGuard } from '../../auth/auth.guard';
import { AnalizarSpecDto, GenerarDesdeSpecDto, QaSpecGeneradorService } from './qa-spec-generador.service';

class AnalizarSpecBody implements AnalizarSpecDto {
  @IsString() @MinLength(1) @MaxLength(200_000) codigo: string;
}

class GenerarDesdeSpecBody implements GenerarDesdeSpecDto {
  @IsString() @MinLength(1) @MaxLength(200_000) codigo: string;
  @IsString() @MinLength(1) @MaxLength(200) nombreBase: string;
  @IsString() @IsOptional() @MaxLength(20_000) transcripcion?: string;
  @IsString() @IsOptional() @MaxLength(200) nombreArchivo?: string;
  @IsBoolean() @IsOptional() permitirGuardar?: boolean;
  @IsIn(['global', 'ruta']) @IsOptional() ambito?: 'global' | 'ruta';
  @IsArray() @IsOptional() @IsString({ each: true }) aplicaA?: string[];
}

/**
 * Genera casos del Spider (suave/media/extrema) a partir de un spec de
 * Playwright Codegen subido por el operador. Los casos resultantes quedan en
 * la misma coleccion que "Casos propios": se listan, editan, ejecutan y
 * borran desde ahi como cualquier otro caso.
 */
@Controller('qa/spider/generador')
@UseGuards(AuthGuard)
export class QaSpecGeneradorController {
  constructor(private readonly service: QaSpecGeneradorService) {}

  @Post('analizar')
  analizar(@Body() body: AnalizarSpecBody) {
    return this.service.analizar(body);
  }

  @Post('generar')
  generar(@Body() body: GenerarDesdeSpecBody) {
    return this.service.generar(body);
  }
}
