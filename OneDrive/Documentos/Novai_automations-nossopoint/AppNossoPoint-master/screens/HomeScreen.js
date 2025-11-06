import React from 'react';
import {
  StyleSheet,
  View,
  Button,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Text,
  Pressable,
  Animated,
  Keyboard,
  Alert,
} from 'react-native';
import { UserContext } from '../UserContext';
import { API_URL } from './url';
import debounce from 'lodash.debounce';
import { getSocket } from '../socket';
import NetInfo from '@react-native-community/netinfo';

// formata R$ de forma robusta no RN
const brl = (n) => {
  const v = Number(n || 0);
  const s = (isNaN(v) ? 0 : v).toFixed(2);
  return `R$ ${s.replace('.', ',')}`;
};

export default class HomeScreen extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      // usuário
      username: '',
      cargo: '',

      // inputs
      comand: '',
      pedido: '',
      extra: '',
      nome: '',

      // dados
      data: [],
      dataFixo: [],
      pedido_filtrado: [],
      comanda_filtrada: [],
      comandaGeral: [],

      // carrinho
      quantidadeSelecionada: [],
      pedidosSelecionados: [],
      extraSelecionados: [],
      nomeSelecionado: [],
      selectedUnitPrices: [],        // preço unitário (base + extras) por item adicionado
      opcoesSelecionadasPorItem: [], // seleção de opções por item

      // seleção atual (do item em edição)
      options: [],
      selecionadosByGroup: [],

      // UI flags
      showPedido: false,
      showComandaPedido: false,
      showComanda: false,
      showQuantidade: false,
      showPedidoSelecionado: false,

      quantidade: 1,

      // toasts
      showConfirmOrder: false,
      confirmMsg: 'Pedido enviado com sucesso!',
      toastVariant: 'success',

      // rede/estado
      isConnected: true,
      isSending: false,       // previne double-submit de "Enviar pedido"
      isCheckingQty: false,   // previne double-click de "Adicionar" (verificação de estoque)

      // mensagens de alerta de estoque (quando servidor emite)
      quantidadeRestanteMensagem: null,
      pedidoRestanteMensagem: null,

      // outros usados em funções auxiliares
      comanda_filtrada_abrir: [],
      fcomanda: '',
      preco: 0,
      valor_pago: '',
    };

    // debounce para busca de pedidos
    this.processarPedido = debounce(this.processarPedido.bind(this), 200);

    // refs/flags
    this.socket = null;
    this._toastOpacity = new Animated.Value(0);
    this._toastTranslateY = new Animated.Value(-12);
    this._hideToastTimer = null;
    this._isMounted = false;
    this._netinfoUnsub = null;
  }
  getCarrinho() {
    const { user } = this.context || {};
    console.log('carrinho', user)
    return user?.carrinho || '';
  }
  // =============== Ciclo de vida ===============
  async componentDidMount() {
    this._isMounted = true;

    const { user } = this.context || {};
    this.safeSetState({ username: user?.username || '' });

    // 1) Monitor da rede do aparelho
    this._netinfoUnsub = NetInfo.addEventListener(this.handleNetInfoChange);

    // 2) Checagem inicial da rede
    try {
      const net = await NetInfo.fetch();
      this.safeSetState({ isConnected: !!net.isConnected });
      if (!net.isConnected) {
        this.showConfirmToast('Sem internet no dispositivo.', 'warning');
      }
    } catch {
      // mantém estado padrão
    }

    // 3) Socket.io (global/compartilhado)
    this.socket = getSocket();
    if (this.socket) {
      this.socket.on('respostaCardapio', this.handleRespostaCardapio);
      this.socket.on('respostaComandas', this.handleRespostaComandas);
      this.socket.on('alerta_restantes', this.handleAlertaRestantes);
      this.socket.on('quantidade_insuficiente', this.handleQuantidadeInsuficiente);

      // conectividade socket
      this.socket.on('connect', this.handleSocketConnect);
      this.socket.on('disconnect', this.handleSocketDisconnect);
      this.socket.on('error', this.handleSocketError);
      this.socket.on('connect_error', this.handleSocketConnectError);
    }

    // 4) Primeiras cargas (se houver rede)
    const carrinho = this.getCarrinho();
    if (this.state.isConnected && this.socket?.connected) {
     this.socket.emit('getCardapio', { emitir: false, carrinho });
      this.socket.emit('getComandas', { emitir: false, carrinho });
    } else if (this.socket) {
      // tenta mesmo assim — servidor pode responder depois que conectar
      this.socket.emit('getCardapio', { emitir: false, carrinho });
      this.socket.emit('getComandas', { emitir: false, carrinho });
    }
  }

  componentWillUnmount() {
    this._isMounted = false;

    if (this._hideToastTimer) {
      clearTimeout(this._hideToastTimer);
      this._hideToastTimer = null;
    }

    if (this._netinfoUnsub) {
      this._netinfoUnsub();
      this._netinfoUnsub = null;
    }

    if (this.socket) {
      this.socket.off('respostaCardapio', this.handleRespostaCardapio);
      this.socket.off('respostaComandas', this.handleRespostaComandas);
      this.socket.off('alerta_restantes', this.handleAlertaRestantes);
      this.socket.off('quantidade_insuficiente', this.handleQuantidadeInsuficiente);
      this.socket.off('connect', this.handleSocketConnect);
      this.socket.off('disconnect', this.handleSocketDisconnect);
      this.socket.off('error', this.handleSocketError);
      this.socket.off('connect_error', this.handleSocketConnectError);
    }

    // cancela debounce pendente
    if (this.processarPedido && this.processarPedido.cancel) {
      this.processarPedido.cancel();
    }
  }

  // =============== Helpers base ===============
  safeSetState = (updater, cb) => {
    if (!this._isMounted) return;
    this.setState(updater, cb);
  };

  getCurrentTime = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  normalize = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  // Quantas opções ainda estão disponíveis no grupo
  getAvailableOptions = (g) => (g?.options || []).filter((o) => !o?.esgotado);

  // Máximo efetivo = min(max_selected, opções disponíveis). Se não houver opções, 0.
  getEffectiveMaxSel = (g) => {
    const av = this.getAvailableOptions(g).length;
    if (av <= 0) return 0;
    const raw = Number(g?.max_selected || 1) || 1;
    return Math.max(1, Math.min(raw, av));
  };

  // =============== Handlers de socket/rede ===============
  handleRespostaCardapio = (data) => {
    if (data?.dataCardapio) {
      this.safeSetState({
        pedido_filtrado: data.dataCardapio,
        dataFixo: data.dataCardapio,
      });
    }
  };

  handleRespostaComandas = (data) => {
    if (data?.dados_comandaAberta) {
      this.safeSetState({
        comanda_filtrada: data.dados_comandaAberta,
        comandaGeral: data.dados_comandaAberta,
      });
    }
  };

  handleSocketError = (e) => {
    const msg = (e && (e.message || e.toString?.())) || 'Erro do servidor.';
    this.showConfirmToast(msg, 'error');
  };

  handleSocketConnectError = (e) => {
    const msg = (e && (e.message || e.toString?.())) || 'Falha ao conectar.';
    this.showConfirmToast(msg, 'error');
  };

  handleSocketConnect = () => {
    this.showConfirmToast('Conectado novamente!', 'success');
  };

  handleSocketDisconnect = () => {
    this.showConfirmToast('Sem conexão com o servidor.', 'error');
  };

  handleNetInfoChange = (state) => {
    const now = !!state.isConnected;
    if (now !== this.state.isConnected) {
      this.safeSetState({ isConnected: now }, () => {
        this.showConfirmToast(now ? 'Internet restaurada.' : 'Sem internet no dispositivo.', now ? 'success' : 'error');
      });
    }
  };

  handleAlertaRestantes = (data) => {
    if (!data) return;
    this.safeSetState({
      quantidadeRestanteMensagem: data.quantidade ?? 0,
      pedidoRestanteMensagem: data.item ?? '',
    });
  };

  handleQuantidadeInsuficiente = (data) => {
    if (data?.erro) {
      this.showConfirmToast(
      `Servidor sinalizou estoque insuficiente (resta ${String(data?.quantidade ?? 0)}). Envio permitido.`,
      'warning'
      );
      // não limpa nada e não bloqueia
      }
  };


  confirmRemoveFromCart = (index) => {
    Alert.alert(
      'Remover item',
      'Deseja remover este item do carrinho?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: () => this.removeFromCart(index) },
      ]
    );
  };

  removeFromCart = (index) => {
    this.safeSetState((prev) => {
      const filterOut = (arr) => (Array.isArray(arr) ? arr.filter((_, i) => i !== index) : []);
      const pedidos = filterOut(prev.pedidosSelecionados);

      return {
        pedidosSelecionados: pedidos,
        quantidadeSelecionada: filterOut(prev.quantidadeSelecionada),
        extraSelecionados: filterOut(prev.extraSelecionados),
        nomeSelecionado: filterOut(prev.nomeSelecionado),
        selectedUnitPrices: filterOut(prev.selectedUnitPrices),
        opcoesSelecionadasPorItem: filterOut(prev.opcoesSelecionadasPorItem),
        // se esvaziou, some com a faixa “itens selecionados”
        showPedidoSelecionado: pedidos.length > 0 ? prev.showPedidoSelecionado : false,
      };
    });
  };


  // =============== Toast ===============
  showConfirmToast = (msg = 'Tudo certo!', variant = 'success') => {
    if (!this._isMounted) return;

    this.safeSetState({ showConfirmOrder: true, confirmMsg: msg, toastVariant: variant }, () => {
      Animated.parallel([
        Animated.timing(this._toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(this._toastTranslateY, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(() => {
        if (this._hideToastTimer) clearTimeout(this._hideToastTimer);
        this._hideToastTimer = setTimeout(() => {
          this.hideConfirmToast();
        }, 2000);
      });
    });
  };

  hideConfirmToast = () => {
    if (!this._isMounted) return;
    Animated.parallel([
      Animated.timing(this._toastOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(this._toastTranslateY, { toValue: -12, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      this.safeSetState({ showConfirmOrder: false });
    });
  };

  renderConfirmToast() {
    if (!this.state.showConfirmOrder) return null;
    return (
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 999,
          opacity: this._toastOpacity,
          transform: [{ translateY: this._toastTranslateY }],
        }}
      >
        <View
          style={{
            backgroundColor:
              this.state.toastVariant === 'error'
                ? '#ef4444'
                : this.state.toastVariant === 'warning'
                ? '#f59e0b'
                : this.state.toastVariant === 'info'
                ? '#3b82f6'
                : '#22c55e',
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 8,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: 'rgba(255,255,255,0.9)',
              marginRight: 8,
            }}
          />
          <Text style={{ color: '#fff', fontWeight: '700' }}>{this.state.confirmMsg}</Text>
        </View>
      </Animated.View>
    );
  }

  // =============== Focus/Blur de inputs ===============
  handleComandaFocus = () => {
    this.safeSetState({ showComandaPedido: !!(this.state.comand && this.state.comand.trim()) });
  };
  handleComandaBlur = () => setTimeout(() => this.safeSetState({ showComandaPedido: false }), 0);

  handlePedidoFocus = () => {
    this.safeSetState({ showPedido: !!(this.state.pedido && this.state.pedido.trim()) });
  };
  handlePedidoBlur = () => setTimeout(() => this.safeSetState({ showPedido: false }), 0);

  // =============== Normalização de grupos de opções ===============
  normalizeGroups = (raw) => {
    let groups = [];
    try {
      groups = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      groups = [];
    }
    if (!Array.isArray(groups)) groups = [];

    return groups.map((g) => {
      const nome = g?.nome ?? g?.Nome ?? 'Opções';
      const ids = g?.ids ?? '';
      const max_selected = Number(g?.max_selected ?? 1) || 1;
      const obrigatorio = !!(g?.obrigatorio || g?.Obrigatorio);
      let options = g?.options ?? g?.opcoes ?? [];

      if (!Array.isArray(options)) options = [];
      options = options.map((o) => {
        if (typeof o === 'string') return { nome: o, valor_extra: 0, esgotado: false };
        return {
          nome: o?.nome ?? String(o ?? ''),
          valor_extra: Number(o?.valor_extra ?? 0) || 0,
          esgotado: !!o?.esgotado,
        };
      });

      return { nome, ids, options, max_selected, obrigatorio };
    });
  };

  validateRequiredGroups = () => {
    const { options, selecionadosByGroup } = this.state;
    for (let i = 0; i < (options || []).length; i++) {
      const g = options[i];
      if (!g) continue;

      const available = this.getAvailableOptions(g);
      if (available.length === 0) continue; // ignora obrigatoriedade se não há disponíveis

      if (g.obrigatorio) {
        const selectedNames = new Set(selecionadosByGroup[i] || []);
        const hasAny = available.some((o) => selectedNames.has(o.nome));
        if (!hasAny) return { ok: false, msg: `Selecione ao menos 1 opção em "${g.nome}".` };
      }
    }
    return { ok: true };
  };

  computeExtrasFromSelection = () => {
    const selection = this.buildSelectionFromState();
    let sum = 0;
    for (const g of selection) {
      for (const o of g.options || []) sum += Number(o.valor_extra || 0);
    }
    return sum;
  };

  getItemBasePrice = (itemName) => {
    const base = Array.isArray(this.state.dataFixo) ? this.state.dataFixo : [];
    const found = base.find(
      (it) => String(it.item || '').toLowerCase() === String(itemName || '').toLowerCase()
    );
    const preco = found ? Number(found.preco || 0) : 0;
    return isNaN(preco) ? 0 : preco;
  };

  summarizeSelection = (selGroups = []) =>
    selGroups
      .map((g) => {
        const itens = (g.options || []).map((o) => (o.valor_extra ? `${o.nome} (+${brl(o.valor_extra)})` : o.nome));
        return `${g.nome}: ${itens.join(', ') || '—'}`;
      })
      .join(' • ');

  toggleOption = (groupIndex, optionName) => {
  let toastMessage = null;

  this.safeSetState((prev) => {
    const options = prev.options || [];
    const group = options[groupIndex];
    if (!group) return null;

    const opt = (group.options || []).find((o) => o.nome === optionName);
    if (!opt || opt.esgotado) {
      toastMessage = 'Opção esgotada';
      return null;
    }

    const effectiveMax = this.getEffectiveMaxSel(group);
    if (effectiveMax === 0) {
      toastMessage = 'Todas as opções estão esgotadas.';
      return null;
    }

    const selecionadosByGroup = [...(prev.selecionadosByGroup || [])];

    // mantém apenas seleções ainda disponíveis
    const availableNames = new Set(this.getAvailableOptions(group).map((o) => o.nome));
    const current = new Set(
      (selecionadosByGroup[groupIndex] || []).filter((n) => availableNames.has(n))
    );

    // toggle off se já estava selecionada
    if (current.has(optionName)) {
      selecionadosByGroup[groupIndex] = [...current].filter((n) => n !== optionName);
      return { selecionadosByGroup };
    }

    // ===== MODO RÁDIO: max_selected = 1 => substitui a seleção anterior =====
    if (effectiveMax <= 1) {
      selecionadosByGroup[groupIndex] = [optionName];
      return { selecionadosByGroup };
    }

    // ===== Multi-seleção (max > 1) =====
    if ([...current].length >= effectiveMax) {
      toastMessage = `Máximo de ${effectiveMax} em "${group.nome}".`;
      return null;
    }

    selecionadosByGroup[groupIndex] = [...current, optionName];
    return { selecionadosByGroup };
  }, () => {
    if (toastMessage) this.showConfirmToast(toastMessage, 'warning');
  });
};


  buildSelectionFromState = () => {
    const { options, selecionadosByGroup } = this.state;
    if (!options || !options.length) return [];
    return options
      .map((g, idx) => {
        const escolhidos = new Set(selecionadosByGroup[idx] || []);
        const resultOpts = (g.options || [])
          .filter((o) => !o.esgotado && escolhidos.has(o.nome))
          .map((o) => ({ nome: o.nome, valor_extra: Number(o.valor_extra) || 0 }));
        return {
          nome: g.nome,
          ids: g.ids ?? '',
          options: resultOpts,
          max_selected: Number(g.max_selected || 1),
        };
      })
      .filter((g) => g.options.length > 0);
  };

  // =============== Busca/alteração de inputs ===============
  changeComanda = (comand) => {
    const base = Array.isArray(this.state.comandaGeral) ? this.state.comandaGeral : [];
    const raw = String(comand ?? ''); // preserva como usuário digitou
    const qNorm = this.normalize(raw); // somente para busca
    const words = qNorm.trim().split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      this.safeSetState({
        comanda_filtrada: base,
        comand: raw,
        showComandaPedido: false,
      });
      return;
    }

    const starts = [];
    const allWords = [];
    const includes = [];

    for (let i = 0; i < base.length; i++) {
      const it = base[i];
      const nameNorm = this.normalize(it?.comanda);
      if (!nameNorm) continue;

      let matched = false;
      for (const w of words) {
        if (nameNorm.startsWith(w)) {
          starts.push(it);
          matched = true;
          break;
        }
      }
      if (matched) continue;

      if (words.length > 1 && words.every((w) => nameNorm.includes(w))) {
        allWords.push(it);
        continue;
      }

      for (const w of words) {
        if (nameNorm.includes(w)) {
          includes.push(it);
          break;
        }
      }
    }

    // junta e tira duplicados
    const seen = new Set();
    const comanda_filtrada = [];
    for (const bucket of [starts, allWords, includes]) {
      for (const it of bucket) {
        const key = it?.id ?? it?.comanda;
        if (!seen.has(key)) {
          seen.add(key);
          comanda_filtrada.push(it);
        }
      }
    }

    this.safeSetState({
      comanda_filtrada,
      comand: raw,
      showComandaPedido: true,
    });
  };

  changePedido = (pedid) => {
    const pedido = String(pedid ?? '').toLowerCase();
    // limpa somente a seleção atual
    this.resetCurrentSelection();
    this.safeSetState({
      pedido,
      showPedido: !!pedido,
    });
    this.processarPedido(pedido);
  };

  processarPedido(pedido) {
    const base = Array.isArray(this.state.dataFixo) ? this.state.dataFixo : [];

    const raw = String(pedido || '');
    if (!raw) {
      this.safeSetState({ pedido_filtrado: [], showPedido: false });
      return;
    }

    if (raw[0] === '.' && raw.length > 1) {
      const id = raw.slice(1).trim();
      const result = base.filter((it) => String(it && it.id) === id);
      this.safeSetState({ pedido_filtrado: result });
      return;
    }

    const q = raw.toLowerCase().trim();
    if (!q) {
      this.safeSetState({ pedido_filtrado: base });
      return;
    }
    const words = q.split(/\s+/).filter(Boolean);

    const starts = [];
    const allWords = [];
    const includes = [];

    for (let i = 0; i < base.length; i++) {
      const it = base[i];
      const name = String((it && it.item) || '').toLowerCase();
      if (!name) continue;

      let matched = false;
      for (let w of words) {
        if (name.startsWith(w)) {
          starts.push(it);
          matched = true;
          break;
        }
      }
      if (matched) continue;

      if (words.length > 1 && words.every((w) => name.includes(w))) {
        allWords.push(it);
        continue;
      }

      for (let w of words) {
        if (name.includes(w)) {
          includes.push(it);
          break;
        }
      }
    }

    const result = starts.concat(allWords, includes);
    this.safeSetState({ pedido_filtrado: result, showPedido: !!pedido });
  }

  resetCurrentSelection = (extra = {}) => {
    this.safeSetState({
      options: [],
      selecionadosByGroup: [],
      showQuantidade: false,
      ...extra,
    });
  };

  selecionarPedido = (pedid, id) => {
    const pedido = String(pedid || '').trim();
    const row =
      (this.state.dataFixo || []).find((r) => String(r.id) === String(id)) ||
      (this.state.dataFixo || []).find(
        (r) => String(r.item || '').trim().toLowerCase() === pedido.toLowerCase()
      );

    const groups = this.normalizeGroups(row?.opcoes);

    this.safeSetState({
      pedido,
      pedido_filtrado: [],
      showQuantidade: true,
      options: groups,
      selecionadosByGroup: groups.map(() => []),
    });
  };

  selecionarComandaPedido = (comand) => {
    this.safeSetState({ comand, comanda_filtrada: [], showComandaPedido: false });
  };

  selecionarComanda = (fcomanda) => {
    this.safeSetState({ fcomanda, comanda_filtrada_abrir: [], showComanda: false });
  };

  aumentar_quantidade = () =>
    this.safeSetState((prev) => ({ quantidade: prev.quantidade + 1 }));

  diminuir_quantidade = () =>
    this.safeSetState((prev) => ({ quantidade: Math.max(prev.quantidade - 1, 1) }));

  mudar_quantidade = (quantidade) =>
    this.safeSetState({ quantidade: parseInt(quantidade, 10) || 1 });

  verificarExistenciaPedidos(pedido) {
    if (!!pedido) {
      const pedidExist = (this.state.dataFixo || []).filter(
        (item) => String(item.item || '').toLowerCase() === String(pedido || '').toLowerCase()
      );
      return pedidExist.length > 0;
    }
    return true;
  }

  // =============== Carrinho / adicionar item ===============
  adicionarPedido = async () => {
    // previne double click
    if (this.state.isCheckingQty) return;

    const pedido = String(this.state.pedido || '').trim();
    const { showQuantidade, quantidade } = this.state;

    if (!showQuantidade || !pedido) {
      this.showConfirmToast('Selecione um item da lista.', 'warning');
      return;
    }

    // valida grupos obrigatórios antes de consultar estoque
    const { ok, msg } = this.validateRequiredGroups();
    if (!ok) {
      this.showConfirmToast(msg || 'Seleção incompleta.', 'warning');
      return;
    }

    // checa rede/servidor
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      this.showConfirmToast('Sem internet. Tente novamente.', 'error');
      return;
    }
    if (!this.socket) {
      this.showConfirmToast('Sem conexão com o servidor.', 'error');
      return;
    }

    this.safeSetState({ isCheckingQty: true });

    try {
      const resp = await fetch(`${API_URL}/verificar_quantidade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: pedido, quantidade, carrinho: this.getCarrinho() }),
      });

      let data;
      try {
        data = await resp.json();
      } catch {
        data = { erro: true, mensagem: 'Resposta inválida do servidor.' };
      }

   const restante = Number(data?.quantidade ?? 0);
   // NÃO bloqueia mais: apenas avisa e segue adicionando
    if (data.erro) {
      this.showConfirmToast(
        `Estoque atual: ${isNaN(restante) ? 0 : restante}. Vamos adicionar mesmo assim.`,
        'warning'
      );
    }

      const selection = this.buildSelectionFromState();
      const extrasSum = this.computeExtrasFromSelection();
      const basePrice = this.getItemBasePrice(pedido);
      const unitPrice = basePrice + extrasSum;

      const quantidadeR = Number(data?.quantidade ?? -200) ;
      if (quantidadeR !== -200) {
        if (quantidadeR <= 0) {
          alert('ATENÇÃO: estoque atual é 0 — item será adicionado mesmo assim.');
        } else {
          const novaQ = quantidadeR - quantidade;
          if (novaQ <= 0) {
            alert('ATENÇÃO: estoque zerou para este item.');
          } else {
            alert(`ATENÇÃO: restam apenas ${String(novaQ)}\nRecomenda-se repor estoque!`);
          }
        }
    }
      this.safeSetState((prev) => ({
        pedidosSelecionados: [...prev.pedidosSelecionados, pedido],
        quantidadeSelecionada: [...prev.quantidadeSelecionada, quantidade],
        extraSelecionados: [...prev.extraSelecionados, prev.extra ? prev.extra : ''],
        nomeSelecionado: [...prev.nomeSelecionado, prev.nome ? prev.nome : ''],
        selectedUnitPrices: [...prev.selectedUnitPrices, unitPrice],
        opcoesSelecionadasPorItem: [...prev.opcoesSelecionadasPorItem, selection],

        // reset input atual
        quantidade: 1,
        showQuantidade: false,
        pedido: '',
        extra: '',
        nome: '',
        showPedidoSelecionado: true,
        showPedido: false,
        options: [],
        selecionadosByGroup: [],
      }));
    } catch (e) {
      console.error('Erro ao adicionar pedido:', e);
      this.showConfirmToast('Falha ao verificar estoque.', 'error');
    } finally {
      this.safeSetState({ isCheckingQty: false });
    }
  };

  adicionarPedidoSelecionado = (index) =>
    this.safeSetState((prev) => ({
      quantidadeSelecionada: prev.quantidadeSelecionada.map((q, i) => (i === index ? q + 1 : q)),
    }));

  removerPedidoSelecionado = (index) =>
    this.safeSetState((prev) => ({
      quantidadeSelecionada: prev.quantidadeSelecionada.map((q, i) =>
        i === index ? (q - 1 < 0 ? 0 : q - 1) : q
      ),
    }));

  // =============== Envio do pedido (carrinho ou item único) ===============
  sendData = async () => {
    if (this.state.isSending) return; // previne double-click

    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      this.showConfirmToast('Sem internet. Tente novamente.', 'error');
      return;
    }
    if (!this.socket || !this.socket.connected) {
      this.showConfirmToast('Sem conexão com o servidor. Aguarde reconexão.', 'error');
      return;
    }

    const pedido = String(this.state.pedido || '').trim();
    const { user } = this.context || {};

    if (!this.verificarExistenciaPedidos(pedido)) {
      alert('Pedido inexistente');
      return;
    }

    const comand = String(this.state.comand || '').trim();
    if (!comand) {
      alert('Digite a comanda');
      return;
    }

    this.safeSetState({ isSending: true });

    try {
      const {
        nomeSelecionado,
        pedidosSelecionados,
        quantidadeSelecionada,
        extraSelecionados,
        quantidade,
        extra,
        username,
        opcoesSelecionadasPorItem,
      } = this.state;

      const currentTime = this.getCurrentTime();

      // Se há carrinho (múltiplos)
      if (pedidosSelecionados.length && quantidadeSelecionada.length) {
        // apenas índices com quantidade > 0
        const indicesValidos = [];
        quantidadeSelecionada.forEach((q, i) => {
          if (q > 0) indicesValidos.push(i);
        });

        if (indicesValidos.length === 0) {
          this.showConfirmToast('Carrinho vazio.', 'warning');
          return;
        }

        const NovasSelecoes = indicesValidos.map((i) => opcoesSelecionadasPorItem[i] || []);
        const NovosPedidos = indicesValidos.map((i) => pedidosSelecionados[i]);
        const NovasQuantidades = indicesValidos.map((i) => quantidadeSelecionada[i]);
        const NovosExtras = indicesValidos.map((i) => extraSelecionados[i] || '');
        const NovosNomes = indicesValidos.map((i) => nomeSelecionado[i] || '');

        this.socket.emit('insert_order', {
          comanda: comand,
          pedidosSelecionados: NovosPedidos,
          quantidadeSelecionada: NovasQuantidades,
          extraSelecionados: NovosExtras,
          nomeSelecionado: NovosNomes,
          horario: currentTime,
          username: username,
          opcoesSelecionadas: NovasSelecoes,
          token_user: user?.token,
          carrinho: this.getCarrinho(),
        });

        this.showConfirmToast('Enviado ✅', 'success');

        // limpa tudo
        this.safeSetState({
          // inputs
          comand: '',
          pedido: '',
          extra: '',
          nome: '',
          // carrinho
          pedidosSelecionados: [],
          quantidadeSelecionada: [],
          extraSelecionados: [],
          nomeSelecionado: [],
          opcoesSelecionadasPorItem: [],
          selectedUnitPrices: [],
          // UI
          showPedidoSelecionado: false,
          showPedido: false,
          showComandaPedido: false,
          comanda_filtrada: [],
          comanda_filtrada_abrir: [],
          quantidade: 1,
          showQuantidade: false,
          showComanda: false,
          // seleção atual
          options: [],
          selecionadosByGroup: [],
        });
        return;
      }

      // Caso de item único digitado
      if (comand && pedido && quantidade) {
        // valida obrigatório (quando houver opções na tela)
        if ((this.state.options || []).length) {
          const { ok, msg } = this.validateRequiredGroups();
          if (!ok) {
            this.showConfirmToast(msg || 'Seleção incompleta.', 'warning');
            return;
          }
        }



        this.socket.emit('insert_order', {
          comanda: comand,
          pedidosSelecionados: [pedido],
          quantidadeSelecionada: [quantidade],
          extraSelecionados: [extra],
          nomeSelecionado: [this.state.nome],
          horario: currentTime,
          comanda_filtrada: [],
          comanda_filtrada_abrir: [],
          username: username,
          opcoesSelecionadas: [this.buildSelectionFromState()],
          token_user: user?.token,
          carrinho: this.getCarrinho(),
        });

        this.showConfirmToast('Enviado ✅', 'success');

        this.safeSetState({
          comand: '',
          pedido: '',
          quantidade: 1,
          extra: '',
          nome: '',
          showComandaPedido: false,
          showPedidoSelecionado: false,
          showPedido: false,
          showQuantidade: false,
          options: [],
          selecionadosByGroup: [],
          opcoesSelecionadasPorItem: [],
          selectedUnitPrices: [],
        });
        return;
      }

      this.showConfirmToast('Preencha os campos antes de enviar.', 'warning');
    } catch (e) {
      console.error('Erro ao enviar pedido:', e);
      this.showConfirmToast('Falha ao enviar pedido.', 'error');
    } finally {
      this.safeSetState({ isSending: false });
    }
  };

  // =============== Pagamento parcial (mantido) ===============
  pagarParcial = () => {
    const { valor_pago, fcomanda, preco } = this.state;
    const valorNum = parseFloat(String(valor_pago).replace(',', '.'));
    if (!isNaN(valorNum) && valorNum > 0 && valorNum <= Number(preco || 0)) {
      if (this.socket?.connected) {
        this.socket.emit('pagar_parcial', { valor_pago: valorNum, fcomanda,carrinho: this.getCarrinho(), });
        this.safeSetState((prev) => ({ preco: (Number(prev.preco) || 0) - valorNum, valor_pago: '' }));
      } else {
        this.showConfirmToast('Sem conexão com o servidor.', 'error');
      }
    } else {
      this.showConfirmToast('Insira um valor válido.', 'warning');
    }
  };

  changeExtra = (extra) => this.safeSetState({ extra });

  // =============== Render ===============
  render() {
    const {
      isConnected,
      isCheckingQty,
      isSending,
      showQuantidade,
      pedido,
      pedidosSelecionados,
      quantidadeSelecionada,
      selectedUnitPrices,
      opcoesSelecionadasPorItem,
      extraSelecionados,
    } = this.state;

    const canAdd = !!showQuantidade && !!pedido && !isCheckingQty;
    const canSendCart =
      pedidosSelecionados.length > 0 &&
      quantidadeSelecionada.length > 0 &&
      !isSending &&
      isConnected &&
      !!this.socket?.connected;

    return (
      <View style={styles.mainContainer}>
        {this.renderConfirmToast()}
        <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.innerContainer}>
            <View style={styles.inputRow}>
              <TextInput
                placeholder="Comanda"
                placeholderTextColor="#999"
                onChangeText={this.changeComanda}
                value={this.state.comand}
                style={styles.inputComanda}
                autoComplete="off"
                autoCorrect={false}
                spellCheck={false}
                textContentType="none"
                importantForAutofill="no"
                onFocus={this.handleComandaFocus}
                onBlur={this.handleComandaBlur}
              />
              <TextInput
                placeholder="Digite o pedido"
                placeholderTextColor="#999"
                onChangeText={this.changePedido}
                value={this.state.pedido}
                style={styles.inputPedido}
                autoComplete="off"
                autoCorrect={false}
                spellCheck={false}
                textContentType="none"
                importantForAutofill="no"
                onFocus={this.handlePedidoFocus}
                onBlur={this.handlePedidoBlur}
              />
              {showQuantidade && (
                <View style={styles.quantityRow}>
                  <Button title="-" onPress={this.diminuir_quantidade} />
                  <TextInput
                    style={styles.inputQuantidade}
                    value={String(this.state.quantidade)}
                    onChangeText={this.mudar_quantidade}
                    autoComplete="off"
                    autoCorrect={false}
                    spellCheck={false}
                    textContentType="none"
                    importantForAutofill="no"
                    keyboardType="numeric"
                  />
                  <Button title="+" onPress={this.aumentar_quantidade} />
                </View>
              )}
            </View>

            {/* Grupos de opções */}
            {Array.isArray(this.state.options) &&
              this.state.options.map((group, gIdx) => {
                const selecionados = new Set(this.state.selecionadosByGroup[gIdx] || []);
                const available = (group.options || []).filter((o) => !o.esgotado);
                const maxSel = this.getEffectiveMaxSel(group);
                const selCount = [...selecionados].filter((n) => available.some((o) => o.nome === n)).length;
                return (
                  <View key={gIdx} style={styles.categoriaContainer}>
                    <View style={styles.categoriaHeader}>
                      <Text style={styles.categoriaTitle}>
                        {group.nome}
                        {group.obrigatorio ? ' *' : ''}
                      </Text>
                      <Text style={styles.categoriaCounter}>{maxSel ? `${selCount}/${maxSel}` : '0/0'}</Text>
                    </View>

                    <View style={styles.optionGrid}>
                      {(group.options || []).map((opt, oIdx) => {
                        const isSelected = selecionados.has(opt.nome);
                        const isDisabled = !!opt.esgotado;
                        const label = opt.valor_extra ? `${opt.nome} (+${brl(opt.valor_extra)})` : opt.nome;
                        return (
                          <TouchableOpacity
                            key={oIdx}
                            onPress={() => !isDisabled && this.toggleOption(gIdx, opt.nome)}
                            activeOpacity={0.8}
                            style={[
                              styles.optionChip,
                              isSelected && styles.optionChipSelected,
                              isDisabled && styles.optionChipDisabled,
                            ]}
                          >
                            <Text
                              style={[
                                styles.optionChipText,
                                isSelected && styles.optionChipTextSelected,
                                isDisabled && styles.optionChipTextDisabled,
                              ]}
                              numberOfLines={2}
                            >
                              {isDisabled ? `${label} (esgotado)` : label}
                            </Text>
                            <View
                              style={[
                                styles.optionDot,
                                isSelected && styles.optionDotSelected,
                                isDisabled && styles.optionDotDisabled,
                              ]}
                            />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}

            {/* Sugestões de comanda */}
            <View>
              {this.state.showComandaPedido &&
                (this.state.comanda_filtrada || []).map((item, index) => (
                  <TouchableOpacity
                    key={`${String(item?.comanda || '')}-${index}`}
                    style={styles.comandaItem}
                    onPress={() => this.selecionarComandaPedido(item.comanda)}
                  >
                    <Text style={styles.comandaText}>{item.comanda}</Text>
                  </TouchableOpacity>
                ))}
            </View>

            {/* Sugestões de pedido */}
            <View>
              {this.state.showPedido &&
                (this.state.pedido_filtrado || []).slice(0, 5).map((item, index) => (
                  <Pressable
                    key={`${String(item?.id || item?.item || index)}`}
                    style={styles.pedidoSelecionadoItem}
                    onPress={() => {
                      Keyboard.dismiss();
                      this.selecionarPedido(item.item, item.id);
                    }}
                  >
                    <Text style={styles.pedidoText}>{item.item}</Text>
                  </Pressable>
                ))}
            </View>

            <TextInput
              placeholder="Extra (opcional)"
              placeholderTextColor="#999"
              onChangeText={this.changeExtra}
              value={this.state.extra}
              style={styles.inputExtra}
            />

            <TextInput
              placeholder="Nome (opcional)"
              placeholderTextColor="#999"
              onChangeText={(nome) => this.safeSetState({ nome })}
              value={this.state.nome}
              style={styles.inputNome}
              autoComplete="off"
              autoCorrect={false}
              spellCheck={false}
              textContentType="none"
              importantForAutofill="no"
            />

            <View style={styles.actionRow}>
              <Button title={isCheckingQty ? 'Verificando...' : 'Adicionar'} onPress={this.adicionarPedido} disabled={!canAdd} />
              {this.state.showPedidoSelecionado !== this.state.showPedido && !this.state.pedido ? (
                <Button
                  title={isSending ? 'Enviando...' : 'Enviar pedido'}
                  onPress={this.sendData}
                  disabled={!canSendCart}
                />
              ) : null}
            </View>

            {/* Lista do carrinho */}
            {pedidosSelecionados.map((item, index) => {
              const qtd = quantidadeSelecionada[index] || 1;
              const unit = selectedUnitPrices[index] || 0;
              const resumo = this.summarizeSelection(opcoesSelecionadasPorItem[index] || []);
              const extraTxt = extraSelecionados[index] || '';

              return (
                <View key={`${item}-${index}`} style={styles.cartItemCard}>
                  <View style={styles.cartItemHeader}>
                   <Text style={styles.cartItemTitle}>{item}</Text>
                   <View style={styles.cartItemHeaderRight}>
                    <Text style={styles.cartItemSubtitle}>unit: {brl(unit)}</Text>
                    <TouchableOpacity
                   onPress={() => this.confirmRemoveFromCart(index)}
                   style={styles.removeBtn}
                  activeOpacity={0.85}
                  >
                  <Text style={styles.removeBtnText}>Remover</Text>
                    </TouchableOpacity>
                  </View>
                  </View>

                  <View style={styles.cartItemBody}>
                    {!!resumo && <Text style={styles.cartItemLine}>Opções: {resumo}</Text>}
                    {!!extraTxt && <Text style={styles.cartItemLine}>Extra: {extraTxt}</Text>}
                  </View>

                  <View style={styles.cartItemPriceRow}>
                    <View style={styles.cartQtyControls}>
                      <Button title="-" onPress={() => this.removerPedidoSelecionado(index)} />
                      <Text>{qtd}</Text>
                      <Button title="+" onPress={() => this.adicionarPedidoSelecionado(index)} />
                    </View>
                    <Text style={styles.cartItemTitle}>{brl(unit * qtd)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    );
  }
}

// ===================== Styles =====================
const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  scrollContainer: {
    paddingBottom: 40,
  },
  innerContainer: {
    flexGrow: 1,
  },
  inputRow: { flexDirection: 'row' },
  inputComanda: {
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    flexDirection: 'row',
    paddingHorizontal: 8,
    height: 40,
    flex: 1,
  },
  inputPedido: {
    flex: 2,
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    marginHorizontal: 5,
    paddingHorizontal: 8,
  },
  quantityRow: { flexDirection: 'row', alignItems: 'center' },
  inputQuantidade: {
    height: 40,
    width: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    textAlign: 'center',
    marginHorizontal: 6,
    paddingVertical: 0,
  },
  categoriaContainer: {
    marginTop: 10,
  },
  categoriaTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#111827',
  },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderColor: 'black',
    borderStyle: 'solid',
  },
  optionText: {
    fontSize: 14,
  },
  optionCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  inputExtra: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    marginTop: 15,
  },
  comandaItem: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff',
  },
  comandaText: {
    fontSize: 16,
    color: '#333',
  },
  pedidoSelecionadoItem: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff',
    borderRadius: 6,
    marginVertical: 4,
    marginHorizontal: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  pedidoText: {
    fontSize: 16,
    color: '#333',
  },
  inputNome: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    marginVertical: 10,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 10,
  },
  pedidoEditItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  pedidoEditControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  categoriaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  categoriaCounter: {
    fontSize: 12,
    color: '#6b7280',
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f8fafc',
    marginRight: 8,
    marginBottom: 8,
    maxWidth: '100%',
    flexShrink: 1,
  },
  optionChipSelected: {
    borderColor: '#16a34a',
    backgroundColor: '#ecfdf5',
  },
  optionChipDisabled: {
    opacity: 0.5,
    backgroundColor: '#f3f4f6',
  },
  optionChipText: {
    fontSize: 14,
    color: '#111827',
    flexShrink: 1,
  },
  optionChipTextSelected: {
    fontWeight: '600',
  },
  optionChipTextDisabled: {
    textDecorationLine: 'line-through',
    color: '#6b7280',
  },
  optionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#d1d5db',
    marginLeft: 8,
  },
  optionDotSelected: {
    backgroundColor: '#16a34a',
  },
  optionDotDisabled: {
    backgroundColor: '#e5e7eb',
  },
  // Cards dos itens adicionados
  cartItemCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 10,
    marginVertical: 6,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cartItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cartItemTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  cartItemSubtitle: { fontSize: 12, color: '#6b7280' },
  cartItemBody: { marginTop: 4, gap: 4 },
  cartItemLine: { fontSize: 13, color: '#374151' },
  cartItemPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  cartQtyControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cartItemHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  removeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  removeBtnText: { color: '#7F1D1D', fontWeight: '700' },
}); 
