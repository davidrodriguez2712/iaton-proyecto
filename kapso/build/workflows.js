// Definiciones de los workflows del flujo de WhatsApp de BrasPer (ver el spec en docs/superpowers/specs/).
// Convención: `entrada` es el primer nodo de un bloque; `ruta`/`salida` es el nodo decide cuyas aristas conecta quien llama.
const { Flow, PHONE_NUMBER_ID } = require('./flow');

const MODELO_EXTRACCION = '7c2cc054-60af-4ca8-aa15-030db79ce9db'; // claude-haiku-5-5 (Anthropic), de workflows list_provider_models
const FORMULARIO_WEB = 'https://brasper.com/es'; // la web aún no admite cotización por parámetros: abre la calculadora
const MSG_PERSONA = 'Te paso con una persona del equipo para ayudarte.';
const MSG_SIN_TASAS = 'Ahora no puedo cotizar con seguridad. Te paso con una persona del equipo para ayudarte.';
const MONEDAS = ['BRL', 'PEN', 'USD'];
const MONEDAS_BTN = MONEDAS.map((m) => ({ id: m, title: m }));
// Lista de demostración: la definitiva está pendiente de BrasPer (máximo 10 filas).
// Bancos por moneda (demostración). USD admite bancos de ambos países. Máximo 10 filas por lista.
const BANCOS_POR_MONEDA = {
  BRL: ['Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Caixa', 'Otro'],
  PEN: ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Otro'],
  USD: ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'Banco do Brasil', 'Itaú', 'Bradesco', 'Nubank', 'Otro'],
};
const ORIGEN_FONDOS = ['Ahorros', 'Venta de un bien', 'Otro'].map((o) => ({ id: o, title: o }));
const ids = (opciones) => opciones.map((o) => o.id);

const PROMPT_EXTRACCION = [
  'Eres un extractor de datos para BrasPer, una casa de cambio. Lee el último mensaje del cliente.',
  'Guarda con la herramienta save_variable solo los datos que el cliente haya dicho de forma explícita:',
  '- monto: el número a enviar (value_type float, solo el número, sin moneda).',
  '- moneda_origen: la moneda que envía (value_type string, solo BRL, PEN o USD).',
  '- moneda_destino: la moneda que recibe (value_type string, solo BRL, PEN o USD).',
  'Interpreta "reales" como BRL, "soles" como PEN y "dólares" como USD. "A Perú" implica moneda_destino PEN y "a Brasil" implica BRL.',
  'Si el cliente no menciona un dato, no lo guardes ni lo inventes.',
  'No escribas ningún mensaje al cliente. Usa solo las herramientas save_variable y complete_task; nunca otra. Cuando termines, llama a complete_task.',
].join('\n');

const AGENTE_EXTRACCION = {
  system_prompt: PROMPT_EXTRACCION,
  provider_model_id: MODELO_EXTRACCION,
  temperature: 0,
  max_iterations: 6,
  enabled_default_tools: ['save_variable', 'complete_task'],
  // Kapso agrega por su cuenta handoff_to_human, send_notification_to_user y enter_waiting y ignora default_tool_configs;
  // por eso el prompt prohíbe usarlas y message_delivery_mode es tool_only.
  message_delivery_mode: 'tool_only',
};

// Handoff a persona: registra el motivo, avisa al cliente (con enlace opcional) y detiene la ejecución.
function escalar(f, nombre, motivo, { mensaje = MSG_PERSONA, cta } = {}) {
  f.api(`${nombre}_reg`, `handoff_to_human:${motivo}`);
  f.text(`${nombre}_msg`, mensaje);
  f.link(`${nombre}_reg`, `${nombre}_msg`);
  let ultimo = `${nombre}_msg`;
  if (cta) {
    f.cta(`${nombre}_cta`, cta.body, cta.label, cta.url);
    f.link(ultimo, `${nombre}_cta`);
    ultimo = `${nombre}_cta`;
  }
  f.handoff(`${nombre}_fin`);
  f.link(ultimo, `${nombre}_fin`);
  return `${nombre}_reg`;
}

