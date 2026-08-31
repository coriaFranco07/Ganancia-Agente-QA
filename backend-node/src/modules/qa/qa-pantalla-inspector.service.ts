import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, rm } from 'fs/promises';
import { dirname, resolve } from 'path';
import { Model } from 'mongoose';
import { Browser, BrowserContext, Page, chromium } from 'playwright-core';
import { COOKIE_SESION } from '../auth/auth.service';
import {
  QaInspeccionPantalla,
  QaInspeccionPantallaDocument,
} from './schemas/qa-inspeccion-pantalla.schema';

export interface ElementoNavegado {
  testid: string;
  selector: string;
  tag: string;
  tipo: string;
  rol: string;
  nombre: string;
  etiqueta: string;
  placeholder: string;
  obligatorio: boolean;
  deshabilitado: boolean;
  visible: boolean;
  opciones: string[];
  fuente: { tipo: 'navegacion'; ref: string };
}

export interface InspeccionPantalla {
  id: string;
  ruta: string;
  frontend_url: string;
  titulo: string;
  encabezado: string;
  inspeccionada_en: string;
  solicitada_por: string;
  elementos: ElementoNavegado[];
  captura_path: string;
  hash: string;
  activa: boolean;
}

@Injectable()
export class QaPantallaInspectorService {
  constructor(
    @InjectModel(QaInspeccionPantalla.name)
    private readonly inspecciones: Model<QaInspeccionPantallaDocument>,
  ) {}

