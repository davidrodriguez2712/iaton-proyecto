const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb } = require('../src/estado/db');
const { crearAlmacen } = require('../src/estado/almacen');
const { crearMotor, MSG_PERSONA } = require('../src/motor/motor');
const { cargarFlujos } = require('../src/flujos');
const { crearLlamadorFuncion } = require('../src/puente-api');
const { ProveedorFalso } = require('./helpers/proveedor-falso');
const { ErrorEnvio } = require('../src/provider/waha');
const { entregarComprobante } = require('../src/comprobante/entrega');
const { msg, AHORA } = require('./helpers/mundo');

const T = '51944686794';
const COTIZA = async () => ({ monto: 500, moneda_origen: 'BRL', moneda_destino: 'PEN' });

function mundoReal({ extraer = COTIZA, cuentas } = {}) {
  const almacen = crearAlmacen(abrirDb(':memory:'));
  const proveedor = new ProveedorFalso();
  const llamar = crearLlamadorFuncion({ kvEnv: almacen.kvEnv(), varsFijas: { simular_ahora: AHORA.toISOString() } });
  const motor = crearMotor({ flujos: cargarFlujos(), almacen, proveedor, llamarFuncion: llamar, extraer, ahora: () => AHORA });
  const accion = (api_action, vars = {}) => llamar({ vars: { api_action, ...vars }, phone: T, edges: [], wa: { messages: [] } });
  let entrantes = 0;
  const decir = (texto, extra = {}) => { entrantes++; return motor.procesarMensaje(msg(T, texto, extra)); };
  return { almacen, proveedor, motor, accion, decir, entrantes: () => entrantes, kv: almacen.kvEnv() };
}

const PRIMERO = 'Hola, quiero enviar 500 reales a Perú';

test('PARIDAD: operación completa con cuenta guardada = 13 mensajes salientes y 9 entrantes, como en Kapso', async () => {
  const m = mundoReal();
  await m.accion('seed_demo');
  const e = m.proveedor.enviados;

  await m.decir(PRIMERO);
  assert.equal(e[0].tipo, 'botones');
  assert.equal(e[0].texto, '¡Hola! Hoy 1 BRL = 0.7 PEN. Comisión 5.00 BRL. Recibirás 350.00 PEN. Tasa asegurada hasta las 10:15 a. m.');
  assert.deepEqual(e[0].opciones.map((o) => o.id), ['continuar', 'cambiar_monto', 'persona']);
  assert.equal(e[1].tipo, 'enlace');
  assert.equal(e[1].url, 'https://brasper.com/es');

  await m.decir('Continuar', { opcionId: 'continuar' });
  assert.equal(e[2].texto, '¿Cuál es tu DNI o CPF?');
  await m.decir('12345678');
  assert.equal(e[3].texto, '¿De dónde provienen los fondos?');
  await m.decir('Ahorros', { opcionId: 'Ahorros' });
  assert.equal(e[4].tipo, 'lista');
  assert.equal(e[4].texto, '¿Desde qué banco nos envías tu dinero?');
  assert.deepEqual(e[4].opciones.map((o) => o.id), ['Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Caixa', 'Otro']);
  await m.decir('Banco do Brasil', { opcionId: 'Banco do Brasil' });
  assert.equal(e[5].texto, 'Tengo guardada tu cuenta Scotiabank ••9956. ¿Recibes ahí? Debe estar a tu nombre.');
  await m.decir('Sí, esa', { opcionId: 'si_esa' });
  assert.match(e[6].texto, /^Transfiere 505\.00 BRL a:\nTitular: BrasPer \(DEMO\)\nBanco: Banco do Brasil\nCuenta: DEMO-BRL-0001/);
  assert.ok(e[6].texto.endsWith('Tasa asegurada hasta las 10:15 a. m.'));
  assert.equal(e[7].texto, 'Cuando termines la transferencia, toca "Ya transferí".');
  await m.decir('Ya transferí', { opcionId: 'ya_transferi' });
  assert.equal(e[8].texto, 'Perfecto. Envíame la foto del comprobante.');
  await m.decir('', { tieneMedia: true, tipoMensaje: 'image', mensajeId: 'wamid-foto' });
  assert.equal(e[9].texto, 'Ahora escribe el número de operación bancaria.');
  await m.decir('123456');
  assert.match(e[10].texto, /^Una persona validará tu pago en unos 15 min\./);
  assert.equal(m.almacen.cargarEjecucion(T), null);
  assert.equal(await m.kv.get(`active:${T}`, 'json'), 'BR-0001');

  // El backend verifica el pago y E4 avisa al cliente.
  await m.accion('set_status', { operacion_id: 'BR-0001', estado: 'verificada' });
  assert.deepEqual(await m.motor.iniciar('E4', T, `${T}@c.us`, { operacion_id: 'BR-0001' }), { iniciado: true });
  assert.equal(e[11].texto, '✅ Pago verificado. Enviamos tu dinero a la cuenta ••9956.');
  assert.equal(e[12].texto, '¡Listo! Recibiste 350.00 PEN.'); // el comprobante llega aparte, como PDF por el chat

  assert.equal(e.length, 13);
  assert.equal(m.entrantes(), 9);

  // Después del aviso, el comprobante en PDF por el mismo chat (con los datos reales de la operación).
  const r = await entregarComprobante({ kv: m.kv, proveedor: m.proveedor, registrar: () => {}, telefono: T, chatId: `${T}@c.us`, operacionId: 'BR-0001' });
  assert.equal(r.enviado, true);
  assert.equal(e.length, 14);
  assert.equal(e[13].tipo, 'documento');
  assert.equal(e[13].nombre, 'comprobante-BR-0001.pdf');
  const pdf = Buffer.from(e[13].base64, 'base64');
  for (const t of ['BR-0001', '500.00 BRL', '505.00 BRL', '350.00 PEN', '1 BRL = 0.7 PEN', 'Scotiabank \x95\x959956', 'Banco do Brasil', 'Ahorros', 'DNI 12345678', '123456']) {
    assert.ok(pdf.includes(Buffer.from(`(${t})`, 'latin1')), `el PDF trae "${t}"`);
  }
});

