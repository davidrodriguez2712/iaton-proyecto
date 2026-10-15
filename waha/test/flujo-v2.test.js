const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMundoV2, hastaInstrucciones, T } = require('./helpers/mundo-v2');

const conMundo = async (fn, opciones) => { const m = await crearMundoV2(opciones); try { await fn(m); } finally { await m.cerrar(); } };
const HORA = '\\d{1,2}:\\d\\d [ap]\\. m\\.';

test('cliente nuevo: de la cotización hasta que la orden queda en validación en el backend', () => conMundo(async (m) => {
  const e = m.proveedor.enviados;
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  assert.equal(e[0].tipo, 'botones');
  assert.match(e[0].texto, new RegExp(`^👋 ¡Hola! Soy el asistente de IA de BrasPer\\. Esta es tu cotización:\n\n📤 Envías: 500\\.00 BRL\n➕ Comisión e impuesto: 14\\.16 BRL\n💳 \\*Total a transferir: 514\\.16 BRL\\*\n📥 \\*Recibes: 337\\.25 PEN\\*\n📈 Tasa: 1 BRL = 0\\.6745 PEN\n⏱ Válida hasta las ${HORA}\n\n¿Quieres continuar\\?$`));
  assert.deepEqual(e[0].opciones.map((o) => o.id), ['continuar', 'cambiar_monto', 'persona']);
  assert.equal(e[1].tipo, 'enlace');
  assert.equal(m.falso.llamadas.find((l) => l.nombre === 'createQuote').data.channel, 'whatsapp');

  await m.tocar('continuar', 'Continuar');
  assert.equal(m.ultimo().texto, '¡Perfecto! 🙌 Para registrar tu operación necesito unos datos.\n\n¿Cuál es tu nombre completo, como figura en tu documento?');
  await m.decir('Ana Paula Souza');
  assert.equal(m.ultimo().tipo, 'lista');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['DNI', 'CE', 'RUC', 'CPF']);
  await m.tocar('CPF');
  assert.equal(m.ultimo().texto, 'Escribe tu número de CPF (11 dígitos).');
  await m.decir('529.982.247-25');
  assert.equal(m.ultimo().texto, '¿A qué correo te enviamos tu comprobante?');
  await m.decir('ana@example.com');
  assert.equal(m.ultimo().texto, '¿Cuál es el origen de los fondos que vas a enviar?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['savings', 'salary', 'business', 'asset_sale', 'donation', 'other']);
  await m.tocar('savings', 'Ahorros');
  assert.equal(m.ultimo().texto, '¿Desde qué banco vas a transferir?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Caixa', 'Otro']);
  await m.tocar('Nubank');
  assert.equal(m.ultimo().texto, '¿En qué banco recibirá tu destinatario?'); // sin número de cuenta de origen: es opcional en el backend
  assert.equal(m.ultimo().texto, '¿En qué banco recibirá tu destinatario?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Otro']);
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  assert.equal(m.ultimo().texto, '📋 *Resumen de tu operación*\n📤 Envías: 514.16 BRL desde Nubank\n📥 Recibe: 337.25 PEN en BCP ••7890\n📈 Tasa: 1 BRL = 0.6745 PEN\n\n¿Todo correcto?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['confirmar', 'cambiar', 'cancelar']);
  assert.equal(m.falso.ordenes.size, 0); // todavía no se creó nada

  await m.tocar('confirmar', 'Confirmar');
  const instr = m.ultimo(); // las instrucciones y los botones van en un solo mensaje
  assert.match(instr.texto, new RegExp(`^✅ \\*Operación BR-0001 registrada\\*\n\nTransfiere \\*514\\.16 BRL\\* a esta cuenta:\n🏦 Banco: Nubank\n👤 Titular: BrasPer \\(DEMO\\)\n🔢 Cuenta: 0001-0000001-0\n🔑 Pix: pix@brasper\\.demo\n\n⏱ Tienes hasta las ${HORA} para transferir con esta tasa\\.\n⚠ Transfiere en BRL, no en otra moneda\\.\n\nCuando termines, toca \\*Ya transferí\\*\\.$`));
  assert.deepEqual(instr.opciones.map((o) => o.id), ['ya_transferi', 'cancelar']);
  const o = m.falso.ordenes.get('BR-0001');
  assert.deepEqual([o.channel, o.status, o.clientName, o.docType, o.docNumber, o.email, o.fundsSource], ['whatsapp', 'pending', 'Ana Paula Souza', 'CPF', '52998224725', 'ana@example.com', 'savings']);
  assert.deepEqual([o.sourceBank, o.sourceAccount, o.destinationBank, o.destinationAccount], ['Nubank', '', 'BCP', '191-1234567890']);

  // Los datos personales ya no están en el estado de la conversación ni en el registro.
  const guardado = JSON.stringify(m.almacen.cargarEjecucion(T));
  for (const dato of ['52998224725', 'ana@example.com', 'Ana Paula Souza', '0001-12345678-9', '191-1234567890']) assert.ok(!guardado.includes(dato), `el estado no debe guardar ${dato}`);

  await m.tocar('ya_transferi', 'Ya transferí');
  assert.equal(m.ultimo().texto, '¡Gracias! 📎 Envíame la foto o el PDF del comprobante de tu transferencia.');
  await m.foto();
  assert.equal(m.ultimo().texto, 'Ahora escribe el número de operación que aparece en tu comprobante.');
  assert.equal(m.falso.archivos.size, 1);
  assert.match([...m.falso.archivos.keys()][0], /^proofs\/uid001\/BR-0001\/proof-\d+\.jpg$/);
  await m.decir('ab-1234');
  assert.equal(m.ultimo().texto, '¡Listo! Recibimos tu comprobante ✅\nUna persona validará tu pago y te escribo apenas esté listo.');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
  assert.equal(m.falso.ordenes.get('BR-0001').operationNo, 'AB-1234');
  assert.equal(m.almacen.cargarEjecucion(T), null);
  assert.equal(m.almacen.seguimientosAbiertos().length, 1);
  // Ningún dato personal llega al registro (ni de la base ni de los eventos que se informan).
  const todo = JSON.stringify(m.bd.prepare('SELECT * FROM registro').all()) + JSON.stringify(m.registrados);
  for (const dato of ['52998224725', 'ana@example.com', 'Ana Paula', '0001-12345678-9']) assert.ok(!todo.includes(dato), `el registro no debe tener ${dato}`);
}));