// Pregunta de texto libre con validación; el segundo fallo seguido escala. El llamador conecta `salida` con 'valido'.
function pregunta(f, n, { prompt, guardar, validar, error, motivo, escalarOpts }) {
  f.text(`${n}_ask`, prompt);
  f.wait(`${n}_wait`, { save: guardar });
  f.api(`${n}_val`, `validate:${validar}`, { edges: ['valido', 'invalido', 'escalar'] });
  f.text(`${n}_err`, error);
  const esc = escalar(f, `${n}_esc`, motivo, escalarOpts);
  f.link(`${n}_ask`, `${n}_wait`).link(`${n}_wait`, `${n}_val`);
  f.link(`${n}_val`, `${n}_err`, 'invalido').link(`${n}_err`, `${n}_wait`);
  f.link(`${n}_val`, esc, 'escalar');
  return { entrada: `${n}_ask`, salida: `${n}_val` };
}

// Elección por botones o lista; una respuesta fuera de las opciones repite el mensaje y el segundo fallo escala.
// El llamador conecta `ruta` con cada id de `opciones`.
function elegir(f, n, { tipo, body, opciones, boton = 'Elegir', variable, motivo }) {
  if (tipo === 'list') f.list(`${n}_ask`, body, boton, opciones);
  else f.buttons(`${n}_ask`, body, opciones);
  f.wait(`${n}_wait`);
  f.api(`${n}_route`, `route_reply:${variable}`, { edges: [...ids(opciones), 'invalido', 'escalar'] });
  const esc = escalar(f, `${n}_esc`, motivo);
  f.link(`${n}_ask`, `${n}_wait`).link(`${n}_wait`, `${n}_route`);
  f.link(`${n}_route`, `${n}_ask`, 'invalido');
  f.link(`${n}_route`, esc, 'escalar');
  return { entrada: `${n}_ask`, ruta: `${n}_route` };
}

// Como `elegir` con lista, pero la lista depende de la moneda guardada en `monedaVar`.
// Una respuesta fuera de las opciones vuelve a decidir por moneda y reenvía la lista correcta.
function elegirPorMoneda(f, n, { monedaVar, body, boton = 'Elegir banco', listas, variable, motivo }) {
  const todas = [...new Set(Object.values(listas).flat())];
  f.api(`${n}_mon`, `route_moneda:${monedaVar}`, { edges: MONEDAS });
  f.wait(`${n}_wait`);
  for (const m of MONEDAS) {
    f.list(`${n}_ask_${m}`, body, boton, listas[m].map((b) => ({ id: b, title: b })));
    f.link(`${n}_mon`, `${n}_ask_${m}`, m).link(`${n}_ask_${m}`, `${n}_wait`);
  }
  f.api(`${n}_route`, `route_reply:${variable}`, { edges: [...todas, 'invalido', 'escalar'] });
  const esc = escalar(f, `${n}_esc`, motivo);
  f.link(`${n}_wait`, `${n}_route`).link(`${n}_route`, `${n}_mon`, 'invalido').link(`${n}_route`, esc, 'escalar');
  return { entrada: `${n}_mon`, ruta: `${n}_route`, ids: todas };
}

