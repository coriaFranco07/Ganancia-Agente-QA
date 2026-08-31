import { AnalisisService } from './analisis.service';
import { ContextoComplementarioService } from '../contexto-complementario/contexto-complementario.service';
describe('AnalisisService persistencia',()=>{
 it('conserva el hash del archivo y crea snapshot inmutable',async()=>{const snapshots:any={create:jest.fn(async(x:any)=>({...x,_id:'snapshot-1'}))},archivos:any={create:jest.fn(async(x:any)=>x)},excel:any={leer:jest.fn(async()=>({metadata:{},advertencias:[]}))},reporte:any={analizar:jest.fn(()=>({estado:'analisis_completado',tipo_analisis:'ANALISIS_BASICO',metadata:{cliente:'A',legajo:'1'},snapshot:{fecha_analisis:'2026-07-07T00:00:00Z',periodo:'2026-06'},validaciones:[],detalle_mensual:[]}))},contexto:any={};const service=new AnalisisService(excel,reporte,contexto,snapshots,archivos);const r=await service.analizar(Buffer.from('excel'),'a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');expect(r.id).toBe('snapshot-1');expect(snapshots.create.mock.calls[0][0].hash_archivo).toMatch(/^[a-f0-9]{64}$/);expect(archivos.create).toHaveBeenCalledWith(expect.objectContaining({analisis_id:'snapshot-1'}));});

 it('completa metadata desde el formulario antes de ejecutar el reporte',async()=>{
  const snapshots:any={create:jest.fn(async(x:any)=>({...x,_id:'snapshot-1'}))},archivos:any={create:jest.fn(async(x:any)=>x)};
  const liquidacion:any={metadata:{archivo:'Netser-Ganancia.xlsx',hoja:'Hoja1',cliente:'NETSER S.A.',legajo:null,periodo_fiscal:null,mes_liquidacion:null},advertencias:[],papel_trabajo_mes:null};
  const excel:any={leer:jest.fn(async()=>liquidacion)};
  const reporte:any={analizar:jest.fn((liq:any)=>({estado:'analisis_completado',tipo_analisis:'ANALISIS_ENRIQUECIDO',metadata:liq.metadata,snapshot:{fecha_analisis:'2026-07-07T00:00:00Z',periodo:'2026-06'},validaciones:[],detalle_mensual:[]}))};
  const service=new AnalisisService(excel,reporte,new ContextoComplementarioService(),snapshots,archivos);
  await service.analizar(Buffer.from('excel'),'Netser-Ganancia.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{datos_cliente:{cliente_nombre:'Netser',modo_saldo_favor:'Compensar'},datos_legajo:{legajo_numero:'67'},datos_contexto:{periodo_fiscal:2026,mes_liquidacion:6}});
  const liqEnviado=reporte.analizar.mock.calls[0][0];
  expect(liqEnviado.metadata).toEqual(expect.objectContaining({cliente:'Netser',legajo:'67',periodo_fiscal:2026,mes_liquidacion:6}));
  expect(liqEnviado.config_cliente.modo_saldo_favor).toBe('compensar');
  expect(liqEnviado.papel_trabajo_mes).toBe(6);
  const resultadoPersistido=snapshots.create.mock.calls[0][0].snapshot_original;
  expect(resultadoPersistido.control_archivo.metadata_detectada).toEqual(expect.objectContaining({cliente:'NETSER S.A.',legajo:null,periodo_fiscal:null,mes_liquidacion:null}));
  expect(resultadoPersistido.control_archivo.metadata_usada).toEqual(expect.objectContaining({cliente:'Netser',legajo:'67',periodo_fiscal:2026,mes_liquidacion:6}));
 });

 it('guarda modo_saldo_favor en el snapshot persistido',async()=>{
  const snapshots:any={create:jest.fn(async(x:any)=>({...x,_id:'snapshot-1'}))},archivos:any={create:jest.fn(async(x:any)=>x)};
  const excel:any={leer:jest.fn(async()=>({metadata:{cliente:'Parodi',legajo:'53',periodo_fiscal:2026,mes_liquidacion:7},advertencias:[],config_cliente:{modo_saldo_favor:'compensar'}}))};
  const reporte:any={analizar:jest.fn(()=>({estado:'analisis_completado',tipo_analisis:'ANALISIS_ENRIQUECIDO',metadata:{cliente:'Parodi',legajo:'53'},snapshot:{fecha_analisis:'2026-07-07T00:00:00Z',periodo:'2026-07'},contexto_complementario:{datos_cliente:{modo_saldo_favor:'compensar'}},validaciones:[],detalle_mensual:[]}))};
  const service=new AnalisisService(excel,reporte,new ContextoComplementarioService(),snapshots,archivos);
  await service.analizar(Buffer.from('excel'),'Parodi.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(snapshots.create.mock.calls[0][0]).toEqual(expect.objectContaining({modo_saldo_favor:'compensar'}));
  expect(snapshots.create.mock.calls[0][0].contexto_complementario.datos_cliente.modo_saldo_favor).toBe('compensar');
 });

 it('detecta periodo del Excel desde nombres con rango de meses antes del contexto manual',async()=>{
  const snapshots:any={create:jest.fn(async(x:any)=>({...x,_id:'snapshot-1'}))},archivos:any={create:jest.fn(async(x:any)=>x)};
  const liquidacion:any={metadata:{archivo:'Legajo_434_Meses_1al_8.xlsx',hoja:'Hoja1',cliente:null,legajo:'434',periodo_fiscal:null,mes_liquidacion:null},advertencias:[],papel_trabajo_mes:null};
  const excel:any={leer:jest.fn(async()=>liquidacion)};
  const reporte:any={analizar:jest.fn((liq:any)=>({estado:'analisis_completado',tipo_analisis:'ANALISIS_BASICO',metadata:liq.metadata,snapshot:{fecha_analisis:'2026-08-24T00:00:00Z',periodo:'2026-06'},validaciones:[],detalle_mensual:[]}))};
  const service=new AnalisisService(excel,reporte,new ContextoComplementarioService(),snapshots,archivos);
  await service.analizar(Buffer.from('excel'),'Legajo_434_Meses_1al_8.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{datos_legajo:{legajo_numero:'434'},datos_contexto:{periodo_fiscal:2026,mes_liquidacion:6}});
  const control=snapshots.create.mock.calls[0][0].snapshot_original.control_archivo;
  expect(control.periodo_detectado).toEqual(expect.objectContaining({mes:8,anio:2026,etiqueta:'08/2026',fuente:'nombre_archivo_rango_meses'}));
  expect(control.periodo_usado).toEqual(expect.objectContaining({mes:6,anio:2026,etiqueta:'06/2026'}));
 });
});