// Una orden ya terminada para ese teléfono: el siguiente mensaje empieza una operación nueva con el perfil guardado.
async function cerrarLaPrimera(m) {
  await hastaInstrucciones(m);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234');
  m.falso.aprobar('BR-0001');
  m.almacen.actualizarSeguimiento('BR-0001', { cerrado: 1 }); // lo que hará el vigilante al terminar
}

test('cliente que vuelve: confirma sus datos y elige sus cuentas guardadas de una lista', () => conMundo(async (m) => {
  await cerrarLaPrimera(m);
  // La cuenta de origen es opcional, así que la orden anterior no la guardó; este cliente la tiene de antes (p. ej. de otro canal).
  m.falso.clientes.get('uid001').accounts.push({ id: 'Nubank|0001-12345678-9', bank: 'Nubank', accountNumber: '0001-12345678-9', currency: 'BRL' });
  const n = m.proveedor.enviados.length;
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  assert.equal(m.ultimo().texto, '¡Qué gusto verte de nuevo! 👋\nUsaremos tu CPF 52998224725 y tu correo a***@example.com. ¿Es correcto?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['si_datos', 'cambiar']);
  await m.tocar('si_datos', 'Sí, es correcto');
  assert.equal(m.ultimo().texto, '¿Cuál es el origen de los fondos que vas a enviar?');
  await m.tocar('salary', 'Sueldo');
  assert.equal(m.ultimo().texto, '¿Desde qué cuenta vas a transferir?');
  assert.deepEqual(m.ultimo().opciones, [{ id: 'acc:0', title: 'Nubank ••6789' }, { id: 'otra', title: 'Otra cuenta' }]);
  await m.tocar('acc:0', 'Nubank ••6789');
  assert.equal(m.ultimo().texto, '¿A qué cuenta recibirá tu destinatario?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.title), ['BCP ••7890', 'Otra cuenta']);
  await m.tocar('acc:0', 'BCP ••7890');
  assert.match(m.ultimo().texto, /^📋 \*Resumen de tu operación\*\n📤 Envías: 514\.16 BRL desde Nubank ••6789\n📥 Recibe: 337\.25 PEN en BCP ••7890/);
  await m.tocar('confirmar', 'Confirmar');
  assert.equal(m.falso.ordenes.get('BR-0002').sourceAccount, '0001-12345678-9'); // la cuenta guardada sí viaja al backend
  assert.equal(m.falso.ordenes.get('BR-0002').fundsSource, 'salary');
  assert.equal(m.falso.ordenes.get('BR-0002').clientName, 'Ana Paula Souza');
  assert.ok(m.proveedor.enviados.length > n);
  assert.equal(m.falso.usuarios.size, 1); // el mismo usuario anónimo de siempre: así recuerda al cliente
}));

test('cliente que vuelve y elige "Otra cuenta" para el destino: pide banco y número', () => conMundo(async (m) => {
  await cerrarLaPrimera(m);
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.tocar('si_datos', 'Sí, es correcto');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.tocar('otra', 'Otra cuenta');
  assert.equal(m.ultimo().texto, '¿En qué banco recibirá tu destinatario?');
  await m.tocar('Otro');
  assert.equal(m.ultimo().texto, 'Escribe el nombre de tu banco.');
  await m.decir('Banco Pichincha');
  assert.equal(m.ultimo().texto, 'Escribe el número de la cuenta de tu destinatario en Banco Pichincha.');
  await m.decir('555-0099');
  await m.tocar('confirmar', 'Confirmar');
  assert.deepEqual([m.falso.ordenes.get('BR-0002').destinationBank, m.falso.ordenes.get('BR-0002').destinationAccount], ['Banco Pichincha', '555-0099']);
}));

test('si la cotización vence mientras el cliente completa los datos, se cotiza de nuevo y se pide confirmar', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('52998224725');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  m.falso.avanzar(16);
  await m.tocar('confirmar', 'Confirmar');
  assert.match(m.ultimo().texto, /^La tasa se actualizó mientras completabas tus datos 🔄\n\n💳 \*Total a transferir: 514\.16 BRL\*/);
  assert.equal(m.falso.ordenes.size, 0);
  await m.tocar('continuar', 'Continuar');
  assert.equal(m.falso.ordenes.size, 1);
  assert.match(m.ultimo().texto, /^✅ \*Operación BR-0001 registrada\*/);
}));

