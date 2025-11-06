import React from 'react';
import {
  FlatList,
  View,
  StyleSheet,
  Text,
  RefreshControl,
  Button,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Picker } from '@react-native-picker/picker';
import { BLEPrinter } from 'react-native-thermal-receipt-printer';
import { askBtPermissions } from '../permissions';
import { PrinterService } from '../PrinterService';
import { UserContext } from '../UserContext';
import { getSocket } from '../socket';

export default class ChoseUser extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      data: [],
      refreshing: false,

      // modal edição
      showModal: false,
      usuarioSelected: '',
      cargoUsuarioSelected: '',
      senhaUsuarioSelected: '',
      idUsuarioSelected: '',
      editCargo: '',

      // catálogos
      cargos: ['Colaborador', 'ADM', 'Entregador', 'Cozinha'],

      // robustez/UX
      isConnected: true,
      submitMsg: '',
      isSubmitting: false,       // evita clique duplo no modal
      rowBusyIds: new Set(),     // bloqueio por linha p/ Liberar/Bloquear
      bleListing: false,
      bleSelecting: false,
      blePrinting: false,
    };

    this.socket = null;

    // flags/timers
    this._isMounted = false;
    this._netinfoUnsub = null;
    this._refreshTimeout = null;
    this._ackTimer = null;
  }

  getCarrinho = () => {
    const { user } = this.context || {};
    return user?.carrinho || '';
  };

  // ===== util =====
  safeSetState = (updater, cb) => {
    if (!this._isMounted) return;
    this.setState(updater, cb);
  };

  emitWithAck = (event, payload, timeoutMs = 7000) =>
    new Promise((resolve) => {
      if (!this.socket) return resolve({ ok: false, message: 'Sem socket' });
      let settled = false;
      const done = (resp) => {
        if (settled) return;
        settled = true;
        if (this._ackTimer) {
          clearTimeout(this._ackTimer);
          this._ackTimer = null;
        }
        resolve(resp || { ok: true });
      };
      try {
        const carrinho = this.getCarrinho();
        const finalPayload =
          payload && typeof payload === 'object'
            ? { ...payload, carrinho }
            : { carrinho };
        this.socket.emit(event, finalPayload, done);
        this._ackTimer = setTimeout(() => done({ ok: false, message: 'Sem resposta do servidor' }), timeoutMs);
      } catch (e) {
        done({ ok: false, message: 'Erro ao emitir' });
      }
    });

  // ===== lifecycle =====
  async componentDidMount() {
    this._isMounted = true;

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
      this.socket.on('usuarios', this.handleUsuarios);
    }

    // primeira carga
    this.fetchUsers();
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
    if (this._ackTimer) {
      clearTimeout(this._ackTimer);
      this._ackTimer = null;
    }
    if (this.socket) {
      this.socket.off('usuarios', this.handleUsuarios);
    }
  }

  // ===== socket handlers =====
  handleUsuarios = (data) => {
    const users = Array.isArray(data?.users) ? data.users : [];
    this.safeSetState({ data: users, refreshing: false });
  };

  // ===== actions =====
  fetchUsers = async () => {
    // guarda rede/socket
    if (!this.state.isConnected) {
      this.safeSetState({ submitMsg: 'Sem internet.' });
      return;
    }
    if (!this.socket || !this.socket.connected) {
      this.safeSetState({ submitMsg: 'Sem conexão com o servidor.' });
      return;
    }

    this.safeSetState({ refreshing: true, submitMsg: '' }, () => {
      const carrinho = this.getCarrinho();
      this.socket.emit('users', { emitir: false, carrinho });
      // fallback para não travar refresh
      if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
      this._refreshTimeout = setTimeout(() => this.safeSetState({ refreshing: false }), 7000);
    });
  };

  setRowBusy = (id, busy) => {
    this.safeSetState((prev) => {
      const set = new Set(prev.rowBusyIds);
      if (busy) set.add(id);
      else set.delete(id);
      return { rowBusyIds: set };
    });
  };

  Liberar = async (id, numero) => {
    if (!this.state.isConnected || !this.socket?.connected) {
      return this.safeSetState({ submitMsg: 'Sem conexão.' });
    }
    if (this.state.rowBusyIds.has(id)) return; // evita clique duplo
    this.setRowBusy(id, true);

    const resp = await this.emitWithAck('permitir', { id, numero });
    if (!resp?.ok) {
      this.safeSetState({ submitMsg: resp?.message || 'Falha ao atualizar.' });
    } else {
      this.safeSetState({ submitMsg: 'Atualizado.' });
      this.fetchUsers();
    }

    setTimeout(() => this.setRowBusy(id, false), 700);
  };

  handleEditCargo = async () => {
    const { cargoUsuarioSelected, usuarioSelected, isSubmitting, isConnected } = this.state;
    if (isSubmitting) return;
    if (!usuarioSelected) return;
    if (!isConnected || !this.socket?.connected) {
      return this.safeSetState({ submitMsg: 'Sem conexão.' });
    }

    this.safeSetState({ isSubmitting: true, submitMsg: 'Atualizando cargo...' });
    const resp = await this.emitWithAck('editCargo', {
      usuario: usuarioSelected,
      cargo: cargoUsuarioSelected,
    });

    if (!resp?.ok) {
      this.safeSetState({ submitMsg: resp?.message || 'Não foi possível atualizar o cargo.' });
    } else {
      this.safeSetState({ submitMsg: 'Cargo atualizado!' });
      this.fetchUsers();
    }
    this.safeSetState({ isSubmitting: false });
  };

  Remover = async () => {
    const { idUsuarioSelected, isSubmitting, isConnected } = this.state;
    if (isSubmitting) return;
    if (!idUsuarioSelected) return;
    if (!isConnected || !this.socket?.connected) {
      return this.safeSetState({ submitMsg: 'Sem conexão.' });
    }

    this.safeSetState({ isSubmitting: true, submitMsg: 'Removendo usuário...' });
    const resp = await this.emitWithAck('Delete_user', { id: idUsuarioSelected });

    if (!resp?.ok) {
      this.safeSetState({ submitMsg: resp?.message || 'Não foi possível remover.' });
    } else {
      this.safeSetState({
        submitMsg: 'Usuário removido.',
        showModal: false,
        usuarioSelected: '',
        cargoUsuarioSelected: '',
        senhaUsuarioSelected: '',
        idUsuarioSelected: '',
      });
      this.fetchUsers();
    }
    this.safeSetState({ isSubmitting: false });
  };

  // ===== BT helpers =====
  listBtDevices = async () => {
    if (this.state.bleListing) return;
    this.safeSetState({ bleListing: true, submitMsg: '' });
    try {
      await BLEPrinter.init();
      const list = await BLEPrinter.getDeviceList();
      console.log('BT devices:', list);
      this.safeSetState({ submitMsg: `Encontrados ${list?.length || 0} dispositivos.` });
    } catch (e) {
      console.log('Erro listar:', e);
      this.safeSetState({ submitMsg: 'Erro ao listar dispositivos.' });
    } finally {
      this.safeSetState({ bleListing: false });
    }
  };

  selectBtPrinter = async () => {
    if (this.state.bleSelecting) return;
    this.safeSetState({ bleSelecting: true, submitMsg: '' });
    try {
      await askBtPermissions();
      await PrinterService.selectBluetoothPrinter();
      this.safeSetState({ submitMsg: 'Impressora selecionada.' });
    } catch (e) {
      console.log('Erro ao selecionar:', e);
      this.safeSetState({ submitMsg: 'Falha ao selecionar impressora.' });
    } finally {
      this.safeSetState({ bleSelecting: false });
    }
  };

  printTest = async () => {
    if (this.state.blePrinting) return;
    this.safeSetState({ blePrinting: true, submitMsg: '' });
    try {
      await PrinterService.printPedido({
        mesa: 'Teste',
        pedido: 'Pedido de teste',
        quant: '2',
        extra: 'gelo e limão',
        hora: '12:00',
        sendBy: 'testador',
      });
      this.safeSetState({ submitMsg: 'Impressão enviada.' });
    } catch (e) {
      console.log('Erro ao imprimir:', e);
      this.safeSetState({ submitMsg: 'Falha ao imprimir.' });
    } finally {
      this.safeSetState({ blePrinting: false });
    }
  };

  // ===== render =====
  renderUser = ({ item }) => {
    const isBusy = this.state.rowBusyIds.has(item.id);
    // segurança básica: não exibir senha em claro
    const senhaMask = item?.senha ? '•'.repeat(String(item.senha).length || 6) : '—';

    return (
      <View style={styles.userCard}>
        <Text style={styles.userInfo}>👤 {item.username}</Text>
        <Text style={styles.userInfo}>🔒 {senhaMask}</Text>
        {!!item.cargo && <Text style={[styles.userInfo, { fontWeight: '600' }]}>💼 {item.cargo}</Text>}

        <View style={styles.buttonRow}>
          {item.liberado === '0' ? (
            <TouchableOpacity
              style={[styles.liberar, isBusy && styles.btnDisabled]}
              onPress={() => !isBusy && this.Liberar(item.id, '1')}
              activeOpacity={0.85}
              disabled={isBusy}
            >
              <Text style={styles.buttonText}>{isBusy ? '...' : 'Liberar'}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.bloquear, isBusy && styles.btnDisabled]}
              onPress={() => !isBusy && this.Liberar(item.id, '0')}
              activeOpacity={0.85}
              disabled={isBusy}
            >
              <Text style={styles.buttonText}>{isBusy ? '...' : 'Bloquear'}</Text>
            </TouchableOpacity>
          )}

          {!this.state.showModal && (
            <TouchableOpacity
              style={styles.editar}
              onPress={() =>
                this.safeSetState({
                  showModal: true,
                  usuarioSelected: item.username,
                  cargoUsuarioSelected: item.cargo || '',
                  editCargo: item.cargo || '',
                  senhaUsuarioSelected: item.senha || '',
                  idUsuarioSelected: item.id,
                  submitMsg: '',
                })
              }
              activeOpacity={0.85}
            >
              <Text style={styles.buttonText}>Editar</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  render() {
    const {
      data,
      refreshing,
      showModal,
      cargoUsuarioSelected,
      cargos,
      editCargo,
      isSubmitting,
      submitMsg,
      isConnected,
      bleListing,
      bleSelecting,
      blePrinting,
    } = this.state;

    return (
      <View style={styles.container}>
        {!isConnected && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>Sem internet</Text>
          </View>
        )}

        <View style={styles.btRow}>
          <TouchableOpacity
            style={[styles.btBtn, bleListing && styles.btBtnBusy]}
            onPress={this.listBtDevices}
            disabled={bleListing}
          >
            {bleListing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btBtnText}>Listar dispositivos</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btBtn, bleSelecting && styles.btBtnBusy]}
            onPress={this.selectBtPrinter}
            disabled={bleSelecting}
          >
            {bleSelecting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btBtnText}>Selecionar impressora</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btBtn, blePrinting && styles.btBtnBusy]}
            onPress={this.printTest}
            disabled={blePrinting}
          >
            {blePrinting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btBtnText}>Imprimir teste</Text>}
          </TouchableOpacity>
        </View>

        <FlatList
          data={Array.isArray(data) ? data : []}
          keyExtractor={(item, index) => String(item?.id ?? index)}
          renderItem={this.renderUser}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={this.fetchUsers} />}
          contentContainerStyle={{ paddingBottom: 24 }}
        />

        {!!submitMsg && <Text style={styles.feedback}>{submitMsg}</Text>}

        {/* Modal de edição */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={showModal}
          onRequestClose={() =>
            this.safeSetState({
              showModal: false,
              usuarioSelected: '',
              cargoUsuarioSelected: '',
              senhaUsuarioSelected: '',
              idUsuarioSelected: '',
              submitMsg: '',
            })
          }
        >
          <View style={styles.ModalContainer}>
            <View style={styles.ModalHeader}>
              <TouchableOpacity
                style={styles.setaVoltar}
                onPress={() =>
                  this.safeSetState({
                    showModal: false,
                    usuarioSelected: '',
                    cargoUsuarioSelected: '',
                    senhaUsuarioSelected: '',
                    idUsuarioSelected: '',
                    submitMsg: '',
                  })
                }
              >
                <Text style={styles.setaTexto}>{'\u2190'}</Text>
              </TouchableOpacity>
              <Text style={styles.headerText}>Usuário: 👤 {this.state.usuarioSelected}</Text>
            </View>

            <Picker
              selectedValue={cargoUsuarioSelected}
              onValueChange={(value) => this.safeSetState({ cargoUsuarioSelected: value })}
              style={styles.picker}
            >
              <Picker.Item label={cargoUsuarioSelected || 'Selecionar Cargo'} value={cargoUsuarioSelected || ''} />
              {cargos
                .filter((item) => item !== cargoUsuarioSelected)
                .map((item) => (
                  <Picker.Item key={item} label={item} value={item} />
                ))}
            </Picker>

            {cargoUsuarioSelected !== editCargo && (
              <TouchableOpacity
                style={[styles.primaryBtn, isSubmitting && styles.btnDisabled]}
                onPress={this.handleEditCargo}
                disabled={isSubmitting}
                activeOpacity={0.85}
              >
                {isSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Confirmar Cargo</Text>}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.dangerBtn, isSubmitting && styles.btnDisabled]}
              onPress={() =>
                Alert.alert('Remover usuário?', 'Tem certeza que deseja remover este usuário?', [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'REMOVER', style: 'destructive', onPress: this.Remover },
                ])
              }
              disabled={isSubmitting}
              activeOpacity={0.85}
            >
              {isSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryBtnText}>Remover</Text>}
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },

  offlineBanner: {
    backgroundColor: '#ef4444',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  offlineText: { color: '#fff', fontWeight: '700' },

  btRow: { flexDirection: 'row', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  btBtn: {
    flexGrow: 1,
    backgroundColor: '#17315c',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btBtnBusy: { opacity: 0.7 },
  btBtnText: { color: '#fff', fontWeight: '800' },

  userCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  userInfo: { fontSize: 16, fontWeight: 'bold', marginBottom: 6 },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-start', gap: 10, marginTop: 6 },

  liberar: { backgroundColor: '#4CAF50', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 6 },
  bloquear: { backgroundColor: '#f44336', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 6 },
  editar: { backgroundColor: '#2563eb', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 6 },
  buttonText: { color: 'white', fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },

  feedback: { textAlign: 'center', marginTop: 8, color: '#374151', fontSize: 13 },

  ModalContainer: {
    backgroundColor: 'white',
    marginVertical: 40,
    marginHorizontal: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'black',
    flex: 1,
    paddingBottom: 16,
  },
  ModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  setaTexto: { fontSize: 30, color: '#333' },
  setaVoltar: { left: 10, marginRight: 20 },
  headerText: { fontSize: 22, fontWeight: 'bold', marginLeft: 16 },
  picker: { height: 50, width: '100%' },

  primaryBtn: {
    backgroundColor: '#17315c',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 10,
  },
  dangerBtn: {
    backgroundColor: '#dc2626',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 10,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800' },
});
