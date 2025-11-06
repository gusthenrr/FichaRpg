import React from 'react';
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Modal,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { API_URL } from './url';
import { UserContext } from '../UserContext';
import { PrinterService } from '../PrinterService';
import { getSocket } from '../socket';

export default class BarmanScreen extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      data: [],
      data_filtrado: [],
      showFiltrado: true,

      ingredientes: [],
      refreshing: false,
      showModal: false,
      loadingIng: false,

      // rede/controle
      isConnected: true,
    };

    this.socket = null;

    // timers/flags
    this._isMounted = false;
    this._netinfoUnsub = null;
    this._refreshTimeout = null;

    // fila e trava de impressão (sequencial)
    this._printQueue = [];
    this._printing = false;

    // evita cliques múltiplos por item
    this._rowBusyIds = new Set();

    // binds
    this.refreshData = this.refreshData.bind(this);
    this.alterar_estado = this.alterar_estado.bind(this);
    this.filtrar = this.filtrar.bind(this);
    this.extra = this.extra.bind(this);
  }

  getCarrinho() {
    const { user } = this.context || {};
    return user?.carrinho || '';
  }

  // ===== Util =====
  safeSetState = (updater, cb) => {
    if (!this._isMounted) return;
    this.setState(updater, cb);
  };

  // normaliza chaves
  normalizeKey = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  /** chave do grupo = pedido + extra + opcoes (normalizados) */
  getGroupKey = (item) => {
    const p = this.normalizeKey(item.pedido);
    const i = this.normalizeKey(item.opcoes);
    const e = this.normalizeKey(item.extra);
    return `${p}|${e}|${i}`;
  };

  // Aceita string JSON, objeto único ou array de grupos.
  // Retorna "Grupo: opt1, opt2 | Outro: optA, optB"
  formatOpcoesText = (raw) => {
    if (!raw) return '';
    let data;
    try {
      data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return '';
    }
    let groups = [];
    if (Array.isArray(data)) groups = data;
    else if (data && typeof data === 'object' && Array.isArray(data.options)) groups = [data];
    if (!groups.length) return '';

    const parts = groups
      .map((g) => {
        const groupName = g?.nome ? String(g.nome).trim() : '';
        const opts = (Array.isArray(g?.options) ? g.options : [])
          .map((o) => (o && String(o.nome || '').trim()))
          .filter(Boolean);
        if (!opts.length) return '';
        const optsTxt = opts.join(', ');
        return groupName ? `${groupName}: ${optsTxt}` : optsTxt;
      })
      .filter(Boolean);

    return parts.join(' | ');
  };

  /** Contagem por grupo (sem cores dinâmicas) */
  buildGroupCounts = (list, countMode = 'rows') => {
    const counts = {};
    for (const it of list) {
      const key = this.getGroupKey(it);
      if (!(key in counts)) counts[key] = 0;
      counts[key] += countMode === 'qty' ? Number(it.quantidade || 0) : 1;
    }
    return counts;
  };

  // ===== Ciclo de vida =====
  async componentDidMount() {
    this._isMounted = true;

    // monitor de rede
    this._netinfoUnsub = NetInfo.addEventListener((state) => {
      const now = !!state.isConnected;
      if (now !== this.state.isConnected) {
        this.safeSetState({ isConnected: now });
      }
    });

    try {
      const net = await NetInfo.fetch();
      this.safeSetState({ isConnected: !!net.isConnected });
    } catch {}

    // socket
    const { user } = this.context || {};
    this.socket = getSocket();

    if (this.socket) {
      const carrinho = this.getCarrinho();
      this.socket.emit('getPedidos', { emitir: false, carrinho });
      this.socket.on('respostaPedidos', this.handleRespostaPedidos);
      this.socket.on('ingrediente', this.handleIngrediente);

      if (user?.username === 'gustavobiondi') {
        // fila de impressão pendente
        await this.processPendingPrintOrders();
        // imprime novos "restantes" via fila
        this.socket.on('emitir_pedido_restante', this.handleEmitirPedidoRestante);
      }
    }
  }

  componentWillUnmount() {
    this._isMounted = false;

    if (this._netinfoUnsub) {
      this._netinfoUnsub();
      this._netinfoUnsub = null;
    }
    if (this._refreshTimeout) {
      clearTimeout(this._refreshTimeout);
      this._refreshTimeout = null;
    }

    if (this.socket) {
      this.socket.off('respostaPedidos', this.handleRespostaPedidos);
      this.socket.off('ingrediente', this.handleIngrediente);
      this.socket.off('emitir_pedido_restante', this.handleEmitirPedidoRestante);
    }
  }

  // ===== Handlers de socket =====
  handleRespostaPedidos = (dados) => {
    if (!dados?.dataPedidos) {
      // encerra refresh se estava ativo
      if (this.state.refreshing) this.safeSetState({ refreshing: false });
      return;
    }

    const data_temp = dados.dataPedidos.filter((item) => item.categoria === '2');
    const data_temp_filtrado = data_temp.filter((item) => item.estado !== 'Pronto');

    this.safeSetState({
      data: data_temp,
      data_filtrado: data_temp_filtrado,
      refreshing: false,
    });
  };

  handleIngrediente = ({ data }) => {
    // conteúdo do modal de ingredientes recebido do backend
    this.safeSetState({ ingredientes: data || [], loadingIng: false });
  };

  handleEmitirPedidoRestante = async (data) => {
    // Enfileira para impressão sequencial
    if (!data) return;
    const ids = Array.isArray(data?.ids)
      ? data.ids.filter((id) => id !== undefined && id !== null)
      : [];
    if (data.id !== undefined && data.id !== null && !ids.includes(data.id)) {
      ids.push(data.id);
    }
    this._enqueuePrintJob({
      id: data.id,
      ids,
      mesa: data?.mesa ?? data?.comanda ?? '',
      pedido: data?.pedido || '',
      quant: data?.quantidade || null,
      opcoes: data?.opcoes || null,
      extra: data?.extra || null,
      hora: data?.hora || null,
      remetente: data?.remetente || null,
      endereco: data?.endereco_entrega || null,
      prazo: data?.prazo || null,
      sendBy: data?.sendBy || null,
      shouldUpdatePrinted: true,
    });
  };

  // ===== Fila de impressão =====
  _enqueuePrintJob(job) {
    this._printQueue.push(job);
    this._drainPrintQueue();
  }

  async _drainPrintQueue() {
    if (this._printing) return;
    this._printing = true;
    try {
      while (this._printQueue.length > 0 && this._isMounted) {
        const job = this._printQueue.shift();
        try {
          await PrinterService.printPedido({
            mesa: job.mesa,
            pedido: job.pedido,
            quant: job.quant,
            opcoes: job.opcoes,
            extra: job.extra,
            hora: job.hora,
            remetente: job.remetente,
            endereco: job.endereco,
            prazo: job.prazo,
            sendBy: job.sendBy,
          });

          if (job.shouldUpdatePrinted) {
            const idsToUpdate = Array.isArray(job?.ids) && job.ids.length
              ? job.ids
              : job.id != null
                ? [job.id]
                : [];
            if (idsToUpdate.length) {
              try {
                const payload = { carrinho: this.getCarrinho() };
                if (idsToUpdate.length === 1) payload.pedidoId = idsToUpdate[0];
                else payload.pedidoIds = idsToUpdate;

                const upd = await fetch(`${API_URL}/updatePrinted`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
                });
                if (!upd.ok) {
                  const errText = await upd.text();
                  console.error(
                    `Falha ao marcar impresso (ids=${idsToUpdate.join(', ')}): ${upd.status} ${upd.statusText} :: ${errText}`,
                  );
                }
              } catch (e) {
                console.error('Erro ao atualizar status de impressão:', e);
              }
            }
          }
        } catch (err) {
          console.error('Erro ao imprimir:', err);
          // continua drenando a fila mesmo em erro
        }
      }
    } finally {
      this._printing = false;
    }
  }

  // Busca e imprime pendências (sequencial + robusto)
  processPendingPrintOrders = async () => {
    // checa rede antes
    try {
      const net = await NetInfo.fetch();
      if (!net.isConnected) return; // sem internet, silencia
    } catch {}

    try {
      const resp = await fetch(`${API_URL}/getPendingPrintOrders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printed: 0, ordem: 0, carrinho: this.getCarrinho() }),
      });

      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} :: ${text}`);

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Resposta não-JSON do servidor: ${text.slice(0, 300)}`);
      }

      const list = Array.isArray(parsed?.pedidos) ? parsed.pedidos : [];
      for (const order of list) {
        // enfileira — e deixa a fila drenar
        const ids = Array.isArray(order?.ids)
          ? order.ids.filter((id) => id !== undefined && id !== null)
          : [];
        if (order.id !== undefined && order.id !== null && !ids.includes(order.id)) {
          ids.push(order.id);
        }

        this._enqueuePrintJob({
          id: order.id,
          ids,
          mesa: order?.mesa ?? order?.comanda ?? '',
          pedido: order?.pedido || '',
          quant: order?.quantidade || null,
          opcoes: order?.opcoes || null,
          extra: order?.extra || null,
          hora: order?.hora || null,
          remetente: order?.remetente || null,
          endereco: order?.endereco_entrega || null,
          prazo: order?.prazo || null,
          sendBy: order?.sendBy || null,
          shouldUpdatePrinted: true,
        });
      }
    } catch (error) {
      console.error('Erro ao buscar pedidos pendentes de impressão:', error);
    }
  };

  // ===== Refresh =====
  refreshData = () => {
    if (!this.socket) return;
    this.safeSetState({ refreshing: true }, () => {
      const carrinho = this.getCarrinho();
      this.socket.emit('getPedidos', { emitir: false, carrinho });
      // fallback para nunca travar o spinner se nada voltar
      if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
      this._refreshTimeout = setTimeout(() => {
        this.safeSetState({ refreshing: false });
      }, 7000);
    });
  };

  // ===== Ações =====
  alterar_estado(id, estado) {
    if (!this.socket) return;
    if (id == null) return;

    // evita spam no botão desta linha
    if (this._rowBusyIds.has(id)) return;
    this._rowBusyIds.add(id);

    try {
      // pode-se adaptar para usar ACK do socket se disponível
      this.socket.emit('inserir_preparo', { id, estado, carrinho: this.getCarrinho() });
    } finally {
      // libera após pequeno intervalo para evitar clique duplo
      setTimeout(() => {
        this._rowBusyIds.delete(id);
        // re-carrega para refletir estado atualizado
        this.refreshData();
      }, 800);
    }
  }

  filtrar = () => {
    this.safeSetState((prevState) => ({ showFiltrado: !prevState.showFiltrado }));
  };

  // Modal ingredientes — evita acesso por índice (lista muda). Recebe o item diretamente.
  extra(item) {
    const pedidoNome = item?.pedido;
    if (!pedidoNome) return;

    this.safeSetState({ showModal: true, loadingIng: true, ingredientes: [] }, () => {
      if (this.socket) {
        this.socket.emit('get_ingredientes', { ingrediente: pedidoNome, carrinho: this.getCarrinho() });
      } else {
        this.safeSetState({ loadingIng: false });
      }
    });
  }

  // ===== UI helpers =====
  actionForEstado = (estado) => {
    if (estado === 'Em Preparo') return { label: 'TERMINAR', bg: '#059669', txt: '#fff', next: 'Pronto' };
    if (estado === 'A Fazer') return { label: 'COMEÇAR', bg: '#17315c', txt: '#fff', next: 'Em Preparo' };
    return { label: 'DESFAZER', bg: '#DC2626', txt: '#fff', next: 'A Fazer' };
  };

  renderHeader = () => (
    <View style={styles.headerBar}>
      <Text style={styles.headerTitle}>Barman • Pedidos</Text>
      <TouchableOpacity
        onPress={this.filtrar}
        activeOpacity={0.9}
        style={[styles.toggleBtn, this.state.showFiltrado ? styles.toggleActive : null]}
      >
        <Text style={[styles.toggleText, this.state.showFiltrado ? styles.toggleTextActive : null]}>
          {this.state.showFiltrado ? 'Todos' : 'Filtrar'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  renderItem = ({ item }) => {
    const a = this.actionForEstado(item.estado);
    const key = this.getGroupKey(item);
    const dupeCount = this._groupCounts?.[key] || 1;

    const rowBusy = this._rowBusyIds.has(item.id);

    return (
      <View style={styles.cardRow}>
        {/* bolha quantidade + badge de duplicados */}
        <View style={styles.qtyWrap}>
          <View style={styles.qtyBubble}>
            <Text style={styles.qtyText}>{item.quantidade}</Text>
          </View>
          {dupeCount > 1 && (
            <View style={styles.dupeDot}>
              <Text style={styles.dupeText}>{dupeCount}</Text>
            </View>
          )}
        </View>

        <View style={styles.middleCol}>
          <Text style={styles.itemName} numberOfLines={1}>
            {item.pedido}
          </Text>

          {(() => {
            const opcoesFmt = this.formatOpcoesText(item.opcoes);
            const hasOpcoes = !!opcoesFmt;
            const extraTxt = (item.extra || '').trim();
            const hasExtra = !!extraTxt;

            if (!hasOpcoes && !hasExtra) return null;

            return (
              <Text style={styles.itemExtra}>
                {hasOpcoes ? opcoesFmt : ''}
                {hasOpcoes && hasExtra ? ' • ' : ''}
                {hasExtra ? `${extraTxt}` : ''}
              </Text>
            );
          })()}

          <Text style={styles.comandaText}>Comanda {item.comanda}</Text>
        </View>

        <View style={styles.rightCol}>
          <Text style={styles.timeText}>{item.inicio}</Text>

          <TouchableOpacity
            style={[styles.btn, styles.btnOutlineSm]}
            onPress={() => this.extra(item)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.btnOutlineSmText}>Detalhes</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.btn,
              styles.btnAction,
              { backgroundColor: a.bg, opacity: rowBusy ? 0.6 : 1 },
            ]}
            onPress={() => !rowBusy && this.alterar_estado(item.id, a.next)}
            activeOpacity={0.9}
          >
            <Text style={styles.btnActionText}>{rowBusy ? '...' : a.label}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  render() {
    const dataToShow = this.state.showFiltrado ? this.state.data_filtrado : this.state.data;
    const { refreshing, showModal, ingredientes, loadingIng } = this.state;

    // recomputa contagem por grupo
    this._groupCounts = this.buildGroupCounts(dataToShow, 'rows');

    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        {this.renderHeader()}

        <FlatList
          data={dataToShow}
          keyExtractor={(item, index) => String(item?.id ?? index)}
          renderItem={this.renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={this.refreshData} />}
          contentContainerStyle={{ paddingBottom: 24 }}
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews
        />

        <Modal
          animationType="slide"
          transparent
          visible={showModal}
          onRequestClose={() => this.safeSetState({ showModal: false, ingredientes: [], loadingIng: false })}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Ingredientes</Text>
                <TouchableOpacity
                  onPress={() => this.safeSetState({ showModal: false, ingredientes: [], loadingIng: false })}
                  style={styles.modalCloseBtn}
                >
                  <Text style={styles.modalCloseIcon}>×</Text>
                </TouchableOpacity>
              </View>

              {loadingIng ? (
                <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                  <ActivityIndicator size="small" />
                </View>
              ) : (
                <FlatList
                  data={Array.isArray(ingredientes) ? ingredientes : []}
                  keyExtractor={(item, index) => index.toString()}
                  renderItem={({ item }) => (
                    <View style={styles.ingRow}>
                      <Text style={styles.ingKey}>{item?.key}</Text>
                      <Text style={styles.ingSep}>:</Text>
                      <Text style={styles.ingVal}>{item?.dado}</Text>
                    </View>
                  )}
                  ListEmptyComponent={
                    <Text style={{ textAlign: 'center', color: '#6B7280', paddingVertical: 8 }}>
                      Sem detalhes para este item.
                    </Text>
                  }
                />
              )}
            </View>
          </View>
        </Modal>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  // layout base
  container: { flex: 1, backgroundColor: '#fff' },

  // header
  headerBar: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: '#111827' },
  toggleBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  toggleActive: { backgroundColor: '#17315c', borderColor: '#17315c' },
  toggleText: { color: '#374151', fontWeight: '800' },
  toggleTextActive: { color: '#fff' },

  // linhas/cartões
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 12,
    marginTop: 10,
  },

  // coluna esquerda: quantidade + duplicados
  qtyWrap: { position: 'relative', marginRight: 10 },
  qtyBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  qtyText: { fontSize: 16, fontWeight: '900', color: '#111827' },
  dupeDot: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  dupeText: { fontSize: 12, fontWeight: '800', color: '#111827' },

  // coluna do meio
  middleCol: { flex: 1, paddingRight: 6 },
  itemName: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 2 },
  itemExtra: { fontSize: 13, color: '#374151', marginBottom: 2, flexWrap: 'wrap', lineHeight: 18 },
  comandaText: { fontSize: 13, fontWeight: '700', color: '#111827' },

  // coluna direita
  rightCol: { width: 116, alignItems: 'flex-end' },
  timeText: { fontSize: 13, fontWeight: '800', color: '#374151', marginBottom: 8 },

  // botões
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  btnOutlineSm: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#9ca3af',
    marginBottom: 8,
  },
  btnOutlineSmText: { color: '#111827', fontWeight: '800' },

  btnAction: { marginTop: 0 },
  btnActionText: { color: '#fff', fontWeight: '800' },

  // modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '92%',
    maxWidth: 520,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
    paddingBottom: 6,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  modalCloseIcon: { fontSize: 20, fontWeight: '800', color: '#111827', marginTop: -2 },

  ingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  ingKey: {
    width: 72,
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textAlign: 'right',
    paddingRight: 6,
  },
  ingSep: {
    width: 10,
    textAlign: 'center',
    color: '#9CA3AF',
    marginTop: 1,
  },
  ingVal: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    color: '#111827',
  },
});