test('un monto por encima del límite pasa a una persona: enlace al WhatsApp humano con la cotización, sin ticket', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 20000 reales a Perú');
  assert.equal(m.falso.ordenes.size, 0);
  assert.equal(m.falso.tickets.size, 0);
  assert.equal(m.ultimo().texto, `Para montos grandes te atiende una persona del equipo, así cuidamos tu operación 🙌\nEscríbenos aquí y te atiende una persona por WhatsApp:\nhttps://wa.me/51966991933?text=${encodeURIComponent('Hola, quiero enviar 20000 BRL a PEN y necesito ayuda.')}`);
  assert.equal(m.almacen.cargarEjecucion(T), null);
}, { extraer: async () => ({ monto: 20000, moneda_origen: 'BRL', moneda_destino: 'PEN' }) }));

test('un monto menor al mínimo explica el mínimo y vuelve a pedir el monto', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 10 reales a Perú');
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Ese monto es muy pequeño para operar. Prueba con un monto mayor, por favor.');
  assert.equal(m.ultimo().texto, '¿Cuánto quieres enviar? Escríbelo solo con números, por ejemplo 500.');
  await m.decir('500');
  assert.match(m.proveedor.enviados.at(-2).texto, /Total a transferir: 514\.16 BRL/); // la oferta va antes del enlace web
}, { extraer: async () => ({ monto: 10, moneda_origen: 'BRL', moneda_destino: 'PEN' }) }));