test('PARIDAD: sin datos de la IA, el flujo pregunta moneda por moneda (el cliente nunca queda sin respuesta)', async () => {
  const m = mundoReal({ extraer: async () => ({}) });
  await m.decir('hola');
  const e = m.proveedor.enviados;
  assert.equal(e.length, 1);
  assert.equal(e[0].texto, '¡Hola! Soy el asistente de IA de BrasPer. ¿Qué moneda quieres enviar?');
  assert.deepEqual(e[0].opciones.map((o) => o.id), ['BRL', 'PEN', 'USD']);
});

test('PARIDAD: en modo texto, "1" elige la primera opción de la oferta', async () => {
  const m = mundoReal();
  await m.decir(PRIMERO);
  await m.decir('1');
  assert.equal(m.proveedor.enviados[2].texto, '¿Cuál es tu DNI o CPF?');
});

test('PARIDAD y REVIEW 1: un sticker o audio en el paso del DNI cuenta como formato inválido y al segundo escala', async () => {
  const m = mundoReal();
  await m.decir(PRIMERO);
  await m.decir('Continuar', { opcionId: 'continuar' });
  const e = m.proveedor.enviados;
  await m.decir('', { tieneMedia: true, tipoMensaje: 'other' });
  assert.equal(e.at(-1).texto, 'No reconozco ese formato. Revisa tu DNI (8 dígitos) o CPF (11 dígitos) y envíalo de nuevo.');
  assert.ok(m.almacen.cargarEjecucion(T).esperando);
  await m.decir('');
  assert.equal(e.at(-1).texto, MSG_PERSONA);
  assert.equal(m.almacen.cargarEjecucion(T), null);
  assert.equal((await m.kv.get(`handoff:${T}`, 'json')).motivo, 'dni_invalido');
});

test('REVIEW 5: un botón antiguo en un paso de texto no avanza el flujo', async () => {
  const m = mundoReal();
  await m.decir(PRIMERO);
  await m.decir('Continuar', { opcionId: 'continuar' });
  await m.decir('Continuar', { opcionId: 'continuar' }); // toca de nuevo "Continuar" cuando se espera el DNI
  assert.match(m.proveedor.enviados.at(-1).texto, /No reconozco ese formato/);
  assert.ok(m.almacen.cargarEjecucion(T).esperando);
});

