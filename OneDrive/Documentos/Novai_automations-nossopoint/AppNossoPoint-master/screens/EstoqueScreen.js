import React from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  Modal,
  Text,
  StyleSheet,
  TextInput,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Alert,
} from 'react-native';
import { UserContext } from '../UserContext';
import { getSocket } from '../socket';

// ---------- Linha da lista (memoizada) ----------
const Row = React.memo(function Row({
  item,
  index,
  editing,
  onPressRow,
  onInc,
  onDec,
  onChangeQty,
}) {
  return (
    <TouchableOpacity
      activeOpacity={editing ? 0.8 : 1}
      onPress={() => editing && onPressRow(item, index)}
    >
      <View style={styles.tableRow}>
        <Text style={styles.itemText} numberOfLines={1}>
          {item.item}
        </Text>

        <View style={styles.valueColumn}>
          {editing ? (
            <View style={styles.editRow}>
              <TouchableOpacity style={[styles.stepBtn, styles.stepMinus]} onPress={() => onDec(index)}>
                <Text style={styles.stepTxt}>-</Text>
              </TouchableOpacity>

              <TextInput
                style={styles.input}
                value={String(item.quantidade ?? 0)}
                onChangeText={(t) => onChangeQty(t, index)}
                keyboardType="numeric"
                maxLength={6}
                returnKeyType="done"
              />

              <TouchableOpacity style={[styles.stepBtn, styles.stepPlus]} onPress={() => onInc(index)}>
                <Text style={styles.stepTxt}>+</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.valueRowSimples}>
              <Text style={styles.quantidade}>{item.quantidade}</Text>
              <Text style={styles.estoque_ideal}>{item.estoque_ideal}</Text>
              <Text style={styles.diffEstoque}>
                {(parseInt(item.estoque_ideal || 0) || 0) - (parseInt(item.quantidade || 0) || 0)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}, areEqualRow);

function areEqualRow(prev, next) {
  return (
    prev.editing === next.editing &&
    prev.index === next.index &&
    prev.item.item === next.item.item &&
    String(prev.item.quantidade) === String(next.item.quantidade) &&
    String(prev.item.estoque_ideal) === String(next.item.estoque_ideal)
  );
}

export default class EstoqueScreen extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      data: [],
      showEditar: false,
      estoque: '',
      refreshing: false,

      // modal principal (adicionar/editar/remover)
      showAdicionar: true,
      showInputsAdicionar: false,
      showInputEditar: false,
      showInputsRemover: false,
      showDataFiltrado: false,

      AdicionarNovoNome: '',
      AdicionarItem: '',
      AdicionarQuantidade: '',
      AdicionarEstoqueIdeal: '',
      titleEnv: '',
      dataGeralAlterarSug: [],

      // modal de quantidade rápida
      showQtyModal: false,
      selectedItem: null,
      selectedItemIndex: null,
      qtyAction: 'diminuir',
      qtyDelta: '1',
      emAmbos: true,

      // lock contra cliques/duplo envio
      sending: false,
    };

    this.dataAll = []; // fonte da verdade
    this.itensAlteradosMap = new Map();

    this.refreshTimeout = null;
    this.buscaDebounce = null;
    this._mounted = false;
  }

  getCarrinho = () => {
    const { user } = this.context || {};
    return user?.carrinho || '';
  };

  componentDidMount() {
    this._mounted = true;
    this.socket = getSocket();

    // listener estável
    this.socket?.on('respostaEstoque', this.handleRespostaEstoque);

    // 1ª carga
    this.refreshData();
  }

  componentWillUnmount() {
    this._mounted = false;
    if (this.socket) {
      this.socket.off('respostaEstoque', this.handleRespostaEstoque);
    }
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    if (this.buscaDebounce) clearTimeout(this.buscaDebounce);
  }

  // ---------- resposta do backend ----------
  handleRespostaEstoque = (payload) => {
    const lista = payload?.dataEstoque ?? [];
    this.dataAll = Array.isArray(lista) ? lista.slice() : [];
    if (!this._mounted) return;
    this.setState({ data: this.dataAll, refreshing: false });
    this.itensAlteradosMap.clear();
  };

  // ---------- refresh com fallback ----------
  refreshData = () => {
    if (this.state.refreshing) return; // anti-spam
    this.setState({ refreshing: true }, () => {
      const carrinho = this.getCarrinho();
      this.socket?.emit('getEstoque', { emitir: false, carrinho });
      if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
      // fallback de rede
      this.refreshTimeout = setTimeout(() => {
        if (this._mounted) this.setState({ refreshing: false });
      }, 10000);
    });
  };

  // ---------- busca com debounce e normalização ----------
  normalize = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  onChangeBusca = (text) => {
    const raw = String(text || '');
    const q = this.normalize(raw);
    this.setState({ estoque: raw });

    if (this.buscaDebounce) clearTimeout(this.buscaDebounce);
    this.buscaDebounce = setTimeout(() => {
      const base = Array.isArray(this.dataAll) ? this.dataAll : [];
      if (!q) {
        if (this._mounted) this.setState({ data: base });
        return;
      }

      const words = q.split(/\s+/).filter(Boolean);
      const starts = [];
      const allWords = [];
      const includes = [];

      for (let i = 0; i < base.length; i++) {
        const it = base[i];
        const name = this.normalize(it?.item);
        if (!name) continue;

        let matched = false;
        for (const w of words) {
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

        for (const w of words) {
          if (name.includes(w)) {
            includes.push(it);
            break;
          }
        }
      }

      const seen = new Set();
      const ranked = [];
      for (const bucket of [starts, allWords, includes]) {
        for (const it of bucket) {
          const key = it?.item ?? it; // se tiver id estável, use it.id
          if (!seen.has(key)) {
            seen.add(key);
            ranked.push(it);
          }
        }
      }

      if (this._mounted) this.setState({ data: ranked });
    }, 150);
  };

  // ---------- atualizações cirúrgicas ----------
  updateItemByIndex = (updater, idx) => {
    this.setState((prev) => {
      const arr = prev.data.slice();
      const oldItem = arr[idx];
      if (!oldItem) return null;

      const updated = updater(oldItem);
      arr[idx] = updated;

      // espelha em dataAll
      const key = oldItem.item;
      const posAll = this.dataAll.findIndex((x) => x.item === key);
      if (posAll >= 0) this.dataAll[posAll] = updated;

      // marca como alterado
      this.itensAlteradosMap.set(updated.item, updated);

      return { data: arr };
    });
  };

  diminuirQuantidade = (index) => {
    this.updateItemByIndex((old) => {
      const q = Math.max(0, (parseInt(old.quantidade) || 0) - 1);
      return { ...old, quantidade: String(q) };
    }, index);
  };

  aumentarQuantidade = (index) => {
    this.updateItemByIndex((old) => {
      const q = (parseInt(old.quantidade) || 0) + 1;
      return { ...old, quantidade: String(q) };
    }, index);
  };

  alterarQuantidade = (text, index) => {
    const n = parseInt(text, 10);
    const q = Number.isFinite(n) ? Math.max(0, n) : 0;
    this.updateItemByIndex((old) => ({ ...old, quantidade: String(q) }), index);
  };

  // ---------- quantidade rápida ----------
  openQtyModal = (item, index) => {
    this.setState({
      showQtyModal: true,
      selectedItem: item,
      selectedItemIndex: index,
      qtyAction: 'diminuir',
      qtyDelta: '1',
    });
  };

  cancelQtyModal = () => {
    this.setState({
      showQtyModal: false,
      selectedItem: null,
      selectedItemIndex: null,
      qtyAction: 'diminuir',
      qtyDelta: '1',
    });
  };

  confirmQtyModal = () => {
    const { selectedItemIndex, qtyAction, qtyDelta } = this.state;
    if (selectedItemIndex == null) return;
    const delta = Math.max(0, parseInt(qtyDelta, 10) || 0);

    this.updateItemByIndex((old) => {
      const atual = parseInt(old.quantidade, 10) || 0;
      const novo = qtyAction === 'aumentar' ? atual + delta : Math.max(0, atual - delta);
      return { ...old, quantidade: String(novo) };
    }, selectedItemIndex);

    this.cancelQtyModal();
  };

  // ---------- util: lock para envios ----------
  sendWithLock = (fn) => {
    if (this.state.sending) return;
    this.setState({ sending: true }, () => {
      try {
        fn();
      } finally {
        // solta lock mesmo sem ACK
        setTimeout(() => this._mounted && this.setState({ sending: false }), 6000);
      }
    });
  };

  // ---------- envio ----------
  handleConfirmar = () => {
    const { user } = this.context || {};
    const itensAlterados = Array.from(this.itensAlteradosMap.values());
    if (itensAlterados.length === 0) {
      Alert.alert('Nada para enviar', 'Nenhum item foi alterado.');
      return;
    }
    this.sendWithLock(() => {
      this.socket?.emit('atualizar_estoque', {
        itensAlterados,
        username: user?.username,
        token: user?.token,
        carrinho: user?.carrinho,
      });
      this.setState({ showEditar: false });
      this.itensAlteradosMap.clear();
    });
  };

  // ---------- filtro 50% ----------
  filtrar = (flag) => {
    const ativar = flag === 'filtrar';
    this.setState(
      (prev) => ({ showDataFiltrado: !prev.showDataFiltrado }),
      () => {
        if (ativar) {
          const half = this.dataAll.filter(
            (it) => (parseInt(it.quantidade) || 0) < (parseInt(it.estoque_ideal) || 0) * 0.5
          );
          this.setState({ data: half });
        } else {
          this.setState({ data: this.dataAll });
        }
      }
    );
  };

  // ---------- emitir edição/adicionar/remover ----------
  emitEditar = () => {
    const {
      titleEnv,
      AdicionarItem,
      AdicionarNovoNome,
      AdicionarQuantidade,
      AdicionarEstoqueIdeal,
      emAmbos,
    } = this.state;
    const { user } = this.context || {};

    if (!AdicionarItem) {
      Alert.alert('Item não identificado', 'Informe o nome do item.');
      return;
    }

    this.sendWithLock(() => {
      this.socket?.emit('EditingEstoque', {
        tipo: titleEnv, // 'Adicionar' | 'Editar' | 'Remover'
        item: (AdicionarItem || '').toLowerCase(),
        novoNome: (AdicionarNovoNome || '').toLowerCase(),
        quantidade: AdicionarQuantidade, // número (string ok)
        estoqueIdeal: AdicionarEstoqueIdeal, // número (string ok)
        estoque: 'estoque',
        username: user?.username,
        token: user?.token,
        mudar_os_dois: emAmbos,
        carrinho: user?.carrinho,
      });

      this.setState({
        AdicionarItem: '',
        AdicionarNovoNome: '',
        AdicionarEstoqueIdeal: '',
        AdicionarQuantidade: '',
      });
    });
  };

  // ---------- render item ----------
  renderItem = ({ item, index }) => (
    <Row
      item={item}
      index={index}
      editing={this.state.showEditar}
      onPressRow={this.openQtyModal}
      onInc={this.aumentarQuantidade}
      onDec={this.diminuirQuantidade}
      onChangeQty={this.alterarQuantidade}
    />
  );

  render() {
    const {
      refreshing,
      showAdicionar,
      showInputsAdicionar,
      showInputEditar,
      showInputsRemover,
      titleEnv,
      estoque,
      sending,
    } = this.state;

    // inputs do modal principal
    let inputs = [];
    let titleEnviar = '';
    if (showInputsAdicionar) {
      inputs = [
        { key: 'nome', label: 'Nome do Item', nome: 'AdicionarItem', tipoTeclado: 'default', isText: true },
        { key: 'quantidade', label: 'Quantidade', nome: 'AdicionarQuantidade', tipoTeclado: 'numeric', isText: false },
        { key: 'EstoqueIdeal', label: 'Estoque Ideal', nome: 'AdicionarEstoqueIdeal', tipoTeclado: 'numeric', isText: false },
      ];
      titleEnviar = 'Adicionar';
    } else if (showInputEditar) {
      inputs = [
        { key: 'nome', label: 'Nome do Item', nome: 'AdicionarItem', tipoTeclado: 'default', isText: true },
        { key: 'novo', label: 'Novo Nome do Item', nome: 'AdicionarNovoNome', tipoTeclado: 'default', isText: true },
        { key: 'EstoqueIdeal', label: 'Estoque Ideal', nome: 'AdicionarEstoqueIdeal', tipoTeclado: 'numeric', isText: false },
      ];
      titleEnviar = 'Editar';
    } else if (showInputsRemover) {
      inputs = [{ key: 'nome', label: 'Nome do Item', nome: 'AdicionarItem', tipoTeclado: 'default', isText: true }];
      titleEnviar = 'Remover';
    }

    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 80}
      >
        {/* Header */}
        <View style={styles.tableHeader}>
          <View style={styles.headerSearchBox}>
            <Text style={styles.label}>Buscar item:</Text>
            <TextInput
              style={styles.inputEstoque}
              placeholder="Digite o nome do item..."
              placeholderTextColor="#999"
              onChangeText={this.onChangeBusca}
              value={estoque}
              returnKeyType="search"
            />
          </View>

          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => this.filtrar(this.state.showDataFiltrado ? 'desfiltrar' : 'filtrar')}
          >
            <Text style={styles.filterButtonText}>
              {this.state.showDataFiltrado ? 'Desfiltrar' : 'Filtrar'}
            </Text>
          </TouchableOpacity>

          {!this.state.showEditar ? (
            <TouchableOpacity
              style={[styles.actionBtn, sending && styles.btnDisabled]}
              onPress={() => !sending && this.setState({ showEditar: true })}
              disabled={sending}
            >
              <Text style={styles.actionBtnText}>{sending ? 'Aguarde…' : 'Editar'}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnCancel, sending && styles.btnDisabled]}
                onPress={() =>
                  !sending &&
                  this.setState({ data: this.dataAll, showEditar: false }, () => {
                    this.itensAlteradosMap.clear();
                    this.refreshData();
                  })
                }
                disabled={sending}
              >
                <Text style={styles.actionBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnConfirm, sending && styles.btnDisabled]}
                onPress={this.handleConfirmar}
                disabled={sending}
              >
                <Text style={styles.actionBtnText}>{sending ? 'Enviando…' : 'Confirmar'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Lista */}
        <View style={{ flex: 1, marginBottom: 80 }}>
          <FlatList
            data={this.state.data}
            keyExtractor={(it, idx) => String(it?.id ?? it?.item ?? idx)}
            renderItem={this.renderItem}
            extraData={{ editing: this.state.showEditar }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={this.refreshData} />}
            windowSize={7}
            maxToRenderPerBatch={14}
            initialNumToRender={12}
            removeClippedSubviews
            ListEmptyComponent={
              !refreshing ? (
                <Text style={{ textAlign: 'center', color: '#667' }}>Nenhum item encontrado.</Text>
              ) : null
            }
          />
        </View>

        {/* Modal principal (Adicionar/Editar/Remover) */}
        <Modal
          animationType="fade"
          transparent
          visible={!showAdicionar}
          onRequestClose={() =>
            this.setState({
              showAdicionar: true,
              showInputsAdicionar: false,
              showInputEditar: false,
              showInputsRemover: false,
            })
          }
        >
          <View style={styles.ModalContainer}>
            <View style={styles.ModalHeader}>
              <TouchableOpacity
                style={styles.setaVoltar}
                onPress={() => {
                  if (showInputsAdicionar || showInputEditar || showInputsRemover) {
                    this.setState({
                      showInputsAdicionar: false,
                      showInputEditar: false,
                      showInputsRemover: false,
                    });
                  } else {
                    this.setState({ showAdicionar: true });
                  }
                }}
              >
                <Text style={styles.setaTexto}>{'\u2190'}</Text>
              </TouchableOpacity>

              <View style={{ flex: 1 }}>
                <Text style={styles.ModalTitulo}>{(titleEnviar || 'Gerenciar') + ' Estoque Carrinho'}</Text>
              </View>
            </View>

            {!showInputsAdicionar && !showInputEditar && !showInputsRemover ? (
              <View style={styles.ButtonsCardapio}>
                <TouchableOpacity
                  style={[styles.actionBtn, { alignSelf: 'center' }]}
                  onPress={() => this.setState({ showInputsAdicionar: true, titleEnv: 'Adicionar' })}
                >
                  <Text style={styles.actionBtnText}>Adicionar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { alignSelf: 'center' }]}
                  onPress={() => this.setState({ showInputEditar: true, titleEnv: 'Editar' })}
                >
                  <Text style={styles.actionBtnText}>Editar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnCancel, { alignSelf: 'center' }]}
                  onPress={() => this.setState({ showInputsRemover: true, titleEnv: 'Remover' })}
                >
                  <Text style={styles.actionBtnText}>Remover</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={inputs}
                keyExtractor={(it) => it.key}
                ListFooterComponent={<View style={{ height: 20 }} />}
                renderItem={({ item }) => {
                  const value = this.state[item.nome];

                  const onChange = (text) => {
                    const raw = String(text || '');
                    const lowerOrRaw = item.isText ? raw.toLowerCase() : raw;
                    this.setState({ [item.nome]: lowerOrRaw });

                    // auto-sugestão (Editar/Remover)
                    if (item.nome === 'AdicionarItem' && (showInputEditar || showInputsRemover)) {
                      const q = this.normalize(lowerOrRaw);
                      if (!q) {
                        this.setState({ dataGeralAlterarSug: [] });
                        return;
                      }
                      const base = Array.isArray(this.dataAll) ? this.dataAll : [];
                      const words = q.split(/\s+/).filter(Boolean);

                      const starts = [];
                      const allWords = [];
                      const includes = [];

                      for (let i = 0; i < base.length; i++) {
                        const it = base[i];
                        const name = this.normalize(it?.item);
                        if (!name) continue;

                        let matched = false;
                        for (const w of words) {
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

                        for (const w of words) {
                          if (name.includes(w)) {
                            includes.push(it);
                            break;
                          }
                        }
                      }

                      const seen = new Set();
                      const ranked = [];
                      for (const bucket of [starts, allWords, includes]) {
                        for (const it of bucket) {
                          const key = it?.item ?? it;
                          if (!seen.has(key)) {
                            seen.add(key);
                            ranked.push(it);
                          }
                        }
                      }

                      this.setState({ dataGeralAlterarSug: ranked.slice(0, 50) });
                    }
                  };

                  return (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>{item.label}</Text>
                      <TextInput
                        style={styles.inputSimples}
                        placeholder={item.label}
                        placeholderTextColor="#999"
                        keyboardType={item.tipoTeclado}
                        value={value}
                        onChangeText={onChange}
                      />

                      {item.nome === 'AdicionarItem' &&
                        (showInputEditar || showInputsRemover) &&
                        this.state.AdicionarItem &&
                        !this.state.AdicionarEstoqueIdeal && (
                          <FlatList
                            style={{
                              maxHeight: 180,
                              marginTop: 8,
                              borderWidth: 1,
                              borderColor: '#ddd',
                              borderRadius: 6,
                            }}
                            data={this.state.dataGeralAlterarSug || []}
                            keyExtractor={(sug, i) => String(sug?.item ?? i)}
                            keyboardShouldPersistTaps="handled"
                            renderItem={({ item: sug }) => (
                              <TouchableOpacity
                                style={{
                                  padding: 10,
                                  backgroundColor: '#fff',
                                  borderBottomWidth: 1,
                                  borderColor: '#eee',
                                }}
                                onPress={() =>
                                  this.setState({
                                    AdicionarItem: (sug.item || '').toLowerCase(),
                                    AdicionarEstoqueIdeal: String(sug.estoque_ideal ?? ''),
                                    dataGeralAlterarSug: [],
                                  })
                                }
                              >
                                <Text>{sug.item}</Text>
                              </TouchableOpacity>
                            )}
                          />
                        )}
                    </View>
                  );
                }}
              />
            )}

            {(showInputsAdicionar || showInputEditar || showInputsRemover) && (
              <>
                <View style={styles.ambosFooter}>
                  <View style={styles.ambosRow}>
                    <Switch
                      value={this.state.emAmbos}
                      onValueChange={(v) => this.setState({ emAmbos: v })}
                    />
                    <Text style={styles.ambosLabel}>{`${titleEnviar || 'Ação'} em ambos estoque`}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.botaoEnviar, sending && styles.btnDisabled]}
                  onPress={() => !sending && this.setState({ titleEnv: titleEnviar }, this.emitEditar)}
                  disabled={sending}
                >
                  <Text style={styles.textoBotaoEnviar}>
                    {sending ? 'Enviando…' : titleEnviar}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Modal>

        {/* Modal quantidade rápida */}
        <Modal
          visible={this.state.showQtyModal}
          transparent
          animationType="slide"
          onRequestClose={this.cancelQtyModal}
        >
          <View style={styles.qtyModalOverlay}>
            <View style={styles.qtyModalBox}>
              <Text style={styles.qtyModalTitle}>
                {this.state.selectedItem?.item ?? 'Item'}
              </Text>

              <View style={{ marginBottom: 10 }}>
                <Text style={styles.qtyInfoText}>
                  Atual: {this.state.selectedItem?.quantidade}
                  {this.state.selectedItem?.estoque_ideal != null
                    ? `   |   Ideal: ${this.state.selectedItem?.estoque_ideal}`
                    : ''}
                </Text>
              </View>

              <View style={styles.qtyToggleRow}>
                <TouchableOpacity
                  style={[
                    styles.qtyToggleBtn,
                    this.state.qtyAction === 'aumentar' && styles.qtyToggleBtnActive,
                  ]}
                  onPress={() => this.setState({ qtyAction: 'aumentar' })}
                >
                  <Text
                    style={[
                      styles.qtyToggleText,
                      this.state.qtyAction === 'aumentar' && styles.qtyToggleTextActive,
                    ]}
                  >
                    Aumentar
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.qtyToggleBtn,
                    this.state.qtyAction === 'diminuir' && styles.qtyToggleBtnActive,
                  ]}
                  onPress={() => this.setState({ qtyAction: 'diminuir' })}
                >
                  <Text
                    style={[
                      styles.qtyToggleText,
                      this.state.qtyAction === 'diminuir' && styles.qtyToggleTextActive,
                    ]}
                  >
                    Diminuir
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.qtyInputRow}>
                <Text style={styles.qtyInputLabel}>Quantidade:</Text>
                <TextInput
                  style={styles.qtyInput}
                  keyboardType="numeric"
                  value={this.state.qtyDelta}
                  onChangeText={(t) => this.setState({ qtyDelta: t })}
                  placeholder="Ex.: 3"
                  placeholderTextColor="#999"
                  maxLength={6}
                />
              </View>

              <View style={styles.qtyActions}>
                <TouchableOpacity style={[styles.qtyBtn, styles.qtyBtnCancel]} onPress={this.cancelQtyModal}>
                  <Text style={styles.qtyBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.qtyBtn, styles.qtyBtnOk]} onPress={this.confirmQtyModal}>
                  <Text style={styles.qtyBtnText}>OK</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* FAB */}
        {showAdicionar && (
          <TouchableOpacity
            style={[styles.buttonAdicionar, sending && styles.btnDisabled]}
            onPress={() => !sending && this.setState({ showAdicionar: false })}
            activeOpacity={0.85}
            disabled={sending}
          >
            <Text style={styles.buttonTexto}>+</Text>
          </TouchableOpacity>
        )}
      </KeyboardAvoidingView>
    );
  }
}

