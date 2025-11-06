import React from 'react';
import {
  StyleSheet,
  View,
  Button,
  TextInput,
  TouchableOpacity,
  Text,
  ScrollView,
  Pressable,
  Modal,
  Animated,
  Keyboard,
  Alert,
  Platform,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import debounce from 'lodash.debounce';
import { UserContext } from '../UserContext';
import { API_URL } from './url';
import { getSocket } from '../socket';

// formata R$ de forma robusta no RN
const brl = (n) => {
  const v = Number(n || 0);
  const s = (isNaN(v) ? 0 : v).toFixed(2);
  return `R$ ${s.replace('.', ',')}`;
};

export default class HomeScreenCozinha extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      username: '',
      cargo: '',
      // campos existentes
      comand: '',
      pedido: '',
      extra: '',
      nome: '',
      data: [],
      dataFixo: [],
      pedido_filtrado: [],
      comanda_filtrada: [],
      comandaGeral: [],
      quantidadeSelecionada: [],
      pedidosSelecionados: [],
      extraSelecionados: [],
      nomeSelecionado: [],
      options: [],
      selecionadosByGroup: [],
      showPedido: false,
      showComandaPedido: false,
      showComanda: false,
      showQuantidade: false,
      showPedidoSelecionado: false,
      quantidade: 1,
      quantidadeRestanteMensagem: null,
      pedidoRestanteMensagem: null,
      showConfirmOrder: false,
      confirmMsg: 'Pedido enviado com sucesso!',
      isConnected: true,
      toastVariant: 'success',
      selectedUnitPrices: [],
      opcoesSelecionadasPorItem: [],
      carrinhos: [],
      showCarrinhoPicker: false,
      carrinhoOutro: false,
      // novos campos para o modo de entrega
      modoEntrega: 'carrinho', // 'carrinho' | 'residencial'
      carrinhoNome: '',
      enderecoEntrega: '',
      // locks anti-duplo-clique
      sending: false,
      adding: false,
    };

    // debounce para busca de pedidos
    this.processarPedido = debounce(this.processarPedido.bind(this), 200);

    // animação toast
    this._toastOpacity = new Animated.Value(0);
    this._toastTranslateY = new Animated.Value(-12);
    this._hideToastTimer = null;

    this._isMounted = false;
    this.socket = null;
    this._netinfoUnsub = null;
  }

  getCarrinho() {
    const { user } = this.context || {};
    return user?.carrinho || '';
  }

  // ======= helpers de UI/locks =======
  sendWithLock = async (fn, { lockKey = 'sending', releaseMs = 6000 } = {}) => {
    if (this.state[lockKey]) return;
    this.setState({ [lockKey]: true });
    try {
      await fn();
    } finally {
      // libera mesmo sem ACK, evita travar UI se a rede cair
      setTimeout(() => this._isMounted && this.setState({ [lockKey]: false }), releaseMs);
    }
  };

  // ======= handlers modais carrinho =======
  openCarrinhoPicker = () => this.setState({ showCarrinhoPicker: true });
  closeCarrinhoPicker = () => this.setState({ showCarrinhoPicker: false });

  selectCarrinho = (nome) => {
    this.setState({
      carrinhoNome: nome || '',
      carrinhoOutro: false,
      showCarrinhoPicker: false,
    });
  };

  escolherOutroCarrinho = () => {
    this.setState({
      carrinhoOutro: true,
      showCarrinhoPicker: false,
      carrinhoNome: '',
    });
  };

  // Quantas opções ainda estão disponíveis no grupo
  getAvailableOptions = (g) => (g?.options || []).filter((o) => !o?.esgotado);
  // Máximo efetivo com base nas disponíveis
  getEffectiveMaxSel = (g) => {
    const av = this.getAvailableOptions(g).length;
    if (av <= 0) return 0;
    const raw = Number(g?.max_selected || 1) || 1;
    return Math.max(1, Math.min(raw, av));
  };

  async componentDidMount() {
    this._isMounted = true;
    const { user } = this.context || {};
    this.setState({ username: user?.username || '' });

    // 1) Monitor da rede
    this._netinfoUnsub = NetInfo.addEventListener(this.handleNetInfoChange);
    try {
      const net = await NetInfo.fetch();
      this.setState({ isConnected: !!net.isConnected });
      if (!net.isConnected) {
        this.showConfirmToast('Sem internet no dispositivo.', 'error');
      }
    } catch {
      // ignore
    }

    // 2) Socket.io
    this.socket = getSocket();

    // listeners estáveis
    this.socket?.on('respostaCardapio', this.handleRespostaCardapio);
    this.socket?.on('respostaComandas', this.handleRespostaComandas);
    this.socket?.on('respostaCarrinhos', this.handleRespostaCarrinhos);
    this.socket?.on('error', this.handleSocketError);
    this.socket?.on('alerta_restantes', this.handleAlertaRestantes);
    this.socket?.on('connect', this.handleSocketConnect);
    this.socket?.on('disconnect', this.handleSocketDisconnect);

    // 3) Primeiras cargas
    if (this.state.isConnected && this.socket?.connected) {
      const carrinho = this.getCarrinho();
      this.socket.emit('getCardapio', { emitir: false, carrinho });
      this.socket.emit('getComandas', { emitir: false, carrinho });
      this.socket.emit('getCarrinhos', { emitir: false, carrinho });
    } else {
      this.showConfirmToast('Sem internet. Tentando novamente quando voltar.', 'warning');
    }
  }

  componentWillUnmount() {
    this._isMounted = false;
    if (this._hideToastTimer) clearTimeout(this._hideToastTimer);
    if (this._netinfoUnsub) {
      this._netinfoUnsub();
      this._netinfoUnsub = null;
    }
    if (this.socket) {
      this.socket.off('respostaCardapio', this.handleRespostaCardapio);
      this.socket.off('respostaComandas', this.handleRespostaComandas);
      this.socket.off('respostaCarrinhos', this.handleRespostaCarrinhos);
      this.socket.off('error', this.handleSocketError);
      this.socket.off('alerta_restantes', this.handleAlertaRestantes);
      this.socket.off('connect', this.handleSocketConnect);
      this.socket.off('disconnect', this.handleSocketDisconnect);
    }
  }

  // -------- handlers socket --------
  handleRespostaCardapio = (data) => {
    const list = Array.isArray(data?.dataCardapio) ? data.dataCardapio : [];
    const apenasCat3 = list.filter((it) => {
      const candidates = [it?.categoria_id, it?.categoria, it?.category, it?.tipo];
      return candidates.some((v) => Number(v) === 3);
    });
    if (!this._isMounted) return;
    this.setState({
      pedido_filtrado: apenasCat3,
      dataFixo: apenasCat3,
    });
  };

  handleRespostaComandas = (data) => {
    if (!this._isMounted) return;
    if (data?.dados_comandaAberta) {
      this.setState({
        comanda_filtrada: data.dados_comandaAberta,
        comandaGeral: data.dados_comandaAberta,
      });
    }
  };

  handleRespostaCarrinhos = (data) => {
    if (!this._isMounted) return;
    if (data?.carrinhos) {
      this.setState({ carrinhos: Array.isArray(data.carrinhos) ? data.carrinhos : [] });
    }
  };

  handleSocketError = ({ message }) => console.error('Erro do servidor:', message);

  handleAlertaRestantes = (data) => {
    if (!this._isMounted || !data) return;
    this.setState({
      quantidadeRestanteMensagem: data.quantidade ?? 0,
      pedidoRestanteMensagem: data.item ?? '',
    });
  };

  handleSocketConnect = () => {
    this.showConfirmToast('Conectado novamente!', 'success');
    // revalida dados ao reconectar
    try {
      const carrinho = this.getCarrinho();
      this.socket?.emit('getCardapio', { emitir: false, carrinho });
      this.socket?.emit('getComandas', { emitir: false, carrinho });
      this.socket?.emit('getCarrinhos', { emitir: false, carrinho });
    } catch {
      // ignore
    }
  };

  handleSocketDisconnect = () => this.showConfirmToast('Sem conexão com o servidor.', 'error');

  handleNetInfoChange = (state) => {
    const was = this.state.isConnected;
    const now = !!state.isConnected;
    if (was !== now) {
      this.setState({ isConnected: now });
      if (!now) this.showConfirmToast('Sem internet no dispositivo.', 'error');
      else this.showConfirmToast('Internet restaurada.', 'success');
    }
  };

  // -------- util --------
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

  resetCurrentSelection = (extra = {}) => {
    this.setState({
      options: [],
      selecionadosByGroup: [],
      showQuantidade: false,
      ...extra,
    });
  };

  // -------- inputs de comanda/pedido --------
  handleComandaFocus = () => {
    this.setState({ showComandaPedido: !!(this.state.comand && this.state.comand.trim()) });
  };
  handleComandaBlur = () => setTimeout(() => this.setState({ showComandaPedido: false }), 0);
  handlePedidoFocus = () => this.setState({ showPedido: !!(this.state.pedido && this.state.pedido.trim()) });
  handlePedidoBlur = () => setTimeout(() => this.setState({ showPedido: false }), 0);

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
    this.setState((prev) => {
      const filterOut = (arr) => (Array.isArray(arr) ? arr.filter((_, i) => i !== index) : []);
      const pedidos = filterOut(prev.pedidosSelecionados);
  
      return {
        pedidosSelecionados: pedidos,
        quantidadeSelecionada: filterOut(prev.quantidadeSelecionada),
        extraSelecionados: filterOut(prev.extraSelecionados),
        nomeSelecionado: filterOut(prev.nomeSelecionado),
        selectedUnitPrices: filterOut(prev.selectedUnitPrices),
        opcoesSelecionadasPorItem: filterOut(prev.opcoesSelecionadasPorItem),
        showPedidoSelecionado: pedidos.length > 0 ? prev.showPedidoSelecionado : false,
      };
    });
  };
  

  changeComanda = (comand) => {
    const base = Array.isArray(this.state.comandaGeral) ? this.state.comandaGeral : [];
    const raw = String(comand ?? '');
    const qNorm = this.normalize(raw);
    const words = qNorm.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      this.setState({ comanda_filtrada: base, comand: raw, showComandaPedido: false });
      return;
    }
    const starts = [],
      allWords = [],
      includes = [];
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
    this.setState({ comanda_filtrada, comand: raw, showComandaPedido: true });
  };

  showConfirmToast = (msg = 'Tudo certo!', variant = 'success') => {
    if (!this._isMounted || !this._toastOpacity || !this._toastTranslateY) return;
    this.setState({ showConfirmOrder: true, confirmMsg: msg, toastVariant: variant }, () => {
      Animated.parallel([
        Animated.timing(this._toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(this._toastTranslateY, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(() => {
        if (this._hideToastTimer) clearTimeout(this._hideToastTimer);
        this._hideToastTimer = setTimeout(() => {
          if (this._isMounted) this.hideConfirmToast();
        }, 2000);
      });
    });
  };

  hideConfirmToast = () => {
    if (!this._isMounted || !this._toastOpacity || !this._toastTranslateY) return;
    Animated.parallel([
      Animated.timing(this._toastOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(this._toastTranslateY, { toValue: -12, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      if (this._isMounted) this.setState({ showConfirmOrder: false });
    });
  };

  changePedido = (pedid) => {
    const pedido = String(pedid).toLowerCase();
    this.resetCurrentSelection();
    this.setState({ pedido, showPedido: !!pedido });
    this.processarPedido(pedido);
  };

  processarPedido(pedido) {
    const base = Array.isArray(this.state.dataFixo) ? this.state.dataFixo : [];
    const raw = String(pedido || '');
    if (!raw) {
      this.setState({ pedido_filtrado: [], showPedido: false });
      return;
    }
    if (raw[0] === '.' && raw.length > 1) {
      const id = raw.slice(1).trim();
      const result = base.filter((it) => String(it && it.id) === id);
      this.setState({ pedido_filtrado: result });
      return;
    }
    const q = raw.toLowerCase().trim();
    if (!q) {
      this.setState({ pedido_filtrado: base });
      return;
    }
    const words = q.split(/\s+/).filter(Boolean);
    const starts = [],
      allWords = [],
      includes = [];
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
    this.setState({ pedido_filtrado: result, showPedido: !!pedido });
  }

  verificarExistenciaPedidos(pedido) {
    if (!!pedido) {
      const pedidExist = this.state.dataFixo.filter(
        (item) => String(item.item).toLowerCase() === String(pedido).toLowerCase()
      );
      return pedidExist.length > 0;
    }
    return true;
  }

  // ===== opções/grupos =====
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
      if (available.length === 0) continue; // ignora obrigatoriedade se todas esgotadas
      if (g.obrigatorio) {
        const selectedNames = new Set(selecionadosByGroup[i] || []);
        const hasAny = available.some((o) => selectedNames.has(o.nome));
        if (!hasAny) {
          return { ok: false, msg: `Selecione ao menos 1 opção em "${g.nome}".` };
        }
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

  summarizeSelection = (selGroups = []) => {
    return selGroups
      .map((g) => {
        const itens = (g.options || []).map((o) =>
          o.valor_extra ? `${o.nome} (+${brl(o.valor_extra)})` : o.nome
        );
        return `${g.nome}: ${itens.join(', ') || '—'}`;
      })
      .join(' • ');
  };

  toggleOption = (groupIndex, optionName) => {
    let toastMessage = null;
    this.setState(
      (prev) => {
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

        const selecionadosByGroup = [...prev.selecionadosByGroup];
        const selected = new Set(selecionadosByGroup[groupIndex] || []);

        const availableNames = new Set(this.getAvailableOptions(group).map((o) => o.nome));
        const selectedAvailableCount = [...selected].filter((n) => availableNames.has(n)).length;
        const already = selected.has(optionName);

        if (already) {
          selecionadosByGroup[groupIndex] = [...selected].filter((n) => n !== optionName);
          return { selecionadosByGroup };
        }

        if (selectedAvailableCount >= effectiveMax) {
          toastMessage = `Máximo de ${effectiveMax} em "${group.nome}".`;
          return null;
        }

        selecionadosByGroup[groupIndex] = [...selected, optionName];
        return { selecionadosByGroup };
      },
      () => {
        if (toastMessage) this.showConfirmToast(toastMessage, 'warning');
      }
    );
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

  // -------- ações --------
  selecionarPedido = (pedid, id) => {
    const pedido = pedid.trim();
    const row =
      (this.state.dataFixo || []).find((r) => String(r.id) == String(id)) ||
      (this.state.dataFixo || []).find(
        (r) => String(r.item || '').trim().toLowerCase() === pedido.toLowerCase()
      );
    const groups = this.normalizeGroups(row?.opcoes);

    this.setState({
      pedido,
      pedido_filtrado: [],
      showQuantidade: true,
      options: groups,
      selecionadosByGroup: groups.map(() => []),
    });
  };

  selecionarComandaPedido = (comand) =>
    this.setState({ comand, comanda_filtrada: [], showComandaPedido: false });

  aumentar_quantidade = () => this.setState((prev) => ({ quantidade: prev.quantidade + 1 }));
  diminuir_quantidade = () =>
    this.setState((prev) => ({ quantidade: Math.max(prev.quantidade - 1, 1) }));
  mudar_quantidade = (quantidade) =>
    this.setState({ quantidade: Math.max(parseInt(quantidade) || 1, 1) });

  adicionarPedido = async () => {
    const pedido = (this.state.pedido || '').trim();
    const { showQuantidade, quantidade } = this.state;
    if (!showQuantidade) return;

    // evita duplo clique
    if (this.state.adding) return;
    await this.sendWithLock(async () => {
      const { ok, msg } = this.validateRequiredGroups();
      if (!ok) {
        this.showConfirmToast(msg || 'Seleção incompleta.', 'warning');
        return;
      }

      try {
        const resp = await fetch(`${API_URL}/verificar_quantidade`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: pedido, quantidade, carrinho: this.getCarrinho() }),
        });
        const data = await resp.json();

        if (data?.erro) {
          if (!this._isMounted) return;
          this.setState({
            quantidade: 1,
            showQuantidade: false,
            pedido: '',
            extra: '',
            nome: '',
            showPedidoSelecionado: false,
            showPedido: false,
            options: [],
            selecionadosByGroup: [],
          });
          const quantidadeRest = data.quantidade;
          Alert.alert('Quantidade insuficiente', `Restam apenas ${String(quantidadeRest)}.`);
          return;
        }

        const selection = this.buildSelectionFromState();
        const extrasSum = this.computeExtrasFromSelection();
        const basePrice = this.getItemBasePrice(pedido);
        const unitPrice = basePrice + extrasSum;

        const quantidadeR = data.quantidade;
        const novaQ = parseFloat(quantidadeR) - quantidade;
        if (Number.isFinite(novaQ) && novaQ >= 0) {
          this.showConfirmToast(
            `Atenção: restam apenas ${String(novaQ)} — recomende reposição.`,
            'warning'
          );
        }

        if (!this._isMounted) return;
        this.setState((prev) => ({
          pedidosSelecionados: [...prev.pedidosSelecionados, pedido],
          quantidadeSelecionada: [...prev.quantidadeSelecionada, quantidade],
          extraSelecionados: this.state.extra
            ? [...prev.extraSelecionados, this.state.extra]
            : [...prev.extraSelecionados, ''],
          nomeSelecionado: this.state.nome
            ? [...prev.nomeSelecionado, this.state.nome]
            : [...prev.nomeSelecionado, ''],
          selectedUnitPrices: [...prev.selectedUnitPrices, unitPrice],
          opcoesSelecionadasPorItem: [...prev.opcoesSelecionadasPorItem, selection],
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
      } catch (error) {
        console.error('Erro ao adicionar pedido:', error);
        this.showConfirmToast('Falha ao verificar estoque.', 'error');
      }
    }, { lockKey: 'adding', releaseMs: 1500 });
  };

  adicionarPedidoSelecionado = (index) =>
    this.setState((prev) => ({
      quantidadeSelecionada: prev.quantidadeSelecionada.map((q, i) =>
        i === index ? q + 1 : q
      ),
    }));

  removerPedidoSelecionado = (index) => {
    this.setState((prev) => ({
      quantidadeSelecionada: prev.quantidadeSelecionada.map((q, i) =>
        i === index ? (q - 1 < 0 ? 0 : q - 1) : q
      ),
    }));
  };

  changeExtra = (extra) => this.setState({ extra });

  // -------- envio principal --------
  sendData = async () => {
    await this.sendWithLock(async () => {
      const net = await NetInfo.fetch();
      if (!net.isConnected) {
        this.showConfirmToast('Sem internet. Tente novamente.', 'error');
        return;
      }
      if (!this.socket || !this.socket.connected) {
        this.showConfirmToast('Sem conexão com o servidor. Aguarde reconexão.', 'error');
        return;
      }

      const pedido = (this.state.pedido || '').trim();
      const { user } = this.context || {};
      if (!this.verificarExistenciaPedidos(pedido)) {
        Alert.alert('Pedido inexistente', 'Verifique o item informado.');
        return;
      }

      // validações conforme modo de entrega
      const { modoEntrega, carrinhoNome, enderecoEntrega } = this.state;
      if (modoEntrega === 'residencial') {
        if (!enderecoEntrega.trim()) {
          Alert.alert('Endereço obrigatório', 'Informe o endereço para Entrega Residencial.');
          return;
        }
      }
      if (modoEntrega === 'carrinho' && !carrinhoNome.trim()) {
        Alert.alert(
          'Carrinho obrigatório',
          'Selecione um carrinho ou escolha "Outro" e digite o nome.'
        );
        return;
      }

      const comand = (this.state.comand || '').trim();
      const {
        nome,
        nomeSelecionado,
        pedidosSelecionados,
        quantidadeSelecionada,
        extraSelecionados,
        quantidade,
        extra,
        username,
      } = this.state;
      const currentTime = this.getCurrentTime();

      const carrinhoDestino = modoEntrega === 'carrinho' ? carrinhoNome : '';
      const enderecoDestino = modoEntrega === 'residencial' ? enderecoEntrega : '';

      // Carrinho com vários itens
      if (pedidosSelecionados.length && quantidadeSelecionada.length) {
        const indicesValidos = [];
        quantidadeSelecionada.forEach((q, i) => {
          if (q > 0) indicesValidos.push(i);
        });

        if (indicesValidos.length === 0) {
          this.showConfirmToast('Carrinho vazio.', 'warning');
          return;
        }

        const NovasSelecoes = indicesValidos.map((i) => this.state.opcoesSelecionadasPorItem[i] || []);
        const NovosPedidos = indicesValidos.map((i) => pedidosSelecionados[i]);
        const NovasQuantidades = indicesValidos.map((i) => quantidadeSelecionada[i]);
        const NovosExtras = indicesValidos.map((i) => extraSelecionados[i] ?? '');
        const NovosNomes = indicesValidos.map((i) => nomeSelecionado[i] ?? '');

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
          modo_entrega: modoEntrega,
          endereco: enderecoDestino,
          carrinho_destino: carrinhoDestino,
          carrinho: this.getCarrinho(),
        });

        if (!this._isMounted) return;
        this.showConfirmToast('Enviado ✅', 'success');
        this.setState({
          // inputs
          comand: '',
          pedido: '',
          extra: '',
          nome: '',
          carrinhoNome: '',
          enderecoEntrega: '',
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
          // seleção atual (chips)
          options: [],
          selecionadosByGroup: [],
        });
        return;
      }

      // Item único
      if (pedido && quantidade) {
        if ((this.state.options || []).length) {
          const { ok, msg } = this.validateRequiredGroups();
          if (!ok) {
            this.showConfirmToast(msg || 'Seleção incompleta.', 'warning');
            return;
          }
        }

        try {
          const resp = await fetch(`${API_URL}/verificar_quantidade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item: pedido, quantidade, carrinho: this.getCarrinho() }),
          });
          const data = await resp.json();

          if (data?.erro) {
            if (!this._isMounted) return;
            this.setState({
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
            const qtd = data.quantidade;
            Alert.alert('Quantidade insuficiente', `Restam apenas ${String(qtd)}.`);
            return;
          }

          const selection = [this.buildSelectionFromState()];
          this.socket.emit('insert_order', {
            comanda: comand,
            pedidosSelecionados: [pedido],
            quantidadeSelecionada: [this.state.quantidade],
            extraSelecionados: [this.state.extra],
            nomeSelecionado: [this.state.nome],
            horario: currentTime,
            comanda_filtrada: [],
            comanda_filtrada_abrir: [],
            username: this.state.username,
            opcoesSelecionadas: selection,
            token_user: user?.token,
            modo_entrega: modoEntrega,
            endereco: enderecoDestino,
            carrinho_destino: carrinhoDestino,
            carrinho: this.getCarrinho(),
          });

          if (!this._isMounted) return;
          this.showConfirmToast('Enviado ✅', 'success');
          this.setState({
            comand: '',
            pedido: '',
            quantidade: 1,
            extra: '',
            nome: '',
            carrinhoNome: '',
            enderecoEntrega: '',
            showComandaPedido: false,
            showPedidoSelecionado: false,
            showPedido: false,
            showQuantidade: false,
            options: [],
            selecionadosByGroup: [],
            opcoesSelecionadasPorItem: [],
            selectedUnitPrices: [],
          });
        } catch (err) {
          console.error('Erro ao adicionar pedido:', err);
          this.showConfirmToast('Falha ao enviar.', 'error');
        }
      } else {
        this.showConfirmToast('Preencha o pedido e quantidade.', 'warning');
      }
    });
  };

  // -------- UI: toast --------
  renderConfirmToast() {
    if (!this.state.showConfirmOrder) return null;
    const { toastVariant } = this.state;
    const bg =
      toastVariant === 'error'
        ? '#ef4444'
        : toastVariant === 'warning'
        ? '#f59e0b'
        : toastVariant === 'info'
        ? '#3b82f6'
        : '#22c55e';
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
            backgroundColor: bg,
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

  render() {
    const { modoEntrega, sending } = this.state;

    const hasCart =
      this.state.pedidosSelecionados.length > 0 &&
      this.state.quantidadeSelecionada.some((q) => (q || 0) > 0);
    const hasSingle = !!this.state.pedido && (this.state.quantidade || 0) > 0;
    const canSend = hasCart || hasSingle;

    return (
      <View style={styles.mainContainer}>
        {this.renderConfirmToast()}

        {/* Switch de Modo de Entrega */}
        <View style={styles.switchRow}>
          <Pressable
            onPress={() =>
              this.setState({
                modoEntrega: 'carrinho',
                // opcional: limpa endereço ao mudar
                enderecoEntrega: '',
              })
            }
            style={[styles.switchChip, modoEntrega === 'carrinho' && styles.switchChipOn]}
          >
            <Text
              style={[
                styles.switchChipText,
                modoEntrega === 'carrinho' && styles.switchChipTextOn,
              ]}
            >
              Carrinho Praia
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              this.setState({
                modoEntrega: 'residencial',
                // opcional: limpa carrinho ao mudar
                carrinhoNome: '',
                carrinhoOutro: false,
              })
            }
            style={[styles.switchChip, modoEntrega === 'residencial' && styles.switchChipOn]}
          >
            <Text
              style={[
                styles.switchChipText,
                modoEntrega === 'residencial' && styles.switchChipTextOn,
              ]}
            >
              Entrega Residencial
            </Text>
          </Pressable>
        </View>

        {/* Campos dependentes do modo */}
        {modoEntrega === 'carrinho' ? (
          <View style={{ marginBottom: 8 }}>
            <Pressable
              onPress={this.openCarrinhoPicker}
              style={[styles.inputCarrinho, { justifyContent: 'center' }]}
            >
              <Text style={{ color: this.state.carrinhoNome ? '#111' : '#999' }}>
                {this.state.carrinhoNome || 'Selecionar carrinho'}
              </Text>
            </Pressable>

            {this.state.carrinhoOutro && (
              <TextInput
                placeholder="Digite o nome do carrinho"
                placeholderTextColor="#999"
                value={this.state.carrinhoNome}
                onChangeText={(carrinhoNome) => this.setState({ carrinhoNome })}
                style={[styles.inputCarrinho, { marginTop: 6 }]}
                autoComplete="off"
                autoCorrect={false}
                spellCheck={false}
                textContentType="none"
                importantForAutofill="no"
              />
            )}
          </View>
        ) : (
          <View style={{ marginBottom: 8 }}>
            <TextInput
              placeholder="Endereço para entrega"
              placeholderTextColor="#999"
              value={this.state.enderecoEntrega}
              onChangeText={(enderecoEntrega) => this.setState({ enderecoEntrega })}
              style={styles.inputEndereco}
              autoComplete="off"
              autoCorrect={false}
              spellCheck={false}
              textContentType="none"
              importantForAutofill="no"
            />
          </View>
        )}

        <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.innerContainer}>
            {/* Linha de inputs principais */}
            <View style={styles.inputRow}>
              {modoEntrega === 'residencial' ? null : (
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
              )}

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
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
              />
              {this.state.showQuantidade && (
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
                    keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'numeric'}
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
                const selCount = [...selecionados].filter((n) =>
                  available.some((o) => o.nome === n)
                ).length;
                return (
                  <View key={gIdx} style={styles.categoriaContainer}>
                    <View style={styles.categoriaHeader}>
                      <Text style={styles.categoriaTitle}>
                        {group.nome}
                        {group.obrigatorio ? ' *' : ''}
                      </Text>
                      <Text style={styles.categoriaCounter}>
                        {maxSel ? `${selCount}/${maxSel}` : '0/0'}
                      </Text>
                    </View>

                    <View style={styles.optionGrid}>
                      {group.options.map((opt, oIdx) => {
                        const isSelected = selecionados.has(opt.nome);
                        const isDisabled = !!opt.esgotado;
                        const label = opt.valor_extra
                          ? `${opt.nome} (+${brl(opt.valor_extra)})`
                          : opt.nome;
                        return (
                          <TouchableOpacity
                            key={`${gIdx}-${oIdx}-${opt.nome}`}
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

            {/* Sugestões de comanda (apenas no modo carrinho) */}
            {modoEntrega !== 'residencial' && (
              <View>
                {this.state.showComandaPedido &&
                  this.state.comanda_filtrada.slice(0, 8).map((item, index) => (
                    <TouchableOpacity
                      key={`${item?.id ?? item?.comanda ?? index}`}
                      style={styles.comandaItem}
                      onPress={() => this.selecionarComandaPedido(item.comanda)}
                    >
                      <Text style={styles.comandaText}>{item.comanda}</Text>
                    </TouchableOpacity>
                  ))}
              </View>
            )}

            {/* Sugestões de pedido */}
            <View>
              {this.state.showPedido &&
                this.state.pedido_filtrado.slice(0, 5).map((item, index) => (
                  <Pressable
                    key={`${item?.id ?? item?.item ?? index}`}
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
              onChangeText={(nome) => this.setState({ nome })}
              value={this.state.nome}
              style={styles.inputNome}
              autoComplete="off"
              autoCorrect={false}
              spellCheck={false}
              textContentType="none"
              importantForAutofill="no"
            />

            <View style={styles.actionRow}>
              <Button
                title={this.state.adding ? 'Adicionando…' : 'Adicionar'}
                onPress={this.adicionarPedido}
                disabled={this.state.adding}
              />
              {(this.state.showPedidoSelecionado !== this.state.showPedido && !this.state.pedido) && (
                <Button
                  title={sending ? 'Enviando…' : 'Enviar pedido'}
                  onPress={this.sendData}
                  disabled={!canSend || sending}
                />
              )}
            </View>

            {/* Carrinho */}
            {this.state.pedidosSelecionados.map((item, index) => {
              const qtd = this.state.quantidadeSelecionada[index] || 1;
              const unit = this.state.selectedUnitPrices[index] || 0;
              const resumo = this.summarizeSelection(
                this.state.opcoesSelecionadasPorItem[index] || []
              );
              const extraTxt = this.state.extraSelecionados[index] || '';
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
                      <Button title="-" color="red" onPress={() => this.removerPedidoSelecionado(index)} />
                      <Text>{qtd}</Text>
                      <Button title="+" onPress={() => this.adicionarPedidoSelecionado(index)} />
                    </View>
                    <Text style={styles.cartItemTitle}>{brl(unit * qtd)}</Text>
                  </View>
                </View>
              );
            })}

            {/* Modal do seletor de carrinho */}
            <Modal
              visible={this.state.showCarrinhoPicker}
              transparent
              animationType="fade"
              onRequestClose={this.closeCarrinhoPicker}
            >
              <View style={styles.modalBackdrop}>
                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>Selecione um carrinho</Text>

                  <ScrollView style={{ maxHeight: 260, marginTop: 8 }}>
                    {Array.isArray(this.state.carrinhos) && this.state.carrinhos.length > 0 ? (
                      this.state.carrinhos.map((c) => (
                        <TouchableOpacity
                          key={String(c.id ?? c.carrinho)}
                          onPress={() => this.selectCarrinho(c.carrinho)}
                          style={styles.modalItem}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.modalItemText}>{c.carrinho}</Text>
                        </TouchableOpacity>
                      ))
                    ) : (
                      <View style={{ padding: 12 }}>
                        <Text style={{ color: '#666' }}>Nenhum carrinho cadastrado.</Text>
                      </View>
                    )}

                    <TouchableOpacity
                      onPress={this.escolherOutroCarrinho}
                      style={styles.modalItem}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.modalItemText, { fontStyle: 'italic' }]}>
                        Outro (digitar)
                      </Text>
                    </TouchableOpacity>
                  </ScrollView>

                  <View style={{ marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <TouchableOpacity onPress={this.closeCarrinhoPicker} style={styles.modalBtn}>
                      <Text style={styles.modalBtnText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          </View>
        </ScrollView>
      </View>
    );
  }
}

export const getCurrentTime = () => new Date().toTimeString().slice(0, 5);

const styles = StyleSheet.create({
  mainContainer: { flex: 1, padding: 20, backgroundColor: '#fff' },
  scrollContainer: { paddingBottom: 40 },
  innerContainer: { flexGrow: 1 },

  // switch
  switchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  switchChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f8fafc',
  },
  switchChipOn: { backgroundColor: '#ecfdf5', borderColor: '#16a34a' },
  switchChipText: { color: '#111827', fontWeight: '600' },
  switchChipTextOn: { color: '#065f46' },

  inputRow: { flexDirection: 'row' },
  inputComanda: {
    flex: 1,
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
  },
  inputPedido: {
    flex: 2,
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    marginHorizontal: 5,
    paddingHorizontal: 10,
  },
  inputCarrinho: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
  },
  inputEndereco: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
  },

  quantityRow: { flexDirection: 'row' },
  inputQuantidade: {
    height: 40,
    width: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    textAlign: 'center',
    marginHorizontal: 3,
  },

  categoriaContainer: { marginTop: 10 },
  categoriaTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  categoriaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  categoriaCounter: { fontSize: 12, color: '#6b7280' },

  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
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
  optionChipSelected: { borderColor: '#16a34a', backgroundColor: '#ecfdf5' },
  optionChipDisabled: { opacity: 0.5, backgroundColor: '#f3f4f6' },
  optionChipText: { fontSize: 14, color: '#111827', flexShrink: 1 },
  optionChipTextSelected: { fontWeight: '600' },
  optionChipTextDisabled: { textDecorationLine: 'line-through', color: '#6b7280' },
  optionDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#d1d5db', marginLeft: 8 },
  optionDotSelected: { backgroundColor: '#16a34a' },
  optionDotDisabled: { backgroundColor: '#e5e7eb' },

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
  comandaText: { fontSize: 16, color: '#333' },
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
  pedidoText: { fontSize: 16, color: '#333' },
  inputNome: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    marginVertical: 10,
  },
  actionRow: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 10 },

  // cards carrinho
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

  // toast modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  modalItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  modalItemText: { fontSize: 15, color: '#111' },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
  },
  modalBtnText: { color: '#111827', fontWeight: '600' },
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