test('datos inválidos para el backend: se repregunta solo el campo que rechazó', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('52998224725');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  m.falso.fallar('/fn/createorder', { estado: 400, veces: 1, cuerpo: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'invalid-input', details: [{ path: 'email', message: 'x' }] } }) });
  await m.tocar('confirmar', 'Confirmar');
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Uno de tus datos no pasó la validación 🤔 Revisémoslo juntos.');
  assert.equal(m.ultimo().texto, '¿A qué correo te enviamos tu comprobante?');
}));

test('las respuestas inválidas en un paso de texto repiten la pregunta y el segundo fallo escala', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana');
  assert.equal(m.ultimo().texto, 'Escríbelo con nombre y apellido, por ejemplo Ana Souza.');
  await m.decir('');
  assert.match(m.ultimo().texto, /^Te paso con una persona del equipo para ayudarte 🙋\nEscríbenos aquí y te atiende una persona por WhatsApp:\nhttps:\/\/wa\.me\/51966991933\?text=/);
  assert.equal(m.falso.tickets.size, 0);
}));

test('documento inválido para el tipo elegido: repite y no avanza', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('DNI');
  await m.decir('1234567');
  assert.equal(m.ultimo().texto, 'No pude validar ese número de DNI 🤔 Revisa que tenga 8 dígitos e inténtalo de nuevo.');
  await m.decir('12345678');
  assert.equal(m.ultimo().texto, '¿A qué correo te enviamos tu comprobante?');
}));

test('E3: el número de operación duplicado se avisa y se puede corregir', () => conMundo(async (m) => {
  await cerrarLaPrimera(m);
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.tocar('si_datos', 'Sí, es correcto');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.tocar('acc:0', 'BCP ••7890');
  await m.tocar('confirmar', 'Confirmar');
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234'); // el mismo de la primera orden
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Ese número ya está registrado en otra operación. Revísalo en tu comprobante y envíalo de nuevo.');
  assert.equal(m.ultimo().texto, 'Ahora escribe el número de operación que aparece en tu comprobante.'); // vuelve a pedirlo
  assert.equal(m.falso.ordenes.get('BR-0002').status, 'pending');
  await m.decir('ZZ-9999');
  assert.equal(m.ultimo().texto, '¡Listo! Recibimos tu comprobante ✅\nUna persona validará tu pago y te escribo apenas esté listo.');
  assert.equal(m.falso.ordenes.get('BR-0002').status, 'validating');
}));

test('E3: sin foto, archivo de otro tipo o demasiado grande no avanzan; el segundo fallo escala', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.decir('ya pagué');
  assert.equal(m.ultimo().texto, 'No veo ninguna foto o PDF en tu mensaje 🤔 Envía una foto o captura del comprobante.');
  m.descargar.usar(async () => ({ bytes: Buffer.alloc(8 * 1024 * 1024), mimetype: 'image/jpeg' }));
  await m.foto();
  assert.equal(m.ultimo().texto, 'El archivo es muy pesado (máximo 8 MB). Envía una foto más liviana o un PDF más pequeño.');
  m.descargar.usar(async () => ({ bytes: Buffer.from('v'), mimetype: 'video/mp4' }));
  await m.foto();
  assert.match(m.ultimo().texto, /^Te paso con una persona del equipo para ayudarte 🙋/); // segundo fallo del mismo paso
  assert.equal(m.falso.archivos.size, 0);
}));

