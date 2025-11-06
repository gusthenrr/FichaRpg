// ScreenCardapio.js (React Native .js)
import React from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TextInput,
  Modal,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Switch,
  ActivityIndicator,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import debounce from 'lodash.debounce';
import { UserContext } from '../UserContext';
import { getSocket } from '../socket';

const CATEGORIAS = ['Restante', 'Bebida', 'Porção'];
const MODALIDADES = ['Coqueteleira', 'Montado', 'Liquidificador', 'Montado na taça', 'Montado no copo'];

export default class ScreenCardapio extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      user: null,

      dataGeral: [],
      dataCardapio: [],
      data: [],

      cardapio: '',

      // modal/fluxo
      showAdicionar: true,
      showInputsAdicionar: false,
      showInputsRemover: false,
      showInputEditar: false,
      titleEnv: '',

      // campos
      AdicionarItem: '',
      AdicionarPreco: '',
      AdicionarNovoNome: '',
      categoria: '',
      modalidade: '',

      // grupos/opções
      opcoes: this.defaultOpcoes,

      // sugestões do modal (busca de itens existentes)
      sugsModal: [],

      // robustez
      isConnected: true,
      isSubmitting: false, // evita cliques rápidos no "Enviar"
      submitMsg: '',
    };

    this.socket = null;

    // controladores
    this._isMounted = false;
    this._netinfoUnsub = null;
    this._ackTimer = null;

    // debounces
    this.debouncedHeaderSearch = debounce((txt) => this.searchEstoque(txt, 'data'), 150);
    this.debouncedSearchModal = debounce((txt) => this.searchModal(txt, 5), 150);
  }

  getCarrinho = () => {
    const { user } = this.context || {};
    return user?.carrinho || '';
  };

  // ---------- getters/util ----------
  get defaultOpcoes() {
    return [
      {
        nome: '',
        ids: '',
        max_selected: 1,
        obrigatorio: false,
        options: [{ nome: '', valor_extra: 0, esgotado: false }],
      },
    ];
  }

  toInt = (v) => (v ? 1 : 0);

  safeSetState = (updater, cb) => {
    if (!this._isMounted) return;
    this.setState(updater, cb);
  };

  normalize = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  mapCategoriaIdToName = (id) => {
    if (id === 1) return 'Restante';
    if (id === 2) return 'Bebida';
    if (id === 3) return 'Porção';
    return '';
  };

  // ---------- lifecycle ----------
  async componentDidMount() {
    this._isMounted = true;

    const { user } = this.context || {};
    this.safeSetState({ user: user || null });

    // rede
    this._netinfoUnsub = NetInfo.addEventListener((state) => {
      const now = !!state.isConnected;
      if (now !== this.state.isConnected) this.safeSetState({ isConnected: now });
    });
    try {
      const net = await NetInfo.fetch();
      this.safeSetState({ isConnected: !!net.isConnected });
    } catch {}

    // socket
    this.socket = getSocket();
    if (this.socket) {
      this.socket.on('respostaCardapio', this.handleRespostaCardapio);
      this.socket.on?.('connect_error', () => this.safeSetState({ submitMsg: 'Falha ao conectar ao servidor.' }));
      this.socket.on?.('disconnect', () => this.safeSetState({ submitMsg: 'Servidor desconectado.' }));
    }

    this.initializeData();
  }

  componentWillUnmount() {
    this._isMounted = false;

    if (this._netinfoUnsub) {
      this._netinfoUnsub();
      this._netinfoUnsub = null;
    }
    if (this._ackTimer) {
      clearTimeout(this._ackTimer);
      this._ackTimer = null;
    }

    if (this.debouncedHeaderSearch?.cancel) this.debouncedHeaderSearch.cancel();
    if (this.debouncedSearchModal?.cancel) this.debouncedSearchModal.cancel();

    if (this.socket) {
      this.socket.off('respostaCardapio', this.handleRespostaCardapio);
    }
  }

  // ---------- socket/data ----------
  initializeData = () => {
    if (!this.socket) return;
    const carrinho = this.getCarrinho();
    this.socket.emit('getCardapio', { emitir: false, carrinho });
  };

  handleRespostaCardapio = (data) => {
    if (data?.dataCardapio) {
      this.safeSetState({
        dataCardapio: data.dataCardapio,
        data: data.dataCardapio,
        dataGeral: data.dataCardapio,
      });
    }
  };

  // ---------- opções/grupos ----------
  setObrigatorio = (groupIndex, value) => {
    const opcoes = [...this.state.opcoes];
    opcoes[groupIndex].obrigatorio = !!value;
    this.safeSetState({ opcoes });
  };

  sanitizeOpcoes = (ops = []) =>
    (Array.isArray(ops) ? ops : [])
      .map((g) => ({
        nome: String(g?.nome ?? g?.titulo ?? '').trim(),
        ids: String(g?.ids ?? ''),
        obrigatorio: this.toInt(!!g?.obrigatorio),
        max_selected: Math.max(1, parseInt(g?.max_selected ?? 1, 10) || 1),
        options: (g?.options || [])
          .filter((o) => String(o?.nome || '').trim())
          .map((o) => ({
            nome: String(o?.nome || '').trim(),
            valor_extra: Number(o?.valor_extra ?? 0) || 0,
            esgotado: this.toInt(!!o?.esgotado),
          })),
      }))
      .filter((g) => g.nome && (g.options || []).length > 0);

  parseLegacyOpcoes = (legacyStr) => {
    // Ex.: "Frutas(morango-melancia-manga+2)Complementos(banana-leite-leite condensado+2)"
    const re = /([^(]+)\(([^)]*)\)/g;
    const groups = [];
    let m;
    while ((m = re.exec(String(legacyStr))) !== null) {
      const gname = m[1].trim();
      const body = m[2].trim();
      if (!body) {
        groups.push({ nome: gname, ids: '', max_selected: 1, obrigatorio: false, options: [] });
        continue;
      }
      const options = body.split('-').map((tok) => {
        tok = tok.trim();
        const mm = tok.match(/^(.*?)(?:\+(\d+))?$/);
        const nome = (mm?.[1] || '').trim();
        const valor_extra = mm?.[2] ? Number(mm[2]) : 0;
        return { nome, valor_extra, esgotado: false };
      });
      groups.push({ nome: gname, ids: '', max_selected: 1, obrigatorio: false, options });
    }
    return groups.length ? groups : this.defaultOpcoes;
  };

  normalizeGroupsFromDB = (raw) => {
    // Aceita: objeto/array já no formato novo, string JSON do novo formato, ou string legada
    if (!raw) return this.defaultOpcoes;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) {
        return parsed.map((g) => ({
          nome: g?.nome ?? g?.titulo ?? '',
          ids: g?.ids ?? '',
          max_selected: Number(g?.max_selected ?? 1) || 1,
          obrigatorio: !!g?.obrigatorio,
          options: Array.isArray(g?.options)
            ? g.options.map((o) => ({
                nome: o?.nome ?? String(o ?? ''),
                valor_extra: Number(o?.valor_extra ?? 0) || 0,
                esgotado: !!o?.esgotado,
              }))
            : [],
        }));
      }
    } catch (_) {
      // pode ser string legada
    }
    if (typeof raw === 'string') return this.parseLegacyOpcoes(raw);
    return this.defaultOpcoes;
  };

  getDados = (row) => {
    // tenta primeiro no próprio objeto; se não vier, procura na lista carregada
    let rawOpcoes = row?.opcoes;
    if (rawOpcoes == null) {
      const found = (this.state.dataCardapio || []).find((r) => r.item === row?.item);
      rawOpcoes = found?.opcoes;
    }
    const groups = this.normalizeGroupsFromDB(rawOpcoes);
    this.safeSetState({ opcoes: groups || this.defaultOpcoes });
  };

  adicionarOpcao = () => {
    this.safeSetState((prev) => ({
      opcoes: [
        ...prev.opcoes,
        { nome: '', ids: '', max_selected: 1, obrigatorio: false, options: [{ nome: '', valor_extra: 0, esgotado: false }] },
      ],
    }));
  };

  removerOpcao = (groupIndex) => {
    const opcoes = [...this.state.opcoes];
    opcoes.splice(groupIndex, 1);
    this.safeSetState({ opcoes: opcoes.length ? opcoes : this.defaultOpcoes });
  };

  adicionarConteudo = (groupIndex) => {
    const opcoes = [...this.state.opcoes];
    opcoes[groupIndex].options.push({ nome: '', valor_extra: 0, esgotado: false });
    this.safeSetState({ opcoes });
  };

  removerConteudo = (groupIndex, optionIndex) => {
    const opcoes = [...this.state.opcoes];
    opcoes[groupIndex].options.splice(optionIndex, 1);
    this.safeSetState({ opcoes });
  };

  atualizarNomeGrupo = (groupIndex, text) => {
    const opcoes = [...this.state.opcoes];
    opcoes[groupIndex].nome = text;
    this.safeSetState({ opcoes });
  };

  atualizarMaxSelected = (groupIndex, text) => {
    const n = Math.max(1, parseInt(text || '1', 10) || 1);
    const opcoes = [...this.state.opcoes];
    opcoes[groupIndex].max_selected = n;
    this.safeSetState({ opcoes });
  };

  atualizarOptionNome = (groupIndex, optionIndex, text) => {
    const opcoes = [...this.state.opcoes];
    opcoes[groupIndex].options[optionIndex].nome = text;
    this.safeSetState({ opcoes });
  };

  atualizarOptionExtra = (groupIndex, optionIndex, text) => {
    const v = Number(String(text).replace(',', '.')) || 0;
    const opcoes = [...this.state.opcoes];
    opcoes[groupIndex].options[optionIndex].valor_extra = v;
    this.safeSetState({ opcoes });
  };

  atualizarOptionEsgotado = (groupIndex, optionIndex, value) => {
    const opcoes = [...this.state.opcoes];
    opcoes[groupIndex].options[optionIndex].esgotado = !!value;
    this.safeSetState({ opcoes });
  };

  // ---------- busca ----------
  searchModal = (text, limit = 5) => {
    const base = this.state.dataCardapio || [];
    const qNorm = this.normalize(text);
    if (!qNorm) {
      this.safeSetState({ sugsModal: [] });
      return;
    }
    const tokens = qNorm.split(' ').filter(Boolean);

    const ranked = [];
    for (const it of base) {
      const nameN = this.normalize(String(it.item || ''));
      let ok = true;
      let score = 0;
      for (const tok of tokens) {
        const idx = nameN.indexOf(tok);
        if (idx === -1) {
          ok = false;
          break;
        }
        score += idx === 0 ? 4 : 2;
        score += Math.max(0, 2 - Math.min(idx, 2)) * 0.1;
      }
      if (ok) ranked.push({ it, score, nameN });
    }

    ranked.sort((a, b) => b.score - a.score || a.nameN.length - b.nameN.length || a.nameN.localeCompare(b.nameN));
    this.safeSetState({ sugsModal: ranked.slice(0, limit).map((r) => r.it) });
  };

  searchEstoque = (text, stateKey, limit = null) => {
    const base = this.state.dataCardapio || [];
    const qNorm = this.normalize(text);

    if (!qNorm) {
      const full = [...base];
      const result = limit ? full.slice(0, limit) : full;
      this.safeSetState({ cardapio: text, [stateKey]: result });
      return;
    }

    const tokens = qNorm.split(' ').filter(Boolean);
    const ranked = [];
    for (const it of base) {
      const name = String(it.item || '');
      const nameN = this.normalize(name);

      let ok = true;
      let score = 0;

      for (const tok of tokens) {
        const idx = nameN.indexOf(tok);
        if (idx === -1) {
          ok = false;
          break;
        }
        score += idx === 0 ? 4 : 2;
        score += Math.max(0, 2 - Math.min(idx, 2)) * 0.1;
      }

      if (ok) ranked.push({ item: it, score, nameN });
    }

    ranked.sort((a, b) => b.score - a.score || a.nameN.length - b.nameN.length || a.nameN.localeCompare(b.nameN));
    const result = ranked.map((r) => r.item);
    const clipped = limit ? result.slice(0, limit) : result;

    this.safeSetState({ cardapio: text, [stateKey]: clipped });
  };

  // ---------- UI/fluxo ----------
  openEditFor = (it) => {
    this.safeSetState(
      {
        showAdicionar: false,
        showInputsAdicionar: false,
        showInputsRemover: false,
        showInputEditar: true,

        AdicionarItem: String(it.item || ''),
        AdicionarPreco: String(it.preco ?? ''),
        AdicionarNovoNome: '',
        categoria: this.mapCategoriaIdToName(it.categoria_id),
        modalidade: it.modalidade || '',

        sugsModal: [],
      },
      () => this.getDados(it),
    );
  };

  handlePickDropdown = (key, value) => {
    this.safeSetState((prev) => {
      const isAdicionar = prev.showInputsAdicionar;
      const isCategoria = key === 'categoria';
      const shouldResetOpcoes = isAdicionar && isCategoria;
      return {
        [key]: value,
        opcoes: shouldResetOpcoes ? this.defaultOpcoes : prev.opcoes,
      };
    });
  };

  // ---------- envio (Adicionar/Editar/Remover) com ACK ----------
  canSubmit = (mode) => {
    const { categoria, modalidade, AdicionarItem, AdicionarPreco, AdicionarNovoNome } = this.state;

    if (mode === 'Adicionar') {
      if (!AdicionarItem?.trim()) return false;
      if (!AdicionarPreco?.toString().trim()) return false;
      if (!categoria) return false;
      if (categoria === 'Bebida' && !modalidade) return false;
      return true;
    }
    if (mode === 'Editar') {
      if (!AdicionarItem?.trim()) return false;
      if (!AdicionarPreco?.toString().trim() && !AdicionarNovoNome?.trim() && !this.sanitizeOpcoes(this.state.opcoes).length) {
        // precisa mudar algo: preço, novo nome, ou opções
        return false;
      }
      if (!categoria) return false;
      if (categoria === 'Bebida' && !modalidade) return false;
      return true;
    }
    if (mode === 'Remover') {
      return !!AdicionarItem?.trim();
    }
    return false;
  };

  enviar = async (mode) => {
    if (this.state.isSubmitting) return;

    const { isConnected } = this.state;
    if (!isConnected) return this.safeSetState({ submitMsg: 'Sem internet. Tente novamente.' });
    if (!this.socket || !this.socket.connected) return this.safeSetState({ submitMsg: 'Sem conexão com o servidor.' });

    if (!this.canSubmit(mode)) return this.safeSetState({ submitMsg: 'Preencha os campos obrigatórios.' });

    const { categoria, modalidade, AdicionarItem, AdicionarPreco, AdicionarNovoNome, opcoes } = this.state;
    const { user } = this.context || {};

    const payloadBase = {
      username: user?.username,
      token: user?.token,
      carrinho: user?.carrinho,
    };

    const payloads = {
      Adicionar: {
        ...payloadBase,
        categoria,
        modalidade,
        item: AdicionarItem,
        preco: AdicionarPreco,
        opcoes: this.sanitizeOpcoes(opcoes),
      },
      Editar: {
        ...payloadBase,
        categoria,
        modalidade,
        item: AdicionarItem,
        preco: AdicionarPreco,
        novoNome: AdicionarNovoNome,
        opcoes: this.sanitizeOpcoes(opcoes),
      },
      Remover: {
        ...payloadBase,
        item: AdicionarItem,
      },
    };

    const eventByMode = {
      Adicionar: 'adicionarCardapio',
      Editar: 'editarCardapio',
      Remover: 'removerCardapio',
    };

    const event = eventByMode[mode];
    const payload = payloads[mode];

    this.safeSetState({ isSubmitting: true, submitMsg: 'Enviando...' });

    let acked = false;
    const onAck = (resp) => {
      if (acked) return;
      acked = true;
      if (this._ackTimer) {
        clearTimeout(this._ackTimer);
        this._ackTimer = null;
      }

      const ok = resp?.ok !== false;
      if (ok) {
        this.safeSetState({ submitMsg: `${mode} concluído!` });
        // limpa formulario
        this.safeSetState({
          categoria: '',
          modalidade: '',
          AdicionarItem: '',
          AdicionarPreco: '',
          AdicionarNovoNome: '',
          opcoes: this.defaultOpcoes,
          sugsModal: [],
        });
        // recarrega
        this.initializeData();
      } else {
        this.safeSetState({ submitMsg: resp?.message || `Não foi possível ${mode.toLowerCase()}.` });
      }
      this.safeSetState({ isSubmitting: false });
    };

    try {
      // emite com callback ACK; se backend não tiver ACK, cai no timeout
      this.socket.emit(event, payload, onAck);
      this._ackTimer = setTimeout(() => {
        if (acked) return;
        acked = true;
        this._ackTimer = null;
        this.safeSetState({ isSubmitting: false, submitMsg: 'Sem resposta do servidor.' });
      }, 8000);
    } catch (e) {
      this.safeSetState({ isSubmitting: false, submitMsg: 'Erro ao enviar.' });
    }
  };

  // ---------- render ----------
  render() {
    const {
      user,
      data,
      cardapio,
      showAdicionar,
      showInputsAdicionar,
      showInputEditar,
      showInputsRemover,
      isSubmitting,
      submitMsg,
    } = this.state;

    let inputs = [];
    let titleEnviar = '';

    if (showInputsAdicionar) {
      inputs = [
        { key: 'Nome:', label: 'Nome do Item', nome: 'AdicionarItem', tipoTeclado: 'default' },
        { key: 'Preco:', label: 'Preço', nome: 'AdicionarPreco', tipoTeclado: 'numeric' },
        { key: 'categoria', label: 'Categoria' },
        { key: 'modalidade', label: 'Modalidade', categoria: 'Bebida' },
      ];
      titleEnviar = 'Adicionar';
    } else if (showInputEditar) {
      inputs = [
        { key: 'Nome', label: 'Nome do Item', nome: 'AdicionarItem', tipoTeclado: 'default' },
        { key: 'Novo nome', label: 'Novo Nome do Item', nome: 'AdicionarNovoNome', tipoTeclado: 'default' },
        { key: 'Preco:', label: 'Preço', nome: 'AdicionarPreco', tipoTeclado: 'numeric' },
        { key: 'categoria', label: 'Categoria' },
        { key: 'modalidade', label: 'Modalidade', categoria: 'Bebida' },
      ];
      titleEnviar = 'Editar';
    } else if (showInputsRemover) {
      inputs = [{ key: 'Nome', label: 'Nome do Item', nome: 'AdicionarItem', tipoTeclado: 'default' }];
      titleEnviar = 'Remover';
    }

    return (
      <View style={{ flex: 1, padding: 10, marginBlockEnd: 30 }}>
        <View style={styles.container}>
          <View style={styles.tableHeader}>
            <Text style={styles.headerTitle}>ITEM</Text>
            <TextInput
              style={styles.inputEstoque}
              placeholder="Buscar item..."
              placeholderTextColor="#777"
              selectionColor="#111"
              value={cardapio}
              onChangeText={(txt) => {
                this.safeSetState({ cardapio: txt });
                this.debouncedHeaderSearch(txt);
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={[styles.tableRow, styles.headerRow]}>
            <Text style={[styles.itemText, styles.headerText]}>Item</Text>
            <Text style={[styles.cellheader, styles.headerText]}>Preço</Text>
          </View>
        </View>

        <ScrollView style={{ marginTop: 10, marginBottom: 80 }} keyboardShouldPersistTaps="handled">
          {data &&
            data.map((item, i) => (
              <View key={`row-${i}`} style={styles.tableRow}>
                <Text style={styles.itemText} ellipsizeMode="tail">
                  {item.item}
                </Text>
                <Text style={styles.cell} ellipsizeMode="tail">
                  {item.preco}
                </Text>

                {!!user && user.cargo === 'ADM' && (
                  <Pressable onPress={() => this.openEditFor(item)}>
                    <Text>📝</Text>
                  </Pressable>
                )}
              </View>
            ))}
        </ScrollView>

        {/* MODAL */}
        <Modal
          animationType="fade"
          transparent
          visible={!showAdicionar}
          onRequestClose={() =>
            this.safeSetState({
              showAdicionar: true,
              showInputsAdicionar: false,
              showInputEditar: false,
              showInputsRemover: false,
              opcoes: this.defaultOpcoes,
              sugsModal: [],
              submitMsg: '',
            })
          }
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
          >
            <View style={styles.ModalContainer}>
              {/* Header do modal */}
              <View style={styles.ModalHeader}>
                <TouchableOpacity
                  style={styles.setaVoltar}
                  onPress={() => {
                    if (showInputsAdicionar || showInputEditar || showInputsRemover) {
                      this.safeSetState({
                        showInputsAdicionar: false,
                        showInputEditar: false,
                        showInputsRemover: false,
                        AdicionarItem: '',
                        AdicionarPreco: '',
                        AdicionarNovoNome: '',
                        categoria: '',
                        modalidade: '',
                        opcoes: this.defaultOpcoes,
                        sugsModal: [],
                        submitMsg: '',
                      });
                    } else {
                      this.safeSetState({ showAdicionar: true, submitMsg: '' });
                    }
                  }}
                >
                  <Text style={styles.setaTexto}>{'\u2190'}</Text>
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ModalTitulo}>{titleEnviar} Cardápio</Text>
                </View>
              </View>

              {/* Ações ou Inputs */}
              {!showInputsAdicionar && !showInputEditar && !showInputsRemover ? (
                <View style={styles.ButtonsCardapio}>
                  <TouchableOpacity onPress={() => this.safeSetState({ showInputsAdicionar: true, titleEnv: 'Adicionar', submitMsg: '' })}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#17315c' }}>Adicionar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => this.safeSetState({ showInputEditar: true, titleEnv: 'Editar', submitMsg: '' })}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#17315c' }}>Editar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => this.safeSetState({ showInputsRemover: true, titleEnv: 'Remover', submitMsg: '' })}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#17315c' }}>Remover</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <ScrollView keyboardShouldPersistTaps="handled">
                  {inputs
                    .filter((item) => !item.categoria || item.categoria === this.state.categoria)
                    .map((item, index) => {
                      const isDropdown =
                        item.key === 'categoria' || (item.key === 'modalidade' && this.state.categoria === 'Bebida');

                      return (
                        <View key={`input-${index}`} style={styles.inputGroup}>
                          {/* Campo de texto padrão */}
                          {!isDropdown && (
                            <View>
                              <Text style={styles.inputLabel}>{item.key}</Text>
                              <TextInput
                                style={styles.inputSimples}
                                placeholder={item.label}
                                placeholderTextColor="#999"
                                keyboardType={item.tipoTeclado}
                                value={this.state[item.nome]}
                                onChangeText={(text) => {
                                  if (item.nome === 'AdicionarItem' && this.state.showInputsAdicionar) {
                                    this.safeSetState({ [item.nome]: text.toLowerCase() });
                                    return;
                                  }
                                  if (item.nome === 'AdicionarItem' && (this.state.showInputEditar || this.state.showInputsRemover)) {
                                    this.safeSetState({ [item.nome]: text, AdicionarPreco: '', categoria: '' }, () =>
                                      this.debouncedSearchModal(text),
                                    );
                                    return;
                                  }
                                  this.safeSetState({ [item.nome]: text });
                                }}
                                autoComplete="off"
                                autoCorrect={false}
                                spellCheck={false}
                                textContentType="none"
                              />

                              {/* Sugestões (apenas Editar/Remover -> campo Nome) */}
                              {item.nome === 'AdicionarItem' &&
                                (this.state.showInputEditar || this.state.showInputsRemover) &&
                                !!this.state.AdicionarItem &&
                                !this.state.AdicionarPreco &&
                                !!this.state.sugsModal.length && (
                                  <ScrollView style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled">
                                    {this.state.sugsModal.map((sugestao, idx) => (
                                      <TouchableOpacity
                                        key={`sug-${idx}`}
                                        style={{
                                          padding: 8,
                                          backgroundColor: '#eee',
                                          borderBottomWidth: 1,
                                          borderColor: '#ccc',
                                        }}
                                        onPress={() => {
                                          this.safeSetState(
                                            {
                                              [item.nome]: sugestao.item,
                                              AdicionarPreco: String(sugestao.preco ?? ''),
                                              categoria:
                                                sugestao.categoria_id === 1 ? 'Restante' : sugestao.categoria_id === 2 ? 'Bebida' : 'Porção',
                                              modalidade: sugestao.modalidade || '',
                                              sugsModal: [],
                                            },
                                            () => this.getDados(sugestao),
                                          );
                                        }}
                                      >
                                        <Text>{sugestao.item}</Text>
                                      </TouchableOpacity>
                                    ))}
                                  </ScrollView>
                                )}
                            </View>
                          )}

                          {/* DROPDOWNs de Categoria/Modalidade */}
                          {isDropdown && (
                            <View style={styles.dropdownMock}>
                              <Text style={styles.inputLabel}>{item.label}</Text>
                              <Text style={styles.dropdownText}>Selecionar {item.key}</Text>
                              {(item.key === 'categoria' ? CATEGORIAS : MODALIDADES).map((op, idx) => {
                                const selecionado = this.state[item.key] === op;
                                return (
                                  <TouchableOpacity
                                    key={`opt-${idx}`}
                                    style={[styles.dropdownOption, selecionado && styles.dropdownOptionSelecionado]}
                                    onPress={() => this.handlePickDropdown(item.key, op)}
                                  >
                                    <Text style={selecionado ? styles.dropdownTextoSelecionado : null}>{op}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      );
                    })}

                  {/* Editor de grupos/opções (não aparece em Remover) */}
                  {!showInputsRemover && (
                    <View style={{ padding: 15 }}>
                      {this.state.opcoes.map((grupo, gIdx) => (
                        <View key={`grupo-${gIdx}`} style={styles.optCard}>
                          <Text style={styles.inputLabel}>Nome da Seção</Text>
                          <TextInput
                            style={styles.inputSimples}
                            placeholder="Ex.: Frutas, Complementos..."
                            placeholderTextColor="#999"
                            value={grupo.nome}
                            onChangeText={(t) => this.atualizarNomeGrupo(gIdx, t)}
                          />

                          <Text style={[styles.inputLabel, { marginTop: 10 }]}>Máximo de Seleções</Text>
                          <TextInput
                            style={styles.inputSimples}
                            placeholder="1"
                            placeholderTextColor="#999"
                            keyboardType="numeric"
                            value={String(grupo.max_selected ?? 1)}
                            onChangeText={(t) => this.atualizarMaxSelected(gIdx, t)}
                          />

                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
                            <Text style={styles.inputLabel}>Obrigatório</Text>
                            <Switch value={!!grupo.obrigatorio} onValueChange={(v) => this.setObrigatorio(gIdx, v)} />
                            <Text style={{ marginLeft: 6, color: '#666' }}>{grupo.obrigatorio ? 'obrigatório' : 'opcional'}</Text>
                          </View>

                          <Text style={[styles.inputLabel, { marginTop: 10 }]}>Opções</Text>
                          {grupo.options.map((opt, oIdx) => (
                            <View key={`g${gIdx}-opt${oIdx}`} style={styles.optCardInner}>
                              <View style={styles.optRowTop}>
                                <TextInput
                                  style={[styles.inputSimples, styles.optName]}
                                  placeholder="Nome da opção (ex.: manga)"
                                  placeholderTextColor="#999"
                                  value={opt.nome}
                                  onChangeText={(t) => this.atualizarOptionNome(gIdx, oIdx, t)}
                                />
                                <TouchableOpacity onPress={() => this.removerConteudo(gIdx, oIdx)} style={styles.btnRemover}>
                                  <Text style={styles.btnRemoverText}>Remover</Text>
                                </TouchableOpacity>
                              </View>

                              <View style={styles.optRowBottom}>
                                <TextInput
                                  style={[styles.inputSimples, styles.optExtra]}
                                  placeholder="Extra (ex.: 2)"
                                  placeholderTextColor="#999"
                                  keyboardType="numeric"
                                  value={String(opt.valor_extra ?? 0)}
                                  onChangeText={(t) => this.atualizarOptionExtra(gIdx, oIdx, t)}
                                />
                                <View style={styles.esgotadoWrap}>
                                  <Text style={styles.esgotadoLabel}>Esg.</Text>
                                  <Switch
                                    value={!!opt.esgotado}
                                    onValueChange={(v) => this.atualizarOptionEsgotado(gIdx, oIdx, v)}
                                  />
                                </View>
                              </View>
                            </View>
                          ))}

                          <TouchableOpacity
                            onPress={() => this.adicionarConteudo(gIdx)}
                            style={{
                              marginTop: 8,
                              alignSelf: 'flex-start',
                              backgroundColor: '#007bff',
                              paddingVertical: 6,
                              paddingHorizontal: 12,
                              borderRadius: 5,
                            }}
                          >
                            <Text style={{ color: 'white' }}>+ Nova Opção</Text>
                          </TouchableOpacity>

                          {this.state.opcoes.length > 1 && (
                            <TouchableOpacity
                              onPress={() => this.removerOpcao(gIdx)}
                              style={{
                                marginTop: 10,
                                alignSelf: 'flex-start',
                                backgroundColor: '#ff3b30',
                                paddingVertical: 6,
                                paddingHorizontal: 12,
                                borderRadius: 5,
                              }}
                            >
                              <Text style={{ color: 'white' }}>Remover Seção</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}

                      <TouchableOpacity
                        onPress={this.adicionarOpcao}
                        style={{
                          marginTop: 4,
                          alignSelf: 'flex-start',
                          backgroundColor: '#10b981',
                          paddingVertical: 8,
                          paddingHorizontal: 14,
                          borderRadius: 6,
                        }}
                      >
                        <Text style={{ color: 'white', fontWeight: '600' }}>+ Nova Seção</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <View style={{ height: 20 }} />
                </ScrollView>
              )}

              {/* Rodapé do modal: Enviar */}
              {(showInputsAdicionar || showInputEditar || showInputsRemover) && (
                <TouchableOpacity
                  style={[styles.botaoEnviar, { opacity: isSubmitting || !this.canSubmit(titleEnviar) ? 0.7 : 1 }]}
                  onPress={() => this.enviar(titleEnviar)}
                  disabled={isSubmitting || !this.canSubmit(titleEnviar)}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.textoBotaoEnviar}>{titleEnviar}</Text>
                  )}
                </TouchableOpacity>
              )}

              {!!submitMsg && (
                <Text style={{ textAlign: 'center', color: '#374151', paddingVertical: 8, fontSize: 13 }}>{submitMsg}</Text>
              )}
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {showAdicionar && !!user && user.cargo === 'ADM' && (
          <TouchableOpacity style={styles.buttonAdicionar} onPress={() => this.safeSetState({ showAdicionar: false, submitMsg: '' })}>
            <Text style={styles.buttonTexto}>+</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
}

// ---------- styles ----------
const styles = StyleSheet.create({
  container: {
    marginBottom: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 7,
    backgroundColor: '#e9ecef',
    borderRadius: 8,
    marginBottom: 10,
  },
  headerTitle: {
    fontWeight: 'bold',
    fontSize: 18,
    marginBottom: 8,
  },
  inputEstoque: {
    height: 40,
    width: 160,
    borderColor: 'gray',
    borderWidth: 1,
    marginHorizontal: 5,
    borderRadius: 5,
    flex: 2,
    paddingHorizontal: 10,
    color: '#111',
    backgroundColor: '#fff',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: '#eee',
    paddingVertical: 8,
  },
  headerRow: {
    backgroundColor: '#f2f2f2',
  },
  itemText: {
    fontSize: 18,
    fontWeight: '400',
    flex: 2,
    left: 10,
  },
  cellheader: {
    width: 60,
    fontSize: 18,
    fontWeight: '400',
    textAlign: 'center',
    marginRight: 75,
  },
  cell: {
    width: 40,
    fontSize: 18,
    fontWeight: '400',
    textAlign: 'center',
    marginHorizontal: 60,
  },
  headerText: {
    fontWeight: 'bold',
  },
  ModalContainer: {
    backgroundColor: 'white',
    marginVertical: 40,
    marginHorizontal: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'black',
    flex: 1,
  },
  ModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  setaVoltar: {
    left: 10,
    marginRight: 20,
  },
  setaTexto: {
    fontSize: 30,
    color: '#333',
  },
  ModalTitulo: {
    fontSize: 22,
    fontWeight: 'bold',
    marginLeft: 16,
  },
  ButtonsCardapio: {
    padding: 20,
    justifyContent: 'space-around',
    alignItems: 'center',
    height: 200,
    gap: 14,
  },
  inputGroup: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  inputLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  inputSimples: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    paddingHorizontal: 10,
    borderRadius: 6,
    color: '#111',
    backgroundColor: '#fff',
  },
  dropdownMock: {
    borderWidth: 1,
    borderColor: '#aaa',
    borderRadius: 6,
    padding: 10,
    backgroundColor: '#f1f1f1',
  },
  dropdownText: {
    fontWeight: 'bold',
    marginBottom: 6,
  },
  dropdownOption: {
    paddingVertical: 6,
  },
  dropdownOptionSelecionado: {
    backgroundColor: '#2196F3',
    borderRadius: 6,
  },
  dropdownTextoSelecionado: {
    color: 'white',
    fontWeight: 'bold',
  },
  botaoEnviar: {
    backgroundColor: '#2196F3',
    paddingVertical: 15,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
  },
  textoBotaoEnviar: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },

  // flutuante "+"
  buttonAdicionar: {
    position: 'absolute',
    width: 57,
    height: 57,
    bottom: 20,
    right: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'black',
    borderRadius: 100,
  },
  buttonTexto: {
    fontSize: 40,
    fontWeight: '600',
    paddingBottom: 4.2,
    color: 'white',
  },

  // editor de opções
  optCard: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  optCardInner: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  optRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  optRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optName: {
    flex: 1,
  },
  optExtra: {
    width: 110,
  },
  btnRemover: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#ff3b30',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  btnRemoverText: {
    color: 'white',
    fontWeight: '700',
  },
  esgotadoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
  },
  esgotadoLabel: {
    color: '#666',
    fontSize: 13,
  },
});
