// Cozinha.js
import React from 'react';
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { UserContext } from '../UserContext';
import { getSocket } from '../socket';
import { PrinterService } from '../PrinterService';
import { API_URL } from './url';

// -------------------- helpers --------------------
const safeParseOptions = (raw) => {
  if (!raw) return [];
  try {
    return Array.isArray(raw) ? raw : JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(String(raw).replace(/'/g, '"'));
    } catch {
      return [];
    }
  }
};

/** Exibe grupos/opções selecionadas/ativas (sem valor_extra) */
const formatSelectedOptions = (rawOpcoes) => {
  const groups = safeParseOptions(rawOpcoes);
  if (!Array.isArray(groups) || groups.length === 0) return '';
  const lines = [];
  for (const g of groups) {
    const all = g?.options || g?.opcoes || [];
    const opts = all.filter(
      (o) => o?.selecionado === true || typeof o?.selecionado === 'undefined'
    );
    if (!opts.length) continue;
    const groupName = g?.nome || 'Opções';
    lines.push(`${groupName}: ${opts.map((o) => o?.nome).join(', ')}`);
  }
  return lines.join(' | ');
};

const formatHoraCurta = (s) => {
  if (!s) return '';
  const m = String(s).match(/^(\d{2}:\d{2})(:\d{2})?$/);
  return m ? m[1] : s;
};

const estadoStyle = (estado) => {
  switch ((estado || '').toLowerCase()) {
    case 'em preparo':
      return { bg: '#FFF3E0', fg: '#EF6C00' };
    case 'pronto':
      return { bg: '#E8F5E9', fg: '#2E7D32' };
    default:
      return { bg: '#E3F2FD', fg: '#1565C0' };
  }
};

const isCozinhaCategory = (obj) =>
  obj?.categoria === '3' || obj?.categoria_id === 3;

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
};

const collectPedidoIds = (order) => {
  const set = new Set();
  if (!order) return [];
  ensureArray(order.ids).forEach((id) => {
    if (id !== undefined && id !== null) set.add(id);
  });
  if (order.id !== undefined && order.id !== null) {
    set.add(order.id);
  }
  if (Array.isArray(order.pedido)) {
    order.pedido.forEach((item) => {
      const itemId = item?.id;
      if (itemId !== undefined && itemId !== null) set.add(itemId);
    });
  }
  return Array.from(set);
};

const normalizePedidoItens = (rawPedido, quantidade, opcoes, extra) => {
  if (Array.isArray(rawPedido) && rawPedido.length) {
    return rawPedido
      .map((it) => {
        if (it && typeof it === 'object') {
          const normalized = {
            pedido: it.pedido ?? it.nome ?? '',
            quantidade: it.quantidade ?? it.quant ?? 1,
          };
          if (it.opcoes) normalized.opcoes = it.opcoes;
          if (it.extra) normalized.extra = it.extra;
          if (it.id !== undefined) normalized.id = it.id;
          return normalized;
        }
        return { pedido: String(it ?? ''), quantidade: 1 };
      })
      .filter((it) => it.pedido);
  }

  const nome = rawPedido ?? '';
  if (!nome && !quantidade && !opcoes && !extra) return [];

  const normalized = {
    pedido: String(nome),
    quantidade: quantidade ?? 1,
  };
  if (opcoes) normalized.opcoes = opcoes;
  if (extra) normalized.extra = extra;
  return [normalized];
};

const pickEndereco = (order) =>
  order?.endereco ?? order?.endereco_entrega ?? order?.enderecoEntrega ?? '';

// -------------------------------------------------