test('E3: cancelar con confirmación cancela la orden en el backend', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  await m.tocar('cancelar', 'Cancelar operación');
  assert.equal(m.ultimo().texto, '¿Seguro que quieres cancelar la operación BR-0001?');
  await m.tocar('si_cancelar', 'Sí, cancelar');
  assert.equal(m.ultimo().texto, 'Listo, cancelé la operación BR-0001. Cuando quieras, escríbeme para hacer una nueva cotización.');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'cancelled');
  await m.decir('hola'); // vuelve a empezar: no queda nada pendiente
  assert.equal(m.proveedor.enviados.at(-2).tipo, 'botones');
}));

test('E3: si el bloqueo de tasa venció cuando dice "Ya transferí", se avisa y se sigue pidiendo la foto', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  m.avanzar(31); // el bloqueo de la orden dura 30 min
  await m.tocar('ya_transferi', 'Ya transferí');
  assert.equal(m.proveedor.enviados.at(-2).texto, 'Tu tasa asegurada venció mientras transferías, pero igual recibo tu comprobante. Una persona confirmará la tasa final al validar tu pago.');
  assert.equal(m.ultimo().texto, '¡Gracias! 📎 Envíame la foto o el PDF del comprobante de tu transferencia.');
}));

test('si Firebase no responde, se avisa del problema temporal y el siguiente mensaje reintenta sin perder lo hecho', () => conMundo(async (m) => {
  m.falso.fallar('/fn/createquote', { estado: 502, veces: 2 }); // el reintento interno también falla
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  assert.equal(m.ultimo().texto, 'Tuvimos un problema temporal 😕 Escríbeme de nuevo en un momento y seguimos donde quedamos.');
  assert.equal(m.falso.tickets.size, 0); // no se escaló a nadie
  assert.ok(m.almacen.cargarEjecucion(T));
  await m.decir('ya');
  assert.match(m.proveedor.enviados.at(-2).texto, /^👋 ¡Hola! Soy el asistente de IA de BrasPer\. Esta es tu cotización:\n\n📤 Envías: 500\.00 BRL/);
}));

test('si createOrder falla por red, la orden no se pierde ni se duplica: el siguiente mensaje reintenta', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('52998224725');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Nubank');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  m.falso.fallar('/fn/createorder', { estado: 502, veces: 1 });
  await m.tocar('confirmar', 'Confirmar');
  assert.equal(m.ultimo().texto, 'Tuvimos un problema temporal 😕 Escríbeme de nuevo en un momento y seguimos donde quedamos.');
  assert.equal(m.falso.ordenes.size, 0);
  await m.decir('listo');
  assert.equal(m.falso.ordenes.size, 1);
  assert.match(m.ultimo().texto, /^✅ \*Operación BR-0001 registrada\*/);
}));

test('W0: quien vuelve con una orden pendiente ve de nuevo las instrucciones; en validación, el estado', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  m.almacen.borrarEjecucion(T); // el cliente se fue sin transferir y la conversación quedó cerrada
  await m.decir('hola otra vez');
  assert.match(m.proveedor.enviados.at(-2).texto, /^✅ \*Operación BR-0001 registrada\*\n\nTransfiere \*514\.16 BRL\* a esta cuenta:/);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234');
  await m.decir('¿cómo va?');
  assert.equal(m.ultimo().texto, 'Tu operación BR-0001 está en validación: una persona revisa tu pago. Te escribo apenas haya novedades.');
  m.falso.aprobar('BR-0001');
  await m.decir('¿y ahora?');
  assert.equal(m.ultimo().texto, 'Tu operación BR-0001 está verificada: estamos enviando tu dinero. Te escribo apenas haya novedades.');
}, { extraer: async (t) => (/enviar/.test(t) ? { monto: 500, moneda_origen: 'BRL', moneda_destino: 'PEN' } : {}) }));