function e1() {
  const f = new Flow('E1', 'BrasPer · E1 Cotiza', 'brasper-e1-cotiza', 'Etapa 1: extrae monto y monedas, cotiza y ofrece continuar.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  f.agent('extraer', AGENTE_EXTRACCION);
  f.link('init', 'extraer');
  f.api('verifica', 'check_extraction', { edges: ['completa', 'incompleta'] });
  f.link('extraer', 'verifica');
  f.api('cotiza', 'get_rate_quote', { edges: ['ok', 'sin_servicio', 'par_invalido'] });
  f.link('verifica', 'cotiza', 'completa');

  // Respaldo: el mensaje no trae los tres datos.
  const mo = elegir(f, 'mo', { tipo: 'buttons', body: '¡Hola! Soy el asistente de IA de BrasPer. ¿Qué moneda quieres enviar?', opciones: MONEDAS_BTN, variable: 'moneda_origen', motivo: 'moneda_origen' });
  const md = elegir(f, 'md', { tipo: 'buttons', body: '¿En qué moneda recibe tu destinatario?', opciones: MONEDAS_BTN, variable: 'moneda_destino', motivo: 'moneda_destino' });
  const monto = pregunta(f, 'monto', { prompt: '¿Cuánto quieres enviar? Escribe solo el monto.', guardar: 'monto_raw', validar: 'monto', error: 'No entendí el monto. Escribe solo el número, por ejemplo 500.', motivo: 'monto_invalido' });
  f.link('verifica', mo.entrada, 'incompleta');
  f.linkAll(mo.ruta, md.entrada, MONEDAS);
  f.linkAll(md.ruta, monto.entrada, MONEDAS);
  f.link(monto.salida, 'cotiza', 'valido');

  // Resultados de la cotización.
  f.text('par_err', 'Esa combinación de monedas no está disponible. Elige otras.');
  f.link('cotiza', 'par_err', 'par_invalido').link('par_err', mo.entrada);
  f.link('cotiza', escalar(f, 'tasas', 'tasas_no_disponibles', { mensaje: MSG_SIN_TASAS }), 'sin_servicio');
  f.buttons('oferta', '¡Hola! Hoy 1 {{vars.moneda_origen}} = {{vars.tasa_txt}} {{vars.moneda_destino}}. Comisión {{vars.comision_txt}} {{vars.moneda_origen}}. Recibirás {{vars.recibe_txt}} {{vars.moneda_destino}}. Tasa asegurada hasta las {{vars.tasa_hasta}}', [
    { id: 'continuar', title: 'Continuar' }, { id: 'cambiar_monto', title: 'Cambiar monto' }, { id: 'persona', title: 'Hablar con persona' },
  ]);
  f.cta('web', '¿Prefieres hacerlo desde la web?', 'Abrir formulario web', FORMULARIO_WEB);
  f.wait('oferta_wait');
  f.api('oferta_route', 'route_reply:accion_e1', { edges: ['continuar', 'cambiar_monto', 'persona', 'invalido', 'escalar'] });
  f.link('cotiza', 'oferta', 'ok').link('oferta', 'web').link('web', 'oferta_wait').link('oferta_wait', 'oferta_route');
  f.link('oferta_route', 'oferta', 'invalido');
  f.link('oferta_route', escalar(f, 'oferta_esc', 'oferta_sin_respuesta'), 'escalar');
  f.link('oferta_route', escalar(f, 'persona', 'cliente_pide_persona'), 'persona');
  const m2 = pregunta(f, 'monto2', { prompt: '¿Cuánto quieres enviar? Escribe solo el monto.', guardar: 'monto_raw', validar: 'monto', error: 'No entendí el monto. Escribe solo el número, por ejemplo 500.', motivo: 'monto_invalido' });
  f.link('oferta_route', m2.entrada, 'cambiar_monto');
  f.link(m2.salida, 'cotiza', 'valido');
  f.setvar('listo', 'continuar', 'si');
  f.link('oferta_route', 'listo', 'continuar');
  return f;
}

function e2() {
  const f = new Flow('E2', 'BrasPer · E2 Datos', 'brasper-e2-datos', 'Etapa 2: DNI/CPF, origen de fondos, banco de origen y cuenta destino; crea la operación.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  const dni = pregunta(f, 'dni', { prompt: '¿Cuál es tu DNI o CPF?', guardar: 'dni_raw', validar: 'dni_cpf', error: 'No reconozco ese formato. Revisa tu DNI (8 dígitos) o CPF (11 dígitos) y envíalo de nuevo.', motivo: 'dni_invalido' });
  f.link('init', dni.entrada);
  const of = elegir(f, 'of', { tipo: 'buttons', body: '¿De dónde provienen los fondos?', opciones: ORIGEN_FONDOS, variable: 'origen_fondos', motivo: 'origen_fondos' });
  f.link(dni.salida, of.entrada, 'valido');
  const bo = elegirPorMoneda(f, 'bo', { monedaVar: 'moneda_origen', body: '¿Desde qué banco nos envías tu dinero?', listas: BANCOS_POR_MONEDA, variable: 'banco_origen', motivo: 'banco_origen' });
  f.linkAll(of.ruta, bo.entrada, ids(ORIGEN_FONDOS));
  f.api('cliente', 'get_client', { edges: ['con_cuenta', 'sin_cuenta'] });
  f.linkAll(bo.ruta, 'cliente', bo.ids);

  // Cuenta destino guardada.
  const cu = elegir(f, 'cu', {
    tipo: 'buttons', body: 'Tengo guardada tu cuenta {{vars.cuenta_banco}} ••{{vars.cuenta_ultimos4}}. ¿Recibes ahí? Debe estar a tu nombre.',
    opciones: [{ id: 'si_esa', title: 'Sí, esa' }, { id: 'otra_cuenta', title: 'Otra cuenta' }], variable: 'cuenta_destino', motivo: 'cuenta_destino',
  });
  f.link('cliente', cu.entrada, 'con_cuenta');

  // Cuenta nueva: banco por lista, número en texto y confirmación enmascarada.
  const bn = elegirPorMoneda(f, 'bn', { monedaVar: 'moneda_destino', body: 'Vamos a agregar tu cuenta. ¿En qué banco está?', listas: BANCOS_POR_MONEDA, variable: 'cuenta_banco_nuevo', motivo: 'banco_cuenta_nueva' });
  // "Otra cuenta": primero las demás cuentas guardadas de la moneda; al agotarse, una cuenta nueva.
  f.api('sig', 'next_account', { edges: ['otra_guardada', 'nueva'] });
  f.link('cliente', bn.entrada, 'sin_cuenta').link(cu.ruta, 'sig', 'otra_cuenta');
  f.link('sig', cu.entrada, 'otra_guardada').link('sig', bn.entrada, 'nueva');
  const num = pregunta(f, 'num', {
    prompt: 'Escribe el número de cuenta.', guardar: 'numero_cuenta_raw', validar: 'numero_cuenta',
    error: 'Ese número no parece válido. Escríbelo solo con dígitos.', motivo: 'numero_cuenta_invalido',
    escalarOpts: { mensaje: 'No pude validar el número de cuenta. Puedes agregarla desde el formulario web y una persona del equipo te ayudará.', cta: { body: 'Agrega tu cuenta desde la web.', label: 'Abrir formulario web', url: FORMULARIO_WEB } },
  });
  f.linkAll(bn.ruta, num.entrada, bn.ids.filter((b) => b !== 'Otro'));
  // Banco "Otro": la cuenta se agrega desde el formulario web con ayuda de una persona.
  f.link(bn.ruta, escalar(f, 'bnotro', 'banco_otro', { mensaje: 'Para ese banco, agrega tu cuenta desde el formulario web y una persona del equipo te ayudará.', cta: { body: 'Agrega tu cuenta desde la web.', label: 'Abrir formulario web', url: FORMULARIO_WEB } }), 'Otro');
  const cf = elegir(f, 'cf', {
    tipo: 'buttons', body: 'Confirmo: {{vars.cuenta_banco_nuevo}} ••{{vars.cuenta_ultimos4}}. ¿Está a tu nombre?',
    opciones: [{ id: 'guardar', title: 'Sí, guardar' }, { id: 'corregir', title: 'Corregir' }], variable: 'confirma_cuenta', motivo: 'confirma_cuenta',
  });
  f.link(num.salida, cf.entrada, 'valido');
  f.link(cf.ruta, num.entrada, 'corregir');
  f.api('guarda', 'save_account');
  f.link(cf.ruta, 'guarda', 'guardar');

  // Crear la operación.
  f.api('crea', 'create_operation');
  f.link(cu.ruta, 'crea', 'si_esa').link('guarda', 'crea');
  f.setvar('listo', 'continuar', 'si');
  f.link('crea', 'listo');
  return f;
}

function e3() {
  const f = new Flow('E3', 'BrasPer · E3 Pago y constancia', 'brasper-e3-pago', 'Etapa 3: cuenta de BrasPer, aviso de horario, constancia (foto y N° de operación) o cancelación.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.link('start', 'init');
  f.api('vigencia', 'check_tasa', { edges: ['vigente', 'vencida'] });
  f.link('init', 'vigencia');
  f.api('cuenta', 'get_company_account');
  f.link('vigencia', 'cuenta', 'vigente');

  // Tasa vencida: recotiza y pide confirmar.
  f.api('recotiza', 'get_rate_quote', { edges: ['ok', 'sin_servicio', 'par_invalido'] });
  f.link('vigencia', 'recotiza', 'vencida');
  const tn = elegir(f, 'tn', {
    tipo: 'buttons', body: 'La tasa asegurada venció. Nueva cotización: 1 {{vars.moneda_origen}} = {{vars.tasa_txt}} {{vars.moneda_destino}}. Recibirás {{vars.recibe_txt}} {{vars.moneda_destino}}.',
    opciones: [{ id: 'continuar', title: 'Continuar' }, { id: 'cancelar', title: 'Cancelar operación' }], variable: 'tasa_nueva', motivo: 'tasa_nueva',
  });
  f.link('recotiza', tn.entrada, 'ok');
  const sinTasa = escalar(f, 'tasas', 'tasas_no_disponibles', { mensaje: MSG_SIN_TASAS });
  f.link('recotiza', sinTasa, 'sin_servicio').link('recotiza', sinTasa, 'par_invalido');
  f.link(tn.ruta, 'cuenta', 'continuar');
  f.api('cancela', 'cancel_operation');
  f.text('cancelada', 'Listo, cancelé la operación {{vars.operacion_id}}.');
  f.link('cancela', 'cancelada');
  f.link(tn.ruta, 'cancela', 'cancelar');

  // Cuenta de BrasPer y aviso fuera de horario.
  f.text('instr', 'Transfiere {{vars.total_enviar_txt}} {{vars.moneda_origen}} a:\nTitular: {{vars.brasper_titular}}\nBanco: {{vars.brasper_banco}}\nCuenta: {{vars.brasper_cuenta}}\nUsa la cuenta de {{vars.moneda_origen}}, no otra moneda.\nTasa asegurada hasta las {{vars.tasa_hasta}}');
  f.link('cuenta', 'instr');
  f.api('horario', 'check_hours', { edges: ['abierto', 'cerrado'] });
  f.link('instr', 'horario');
  f.text('fuera', 'Fuera de horario: tu operación se verificará {{vars.proxima_verificacion}}');
  const ac = elegir(f, 'ac', {
    tipo: 'buttons', body: 'Cuando termines la transferencia, toca "Ya transferí".',
    opciones: [{ id: 'ya_transferi', title: 'Ya transferí' }, { id: 'cancelar', title: 'Cancelar operación' }], variable: 'accion_e3', motivo: 'accion_e3',
  });
  f.link('horario', 'fuera', 'cerrado').link('horario', ac.entrada, 'abierto').link('fuera', ac.entrada);

  // Cancelar con confirmación.
  const cc = elegir(f, 'cc', {
    tipo: 'buttons', body: '¿Seguro que quieres cancelar la operación {{vars.operacion_id}}?',
    opciones: [{ id: 'si_cancelar', title: 'Sí, cancelar' }, { id: 'continuar', title: 'Continuar' }], variable: 'confirma_cancelar', motivo: 'confirma_cancelar',
  });
  f.link(ac.ruta, cc.entrada, 'cancelar').link(cc.ruta, 'cancela', 'si_cancelar').link(cc.ruta, ac.entrada, 'continuar');

  // Constancia: foto y número de operación bancaria. El asistente no evalúa el comprobante.
  f.text('pide_foto', 'Perfecto. Envíame la foto del comprobante.');
  f.wait('esp_foto');
  f.api('foto', 'media:comprobante', { edges: ['foto', 'sin_foto', 'escalar'] });
  f.text('sin_foto', 'No recibí una foto. Envíame la foto o captura del comprobante.');
  // La tasa se revisa también al transferir: si venció, la constancia se adjunta marcada para que una persona confirme la tasa final.
  f.api('vigencia2', 'check_tasa', { edges: ['vigente', 'vencida'] });
  f.link(ac.ruta, 'vigencia2', 'ya_transferi').link('vigencia2', 'pide_foto', 'vigente');
  f.setvar('marca_vencida', 'tasa_vencida', 'si');
  f.text('aviso_vencida', 'Tu tasa asegurada venció mientras transferías. Igual recibo tu constancia: una persona confirmará la tasa final al validar tu pago.');
  f.link('vigencia2', 'marca_vencida', 'vencida').link('marca_vencida', 'aviso_vencida').link('aviso_vencida', 'pide_foto');
  f.link('pide_foto', 'esp_foto').link('esp_foto', 'foto');
  f.link('foto', 'sin_foto', 'sin_foto').link('sin_foto', 'esp_foto');
  f.link('foto', escalar(f, 'foto_esc', 'comprobante_no_recibido'), 'escalar');
  const nop = pregunta(f, 'nop', { prompt: 'Ahora escribe el número de operación bancaria.', guardar: 'n_operacion_raw', validar: 'n_operacion', error: 'Ese número no parece válido. Escríbelo solo con dígitos.', motivo: 'n_operacion_invalido' });
  f.link('foto', nop.entrada, 'foto');
  f.api('adjunta', 'attach_proof');
  f.link(nop.salida, 'adjunta', 'valido');
  f.text('cierre', 'Una persona validará tu pago en unos 15 min. Te escribo cuando esté listo.');
  f.setvar('listo', 'continuar', 'si');
  f.link('adjunta', 'cierre').link('cierre', 'listo');
  return f;
}

function e4() {
  const f = new Flow('E4', 'BrasPer · E4 Estado', 'brasper-e4-estado', 'Etapa 4: avisa al cliente cuando el backend cambia el estado del pago. Se inicia por API.');
  f.start();
  f.api('operacion', 'get_operation');
  f.link('start', 'operacion');
  f.api('ventana', 'check_window', { edges: ['abierta', 'cerrada'] });
  f.link('operacion', 'ventana');
  f.api('ruta', 'route_estado', { edges: ['verificada', 'rechazada', 'otro'] });
  f.link('ventana', 'ruta', 'abierta');
  // Ventana de 24 h cerrada: en producción aquí va la plantilla de Meta (posterior a la demo).
  f.setvar('plantilla', 'aviso_pendiente', 'plantilla_requerida');
  f.link('ventana', 'plantilla', 'cerrada');
  f.text('verificado', '✅ Pago verificado. Enviamos tu dinero a la cuenta ••{{vars.cuenta_ultimos4}}.');
  f.text('listo', '¡Listo! Recibiste {{vars.recibe_txt}} {{vars.moneda_destino}}.');
  f.api('cierra', 'complete_operation');
  f.link('ruta', 'verificado', 'verificada').link('verificado', 'listo').link('listo', 'cierra');
  f.link('ruta', escalar(f, 'rech', 'pago_no_validado', { mensaje: 'No pudimos validar tu pago de la operación {{vars.operacion_id}}. Una persona del equipo te contactará.' }), 'rechazada');
  f.setvar('omitido', 'aviso_omitido', 'si');
  f.link('ruta', 'omitido', 'otro');
  f.trigger({ trigger_type: 'api_call', active: true });
  return f;
}

function w0() {
  const f = new Flow('W0', 'BrasPer · W0 Enrutador', 'brasper-w0-enrutador', 'Enruta cada conversación nueva a la etapa que corresponde según el estado de la operación.');
  f.start();
  f.api('estado', 'get_status', { edges: ['e1', 'e3', 'estado', 'escalada'] });
  f.link('start', 'estado');
  f.call('c1', 'E1').api('sigue1', 'check_continue', { edges: ['seguir', 'fin'] });
  f.call('c2', 'E2').api('sigue2', 'check_continue', { edges: ['seguir', 'fin'] });
  f.call('c3', 'E3');
  f.setvar('fin', 'flujo_terminado', 'si');
  f.link('estado', 'c1', 'e1').link('c1', 'sigue1').link('sigue1', 'c2', 'seguir').link('c2', 'sigue2').link('sigue2', 'c3', 'seguir');
  f.link('sigue1', 'fin', 'fin').link('sigue2', 'fin', 'fin');
  f.link('estado', 'c3', 'e3');
  f.text('status', 'Tu operación {{vars.operacion_id}} está {{vars.estado_texto}}.');
  f.link('estado', 'status', 'estado');
  f.text('esc', 'Una persona del equipo ya está atendiendo tu caso.');
  f.link('estado', 'esc', 'escalada');
  f.trigger({ trigger_type: 'inbound_message', phone_number_id: PHONE_NUMBER_ID, active: true });
  return f;
}

function buildFlows() {
  return { E1: e1(), E2: e2(), E3: e3(), E4: e4(), W0: w0() };
}

module.exports = { buildFlows, AGENTE_EXTRACCION, FORMULARIO_WEB };
