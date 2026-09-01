import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { QaCatalogoService } from './qa-catalogo.service';

/**
 * Unico endpoint publico del catalogo del Spider. La version cruda
 * (`catalogoCrudo()`) no se expone: incluye los payloads de fuzzing y solo la
 * consume el generador desde spec dentro del backend.
 */
@Controller('qa/spider')
@UseGuards(AuthGuard)
export class QaCatalogoController {
  constructor(private readonly service: QaCatalogoService) {}

  /**
   * GET /api/qa/spider/catalogo
   * Catalogo declarativo: secciones navegables, niveles y casos del catalogo.
   */
  @Get('catalogo')
  catalogo() {
    return this.service.catalogoSpider();
  }
}