test('W0: con una orden en validación, un mensaje que pide una remesa nueva abre otra cotización; un mensaje cualquiera da el estado', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('ab-1234');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
  await m.decir('hola');
  assert.match(m.ultimo().texto, /^Tu operación BR-0001 está en validación/);
  await m.decir('Quiero enviar 500 reales a Perú');
  assert.match(m.proveedor.enviados.find((e) => /Esta es tu cotización/.test(e.texto || '') && e !== m.proveedor.enviados[0]).texto, /Total a transferir: 514\.16 BRL/);
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating'); // la primera sigue su curso y el seguimiento sigue abierto
  assert.equal(m.almacen.seguimiento('BR-0001').cerrado, 0);
}, { extraer: async (t) => (/enviar/.test(t) ? { monto: 500, moneda_origen: 'BRL', moneda_destino: 'PEN' } : {}) }));

test('"Hablar con persona" da el enlace al WhatsApp humano y no deja al cliente atrapado: el siguiente mensaje sigue normal', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('persona', 'Hablar con alguien');
  assert.match(m.ultimo().texto, /^Te paso con una persona del equipo para ayudarte 🙋\nEscríbenos aquí y te atiende una persona por WhatsApp:\nhttps:\/\/wa\.me\/51966991933\?text=/);
  assert.equal(m.falso.tickets.size, 0);
  assert.equal(m.almacen.cargarEjecucion(T), null);
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  assert.equal(m.proveedor.enviados.filter((e) => /Esta es tu cotización/.test(e.texto || '')).length, 2, 'puede cotizar de nuevo');
  assert.ok(!m.proveedor.enviados.some((e) => /ya está atendiendo/.test(e.texto || '')));
}));

test('reinicio del servidor a mitad de los datos: retoma desde SQLite sin pedir nada otra vez', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  const { crearMotor } = require('../src/motor/motor');
  const { cargarFlujosV2 } = require('../src/flujos/v2');
  const { msg } = require('./helpers/mundo');
  const otro = crearMotor({ flujos: cargarFlujosV2(), almacen: m.almacen, proveedor: m.proveedor, llamarFuncion: m.backend.llamarFuncion, extraer: async () => ({}) });
  await otro.procesarMensaje(msg(T, 'CPF', { opcionId: 'CPF' }));
  assert.equal(m.ultimo().texto, 'Escribe tu número de CPF (11 dígitos).');
}));

test('texto libre con llaves de plantilla (nombre de banco) se muestra tal cual y no se interpreta', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('529.982.247-25');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  await m.tocar('Otro');
  await m.decir('Banco {{vars.quote_id}} {{vars.api_action}}');
  await m.tocar('BCP');
  await m.decir('191-1234567890');
  assert.match(m.ultimo().texto, /^📋 \*Resumen de tu operación\*\n📤 Envías: 514\.16 BRL desde Banco \{\{vars\.quote_id\}\} \{\{vars\.api_action\}\}\n/);
}));

test('E3: una foto enviada antes de tocar "Ya transferí" no sube nada ni avanza', () => conMundo(async (m) => {
  await hastaInstrucciones(m);
  await m.foto();
  assert.equal(m.falso.archivos.size, 0);
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'pending');
  await m.tocar('ya_transferi', 'Ya transferí'); // el flujo sigue ahí: puede continuar con normalidad
  assert.equal(m.ultimo().texto, '¡Gracias! 📎 Envíame la foto o el PDF del comprobante de tu transferencia.');
}));

