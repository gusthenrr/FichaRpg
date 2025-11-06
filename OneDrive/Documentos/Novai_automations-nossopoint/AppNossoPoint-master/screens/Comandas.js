import React from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import debounce from 'lodash.debounce';
import { UserContext } from '../UserContext';
import { getSocket } from '../socket';

export default class VerComandas extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      // busca
      comandas: '',
      // dados
      dataGeralAberto: [],
      dataGeralFechado: [],
      dataAberto: [],
      dataFechado: [],
      // ux
      refreshing: false,
      isConnected: true,
      submitMsg: '',
      username: '',
      // bloqueios/estado de ação
      rowBusyComandas: new Set(), // evita clique duplo por comanda
      openingKey: null,           // comanda em abertura (mostra spinner)
    };

    this.socket = null;

    // timers/flags
    this._isMounted = false;
    this.refreshTimeout = null;
    this.precoTimeout = null;
    this._netinfoUnsub = null;
    this._pendingPrecoHandler = null;

    // debounce para busca
    this.debouncedSearch = debounce(this.applySearch, 180);
  }

  getCarrinho = () => {
    const { user } = this.context || {};
    return user?.carrinho || '';
  };

  // ---------- utils ----------
  safeSetState = (updater, cb) => {
    if (!this._isMounted) return;
    this.setState(updater, cb);
  };

  normalize = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  // ---------- lifecycle ----------
  async componentDidMount() {
    this._isMounted = true;

    const { user } = this.context || {};
    this.safeSetState({ username: user?.username || '' });

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
      // listener com ref estável pra poder remover
      this.socket.on('respostaComandas', this.handleRespostaComandas);
    }

    // primeira carga
    this.emitGetComandas();
  }

  componentWillUnmount() {
    this._isMounted = false;

    if (this._netinfoUnsub) {
      this._netinfoUnsub();
      this._netinfoUnsub = null;
    }
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
    if (this.precoTimeout) {
      clearTimeout(this.precoTimeout);
      this.precoTimeout = null;
    }
    if (this.debouncedSearch?.cancel) this.debouncedSearch.cancel();

    if (this.socket) {
      this.socket.off('respostaComandas', this.handleRespostaComandas);
      if (this._pendingPrecoHandler) {
        this.socket.off('preco', this._pendingPrecoHandler);
        this._pendingPrecoHandler = null;
      }
    }
  }

  // ---------- socket handlers ----------
  handleRespostaComandas = (dados) => {
    this.safeSetState({
      dataGeralAberto: dados?.dados_comandaAberta ?? [],
      dataGeralFechado: dados?.dados_comandaFechada ?? [],
      dataAberto: dados?.dados_comandaAberta ?? [],
      dataFechado: dados?.dados_comandaFechada ?? [],
      refreshing: false,
      submitMsg: '',
    });
  };

  // ---------- socket emits ----------
  emitGetComandas = () => {
    if (!this.state.isConnected) {
      return this.safeSetState({ submitMsg: 'Sem internet.' });
    }
    if (!this.socket || !this.socket.connected) {
      return this.safeSetState({ submitMsg: 'Sem conexão com o servidor.' });
    }
    const carrinho = this.getCarrinho();
    this.socket.emit('getComandas', { emitir: false, carrinho });
  };

  // ---------- refresh ----------
  refreshData = () => {
    if (!this.state.isConnected || !this.socket?.connected) {
      this.safeSetState({ submitMsg: 'Sem conexão.', refreshing: false });
      return;
    }
    this.safeSetState({ refreshing: true, submitMsg: '' }, () => {
      this.emitGetComandas();
      if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
      // fallback p/ não travar o spinner se o backend não responder
      this.refreshTimeout = setTimeout(() => {
        this.safeSetState({ refreshing: false });
      }, 10000);
    });
  };

  // ---------- abrir comanda ----------
  getCardapio = (item, ordem) => {
    const key = String(item?.comanda || '').trim();
    if (!key) return;

    // evita clique duplo
    if (this.state.rowBusyComandas.has(key)) return;

    // guarda estado da linha ocupada
    this.safeSetState((prev) => {
      const set = new Set(prev.rowBusyComandas);
      set.add(key);
      return { rowBusyComandas: set, openingKey: key, submitMsg: '' };
    });

    // garante conexão
    if (!this.state.isConnected || !this.socket?.connected) {
      this.releaseRowBusy(key);
      return this.safeSetState({ submitMsg: 'Sem conexão.' });
    }

    // remove handler pendente anterior (se existir)
    if (this._pendingPrecoHandler) {
      this.socket.off('preco', this._pendingPrecoHandler);
      this._pendingPrecoHandler = null;
    }

    // define handler para o preço
    this._pendingPrecoHandler = (data) => {
      // limpa timeout e busy
      if (this.precoTimeout) {
        clearTimeout(this.precoTimeout);
        this.precoTimeout = null;
      }
      this.releaseRowBusy(key);

      const { username } = this.state;
      try {
        this.props.navigation.navigate('Comanda', {
          data: data?.dados,
          fcomanda: item.comanda,
          preco: data?.preco_a_pagar,
          preco_total: data?.preco_total,
          preco_pago: data?.preco_pago,
          desconto: data?.desconto,
          username,
          nomes: data?.nomes,
          ordem,
        });
      } catch {
        // navegação opcional — se falhar, apenas reseta input
      }
      this.safeSetState({ fcomanda: '' });
      // este handler é "once": remove após disparar
      if (this._pendingPrecoHandler) {
        this.socket?.off('preco', this._pendingPrecoHandler);
        this._pendingPrecoHandler = null;
      }
    };

    // registra como "once" manual (off após disparar)
    this.socket.on('preco', this._pendingPrecoHandler);

    // timeout de segurança: se o backend não responder
    this.precoTimeout = setTimeout(() => {
      this.releaseRowBusy(key);
      this.safeSetState({ submitMsg: 'Sem resposta do servidor.' });
      if (this._pendingPrecoHandler) {
        this.socket?.off('preco', this._pendingPrecoHandler);
        this._pendingPrecoHandler = null;
      }
    }, 9000);

    // emite solicitação
    try {
      const carrinho = this.getCarrinho();
      this.socket.emit('get_cardapio', { fcomanda: item.comanda, ordem, carrinho });
    } catch {
      this.releaseRowBusy(key);
      this.safeSetState({ submitMsg: 'Erro ao solicitar dados da comanda.' });
    }
  };

  releaseRowBusy = (key) => {
    this.safeSetState((prev) => {
      const set = new Set(prev.rowBusyComandas);
      set.delete(key);
      const openingKey = prev.openingKey === key ? null : prev.openingKey;
      return { rowBusyComandas: set, openingKey };
    });
  };

  // ---------- busca ----------
  searchcomanda = (text) => {
    this.safeSetState({ comandas: text }, () => {
      this.debouncedSearch(text);
    });
  };

  applySearch = (q) => {
    const qN = this.normalize(q);
    const baseOpen = Array.isArray(this.state.dataGeralAberto) ? this.state.dataGeralAberto : [];
    const baseClosed = Array.isArray(this.state.dataGeralFechado) ? this.state.dataGeralFechado : [];

    if (!qN) {
      this.safeSetState({
        dataAberto: baseOpen,
        dataFechado: baseClosed,
      });
      return;
    }

    const startsWith = (s, t) => this.normalize(s).startsWith(t);
    const data_filtradoAberto = baseOpen.filter((it) => startsWith(it?.comanda || '', qN));
    const data_filtradoFechado = baseClosed.filter((it) => startsWith(it?.comanda || '', qN));

    this.safeSetState({
      dataAberto: data_filtradoAberto,
      dataFechado: data_filtradoFechado,
    });
  };

  // ---------- render ----------
  render() {
    const { dataAberto, dataFechado, refreshing, openingKey, isConnected, submitMsg } = this.state;

    return (
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={this.refreshData} />}
        keyboardShouldPersistTaps="handled"
      >
        {!isConnected && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>Sem internet</Text>
          </View>
        )}

        <View style={styles.tableHeader}>
          <TextInput
            style={styles.inputcomanda}
            onChangeText={this.searchcomanda}
            value={this.state.comandas}
            placeholder="Pesquisar comanda..."
            placeholderTextColor="#999"
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Comandas Abertas</Text>
          {dataAberto?.length > 0 ? (
            dataAberto.map((item, idx) => {
              const key = String(item?.comanda || '');
              const busy = this.state.rowBusyComandas.has(key);
              return (
                <TouchableOpacity
                  key={`open-${key}-${idx}`}
                  onPress={() => !busy && this.getCardapio(item, 0)}
                  style={[styles.comandaButton, busy && styles.btnDisabled]}
                  activeOpacity={0.85}
                  disabled={busy}
                >
                  <View style={styles.rowBetween}>
                    <Text style={styles.comandaText}>Comanda: {key}</Text>
                    {openingKey === key && <ActivityIndicator size="small" color="#fff" />}
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <Text style={{ color: '#666' }}>Nenhuma comanda aberta.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Comandas Fechadas</Text>
          {dataFechado?.length > 0 ? (
            dataFechado.map((item, idx) => {
              const key = String(item?.comanda || '');
              const busy = this.state.rowBusyComandas.has(key);
              const ordem = item?.ordem ?? 0;
              return (
                <TouchableOpacity
                  key={`closed-${key}-${idx}`}
                  onPress={() => !busy && this.getCardapio(item, ordem)}
                  style={[styles.comandaButtonClosed, busy && styles.btnDisabled]}
                  activeOpacity={0.85}
                  disabled={busy}
                >
                  <View style={styles.rowBetween}>
                    <Text style={styles.comandaText}>Comanda: {key}</Text>
                    {openingKey === key && <ActivityIndicator size="small" color="#fff" />}
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <Text style={{ color: '#666' }}>Nenhuma comanda fechada.</Text>
          )}
        </View>

        {!!submitMsg && <Text style={styles.feedback}>{submitMsg}</Text>}
      </ScrollView>
    );
  }
}

// ---------- styles ----------
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: '#F5F5F5',
  },
  offlineBanner: {
    backgroundColor: '#ef4444',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  offlineText: { color: '#fff', fontWeight: '700' },

  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 15,
    backgroundColor: '#f1f3f5',
    borderRadius: 12,
    marginBottom: 10,
    width: '95%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 5,
    alignSelf: 'center',
  },
  inputcomanda: {
    height: 45,
    borderColor: '#ced4da',
    borderWidth: 1,
    paddingHorizontal: 15,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    flex: 1,
    fontSize: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    outlineStyle: 'none',
  },

  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: '#333' },

  comandaButton: {
    backgroundColor: '#00BFFF',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  comandaButtonClosed: {
    backgroundColor: '#D32F2F',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  comandaText: { fontSize: 16, color: '#FFF', textAlign: 'left' },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  btnDisabled: { opacity: 0.65 },

  feedback: { textAlign: 'center', color: '#374151', fontSize: 13, marginTop: 8 },
});