export default class Cozinha extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      data: [],
      data_filtrado: [],
      showFiltrado: false, // false = mostra só "não Pronto"
      refreshing: false,
      pendingIds: {}, // { [idPedido]: true } lock anti-clique
    };
    this.socket = null;
    this.refreshTimeout = null;
    this._mounted = false;
  }

  getCarrinho() {
    const { user } = this.context || {};
    return user?.carrinho || '';
  }

  componentDidMount() {
    this._mounted = true;
    const { user } = this.context || {};
    this.socket = getSocket();

    // listeners (IDs corretos)
    this.socket.on('respostaPedidosCC', this.handleRespostaPedidos);
    this.refreshData();

    // impressões pendentes (somente cozinha principal)
    if (user?.username === 'cozinha_principal') {
      this.processPendingPrintOrders();
      this.socket.on('emitir_pedido_cozinha', this.handleEmitirPedidoRestante);
    }
  }

  componentWillUnmount() {
    this._mounted = false;
    if (this.socket) {
      this.socket.off('respostaPedidosCC', this.handleRespostaPedidos);
      this.socket.off('emitir_pedido_cozinha', this.handleEmitirPedidoRestante);
    }
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
  }

  // ----------------- impressão -----------------
  handleEmitirPedidoRestante = async (order) => {
    try {
      if (!isCozinhaCategory(order)) return;

      const itens = normalizePedidoItens(
        order?.pedido,
        order?.quantidade,
        order?.opcoes,
        order?.extra,
      );
      if (!itens.length) return;

      await PrinterService.printPedido({
        mesa: order?.mesa ?? order?.comanda ?? '',
        pedido: itens,
        hora: order?.hora || null,
        remetente: order?.remetente || null,
        endereco: order?.endereco_entrega || null,
        prazo: order?.prazo || order?.horario_para_entrega || null,
        sendBy: order?.sendBy || null,
      });

      const ids = collectPedidoIds(order);
      if (ids.length) {
        const payload = { carrinho: this.getCarrinho() };
        if (ids.length === 1) payload.pedidoId = ids[0];
        else payload.pedidoIds = ids;

        await fetch(`${API_URL}/updatePrinted`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
    } catch (e) {
      console.log('Erro ao imprimir (cozinha):', e);
    }
  };

  /** Busca itens não impressos e imprime somente categoria 3 */
  processPendingPrintOrders = async () => {
    try {
      const resp = await fetch(`${API_URL}/getPendingPrintOrders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printed: 0, ordem: 0, carrinho: this.getCarrinho() }),
      });

      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} :: ${text}`);

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Resposta não-JSON do servidor: ${text.slice(0, 300)}`);
      }

      for (const order of json.pedidos || []) {
        if (!isCozinhaCategory(order)) continue;
        try {
          const itens = normalizePedidoItens(
            order?.pedido,
            order?.quantidade,
            order?.opcoes,
            order?.extra,
          );
          if (!itens.length) continue;

          await PrinterService.printPedido({
            mesa: order?.mesa ?? order?.comanda ?? '',
            pedido: itens,
            hora: order?.hora || null,
            remetente: order?.remetente || null,
            endereco: order?.endereco_entrega || pickEndereco(order) || null,
            prazo: order?.prazo || order?.horario_para_entrega || null,
            sendBy: order?.sendBy || null,
          });

          const ids = collectPedidoIds(order);
          if (ids.length) {
            const payload = { carrinho: this.getCarrinho() };
            if (ids.length === 1) payload.pedidoId = ids[0];
            else payload.pedidoIds = ids;

            const upd = await fetch(`${API_URL}/updatePrinted`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (!upd.ok) {
              const errText = await upd.text();
              console.error(
                `Falha ao marcar impresso (ids=${ids.join(', ')}): ${upd.status} ${upd.statusText} :: ${errText}`,
              );
            }
          }
        } catch (e) {
          console.log('Erro ao imprimir (cozinha):', e);
        }
      }
    } catch (error) {
      console.error('Erro ao buscar pedidos pendentes de impressão (cozinha):', error);
    }
  };

  // ----------------- socket data -----------------
  handleRespostaPedidos = (dados) => {
    if (!this._mounted) return;
    if (!dados?.dataPedidos) {
      this.setState({ refreshing: false });
      return;
    }
    const data_temp = (dados.dataPedidos || []).filter(isCozinhaCategory);
    const data_temp_filtrado = data_temp.filter((item) => item.estado !== 'Pronto');

    this.setState({
      data: data_temp,
      data_filtrado: data_temp_filtrado,
      refreshing: false,
    });
  };

  // ----------------- refresh -----------------
  refreshData = () => {
    if (this.state.refreshing) return; // anti-spam
    this.setState({ refreshing: true }, () => {
      const carrinho = this.getCarrinho();
      this.socket?.emit('getPedidosCC', { emitir: false, carrinho });
      if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
      // fallback p/ rede instável
      this.refreshTimeout = setTimeout(() => {
        if (this._mounted) this.setState({ refreshing: false });
      }, 8000);
    });
  };

  // ----------------- ações -----------------
  alterar_estado = (id, estado) => {
    if (!id) return;
    // lock anti-cliques rápidos (com auto-release em 7s)
    if (this.state.pendingIds[id]) return;

    this.setState((prev) => ({ pendingIds: { ...prev.pendingIds, [id]: true } }), () => {
      this.socket?.emit('inserir_preparo', { id, estado, carrinho: this.getCarrinho() });

      // Solta lock sozinho, mesmo que backend não responda
      setTimeout(() => {
        if (!this._mounted) return;
        this.setState((prev) => {
          const copy = { ...prev.pendingIds };
          delete copy[id];
          return { pendingIds: copy };
        });
      }, 7000);
    });
  };

  filtrar = () => {
    this.setState((prev) => ({ showFiltrado: !prev.showFiltrado }));
  };

  // ----------------- UI -----------------
  renderBotaoPreparo = (item, { compact = false } = {}) => {
    const { user } = this.context || {};
    if (!(user?.cargo === 'Cozinha' || user?.cargo === 'ADM')) return null;

    const busy = !!this.state.pendingIds[item?.id];
    const wrapStyle = compact ? styles.startBtnWrapInline : styles.actionsRow;

    const makeBtn = (label, onPress, variant) => (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.9}
        disabled={busy}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[
          styles.startBtn,
          compact && styles.startBtnCompact,
          variant === 'blue' && styles.startBtnBlue,
          variant === 'orange' && styles.startBtnOrange,
          variant === 'green' && styles.startBtnGreen,
          busy && { opacity: 0.6 },
        ]}
      >
        <Text style={styles.startBtnText}>{busy ? 'Aguarde…' : label}</Text>
      </TouchableOpacity>
    );

    let content = null;
    if (item?.estado === 'Em Preparo') {
      content = makeBtn('Pronto', () => this.alterar_estado(item.id, 'Pronto'), 'orange');
    } else if (item?.estado === 'A Fazer') {
      content = makeBtn('Começar', () => this.alterar_estado(item.id, 'Em Preparo'), 'blue');
    } else {
      content = makeBtn('Desfazer', () => this.alterar_estado(item.id, 'A Fazer'), 'green');
    }

    return <View style={wrapStyle}>{content}</View>;
  };

  renderItem = ({ item }) => {
    const optionsText = formatSelectedOptions(item?.opcoes);
    const { bg, fg } = estadoStyle(item?.estado);

    const remetente = item?.remetente;
    const comanda = item?.comanda;
    const endereco = item?.endereco_entrega;
    const horaEntrega = item?.horario_para_entrega;

    const remHeader =
      remetente || comanda
        ? `${remetente ? remetente : ''}${comanda ? `${remetente ? ' · ' : ''}Comanda ${comanda}` : ''}`
        : '';

    return (
      <View style={styles.card}>
        {/* Cabeçalho */}
        <View style={styles.cardHeader}>
          {!!remHeader && (
            <View style={styles.pillRemetente}>
              <Text style={styles.pillRemetenteText}>{remHeader}</Text>
            </View>
          )}
          <View style={[styles.pillEstado, { backgroundColor: bg }]}>
            <Text style={[styles.pillEstadoText, { color: fg }]}>{item?.estado || 'A Fazer'}</Text>
          </View>
        </View>

        {/* Pedido */}
        <Text style={styles.pedidoTitle}>{item?.pedido}</Text>
        {!!optionsText && <Text style={styles.optionsText}>{optionsText}</Text>}
        {!!item?.extra && <Text style={styles.extraText}>Obs: {item.extra}</Text>}

        {/* Entrega */}
        {(endereco || horaEntrega) && (
          <View style={styles.deliveryBox}>
            {!!endereco && (
              <Text style={styles.deliveryLine}>
                <Text style={styles.deliveryLabel}>Entrega: </Text>
                {endereco}
              </Text>
            )}

            {!!horaEntrega && (
              <View style={styles.deliveryInline}>
                <Text style={styles.deliveryLine}>
                  <Text style={styles.deliveryLabel}>Prazo: </Text>
                  {formatHoraCurta(horaEntrega)}
                </Text>
                {this.renderBotaoPreparo(item, { compact: true })}
              </View>
            )}
          </View>
        )}

        {/* Ações (se sem prazo) */}
        {!horaEntrega && <View style={styles.actionsRow}>{this.renderBotaoPreparo(item)}</View>}
      </View>
    );
  };

  render() {
    const { showFiltrado, refreshing, data, data_filtrado } = this.state;
    const dataToShow = showFiltrado ? data : data_filtrado;

    return (
      <View style={styles.container}>
        {/* toggle filtro */}
        <View style={styles.topActions}>
          <TouchableOpacity onPress={this.filtrar} activeOpacity={0.85} style={styles.toggleBtn}>
            <Text style={styles.toggleBtnText}>{showFiltrado ? 'Filtrar' : 'Todos'}</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={dataToShow}
          keyExtractor={(item, index) => String(item?.id ?? index)}
          renderItem={this.renderItem}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={!refreshing ? <Text style={styles.emptyText}>Nenhum pedido por aqui…</Text> : null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={this.refreshData} />}
          initialNumToRender={10}
          windowSize={5}
          removeClippedSubviews
        />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 10, backgroundColor: '#F7F9F8' },

  topActions: { alignItems: 'flex-end', marginBottom: 8 },
  toggleBtn: {
    backgroundColor: '#E3F2FD',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  toggleBtnText: { color: '#1565C0', fontWeight: '600' },

  listContent: { paddingBottom: 16 },

  card: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },

  pillRemetente: {
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '75%',
  },
  pillRemetenteText: { color: '#2E7D32', fontWeight: '700', fontSize: 12 },

  pillEstado: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  pillEstadoText: { fontWeight: '700', fontSize: 12 },

  pedidoTitle: { fontSize: 18, fontWeight: '700', color: '#222', marginTop: 2 },
  optionsText: { marginTop: 6, fontSize: 14, color: '#444' },
  extraText: { marginTop: 4, fontSize: 13, color: '#666', fontStyle: 'italic' },

  deliveryBox: { marginTop: 8, backgroundColor: '#F5F5F5', borderRadius: 10, padding: 8 },
  deliveryLine: { fontSize: 13, color: '#333', marginBottom: 2 },
  deliveryLabel: { fontWeight: '700', color: '#222' },
  deliveryInline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  actionsRow: { marginTop: 10, alignItems: 'flex-end' },

  emptyText: { textAlign: 'center', marginTop: 24, color: '#777' },

  // botão “chip”
  startBtnWrapInline: { marginTop: 0 },
  startBtn: {
    backgroundColor: '#111827',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  startBtnCompact: { paddingVertical: 8, paddingHorizontal: 12 },
  startBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  // variantes
  startBtnBlue: { backgroundColor: '#1565C0' },   // Começar
  startBtnOrange: { backgroundColor: '#F59E0B' }, // Pronto
  startBtnGreen: { backgroundColor: '#10B981' },  // Desfazer
});