test('sentido inverso PEN → BRL: bancos peruanos para enviar y brasileños para recibir, cuenta de pago en soles y orden en validación', () => conMundo(async (m) => {
  const e = m.proveedor.enviados;
  await m.decir('Quiero enviar 500 soles a Brasil');
  assert.match(e[0].texto, /^👋 ¡Hola! Soy el asistente de IA de BrasPer\. Esta es tu cotización:\n\n📤 Envías: 500\.00 PEN\n➕ Comisión e impuesto: [\d.]+ PEN\n💳 \*Total a transferir: [\d.]+ PEN\*\n📥 \*Recibes: [\d.]+ BRL\*\n📈 Tasa: 1 PEN = [\d.]+ BRL\n⏱ Válida hasta las /);
  const cot = m.falso.llamadas.find((l) => l.nombre === 'createQuote').data;
  assert.deepEqual([cot.sendCurrency, cot.receiveCurrency, cot.sendAmount, cot.channel], ['PEN', 'BRL', 500, 'whatsapp']);
  await m.tocar('continuar', 'Continuar');
  await m.decir('Luis Alberto Quispe');
  await m.tocar('DNI');
  await m.decir('45678912');
  await m.decir('luis@example.com');
  await m.tocar('salary', 'Sueldo');
  assert.equal(m.ultimo().texto, '¿Desde qué banco vas a transferir?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Otro']);
  await m.tocar('Interbank');
  assert.equal(m.ultimo().texto, '¿En qué banco recibirá tu destinatario?');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Caixa', 'Otro']);
  await m.tocar('Nubank');
  await m.decir('0001-98765432-1');
  assert.match(m.ultimo().texto, /^📋 \*Resumen de tu operación\*\n📤 Envías: [\d.]+ PEN desde Interbank\n📥 Recibe: [\d.]+ BRL en Nubank ••4321/);
  await m.tocar('confirmar', 'Confirmar');
  const o = m.falso.ordenes.get('BR-0001');
  assert.deepEqual([o.sendCurrency, o.receiveCurrency, o.docType, o.fundsSource, o.sourceBank, o.destinationBank], ['PEN', 'BRL', 'DNI', 'salary', 'Interbank', 'Nubank']);
  const instr = m.ultimo().texto;
  assert.match(instr, /^✅ \*Operación BR-0001 registrada\*\n\nTransfiere \*[\d.]+ PEN\* a esta cuenta:\n🏦 Banco: BCP\n👤 Titular: BrasPer \(DEMO\)\n🔢 Cuenta: 191-0000000-0-00\n/);
  assert.ok(!/Pix/.test(instr), 'la cuenta en soles no tiene Pix');
  await m.tocar('ya_transferi', 'Ya transferí');
  await m.foto();
  await m.decir('op-5555');
  assert.equal(m.falso.ordenes.get('BR-0001').status, 'validating');
  m.falso.aprobar('BR-0001');
}, { extraer: async () => ({ monto: 500, moneda_origen: 'PEN', moneda_destino: 'BRL' }) }));

test('USD como moneda de envío ofrece la lista de bancos de dólares y cotiza en dólares', () => conMundo(async (m) => {
  await m.decir('Quiero enviar 300 dólares a Perú');
  const cot = m.falso.llamadas.find((l) => l.nombre === 'createQuote').data;
  assert.deepEqual([cot.sendCurrency, cot.receiveCurrency, cot.sendAmount], ['USD', 'PEN', 300]);
  await m.tocar('continuar', 'Continuar');
  await m.decir('Ana Paula Souza');
  await m.tocar('CPF');
  await m.decir('529.982.247-25');
  await m.decir('ana@example.com');
  await m.tocar('savings', 'Ahorros');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.id), ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Otro']);
}, { extraer: async (t) => (/dólares/.test(t) ? { monto: 300, moneda_origen: 'USD', moneda_destino: 'PEN' } : { monto: 500, moneda_origen: 'PEN', moneda_destino: 'BRL' }) }));

test('una imagen como primer mensaje abre la lista de monedas; escribir la frase de la remesa después la interpreta y cotiza', () => conMundo(async (m) => {
  await m.foto(); // el cliente manda una imagen cualquiera, sin texto
  assert.equal(m.ultimo().texto, '¡Hola! 👋 Soy el asistente de IA de BrasPer. ¿Qué moneda quieres enviar?');
  assert.equal(m.falso.llamadas.filter((l) => l.nombre === 'createQuote').length, 0);
  await m.decir('Quiero enviar 500 soles a Brasil');
  const cot = m.falso.llamadas.find((l) => l.nombre === 'createQuote').data;
  assert.deepEqual([cot.sendCurrency, cot.receiveCurrency, cot.sendAmount], ['PEN', 'BRL', 500]);
  assert.match(m.proveedor.enviados.find((e) => /Esta es tu cotización/.test(e.texto || '')).texto, /Recibes: [\d.]+ BRL/);
}, { extraer: async (t) => (t ? { monto: 500, moneda_origen: 'PEN', moneda_destino: 'BRL' } : {}) }));

