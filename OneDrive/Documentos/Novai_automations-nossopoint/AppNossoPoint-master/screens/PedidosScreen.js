import React from 'react';
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  TextInput,
  Modal,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { UserContext } from '../UserContext';
import { getSocket } from '../socket';
import OpcoesEditorLite from './opcoesEditor';

// ---------- utils ----------
const normalize = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const toInt = (v, d = 0) => {
  const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(n) ? n : d;
};
const toFloat = (v, d = 0) => {
  const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : d;
};
const isHHMM = (s) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(s || '').trim());

// mapeia categoria para rótulo
const catLabel = (c) => {
  const sc = String(c);
  if (sc === '1') return 'Pegar';
  if (sc === '2') return 'Barman';
  if (sc === '3') return 'Cozinha';
  return sc || '—';
};

export default class PedidosScreen extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      // dados
      data: [],
      refreshing: false,

      // conectividade
      isConnected: true,

      // filtros
      filtroComanda: '',
      filtroItem: '',
      filtroCategoria: null,
      categoriasDisponiveis: [],
      filtroStatus: null,

      // modal
      showModal: false,
      editable: false,
      pedidoModal: {},

      // UI/fluxo
      carregandoConfirmar: false,
      salvandoEdicao: false,
    };

    this.socket = null;
    this._isMounted = false;
    this._guards = {};
    this._refreshTimeout = null;
    this._netinfoUnsub = null;
  }

  getCarrinho() {
    const { user } = this.context || {};
    return user?.carrinho || '';
  }

  // ------- guards contra cliques rápidos -------
  guard = (key, fn, cooldown = 280) => {
    if (this._guards[key]) return;
    this._guards[key] = true;
    try {
      fn && fn();
    } finally {
      setTimeout(() => {
        this._guards[key] = false;
      }, cooldown);
    }
  };

  safeSetState = (patch, cb) => {
    if (!this._isMounted) return;
    this.setState(patch, cb);
  };

  // pago ⇔ ordem > 0
  isPago = (it) => toInt(it?.ordem, 0) > 0;
  isComandaFechada = (it) => this.isPago(it);
  isComandaAberta = (it) => !this.isComandaFechada(it);

  componentDidMount() {
    this._isMounted = true;

    // rede
    this._netinfoUnsub = NetInfo.addEventListener((state) => {
      const isConnected = !!state.isConnected;
      if (isConnected !== this.state.isConnected) {
        this.safeSetState({ isConnected });
        if (isConnected) {
          // tenta sincronizar assim que voltar
          this.refreshData();
        }
      }
    });

    // socket
    this.socket = getSocket();
    if (!this.socket) {
      Alert.alert('Erro', 'Sem socket disponível no momento.');
      return;
    }
    this.socket.on('connect', () => {
      // reconexão: re-sincroniza a lista
      this.refreshData();
    });
    this.socket.on('disconnect', () => {
      // nada assíncrono aqui; a UI indica pelo refresh que pode falhar
    });

    const { user } = this.context || {};
    if (user?.cargo !== 'Cozinha') {
      this.socket.on('respostaPedidos', this.handleRespostaPedidos);
    } else {
      this.socket.on('respostaPedidosCC', this.handleRespostaPedidos);
    }

    this.refreshData();
  }

  componentWillUnmount() {
    this._isMounted = false;
    if (this._netinfoUnsub) this._netinfoUnsub();

    if (this.socket) {
      this.socket.off('connect');
      this.socket.off('disconnect');
      const { user } = this.context || {};
      if (user?.cargo !== 'Cozinha') {
        this.socket.off('respostaPedidos', this.handleRespostaPedidos);
      } else {
        this.socket.off('respostaPedidosCC', this.handleRespostaPedidos);
      }
    }
    if (this._refreshTimeout) {
      clearTimeout(this._refreshTimeout);
      this._refreshTimeout = null;
    }
  }

  // ---------- socket handlers ----------
  handleRespostaPedidos = (dados) => {
    // proteção a payload inconsistente
    if (!this._isMounted) return;

    const { user } = this.context || {};
    let arr = [];
    const payload = dados?.dataPedidos;

    if (Array.isArray(payload)) {
      if (user?.cargo !== 'Cozinha') {
        arr = [...payload].reverse();
      } else {
        // garante categoria 3 comparando como string
        arr = payload.filter((p) => String(p?.categoria) === '3').reverse();
      }
    }

    const categorias = Array.from(
      new Set(
        arr
          .map((i) => String(i?.categoria ?? ''))
          .filter((c) => c && c !== 'null' && c !== 'undefined')
      )
    );

    if (this._refreshTimeout) {
      clearTimeout(this._refreshTimeout);
      this._refreshTimeout = null;
    }

    this.safeSetState({
      data: arr,
      categoriasDisponiveis: categorias,
      refreshing: false,
    });
  };

  refreshData = () =>
    this.guard('refresh', () => {
      if (!this._isMounted) return;

      if (!this.state.isConnected || !this.socket || !this.socket.connected) {
        this.safeSetState({ refreshing: false });
        Alert.alert('Sem conexão', 'Verifique sua internet para atualizar os pedidos.');
        return;
      }

      const { user } = this.context || {};
      this.safeSetState({ refreshing: true }, () => {
        try {
          const carrinho = this.getCarrinho();
          if (user?.cargo !== 'Cozinha') {
            this.socket.emit('getPedidos', { emitir: false, carrinho });
          } else {
            this.socket.emit('getPedidosCC', { emitir: true, carrinho });
          }
          // fallback para não travar o spinner
          if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
          this._refreshTimeout = setTimeout(() => {
            this.safeSetState({ refreshing: false });
          }, 10000);
        } catch {
          this.safeSetState({ refreshing: false });
          Alert.alert('Erro', 'Falha ao solicitar atualização.');
        }
      });
    });

  // ---------- filtros ----------
  getFilteredData = () => {
    const { data, filtroComanda, filtroItem, filtroCategoria, filtroStatus } = this.state;

    const nCom = normalize(filtroComanda);
    const nItem = normalize(filtroItem);

    return (data || []).filter((it) => {
      const okComanda = nCom ? normalize(it?.comanda).includes(nCom) : true;
      const okItem = nItem ? normalize(it?.pedido).includes(nItem) : true;
      const okCat = filtroCategoria ? String(it?.categoria) === String(filtroCategoria) : true;

      let okStatus = true;
      if (filtroStatus === 'aberta') okStatus = this.isComandaAberta(it);
      if (filtroStatus === 'fechada') okStatus = this.isComandaFechada(it);

      return okComanda && okItem && okCat && okStatus;
    });
  };

  limparFiltros = () =>
    this.guard('limparFiltros', () => {
      this.safeSetState({
        filtroComanda: '',
        filtroItem: '',
        filtroCategoria: null,
        filtroStatus: null,
      });
    });

  // ---------- modal ----------
  abrirModal = (item) =>
    this.guard('abrirModal', () => {
      const safe = {
        id: item?.id ?? null,
        comanda: item?.comanda ?? '',
        pedido: item?.pedido ?? '',
        quantidade: String(item?.quantidade ?? ''),
        preco: String(item?.preco ?? ''),
        inicio: item?.inicio ?? '',
        fim: item?.fim ?? '',
        comecar: item?.comecar ?? '',
        estado: item?.estado ?? '',
        extra: item?.extra ?? '',
        username: item?.username ?? '',
        ordem: item?.ordem ?? '',
        nome: item?.nome ?? '',
        dia: item?.dia ?? '',
        orderTiming: item?.orderTiming ?? '',
        endereco_entrega: item?.endereco_entrega ?? '',
        order_id: item?.order_id ?? '',
        remetente: item?.remetente ?? '',
        horario_para_entrega: item?.horario_para_entrega ?? '',
        categoria: item?.categoria ?? '',
        preco_unitario: String(item?.preco_unitario ?? ''),
        opcoes: item?.opcoes ?? '',
        quantidade_paga: String(item?.quantidade_paga ?? '0'),
        printed: item?.printed ?? 0,
      };
      this.safeSetState({ pedidoModal: safe, showModal: true, editable: false });
    });

  fecharModal = () =>
    this.guard('fecharModal', () => {
      this.safeSetState({ showModal: false, editable: false, pedidoModal: {} });
    });

  entrarEdicao = () => this.guard('entrarEdicao', () => this.safeSetState({ editable: true }));
  sairEdicao = () => this.guard('sairEdicao', () => this.safeSetState({ editable: false }));

  onChangeCampo = (campo, valor) => {
    // sem guard: alterações devem ser responsivas
    this.safeSetState((prev) => {
      const novo = { ...prev.pedidoModal, [campo]: valor };

      if (campo === 'quantidade') {
        const q = Math.max(0, toInt(valor, 0));
        const pu = toFloat(novo.preco_unitario, 0);
        novo.preco = String((pu * q).toFixed(2));

        const qpAntigo = toInt(prev.pedidoModal.quantidade_paga, 0);
        novo.quantidade_paga = String(Math.min(q, Math.max(0, qpAntigo)));
      }

      if (campo === 'preco_unitario') {
        const pu = toFloat(valor, 0);
        const q = Math.max(0, toInt(novo.quantidade, 0));
        novo.preco = String((pu * q).toFixed(2));
      }

      return { pedidoModal: novo };
    });
  };

  salvarEdicao = () =>
    this.guard('salvarEdicao', () => {
      if (this.state.salvandoEdicao) return;

      const { user } = this.context || {};
      const p = this.state.pedidoModal;

      // validações
      const q = toInt(p.quantidade, NaN);
      if (!Number.isFinite(q)) {
        Alert.alert('Erro', 'Quantidade inválida (somente números).');
        return;
      }
      const qp = toInt(p.quantidade_paga, NaN);
      if (!Number.isFinite(qp)) {
        Alert.alert('Erro', 'Quantidade paga inválida (somente números).');
        return;
      }
      if (qp > q) {
        Alert.alert('Erro', 'Quantidade paga não pode ser maior que a quantidade.');
        return;
      }
      const pu = toFloat(p.preco_unitario, NaN);
      if (!Number.isFinite(pu)) {
        Alert.alert('Erro', 'Preço unitário inválido.');
        return;
      }
      const preco = toFloat(p.preco, NaN);
      if (!Number.isFinite(preco)) {
        Alert.alert('Erro', 'Preço inválido.');
        return;
      }
      const h = String(p.horario_para_entrega || '').trim();
      if (h && !isHHMM(h)) {
        Alert.alert('Erro', 'Horário para entrega deve estar no formato HH:MM.');
        return;
      }

      if (!this.state.isConnected || !this.socket || !this.socket.connected) {
        Alert.alert('Sem conexão', 'Não é possível salvar agora. Tente novamente quando voltar a internet.');
        return;
      }

      const payload = {
        id: p.id,
        comanda: p.comanda,
        preco: String(preco),
        quantidade: String(q),
        quantidade_paga: String(qp),
        preco_unitario: String(pu),
        opcoes: p.opcoes ?? '',
        extra: p.extra ?? '',
        horario_para_entrega: h,
      };

      this.safeSetState({ salvandoEdicao: true }, () => {
        try {
          this.socket.emit('atualizar_pedidos', {
            pedidoAlterado: payload,
            usuario: user?.username,
            token: user?.token,
            carrinho: this.getCarrinho(),
          });
          this.safeSetState({ editable: false, showModal: false, pedidoModal: {} });
        } catch {
          Alert.alert('Erro', 'Não foi possível salvar a edição agora.');
        } finally {
          this.safeSetState({ salvandoEdicao: false });
        }
      });
    });

  confirmarPedido = (item) =>
    this.guard('confirmarPedido', async () => {
      const { user } = this.context || {};
      if (!item?.id) return;

      if (!this.state.isConnected || !this.socket || !this.socket.connected) {
        Alert.alert('Sem conexão', 'Não é possível confirmar agora.');
        return;
      }

      try {
        this.safeSetState({ carregandoConfirmar: true });
        // Se o seu backend tiver um evento específico, ajuste aqui:
        // Exemplo genérico com fallback:
        if (typeof this.socket.emit === 'function') {
          this.socket.emit('confirmar_pedido', {
            id: item.id,
            comanda: item.comanda,
            usuario: user?.username,
            token: user?.token,
            carrinho: this.getCarrinho(),
          });
        }
        // feedback otimista (printed = 1)
        this.safeSetState((prev) => ({
          data: (prev.data || []).map((p) =>
            String(p.id) === String(item.id) ? { ...p, printed: 1 } : p
          ),
        }));
      } catch {
        Alert.alert('Erro', 'Não foi possível confirmar o pedido.');
      } finally {
        this.safeSetState({ carregandoConfirmar: false });
      }
    });

  confirmarExclusao = (item) =>
    this.guard('confirmarExclusao', () => {
      Alert.alert(
        'Excluir pedido',
        `Excluir o pedido "${item?.pedido}" da comanda "${item?.comanda}"? Essa ação não pode ser desfeita.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Excluir', style: 'destructive', onPress: () => this.excluirPedido(item) },
        ]
      );
    });

  excluirPedido = (item) =>
    this.guard('excluirPedido', () => {
      const { user } = this.context || {};
      if (!item?.id) return;

      if (!this.state.isConnected || !this.socket || !this.socket.connected) {
        Alert.alert('Sem conexão', 'Não é possível excluir agora.');
        return;
      }

      try {
        this.socket.emit('excluir_pedido', {
          id: item.id,
          comanda: item.comanda,
          usuario: user?.username,
          token: user?.token,
          carrinho: this.getCarrinho(),
        });

        // feedback otimista
        this.safeSetState((prev) => ({
          showModal: false,
          editable: false,
          pedidoModal: {},
          data: (prev.data || []).filter((p) => String(p.id) !== String(item.id)),
        }));
      } catch {
        Alert.alert('Erro', 'Não foi possível excluir agora.');
      }
    });

  // ---------- render ----------
  renderHeaderFiltros() {
    const {
      filtroComanda,
      filtroItem,
      filtroCategoria,
      categoriasDisponiveis,
      filtroStatus,
    } = this.state;

    return (
      <View style={styles.filtersContainer}>
        <View style={styles.filtersRow}>
          <TextInput
            placeholder="Filtrar por comanda"
            placeholderTextColor="#999"
            value={filtroComanda}
            onChangeText={(v) => this.safeSetState({ filtroComanda: v })}
            style={styles.filterInput}
            autoCorrect={false}
            autoCapitalize="none"
          />
          <TextInput
            placeholder="Filtrar por item"
            placeholderTextColor="#999"
            value={filtroItem}
            onChangeText={(v) => this.safeSetState({ filtroItem: v })}
            style={styles.filterInput}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <TouchableOpacity
            style={[styles.catChip, !filtroCategoria && styles.catChipActive]}
            onPress={() => this.safeSetState({ filtroCategoria: null })}
            activeOpacity={0.85}
          >
            <Text style={[styles.catChipText, !filtroCategoria && styles.catChipTextActive]}>
              Todas
            </Text>
          </TouchableOpacity>

          {categoriasDisponiveis.map((c) => {
            const isActive = String(filtroCategoria) === String(c);
            return (
              <TouchableOpacity
                key={String(c)}
                style={[styles.catChip, isActive && styles.catChipActive]}
                onPress={() => this.safeSetState({ filtroCategoria: c })}
                activeOpacity={0.85}
              >
                <Text style={[styles.catChipText, isActive && styles.catChipTextActive]}>
                  {catLabel(c)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Filtro por status da comanda */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <TouchableOpacity
            style={[styles.catChip, !filtroStatus && styles.catChipActive]}
            onPress={() => this.safeSetState({ filtroStatus: null })}
            activeOpacity={0.85}
          >
            <Text style={[styles.catChipText, !filtroStatus && styles.catChipTextActive]}>
              Todas
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.catChip, filtroStatus === 'aberta' && styles.catChipActive]}
            onPress={() => this.safeSetState({ filtroStatus: 'aberta' })}
            activeOpacity={0.85}
          >
            <Text style={[styles.catChipText, filtroStatus === 'aberta' && styles.catChipTextActive]}>
              Abertas
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.catChip, filtroStatus === 'fechada' && styles.catChipActive]}
            onPress={() => this.safeSetState({ filtroStatus: 'fechada' })}
            activeOpacity={0.85}
          >
            <Text style={[styles.catChipText, filtroStatus === 'fechada' && styles.catChipTextActive]}>
              Fechadas
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.filtersActions}>
          <TouchableOpacity style={[styles.btn, styles.btnGray]} onPress={this.limparFiltros} activeOpacity={0.85}>
            <Text style={styles.btnText}>Limpar filtros</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={this.refreshData} activeOpacity={0.85}>
            <Text style={styles.btnText}>Atualizar</Text>
          </TouchableOpacity>
        </View>

        {String(filtroCategoria) === '1' && (
          <Text style={styles.note}>
            Dica: no filtro Categoria 1, o botão “Confirmar” aparece apenas quando{' '}
            <Text style={{ fontWeight: '800' }}>printed = 0</Text>.
          </Text>
        )}
      </View>
    );
  }

  renderItemRow = ({ item }) => {
    const { filtroCategoria } = this.state;
    const { user } = this.context || {};
    const printed = toInt(item?.printed || 0, 0);
    const showConfirm = String(filtroCategoria) === '1' && printed === 0;

    const isPaid = this.isPago(item); // ordem > 0
    const podeExcluir = user?.cargo === 'ADM' || user?.cargo === 'Cozinha';

    return (
      <View style={[styles.card, isPaid && styles.cardPaid]}>
        {/* excluir (fora da área do modal) */}
        {podeExcluir && (
          <TouchableOpacity
            style={styles.cardDeleteBtn}
            onPress={() => this.confirmarExclusao(item)}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            activeOpacity={0.85}
          >
            <Text style={styles.cardDeleteIcon}>×</Text>
          </TouchableOpacity>
        )}

        {/* faixa topo quando pago */}
        {isPaid && <View style={styles.cardPaidStrip} />}

        {/* abre modal */}
        <TouchableOpacity onPress={() => this.abrirModal(item)} activeOpacity={0.8} style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>
            {item?.quantidade}× {item?.pedido} {item?.extra ? `(${item.extra})` : ''}
          </Text>

          <Text style={styles.cardMeta}>
            Comanda: <Text style={styles.cardMetaStrong}>{item?.comanda}</Text> • Status:{' '}
            <Text style={isPaid ? styles.statusPaid : styles.statusPending}>
              {isPaid ? 'Fechada' : 'Aberta'}
            </Text>
          </Text>
          <Text style={styles.cardMeta}>
            Hora: {item?.inicio || '—'} • Estado: {item?.estado !== 'Pronto' ? item?.estado : 'Feito'}
          </Text>
          <Text style={styles.cardMeta}>
            Categoria: {catLabel(item?.categoria)} • Impresso: {printed === 0 ? 'Não' : 'Sim'}
          </Text>
          {!!item?.preco && (
            <Text style={styles.cardMeta}>
              Preço: {item?.preco} {item?.preco_unitario ? ` • PU: ${item.preco_unitario}` : ''}
            </Text>
          )}
        </TouchableOpacity>

        <View style={styles.cardActionsRow}>
          {showConfirm && (
            <TouchableOpacity
              style={[styles.btn, styles.btnConfirm]}
              onPress={() => this.confirmarPedido(item)}
              disabled={this.state.carregandoConfirmar}
              activeOpacity={0.85}
            >
              <Text style={styles.btnText}>
                {this.state.carregandoConfirmar ? '...' : 'Confirmar'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  renderModal() {
    const { showModal, editable, pedidoModal } = this.state;
    if (!showModal) return null;

    const field = (label, value, editableNow, onChange, extraProps = {}) => (
      <View style={styles.modalRow}>
        <Text style={styles.modalLabel}>{label}</Text>
        <TextInput
          style={[styles.modalInput, !editableNow && styles.modalInputReadonly]}
          value={String(value ?? '')}
          editable={!!editableNow}
          onChangeText={onChange}
          placeholderTextColor="#999"
          autoCorrect={false}
          autoCapitalize="none"
          {...extraProps}
        />
      </View>
    );

    return (
      <Modal animationType="slide" transparent visible={showModal} onRequestClose={this.fecharModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Detalhes do Pedido</Text>
              <TouchableOpacity onPress={this.fecharModal} style={styles.modalCloseBtn} activeOpacity={0.85}>
                <Text style={styles.modalCloseIcon}>×</Text>
              </TouchableOpacity>
            </View>

            {/* conteúdo */}
            <ScrollView style={{ maxHeight: Platform.OS === 'ios' ? 520 : 560 }}>
              {/* somente leitura */}
              {field('ID', pedidoModal.id, false)}
              {field('Pedido', pedidoModal.pedido, false)}
              {field('Usuário', pedidoModal.username, false)}
              {field('Nome', pedidoModal.nome, false)}
              {field('Estado', pedidoModal.estado, false)}
              {field('Início', pedidoModal.inicio, false)}
              {field('Fim', pedidoModal.fim, false)}
              {field('Começar', pedidoModal.comecar, false)}
              {field('Dia', pedidoModal.dia, false)}
              {field('Ordem', pedidoModal.ordem, false)}
              {field('OrderTiming', pedidoModal.orderTiming, false)}
              {field('Endereço Entrega', pedidoModal.endereco_entrega, false)}
              {field('Order ID', pedidoModal.order_id, false)}
              {field('Remetente', pedidoModal.remetente, false)}
              {field('Categoria', pedidoModal.categoria, false)}
              {field('Printed', pedidoModal.printed, false)}

              {/* editáveis */}
              {field('Comanda', pedidoModal.comanda, editable, (v) => this.onChangeCampo('comanda', v))}
              {field(
                'Quantidade',
                pedidoModal.quantidade,
                editable,
                (v) => this.onChangeCampo('quantidade', v),
                { keyboardType: 'numeric' }
              )}
              {field(
                'Quantidade Paga',
                pedidoModal.quantidade_paga,
                editable,
                (v) => this.onChangeCampo('quantidade_paga', v),
                { keyboardType: 'numeric' }
              )}
              {field(
                'Preço Unitário',
                pedidoModal.preco_unitario,
                editable,
                (v) => this.onChangeCampo('preco_unitario', v),
                { keyboardType: Platform.OS === 'ios' ? 'decimal-pad' : 'numeric' }
              )}
              {field(
                'Preço',
                pedidoModal.preco,
                editable,
                (v) => this.onChangeCampo('preco', v),
                { keyboardType: Platform.OS === 'ios' ? 'decimal-pad' : 'numeric' }
              )}

          
                <OpcoesEditorLite
                  key={String(pedidoModal?.id ?? 'novo')}
                  value={pedidoModal.opcoes}
                  editable={editable}
                  onChange={(json) => {
                    // Se vier objeto/array, limpe chaves terminadas com '?'
                    const stripKeys = (o) => {
                      if (Array.isArray(o)) return o.map(stripKeys);
                      if (o && typeof o === 'object') {
                        const out = {};
                        for (const [k,v] of Object.entries(o)) {
                          const nk = k.endsWith('?') ? k.slice(0, -1) : k;
                          out[nk] = stripKeys(v);
                        }
                        return out;
                      }
                      return o;
                    };
                    const safe = typeof json === 'string' ? json.replace(/\?/g, '') : stripKeys(json);
                    this.onChangeCampo('opcoes', safe);
                  }}
                />


              {field('Extra', pedidoModal.extra, editable, (v) => this.onChangeCampo('extra', v))}
              {field(
                'Horário p/ Entrega (HH:MM)',
                pedidoModal.horario_para_entrega,
                editable,
                (v) => this.onChangeCampo('horario_para_entrega', v),
                { keyboardType: 'numbers-and-punctuation' }
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              {editable ? (
                <>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnOutline]}
                    onPress={this.sairEdicao}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.btnOutlineText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={this.salvarEdicao}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.btnText}>Salvar</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={this.entrarEdicao}
                  activeOpacity={0.85}
                >
                  <Text style={styles.btnText}>Editar</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  render() {
    const { refreshing } = this.state;
    const data = this.getFilteredData();

    return (
      <View style={styles.container}>
        {this.renderHeaderFiltros()}

        <FlatList
          data={data}
          keyExtractor={(item, index) =>
            String(item?.id ?? `${item?.comanda || 'x'}:${item?.inicio || 'y'}:${index}`)
          }
          renderItem={this.renderItemRow}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={this.refreshData} />}
          ListEmptyComponent={
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280' }}>Sem pedidos para exibir.</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 16 }}
        />

        {this.renderModal()}
      </View>
    );
  }
}

// ---------- styles ----------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // filtros
  filtersContainer: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, backgroundColor: '#f8fafc' },
  filtersRow: { flexDirection: 'row', gap: 8 },
  filterInput: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  filtersActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  btnPrimary: { backgroundColor: '#17315c' },
  btnConfirm: { backgroundColor: '#059669', marginTop: 8, alignSelf: 'flex-start' },
  btnGray: { backgroundColor: '#374151' },
  btnText: { color: '#fff', fontWeight: '800' },
  btnOutline: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#9ca3af' },
  btnOutlineText: { color: '#111827', fontWeight: '800' },
  note: { marginTop: 8, color: '#6b7280', fontSize: 12 },

  // categorias
  catChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    marginRight: 8,
  },
  catChipActive: { backgroundColor: '#17315c', borderColor: '#17315c' },
  catChipText: { color: '#374151', fontWeight: '700' },
  catChipTextActive: { color: '#fff', fontWeight: '800' },

  // cards
  card: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    position: 'relative',
  },
  // indicação de pago
  cardPaid: {
    borderColor: 'red',
  },
  cardPaidStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 6,
    backgroundColor: 'red',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  statusPaid: { color: 'red', fontWeight: '800' },
  statusPending: { color: 'green', fontWeight: '800' },

  // botão excluir no card
  cardDeleteBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fee2e2',
    zIndex: 5,
  },
  cardDeleteIcon: {
    fontSize: 18,
    fontWeight: '800',
    color: '#b91c1c',
    marginTop: -2,
  },

  cardTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  cardMeta: { marginTop: 4, color: '#374151' },
  cardMetaStrong: { fontWeight: '800', color: '#111827' },

  // modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  modalContent: {
    width: '100%',
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
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  modalCloseIcon: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginTop: -2,
  },
  modalRow: { marginTop: 8 },
  modalLabel: { fontWeight: '700', color: '#374151', marginBottom: 4 },
  modalInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  modalInputReadonly: { backgroundColor: '#f3f4f6' },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 12,
    gap: 10,
  },

  cardActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
});