// ----------------- estilos -----------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f7fafc',
    paddingBottom: 50, // compat RN (evita marginBlockEnd)
  },

  tableHeader: {
    backgroundColor: '#17315c',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 10,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    justifyContent: 'space-between',
  },

  headerSearchBox: { flex: 2.2, marginRight: 8 },
  label: { color: '#fff', marginBottom: 6, fontWeight: '600' },

  inputEstoque: {
    height: 38,
    backgroundColor: '#fff',
    borderColor: '#d2d6de',
    borderWidth: 1.2,
    borderRadius: 8,
    paddingHorizontal: 9,
    fontSize: 15,
  },

  filterButton: {
    backgroundColor: '#ffc43d',
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 7,
    elevation: 1,
    marginHorizontal: 2,
  },
  filterButtonText: {
    fontWeight: 'bold',
    color: '#573400',
    fontSize: 13,
    letterSpacing: 0.7,
  },

  actionButtons: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 7,
    marginLeft: 6,
    backgroundColor: '#35a7ff',
    elevation: 1,
  },
  actionBtnCancel: { backgroundColor: '#e34242' },
  actionBtnConfirm: { backgroundColor: '#3bb273' },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 12.5, letterSpacing: 0.5 },
  btnDisabled: { opacity: 0.6 },

  // linha da lista
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginVertical: 5,
    elevation: 1,
    shadowColor: '#5c5c5c',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
  },
  itemText: { flex: 2, fontSize: 17, fontWeight: '600', color: '#34445d', marginRight: 8 },

  valueColumn: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  valueRowSimples: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },

  quantidade: { fontSize: 18, fontWeight: '700', color: '#1f5eff', textAlign: 'center' },
  estoque_ideal: { fontSize: 18, fontWeight: '600', color: '#34445d', textAlign: 'center' },
  diffEstoque: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', color: '#10B981' },

  editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  input: {
    width: 56,
    height: 40,
    textAlign: 'center',
    borderColor: '#bbb',
    borderWidth: 1,
    borderRadius: 7,
    backgroundColor: '#f7fafd',
    fontSize: 18,
  },

  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  stepMinus: { backgroundColor: '#ef4444' },
  stepPlus: { backgroundColor: '#17315c' },
  stepTxt: { color: '#fff', fontSize: 18, fontWeight: '800' },

  // modal principal
  ModalHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#ccc' },
  setaTexto: { fontSize: 30, color: '#333' },
  ModalTitulo: { fontSize: 22, fontWeight: 'bold', marginLeft: 16 },
  ButtonsCardapio: { padding: 20, justifyContent: 'space-around', height: 200 },

  inputGroup: { paddingHorizontal: 20, paddingVertical: 10 },
  inputLabel: { fontSize: 14, marginBottom: 4 },
  inputSimples: { height: 40, borderColor: 'gray', borderWidth: 1, paddingHorizontal: 10, borderRadius: 6 },

  botaoEnviar: {
    backgroundColor: '#2196F3',
    paddingVertical: 15,
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
  },
  textoBotaoEnviar: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

  setaVoltar: { left: 10, marginRight: 20 },
  ModalContainer: {
    backgroundColor: 'white',
    marginVertical: 40,
    marginHorizontal: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'black',
    flex: 1,
  },

  // botão flutuante
  buttonAdicionar: {
    position: 'absolute',
    width: 57,
    height: 57,
    bottom: 20,
    right: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    borderRadius: 100,
    elevation: 3,
  },
  buttonTexto: { fontSize: 40, paddingBottom: 4.2, color: 'white', fontWeight: '800' },

  // modal quantidade rápida
  qtyModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  qtyModalBox: { width: '88%', backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  qtyModalTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 12, color: '#222' },
  qtyInfoText: { textAlign: 'center', color: '#444' },
  qtyToggleRow: { flexDirection: 'row', marginTop: 12 },
  qtyToggleBtn: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginHorizontal: 5 },
  qtyToggleBtnActive: { backgroundColor: '#17315c', borderColor: '#17315c' },
  qtyToggleText: { color: '#333', fontWeight: '600' },
  qtyToggleTextActive: { color: '#fff' },
  qtyInputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  qtyInputLabel: { width: 100, fontSize: 15, color: '#333' },
  qtyInput: { flex: 1, height: 42, borderWidth: 1, borderColor: '#bbb', borderRadius: 8, paddingHorizontal: 10, backgroundColor: '#f7fafd', fontSize: 16 },
  qtyActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  qtyBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginHorizontal: 4 },
  qtyBtnCancel: { backgroundColor: '#6c757d' },
  qtyBtnOk: { backgroundColor: '#3bb273' },
  qtyBtnText: { color: '#fff', fontWeight: '700' },

  // ambos
  ambosFooter: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  ambosRow: { flexDirection: 'row', alignItems: 'center' },
  ambosLabel: { fontSize: 14.5, color: '#2c3a4b', fontWeight: '600', textTransform: 'capitalize', marginLeft: 10 },
});