test('PARIDAD: "Hablar con persona" escala, registra el handoff y libera la conversación', async () => {
  const m = mundoReal();
  await m.decir(PRIMERO);
  await m.decir('Hablar con persona', { opcionId: 'persona' });
  assert.equal(m.proveedor.enviados.at(-1).texto, MSG_PERSONA);
  assert.equal(m.almacen.cargarEjecucion(T), null);
  assert.equal((await m.kv.get(`handoff:${T}`, 'json')).motivo, 'cliente_pide_persona');
});

test('PARIDAD: "Otra cuenta" recorre las cuentas guardadas y luego pide una nueva (cuentas:2)', async () => {
  const m = mundoReal();
  await m.accion('seed_demo', { cuentas: 2 });
  await m.decir(PRIMERO);
  await m.decir('Continuar', { opcionId: 'continuar' });
  await m.decir('12345678');
  await m.decir('Ahorros', { opcionId: 'Ahorros' });
  await m.decir('Banco do Brasil', { opcionId: 'Banco do Brasil' });
  const e = m.proveedor.enviados;
  assert.match(e.at(-1).texto, /Scotiabank ••9956/);
  await m.decir('Otra cuenta', { opcionId: 'otra_cuenta' });
  assert.match(e.at(-1).texto, /BCP ••1111/);
  await m.decir('Otra cuenta', { opcionId: 'otra_cuenta' });
  assert.equal(e.at(-1).texto, 'Vamos a agregar tu cuenta. ¿En qué banco está?');
  assert.deepEqual(e.at(-1).opciones.map((o) => o.id), ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Otro']);
});

test('PARIDAD: sin tasas disponibles escala a persona con el mensaje de servicio', async () => {
  const almacen = crearAlmacen(abrirDb(':memory:'));
  const proveedor = new ProveedorFalso();
  const llamar = crearLlamadorFuncion({ kvEnv: almacen.kvEnv(), envExtra: { TASAS_CAIDAS: '1' }, varsFijas: { simular_ahora: AHORA.toISOString() } });
  const motor = crearMotor({ flujos: cargarFlujos(), almacen, proveedor, llamarFuncion: llamar, extraer: COTIZA, ahora: () => AHORA });
  await motor.procesarMensaje(msg(T, PRIMERO));
  assert.equal(proveedor.enviados.at(-1).texto, 'Ahora no puedo cotizar con seguridad. Te paso con una persona del equipo para ayudarte.');
  assert.equal(almacen.cargarEjecucion(T), null);
});

test('PARIDAD: con una operación escalada, un nuevo mensaje recibe el aviso de persona', async () => {
  const m = mundoReal();
  await m.accion('seed_demo');
  await m.decir(PRIMERO);
  await m.decir('Continuar', { opcionId: 'continuar' });
  await m.decir('12345678');
  await m.decir('Ahorros', { opcionId: 'Ahorros' });
  await m.decir('Banco do Brasil', { opcionId: 'Banco do Brasil' });
  await m.decir('Sí, esa', { opcionId: 'si_esa' });
  await m.accion('set_status', { operacion_id: 'BR-0001', estado: 'escalada' });
  await m.almacen.borrarEjecucion(T);
  await m.decir('hola');
  assert.equal(m.proveedor.enviados.at(-1).texto, 'Una persona del equipo ya está atendiendo tu caso.');
});

test('un hipo de WAHA al enviar las instrucciones de pago no escala la operación; el siguiente mensaje las reenvía', async () => {
  const m = mundoReal();
  await m.accion('seed_demo');
  await m.decir(PRIMERO);
  await m.decir('Continuar', { opcionId: 'continuar' });
  await m.decir('12345678');
  await m.decir('Ahorros', { opcionId: 'Ahorros' });
  await m.decir('Banco do Brasil', { opcionId: 'Banco do Brasil' });
  m.proveedor.fallar.push(new ErrorEnvio('WAHA caído', { estado: 502, reintentable: true }));
  await m.decir('Sí, esa', { opcionId: 'si_esa' }); // crea la operación y falla al enviar "Transfiere…"
  const op = await m.kv.get('op:BR-0001', 'json');
  assert.notEqual(op.estado, 'escalada');
  assert.equal(await m.kv.get(`handoff:${T}`, 'json'), null);
  assert.ok(m.almacen.cargarEjecucion(T));
  await m.decir('hola');
  const textos = m.proveedor.textos();
  assert.equal(textos.filter((x) => x.startsWith('Transfiere 505.00 BRL')).length, 1);
  assert.equal(textos.at(-1), 'Cuando termines la transferencia, toca "Ya transferí".');
});