  async inspeccionar(rutaEntrada: unknown, cookieHeader: string | undefined, usuario: unknown): Promise<InspeccionPantalla> {
    const ruta = this.validarRuta(rutaEntrada);
    const observacion = await this.observar(ruta, cookieHeader);
    const id = `QA-NAV-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const solicitadaPor = this.usuarioTexto(usuario);
    const doc = await this.inspecciones.create({
      id,
      ...observacion,
      solicitada_por: solicitadaPor,
      activa: true,
    });
    await this.purgar(ruta).catch(() => undefined);
    return this.serializar(doc.toObject());
  }

  /**
   * Cada inspección deja un documento y una captura en disco. Se conservan las
   * ultimas `AUDITORIA_QA_INSPECCIONES_RETENIDAS` por ruta (10 por defecto) y
   * nunca se borra una que este referenciada por un aprendizaje vivo.
   */
  private async purgar(ruta: string): Promise<void> {
    const retenidas = Math.max(1, Number(process.env.AUDITORIA_QA_INSPECCIONES_RETENIDAS ?? 10));
    const docs = await this.inspecciones
      .find({ ruta })
      .sort({ inspeccionada_en: -1 })
      .lean<QaInspeccionPantalla[]>();
    if (docs.length <= retenidas) return;

    const candidatas = docs.slice(retenidas);
    const referenciadas = new Set(
      (await this.inspecciones.db
        .collection('qa_sop_loom_aprendizajes')
        .distinct('inspeccion_navegacion.id', { activo: { $ne: false } })) as string[],
    );

    for (const doc of candidatas) {
      const id = this.texto(doc.id);
      if (referenciadas.has(id)) continue;
      const captura = this.texto(doc.captura_path);
      if (captura && existsSync(captura)) await rm(captura, { force: true }).catch(() => undefined);
      await this.inspecciones.deleteOne({ id });
    }
  }

  async resolver(idEntrada: unknown, rutaEntrada: unknown): Promise<InspeccionPantalla> {
    const id = this.texto(idEntrada);
    const ruta = this.validarRuta(rutaEntrada);
    if (!id) throw new BadRequestException('Primero inspeccioná la pantalla real del sandbox.');

    const doc = await this.inspecciones.findOne({ id, activa: { $ne: false } }).lean<QaInspeccionPantalla>();
    if (!doc) throw new NotFoundException(`No existe la inspección de pantalla ${id}.`);
    if (this.normalizarRuta(doc.ruta) !== ruta) {
      throw new BadRequestException(`La inspección ${id} corresponde a ${doc.ruta}, no a ${ruta}.`);
    }
    return this.serializar(doc);
  }

  async revalidar(
    inspeccionAnterior: unknown,
    cookieHeader: string | undefined,
  ): Promise<{ coincide: boolean; hash_anterior: string; hash_actual: string; cambios: string[] }> {
    const anterior = this.objeto(inspeccionAnterior);
    const ruta = this.validarRuta(anterior['ruta']);
    const hashAnterior = this.texto(anterior['hash']);
    if (!hashAnterior) throw new BadRequestException('El aprendizaje no conserva el hash de navegación aprobado.');

    const actual = await this.observar(ruta, cookieHeader, false);
    const anteriores = this.arrayObjetos(anterior['elementos']).map((item) => this.texto(item['testid'])).filter(Boolean);
    const actuales = actual.elementos.map((item) => item.testid);
    const cambios = [
      ...anteriores.filter((testid) => !actuales.includes(testid)).map((testid) => `ya no existe ${testid}`),
      ...actuales.filter((testid) => !anteriores.includes(testid)).map((testid) => `apareció ${testid}`),
    ];
    return {
      coincide: hashAnterior === actual.hash,
      hash_anterior: hashAnterior,
      hash_actual: actual.hash,
      cambios,
    };
  }

  async captura(idEntrada: unknown): Promise<{ buffer: Buffer; nombre: string }> {
    const id = this.texto(idEntrada);
    const doc = await this.inspecciones.findOne({ id, activa: { $ne: false } }).lean<QaInspeccionPantalla>();
    if (!doc) throw new NotFoundException(`No existe la inspección de pantalla ${id}.`);

    const ruta = resolve(this.texto(doc.captura_path));
    const raiz = resolve(process.cwd(), '..', 'outputs', 'playwright', 'qa-sop-loom', 'inspecciones');
    if (!ruta.startsWith(raiz) || !existsSync(ruta)) {
      throw new NotFoundException('La captura de navegación ya no está disponible.');
    }
    return { buffer: await readFile(ruta), nombre: `${id}.png` };
  }

  private async observar(
    ruta: string,
    cookieHeader: string | undefined,
    guardarCaptura = true,
  ): Promise<Omit<InspeccionPantalla, 'id' | 'solicitada_por' | 'activa'>> {
    const frontendUrl = await this.resolverFrontendUrl();
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;

    try {
      const executablePath = this.detectarNavegador();
      browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
      context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-AR' });
      await this.aplicarSesion(context, frontendUrl, cookieHeader);

      const page = await context.newPage();
      page.setDefaultTimeout(Number(process.env.AUDITORIA_PLAYWRIGHT_TIMEOUT_MS ?? 45_000));
      await page.goto(`${frontendUrl}${ruta}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      this.validarSesionNavegada(page, ruta);

      const inspeccionadaEn = new Date().toISOString();
      const ref = `${frontendUrl}${ruta}#${inspeccionadaEn}`;
      const elementos = await this.extraerElementos(page, ref);
      if (!elementos.some((item) => item.visible)) {
        throw new BadRequestException(`La ruta ${ruta} no expone elementos visibles con data-testid.`);
      }

      const titulo = await page.title();
      const encabezado = await page.locator('h1, h2').first().textContent().catch(() => '');
      const capturaPath = guardarCaptura
        ? await this.guardarCaptura(page, ruta, inspeccionadaEn)
        : '';
      const hash = this.hashInventario(ruta, elementos);

      return {
        ruta,
        frontend_url: frontendUrl,
        titulo: this.texto(titulo),
        encabezado: this.texto(encabezado),
        inspeccionada_en: inspeccionadaEn,
        elementos,
        captura_path: capturaPath,
        hash,
      };
    } finally {
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }
  }

  private async extraerElementos(page: Page, ref: string): Promise<ElementoNavegado[]> {
    const elementos = await page.locator('[data-testid]').evaluateAll((nodos) => nodos.map((nodo) => {
      const elemento = nodo as HTMLElement;
      const input = elemento as HTMLInputElement;
      const testid = elemento.getAttribute('data-testid') ?? '';
      const id = elemento.getAttribute('id') ?? '';
      const labelFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const labelContenedor = elemento.closest('label');
      const etiqueta = (
        elemento.getAttribute('aria-label')
        || labelFor?.textContent
        || labelContenedor?.querySelector('span')?.textContent
        || (['BUTTON', 'A'].includes(elemento.tagName) ? elemento.textContent : '')
        || elemento.getAttribute('placeholder')
        || elemento.getAttribute('name')
        || ''
      ).replace(/\s+/g, ' ').trim();
      const rect = elemento.getBoundingClientRect();
      const estilo = window.getComputedStyle(elemento);
      const visible = rect.width > 0 && rect.height > 0 && estilo.visibility !== 'hidden' && estilo.display !== 'none';
      const opciones = elemento instanceof HTMLSelectElement
        ? Array.from(elemento.options).map((opcion) => opcion.text.trim()).filter(Boolean)
        : [];
      return {
        testid,
        selector: `[data-testid="${testid.replace(/"/g, '\\"')}"]`,
        tag: elemento.tagName.toLowerCase(),
        tipo: input.type || elemento.getAttribute('type') || '',
        rol: elemento.getAttribute('role') || '',
        nombre: elemento.getAttribute('name') || '',
        etiqueta,
        placeholder: elemento.getAttribute('placeholder') || '',
        obligatorio: elemento.hasAttribute('required') || elemento.getAttribute('aria-required') === 'true',
        deshabilitado: elemento.hasAttribute('disabled') || elemento.getAttribute('aria-disabled') === 'true',
        visible,
        opciones,
      };
    }));

    return elementos
      .filter((item) => item.testid)
      .sort((a, b) => a.testid.localeCompare(b.testid))
      .map((item) => ({ ...item, fuente: { tipo: 'navegacion' as const, ref } }));
  }

  private async aplicarSesion(context: BrowserContext, frontendUrl: string, cookieHeader: string | undefined): Promise<void> {
    const valor = this.cookie(cookieHeader, COOKIE_SESION);
    if (!valor) throw new BadRequestException('No pude reutilizar la sesión actual para navegar el sandbox.');
    await context.addCookies([{ name: COOKIE_SESION, value: valor, url: frontendUrl, sameSite: 'Lax' }]);
  }

  private validarSesionNavegada(page: Page, rutaEsperada: string): void {
    const actual = new URL(page.url());
    if (actual.pathname === '/login') {
      throw new BadRequestException('La sesión del navegador venció. Volvé a iniciar sesión e inspeccioná otra vez.');
    }
    if (this.normalizarRuta(actual.pathname) !== rutaEsperada) {
      throw new BadRequestException(`La navegación terminó en ${actual.pathname}, no en ${rutaEsperada}.`);
    }
  }

  private async guardarCaptura(page: Page, ruta: string, fecha: string): Promise<string> {
    const nombre = `${fecha.replace(/\D/g, '').slice(0, 14)}-${this.slug(ruta)}-${randomUUID().slice(0, 8)}.png`;
    const destino = resolve(process.cwd(), '..', 'outputs', 'playwright', 'qa-sop-loom', 'inspecciones', nombre);
    await mkdir(dirname(destino), { recursive: true });
    await page.screenshot({ path: destino, fullPage: true, animations: 'disabled' });
    return destino;
  }

  private async resolverFrontendUrl(): Promise<string> {
    const configurado = this.texto(process.env.AUDITORIA_FRONTEND_URL).replace(/\/$/, '');
    const candidatos = Array.from(new Set([
      configurado,
      'http://localhost:4200',
      'http://127.0.0.1:4200',
    ].filter(Boolean)));
    const errores: string[] = [];

    for (const candidato of candidatos) {
      try {
        const response = await this.fetchConTimeout(candidato, 3000);
        const html = await response.text();
        if (response.ok && /<app-root(?:\s|>)/i.test(html)) return candidato;
        errores.push(`${candidato}: HTTP ${response.status}`);
      } catch (error) {
        errores.push(`${candidato}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new BadRequestException(`El frontend de Auditoría no responde. ${errores.join(' | ')}`);
  }

  private fetchConTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  private detectarNavegador(): string | undefined {
    const candidatos = [
      this.texto(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      resolve(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      resolve(process.env.LOCALAPPDATA ?? '', 'Microsoft/Edge/Application/msedge.exe'),
    ].filter(Boolean);
    return candidatos.find((ruta) => existsSync(ruta));
  }

  private hashInventario(ruta: string, elementos: ElementoNavegado[]): string {
    const estable = elementos.map((item) => ({
      testid: item.testid,
      tag: item.tag,
      tipo: item.tipo,
      rol: item.rol,
      nombre: item.nombre,
      etiqueta: item.etiqueta,
      obligatorio: item.obligatorio,
      opciones: item.opciones,
    }));
    return createHash('sha256').update(JSON.stringify({ ruta, elementos: estable })).digest('hex');
  }

  private validarRuta(valor: unknown): string {
    const ruta = this.normalizarRuta(valor);
    if (!ruta || !ruta.startsWith('/') || ruta.startsWith('//') || ruta.includes('..') || ruta.includes('\\')) {
      throw new BadRequestException('La ruta de pantalla debe ser relativa, por ejemplo /qa/pantalla-3.');
    }
    return ruta;
  }

  private normalizarRuta(valor: unknown): string {
    const ruta = this.texto(valor).split(/[?#]/)[0];
    if (!ruta) return '';
    const conBarra = ruta.startsWith('/') ? ruta : `/${ruta}`;
    return conBarra.replace(/\/+$/, '').toLowerCase() || '/';
  }

  private cookie(header: string | undefined, nombre: string): string {
    return (header ?? '').split(';').map((item) => item.trim())
      .find((item) => item.startsWith(`${nombre}=`))?.slice(nombre.length + 1) ?? '';
  }

  private usuarioTexto(usuario: unknown): string {
    const item = this.objeto(usuario);
    return this.texto(item['correo'] ?? item['nombre']) || 'usuario_actual';
  }

  private serializar(valor: unknown): InspeccionPantalla {
    const item = this.objeto(valor);
    return {
      id: this.texto(item['id']),
      ruta: this.texto(item['ruta']),
      frontend_url: this.texto(item['frontend_url']),
      titulo: this.texto(item['titulo']),
      encabezado: this.texto(item['encabezado']),
      inspeccionada_en: this.texto(item['inspeccionada_en']),
      solicitada_por: this.texto(item['solicitada_por']),
      elementos: this.arrayObjetos(item['elementos']).map((elemento) => ({
        testid: this.texto(elemento['testid']),
        selector: this.texto(elemento['selector']),
        tag: this.texto(elemento['tag']),
        tipo: this.texto(elemento['tipo']),
        rol: this.texto(elemento['rol']),
        nombre: this.texto(elemento['nombre']),
        etiqueta: this.texto(elemento['etiqueta']),
        placeholder: this.texto(elemento['placeholder']),
        obligatorio: Boolean(elemento['obligatorio']),
        deshabilitado: Boolean(elemento['deshabilitado']),
        visible: Boolean(elemento['visible']),
        opciones: this.arrayTexto(elemento['opciones']),
        fuente: { tipo: 'navegacion', ref: this.texto(this.objeto(elemento['fuente'])['ref']) },
      })),
      captura_path: this.texto(item['captura_path']),
      hash: this.texto(item['hash']),
      activa: item['activa'] !== false,
    };
  }

  private slug(valor: unknown): string {
    return this.texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pantalla';
  }

  private texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor).trim();
  }

  private objeto(valor: unknown): Record<string, unknown> {
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
  }

  private arrayObjetos(valor: unknown): Record<string, unknown>[] {
    return Array.isArray(valor) ? valor.map((item) => this.objeto(item)).filter((item) => Object.keys(item).length > 0) : [];
  }

  private arrayTexto(valor: unknown): string[] {
    return Array.isArray(valor) ? valor.map((item) => this.texto(item)).filter(Boolean) : [];
  }
}
