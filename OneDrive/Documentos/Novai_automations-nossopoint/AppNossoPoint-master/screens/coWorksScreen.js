import React from "react";
import {
  Text,
  View,
  ScrollView,
  StyleSheet,
  Button,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import Icon from "react-native-vector-icons/FontAwesome";
import NetInfo from "@react-native-community/netinfo";
import { UserContext } from "../UserContext";
import { getSocket } from "../socket";

export default class CoWorksScreen extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      dataAlteracoes: [],
      dia: "",
      change: 0,

      // filtros
      searchTerm: "",
      filtroUsuario: null,
      filtroTabela: null,
      filtroTipo: null,
      filtroTela: null,

      // robustez / UX
      isConnected: true,
      loading: false,
      dayBusy: false,
      lastError: "",
    };

    this.socket = null;
    this._isMounted = false;
    this._netUnsub = null;
    this._timeouts = new Set();
    this._pendingDayReq = null;
  }

  getCarrinho = () => {
    const { user } = this.context || {};
    return user?.carrinho || '';
  };

  // ---------- utils ----------
  safeSetState = (updater, cb) => {
    if (this._isMounted) this.setState(updater, cb);
  };

  addTimeout = (fn, ms) => {
    const id = setTimeout(() => {
      this._timeouts.delete(id);
      fn();
    }, ms);
    this._timeouts.add(id);
    return id;
  };

  clearAllTimeouts = () => {
    for (const id of this._timeouts) clearTimeout(id);
    this._timeouts.clear();
  };

  isServerReady = () => {
    if (!this.state.isConnected) {
      this.safeSetState({ lastError: "Sem internet." });
      return false;
    }
    if (!this.socket || !this.socket.connected) {
      this.safeSetState({ lastError: "Sem conexão com o servidor." });
      return false;
    }
    return true;
  };

  // ---------- lifecycle ----------
  async componentDidMount() {
    this._isMounted = true;

    // rede
    this._netUnsub = NetInfo.addEventListener((state) =>
      this.safeSetState({ isConnected: !!state.isConnected })
    );
    try {
      const s = await NetInfo.fetch();
      this.safeSetState({ isConnected: !!s.isConnected });
    } catch {}

    // socket
    this.socket = getSocket();
    this.socket.on("respostaAlteracoes", this.handleRespostaAlteracoes);

    // primeira carga
    this.emitGetAlteracoes();
  }

  componentWillUnmount() {
    this._isMounted = false;
    this.clearAllTimeouts();
    if (this._netUnsub) {
      this._netUnsub();
      this._netUnsub = null;
    }
    if (this.socket) {
      this.socket.off("respostaAlteracoes", this.handleRespostaAlteracoes);
    }
  }

  // ---------- socket handlers ----------
  emitGetAlteracoes = () => {
    if (!this.isServerReady()) return;
    this.safeSetState({ loading: true, lastError: "" });
    const carrinho = this.getCarrinho();
    this.socket.emit("getAlteracoes", { emitir: false, carrinho });

    // timeout de segurança
    this.addTimeout(() => {
      if (this.state.loading) {
        this.safeSetState({
          loading: false,
          lastError: "Demora na resposta do servidor.",
        });
      }
    }, 10000);
  };

  handleRespostaAlteracoes = (dados) => {
    const lista = Array.isArray(dados?.alteracoes)
      ? [...dados.alteracoes].reverse()
      : [];
    this.safeSetState({
      dataAlteracoes: lista,
      dia: dados?.hoje ?? "",
      loading: false,
      dayBusy: false,
      lastError: "",
    });
    this._pendingDayReq = null;
  };

  // ---------- dia / navegação ----------
  mudarDia = (novoChange) => {
    // evita spam de cliques e navegação fora do contrato original (somente <= 0)
    if (this.state.dayBusy) return;
    if (novoChange > 0) return;

    if (!this.isServerReady()) return;

    this.safeSetState({ dayBusy: true, change: novoChange, lastError: "" });
    this._pendingDayReq = { novoChange };

    const carrinho = this.getCarrinho();
    this.socket.emit("getAlteracoes", { emitir: false, change: novoChange, carrinho });

    // timeout de segurança para liberar UI
    this.addTimeout(() => {
      if (this._pendingDayReq && this._pendingDayReq.novoChange === novoChange) {
        this.safeSetState({
          dayBusy: false,
          lastError: "Não foi possível carregar o dia solicitado.",
        });
        this._pendingDayReq = null;
      }
    }, 10000);
  };

  abrirCalendario = () => {
    Alert.alert(
      "Calendário",
      "Use os botões de navegação para trocar o dia.\n(Suporte a calendário pode ser habilitado futuramente.)"
    );
  };

  // ---------- filtros ----------
  getUnicos = (arr, chave) => {
    const vals = arr.map((x) => x?.[chave]).filter((v) => v != null && v !== "");
    return Array.from(new Set(vals));
  };

  aplicaFiltros = () => {
    const {
      dataAlteracoes,
      searchTerm,
      filtroUsuario,
      filtroTabela,
      filtroTipo,
      filtroTela,
    } = this.state;

    const q = (searchTerm || "").toLowerCase().trim();

    return dataAlteracoes.filter((item) => {
      const texto = [
        item?.tabela,
        item?.alteracao,
        item?.tipo,
        item?.usuario,
        item?.tela,
        item?.horario,
        item?.dia,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const buscaOk = !q || texto.includes(q);
      const usuarioOk = !filtroUsuario || item?.usuario === filtroUsuario;
      const tabelaOk = !filtroTabela || item?.tabela === filtroTabela;
      const tipoOk = !filtroTipo || item?.tipo === filtroTipo;
      const telaOk = !filtroTela || item?.tela === filtroTela;

      return buscaOk && usuarioOk && tabelaOk && tipoOk && telaOk;
    });
  };

  limparFiltros = () => {
    this.safeSetState({
      searchTerm: "",
      filtroUsuario: null,
      filtroTabela: null,
      filtroTipo: null,
      filtroTela: null,
    });
  };

  // ---------- UI helpers ----------
  Chip = ({ label, ativo, onPress }) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.chip, ativo && styles.chipAtivo]}
    >
      <Text style={[styles.chipTxt, ativo && styles.chipTxtAtivo]}>{label}</Text>
    </TouchableOpacity>
  );

  // ---------- render ----------
  render() {
    const { change, dataAlteracoes, dia, loading, isConnected, dayBusy, lastError } =
      this.state;

    const usuarios = this.getUnicos(dataAlteracoes, "usuario");
    const tabelas = this.getUnicos(dataAlteracoes, "tabela");
    const tipos = this.getUnicos(dataAlteracoes, "tipo");
    const telas = this.getUnicos(dataAlteracoes, "tela");

    const filtrados = this.aplicaFiltros();

    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 12 }}>
        {/* Banner de rede */}
        {!isConnected && (
          <View style={styles.offlineBanner}>
            <Icon name="wifi" size={14} color="#fff" />
            <Text style={styles.offlineText}>Sem internet</Text>
          </View>
        )}

        {/* Cabeçalho de data/navegação */}
        <View style={styles.dataRow}>
          <TouchableOpacity onPress={this.abrirCalendario}>
            <Icon name="calendar" size={18} color="#333" style={styles.dateIcon} />
          </TouchableOpacity>

          <Button
            title="<"
            onPress={() => this.mudarDia(change - 1)}
            disabled={dayBusy || loading}
          />
          <Text style={styles.dateText}>Dia {dia}</Text>
          {change !== 0 && (
            <Button
              title=">"
              onPress={() => this.mudarDia(change + 1)}
              disabled={dayBusy || loading}
            />
          )}

          <View style={{ marginLeft: "auto" }}>
            <TouchableOpacity
              onPress={this.emitGetAlteracoes}
              disabled={loading || dayBusy}
              style={[styles.refreshBtn, (loading || dayBusy) && styles.refreshBtnDisabled]}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#17315c" />
              ) : (
                <>
                  <Icon name="refresh" size={14} color="#17315c" />
                  <Text style={styles.refreshTxt}>Atualizar</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Filtros */}
        <View style={styles.filterCard}>
          <View style={styles.filterHeader}>
            <Icon name="filter" size={16} color="#333" />
            <Text style={styles.filterTitle}>Filtros</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={this.limparFiltros} style={styles.clearBtn}>
              <Icon name="times" size={14} color="#333" />
              <Text style={styles.clearTxt}>Limpar</Text>
            </TouchableOpacity>
          </View>

          {/* Busca livre */}
          <View style={styles.searchRow}>
            <Icon name="search" size={14} color="#333" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar por qualquer campo..."
              placeholderTextColor="#777"
              value={this.state.searchTerm}
              onChangeText={(t) => this.safeSetState({ searchTerm: t })}
              returnKeyType="search"
            />
          </View>

          {/* Chips de usuário */}
          {usuarios.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Usuário</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                <this.Chip
                  label="Todos"
                  ativo={!this.state.filtroUsuario}
                  onPress={() => this.safeSetState({ filtroUsuario: null })}
                />
                {usuarios.map((u) => (
                  <this.Chip
                    key={u}
                    label={u}
                    ativo={this.state.filtroUsuario === u}
                    onPress={() => this.safeSetState({ filtroUsuario: u })}
                  />
                ))}
              </ScrollView>
            </>
          )}

          {/* Chips de Tabela (Pedido) */}
          {tabelas.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Tabela / Pedido</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                <this.Chip
                  label="Todas"
                  ativo={!this.state.filtroTabela}
                  onPress={() => this.safeSetState({ filtroTabela: null })}
                />
                {tabelas.map((t) => (
                  <this.Chip
                    key={t}
                    label={t}
                    ativo={this.state.filtroTabela === t}
                    onPress={() => this.safeSetState({ filtroTabela: t })}
                  />
                ))}
              </ScrollView>
            </>
          )}

          {/* Chips de Tipo */}
          {tipos.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Tipo</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                <this.Chip
                  label="Todos"
                  ativo={!this.state.filtroTipo}
                  onPress={() => this.safeSetState({ filtroTipo: null })}
                />
                {tipos.map((t) => (
                  <this.Chip
                    key={t}
                    label={t}
                    ativo={this.state.filtroTipo === t}
                    onPress={() => this.safeSetState({ filtroTipo: t })}
                  />
                ))}
              </ScrollView>
            </>
          )}

          {/* Chips de Tela */}
          {telas.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Tela</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                <this.Chip
                  label="Todas"
                  ativo={!this.state.filtroTela}
                  onPress={() => this.safeSetState({ filtroTela: null })}
                />
                {telas.map((t) => (
                  <this.Chip
                    key={t}
                    label={t}
                    ativo={this.state.filtroTela === t}
                    onPress={() => this.safeSetState({ filtroTela: t })}
                  />
                ))}
              </ScrollView>
            </>
          )}
        </View>

        {/* contador de resultados */}
        <Text style={styles.resultCount}>
          {filtrados.length} resultado{filtrados.length === 1 ? "" : "s"}
        </Text>

        {/* Lista */}
        {filtrados.map((item, i) => (
          <View key={`${item?.usuario ?? "?"}-${item?.horario ?? "?"}-${i}`} style={styles.userCard}>
            <View style={styles.cardTopRow}>
              <Text style={styles.userInfo}>
                {item?.tabela} às {item?.horario}
              </Text>
              <Text style={styles.badge}>{item?.tipo}</Text>
            </View>
            <Text style={styles.cardLine}>
              Na <Text style={styles.cardStrong}>{item?.tela}</Text>,{" "}
              <Text style={styles.cardStrong}>{item?.usuario}</Text>{" "}
              {item?.tipo} <Text style={styles.cardStrong}>{item?.alteracao}</Text>
            </Text>
          </View>
        ))}

        {/* vazio */}
        {filtrados.length === 0 && !loading && (
          <View style={styles.emptyBox}>
            <Icon name="info-circle" size={16} color="#333" />
            <Text style={styles.emptyTxt}>Nenhum registro encontrado com os filtros atuais.</Text>
          </View>
        )}

        {/* erro discreto */}
        {!!lastError && (
          <View style={styles.errorBox}>
            <Icon name="exclamation-triangle" size={14} color="#B45309" />
            <Text style={styles.errorTxt}>{lastError}</Text>
          </View>
        )}
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#f5f5f5" },

  // offline
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#ef4444",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginHorizontal: 8,
    marginBottom: 8,
  },
  offlineText: { color: "#fff", fontWeight: "700", marginLeft: 6 },

  // header de data
  dataRow: {
    flexDirection: "row",
    padding: 10,
    alignItems: "center",
    margin: 8,
    backgroundColor: "#fff",
    borderRadius: 10,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  dateIcon: { fontSize: 18, marginRight: 8 },
  dateText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    padding: 5,
    marginHorizontal: 8,
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#e8eefb",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  refreshBtnDisabled: { opacity: 0.6 },
  refreshTxt: { color: "#17315c", marginLeft: 6, fontWeight: "700" },

  // filtros
  filterCard: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 10,
    marginHorizontal: 8,
    marginBottom: 12,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  filterHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  filterTitle: { marginLeft: 6, fontWeight: "bold", color: "#333" },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#f0f0f0",
  },
  clearTxt: { marginLeft: 6, color: "#333" },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f7f7f7",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
  },
  searchInput: { flex: 1, color: "#333", paddingVertical: 4 },

  sectionLabel: { fontSize: 12, color: "#555", marginTop: 6, marginBottom: 6 },
  chipsRow: { marginBottom: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#f0f0f0",
    borderRadius: 16,
    marginRight: 8,
  },
  chipAtivo: { backgroundColor: "#e0e0e0" },
  chipTxt: { color: "#333" },
  chipTxtAtivo: { fontWeight: "bold", color: "#333" },

  // lista/cards
  resultCount: { marginHorizontal: 12, marginBottom: 8, color: "#555" },
  userCard: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 10,
    marginHorizontal: 8,
    marginBottom: 12,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cardTopRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  userInfo: { fontSize: 16, fontWeight: "bold", marginRight: 8 },
  badge: {
    marginLeft: "auto",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    color: "#333",
    fontSize: 12,
  },
  cardLine: { color: "#333" },
  cardStrong: { fontWeight: "bold", color: "#333" },

  emptyBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 10,
    marginHorizontal: 8,
    marginBottom: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF3C7",
    padding: 10,
    borderRadius: 8,
    marginHorizontal: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  errorTxt: { color: "#92400E", fontWeight: "600" },
});
