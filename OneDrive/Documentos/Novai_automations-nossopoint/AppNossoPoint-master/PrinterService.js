// PrinterService.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

let BLEPrinter, NetPrinter;
async function loadThermal() {
  if (!BLEPrinter || !NetPrinter) {
    const mod = require('react-native-thermal-receipt-printer');
    BLEPrinter = mod.BLEPrinter;
    NetPrinter = mod.NetPrinter;
  }
}

const KEYS = {
  TYPE: 'printer_type',
  MAC: 'printer_mac',
  HOST: 'printer_host',
};

/* ========= ESC/POS ========= */
const ESC = '\x1B';
const GS  = '\x1D';

const escpos = {
  init: ESC + '@',
  left: ESC + 'a' + '\x00',
  center: ESC + 'a' + '\x01',
  boldOn: ESC + 'E' + '\x01',
  boldOff: ESC + 'E' + '\x00',
  dblOn: ESC + '!' + '\x30',   // largura+altura dupla
  dblH: ESC + '!' + '\x10',    // altura dupla
  normal: ESC + '!' + '\x00',
  cp1252: ESC + 't' + '\x10',  // codepage 16 (acentos)
  feed2: ESC + 'd' + '\x02',
  cut: GS + 'V' + '\x01',
};

/* ========= Utils ========= */
function pad(s, len) {
  s = String(s ?? '');
  if (s.length > len) return s.slice(0, len);
  return s + ' '.repeat(len - s.length);
}

/**
 * Quebra segura por palavra (evita "Ta\nmanho").
 * Se uma palavra > largura, fatia com hífen.
 */