test('en la lista de monedas, dos textos que no dicen la remesa siguen pasando a una persona', () => conMundo(async (m) => {
  await m.foto();
  await m.decir('hola');
  await m.decir('buenas');
  assert.match(m.ultimo().texto, /^Te paso con una persona del equipo/);
}, { extraer: async () => ({}) }));

test('E3 no inventa un horario de atención: las instrucciones de pago van directo a "Ya transferí", a cualquier hora', () => conMundo(async (m) => {
  await hastaInstrucciones(m); // 1:00 a. m. en Lima: el simulador diría "fuera de horario"
  const textos = m.proveedor.enviados.map((e) => e.texto || '');
  assert.ok(!textos.some((t) => /horario|se verificará/i.test(t)), 'ningún mensaje habla de un horario que el backend no dio');
  assert.match(m.ultimo().texto, /Cuando termines, toca \*Ya transferí\*\./);
}, { simular: '2026-10-14T06:00:00Z' }));

test('"Cambiar monto" cotiza de nuevo con "Esta es tu nueva cotización", sin repetir el saludo; y el documento dice cuántos dígitos espera', () => conMundo(async (m) => {
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  assert.match(m.proveedor.enviados[0].texto, /^👋 ¡Hola! Soy el asistente de IA de BrasPer\. Esta es tu cotización:/);
  await m.tocar('cambiar_monto', 'Cambiar monto');
  await m.decir('800');
  const nueva = m.proveedor.enviados.find((e) => /^Esta es tu nueva cotización:/.test(e.texto || ''));
  assert.ok(nueva, 'la segunda cotización no repite el saludo');
  assert.match(nueva.texto, /📤 Envías: 800\.00 BRL/);
  await m.tocar('continuar', 'Sí, continuar');
  await m.decir('Ana Paula Souza');
  assert.deepEqual(m.ultimo().opciones.map((o) => o.title), ['DNI (Perú)', 'CE (extranjería)', 'RUC (empresa)', 'CPF (Brasil)']);
  await m.tocar('CE');
  assert.equal(m.ultimo().texto, 'Escribe tu número de CE (9 a 12 caracteres).');
}));

test('cliente que vuelve sin cuentas de origen guardadas: elige solo el banco y la orden se crea sin número de cuenta de origen', () => conMundo(async (m) => {
  await cerrarLaPrimera(m);
  await m.decir('Hola, quiero enviar 500 reales a Perú');
  await m.tocar('continuar', 'Continuar');
  await m.tocar('si_datos', 'Sí, es correcto');
  await m.tocar('salary', 'Sueldo');
  assert.equal(m.ultimo().texto, '¿Desde qué banco vas a transferir?'); // no hay lista de cuentas de origen: la orden anterior no guardó ninguna
  await m.tocar('Itaú');
  assert.equal(m.ultimo().texto, '¿A qué cuenta recibirá tu destinatario?');
  await m.tocar('acc:0', 'BCP ••7890');
  assert.match(m.ultimo().texto, /Envías: 514\.16 BRL desde Itaú\n/);
  await m.tocar('confirmar', 'Confirmar');
  const o = m.falso.ordenes.get('BR-0002');
  assert.deepEqual([o.sourceBank, o.sourceAccount], ['Itaú', '']);
  const llamada = m.falso.llamadas.filter((l) => l.nombre === 'createOrder').at(-1);
  assert.ok(!('sourceAccount' in llamada.data), 'no se manda sourceAccount vacío');
}));
