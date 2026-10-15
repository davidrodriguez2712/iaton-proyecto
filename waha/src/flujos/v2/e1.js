// E1 v2: extrae monto y monedas, cotiza en el backend real y ofrece continuar.
const { Flow } = require('../../../../kapso/build/flow');
const { AGENTE_EXTRACCION } = require('../../../../kapso/build/workflows');
const { MSG_SIN_TASAS, FORMULARIO_WEB, MONEDAS, MONEDAS_BTN, escalar, pregunta, elegir } = require('./helpers');

function e1() {
  const f = new Flow('E1', 'BrasPer · E1 Cotiza (v2)', 'brasper-v2-e1-cotiza', 'Etapa 1: extrae monto y monedas, cotiza con el backend y ofrece continuar.');
  f.start();
  f.setvar('init', 'continuar', 'no');
  f.setvar('saludo', 'saludo_txt', '👋 ¡Hola! Soy el asistente de IA de BrasPer. Esta es tu cotización:');
  f.link('start', 'init').link('init', 'saludo');
  f.agent('extraer', AGENTE_EXTRACCION);
  f.link('saludo', 'extraer');
  f.api('verifica', 'check_extraction', { edges: ['completa', 'incompleta'] });
  f.link('extraer', 'verifica');
  f.api('cotiza', 'quote_create', { edges: ['ok', 'sin_servicio', 'par_invalido', 'monto_bajo', 'requiere_persona'] });
  f.link('verifica', 'cotiza', 'completa');

  // Respaldo: el mensaje no trae los tres datos.
  const mo = elegir(f, 'mo', { tipo: 'buttons', body: '¡Hola! 👋 Soy el asistente de IA de BrasPer. ¿Qué moneda quieres enviar?', opciones: MONEDAS_BTN, variable: 'moneda_origen', motivo: 'moneda_origen',
    // Si en vez de tocar un botón el cliente escribe la remesa (p. ej. tras mandar una imagen), se interpreta ese texto; el segundo fallo escala.
    siInvalido: 'extraer' });
  const md = elegir(f, 'md', { tipo: 'buttons', body: '¿En qué moneda recibe tu destinatario?', opciones: MONEDAS_BTN, variable: 'moneda_destino', motivo: 'moneda_destino' });
  const monto = pregunta(f, 'monto', { prompt: '¿Cuánto quieres enviar? Escríbelo solo con números, por ejemplo 500.', guardar: 'monto_raw', validar: 'monto', error: 'No pude leer ese monto 🤔 Escríbelo solo con números, por ejemplo 500.', motivo: 'monto_invalido' });
  f.link('verifica', mo.entrada, 'incompleta');
  f.linkAll(mo.ruta, md.entrada, MONEDAS);
  f.linkAll(md.ruta, monto.entrada, MONEDAS);
  f.link(monto.salida, 'cotiza', 'valido');

  // Resultados de la cotización.
  f.text('par_err', 'Esa combinación de monedas no está disponible. Elige otras.');
  f.link('cotiza', 'par_err', 'par_invalido').link('par_err', mo.entrada);
  f.text('bajo', 'Ese monto es muy pequeño para operar. Prueba con un monto mayor, por favor.');
  f.link('cotiza', 'bajo', 'monto_bajo').link('bajo', monto.entrada);
  f.link('cotiza', escalar(f, 'tasas', 'tasas_no_disponibles', { mensaje: MSG_SIN_TASAS }), 'sin_servicio');
  f.link('cotiza', escalar(f, 'grande', 'monto_grande', { mensaje: 'Para montos grandes te atiende una persona del equipo, así cuidamos tu operación 🙌' }), 'requiere_persona');
  f.buttons('oferta', '{{vars.saludo_txt}}\n\n📤 Envías: {{vars.monto_txt}} {{vars.moneda_origen}}\n➕ Comisión e impuesto: {{vars.cargos_txt}} {{vars.moneda_origen}}\n💳 *Total a transferir: {{vars.total_enviar_txt}} {{vars.moneda_origen}}*\n📥 *Recibes: {{vars.recibe_txt}} {{vars.moneda_destino}}*\n📈 Tasa: 1 {{vars.moneda_origen}} = {{vars.tasa_txt}} {{vars.moneda_destino}}\n⏱ Válida hasta las {{vars.tasa_hasta}}\n\n¿Quieres continuar?', [
    { id: 'continuar', title: 'Sí, continuar' }, { id: 'cambiar_monto', title: 'Cambiar monto' }, { id: 'persona', title: 'Hablar con alguien' },
  ]);
  f.cta('web', '¿Prefieres hacerlo desde la web?', 'Abrir formulario web', FORMULARIO_WEB);
  f.wait('oferta_wait');
  f.api('oferta_route', 'route_reply:accion_e1', { edges: ['continuar', 'cambiar_monto', 'persona', 'invalido', 'escalar'] });
  f.link('cotiza', 'oferta', 'ok').link('oferta', 'web').link('web', 'oferta_wait').link('oferta_wait', 'oferta_route');
  f.link('oferta_route', 'oferta', 'invalido');
  f.link('oferta_route', escalar(f, 'oferta_esc', 'oferta_sin_respuesta'), 'escalar');
  f.link('oferta_route', escalar(f, 'persona', 'cliente_pide_persona'), 'persona');
  const m2 = pregunta(f, 'monto2', { prompt: '¿Cuánto quieres enviar? Escríbelo solo con números, por ejemplo 500.', guardar: 'monto_raw', validar: 'monto', error: 'No pude leer ese monto 🤔 Escríbelo solo con números, por ejemplo 500.', motivo: 'monto_invalido' });
  f.setvar('saludo2', 'saludo_txt', 'Esta es tu nueva cotización:');
  f.link('oferta_route', 'saludo2', 'cambiar_monto').link('saludo2', m2.entrada);
  f.link(m2.salida, 'cotiza', 'valido');
  f.setvar('listo', 'continuar', 'si');
  f.link('oferta_route', 'listo', 'continuar');
  return f;
}

module.exports = { e1 };