function wrapWordSafe(text, width, { hyphen = true } = {}) {
  if (!text) return '';
  const paragraphs = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];

  for (let p of paragraphs) {
    p = p.replace(/\s+/g, ' ').trim();
    if (!p) { out.push(''); continue; }

    let line = '';
    for (const word of p.split(' ')) {
      if (!word) continue;
      const add = (line ? ' ' : '') + word;

      if (line.length + add.length <= width) {
        line += add;
        continue;
      }

      if (word.length > width) {
        if (line) { out.push(line); line = ''; }
        let rest = word;
        while (rest.length > width) {
          const take = hyphen ? Math.max(1, width - 1) : width;
          out.push(rest.slice(0, take) + (hyphen ? '-' : ''));
          rest = rest.slice(take);
        }
        line = rest;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }

  return out.join('\n') + (out.length ? '\n' : '');
}

function lineKV(key, value, width) {
  const k = key + ': ';
  const leftLen = Math.min(k.length, Math.floor(width / 2));
  const rightLen = width - leftLen;
  return pad(k, leftLen) + pad(String(value ?? ''), rightLen) + '\n';
}

/* ========= Sanitização forte de “meta” embutida ========= */
// remove linhas de META (Mesa/Hora/Remetente/Operador/Endereço/Pedido, etc.) e frases de rodapé
const META_LINE = /^(?:\s*(?:mesa|hora|remetente|operador|enviado por|enviou|endere[cç]o|pedido)\s*[:\-]\s*.*|\s*obrigado pela prefer[êe]ncia\s*|\s*nao e documento fiscal\s*)$/i;

function stripMetaLinesFromText(s) {
  if (!s) return '';
  return String(s)
    .split(/\r?\n/)
    .filter(line => !META_LINE.test(line.trim()))
    .join('\n')
    .trimEnd();
}

/** Remove META quando `pedido` veio como string “legada” */
function sanitizeLegacyPedidoString(s) {
  return stripMetaLinesFromText(s);
}

/** Limpa texto de item/opções/observação */
function sanitizeAnyText(s) {
  if (!s) return '';
  return stripMetaLinesFromText(s);
}

/* ========= Itens ========= */

/** Renderiza pedido(s) para ESC/POS – aceita string OU array de itens */
function renderItensEscPos(pedido, largura) {
  // Caso array: cada item {pedido, quantidade, opcoes?, extra?}
  if (Array.isArray(pedido)) {
    const itemSep = '-'.repeat(largura) + '\n';
    let out = '';

    pedido.forEach((it, i) => {
      const nome = sanitizeAnyText(it?.pedido ?? '');
      const qtd  = it?.quantidade ?? 1;

      // principal
      out += escpos.boldOn + wrapWordSafe(`${qtd}x ${nome}`, largura) + escpos.boldOff;

      // opções (string já formatada no backend) – também higieniza
      if (it?.opcoes) {
        out += wrapWordSafe(sanitizeAnyText(it.opcoes), largura);
      }

      // observações – também higieniza
      if (it?.extra) {
        out += wrapWordSafe(sanitizeAnyText(`Obs: ${it.extra}`), largura);
      }

      // separador entre itens
      if (i < pedido.length - 1) out += itemSep;
      else out += '\n';
    });

    return out;
  }

  // Caso string: limpa linhas de meta e quebra
  return wrapWordSafe(sanitizeLegacyPedidoString(String(pedido ?? '')), largura);
}

/** Versão “plain” usada no setor 'restantes' (se você usar) */
function renderItensPlain(pedido, largura) {
  if (Array.isArray(pedido)) {
    return pedido
      .map((it) => {
        const nome = sanitizeAnyText(it?.pedido ?? '');
        const qtd  = it?.quantidade ?? 1;
        const op   = it?.opcoes ? wrapWordSafe(sanitizeAnyText(`${it.opcoes}`), largura).trimEnd() : '';
        const ex   = it?.extra ? wrapWordSafe(sanitizeAnyText(`Obs: ${it.extra}`), largura).trimEnd() : '';
        return [wrapWordSafe(`${qtd}x ${nome}`, largura).trimEnd(), op, ex]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n' + '-'.repeat(largura) + '\n');
  }

  return wrapWordSafe(sanitizeLegacyPedidoString(String(pedido ?? '')), largura).trimEnd();
}

/* ========= Cupom ========= */

/** Gera o cupom completo (58mm = 32 col, 80mm = 48 col) */
function buildCupom({
  lojaNome = '',
  end1 = '',
  end2 = '',
  mesa = '',
  pedido = '',
  hora = '',
  sendBy = '',
  remetente = '',
  endereco = '',
  prazo = '',
  largura = 32,
}) {
  const sep = '-'.repeat(largura) + '\n';

  // Cabeçalho + META sempre no topo
  const header =
    escpos.init + escpos.cp1252 +
    escpos.center + escpos.boldOn + escpos.dblOn + (lojaNome || '') + '\n' + escpos.normal + escpos.boldOff +
    (end1 ? (escpos.center + wrapWordSafe(end1, largura)) : '') +
    (end2 ? (escpos.center + wrapWordSafe(end2, largura)) : '') +
    sep +
    escpos.left +
    (mesa       ? lineKV('Mesa',        mesa, largura)         : '') +
    lineKV('Hora', hora || new Date().toLocaleString(), largura) +
    (remetente  ? lineKV('Remetente',   remetente, largura)    : '') +
    (sendBy     ? lineKV('Operador',    sendBy, largura)       : '') +
    (endereco   ? wrapWordSafe('Endereço: ' + endereco, largura) : '') +
    (prazo      ? lineKV('Prazo',       prazo, largura)        : '') +
    sep;

  // Itens (já higienizados)
  const itens = renderItensEscPos(pedido, largura);

  // Corpo = só os itens + régua final
  const corpo = escpos.left + itens + sep;

  // Rodapé (fixo)
  const footer =
    escpos.center + 'Obrigado pela preferência!\n' +
    escpos.center + 'NAO E DOCUMENTO FISCAL\n' +
    '\n' + escpos.feed2 + escpos.cut;

  return header + corpo + footer;
}

/* ========================== Serviço ========================== */

export const PrinterService = {
  async selectBluetoothPrinter() {
    await loadThermal();
    try { await BLEPrinter.init(); } catch (_) {}
    const list = await BLEPrinter.getDeviceList();
    if (!list?.length) {
      Alert.alert('Impressora', 'Nenhum dispositivo pareado encontrado.');
      return;
    }
    const first = list[0];
    const mac = first.inner_mac_address || first.macAddress || first.bdAddress || null;
    if (!mac) {
      Alert.alert('Impressora', 'MAC não encontrado.');
      return;
    }
    await AsyncStorage.setItem(KEYS.MAC, mac);
    await AsyncStorage.setItem(KEYS.TYPE, 'ble');
    const name = first.device_name || first.deviceName || 'Desconhecida';
    Alert.alert('Impressora', `Selecionada: ${name}\nMAC: ${mac}`);
  },

  async printPedido({ mesa, pedido, hora, sendBy, remetente, endereco, prazo, setor }) {
    await loadThermal();

    const type = (await AsyncStorage.getItem(KEYS.TYPE)) || 'ble';
    let content = '';

    if (setor === 'cozinha') {
      content = buildCupom({
        lojaNome: remetente || '',
        mesa,
        pedido,    // string OU array (higienização cobre ambos)
        hora,
        sendBy,
        remetente,
        endereco,
        prazo,
        largura: 32, // use 48 se a bobina for 80mm
      });
    } else if (setor === 'restantes') {
      // opcional – se você usar
      const init = escpos.init + escpos.cp1252;
      const header =
        escpos.center + escpos.dblOn + `Mesa: ${mesa}\n` + escpos.normal;
      const itensPlain = renderItensPlain(pedido, 32);
      const detalhes =
        escpos.dblH + `Pedido(s):\n` + escpos.normal +
        `${itensPlain}\n` +
        `Hora: ${hora}\n` +
        (sendBy ? `Operador: ${sendBy}\n` : '') +
        (endereco ? `${wrapWordSafe(`Endereco: ${endereco}`, 32)}` : '') +
        (prazo ? `Prazo: ${prazo}\n` : '') +
        escpos.feed2;

      content = init + header + detalhes;
    }

    // --- Envio ---
    if (type === 'net') {
      const host = await AsyncStorage.getItem(KEYS.HOST);
      if (!host) throw new Error('Host da impressora (LAN) não configurado');
      try { await NetPrinter.init(); } catch {}
      await NetPrinter.connectPrinter(host, 9100);
      await NetPrinter.printText(content, {});
      return;
    }

    const mac = await AsyncStorage.getItem(KEYS.MAC);
    if (!mac) throw new Error('Impressora Bluetooth não configurada');
    try { await BLEPrinter.init(); } catch {}
    await BLEPrinter.connectPrinter(mac);
    await BLEPrinter.printText(content, {});
  }
};
