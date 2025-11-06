import React from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Button,
  TouchableOpacity,
  Platform,
  Modal,
  Dimensions,
  FlatList
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { UserContext } from "../UserContext";
import { FontAwesome } from "@expo/vector-icons";
import DateTimePicker from '@react-native-community/datetimepicker';
import { BarChart, PieChart } from "react-native-chart-kit";
import { getSocket } from "../socket";


const { width } = Dimensions.get("window");
const AUTO_APLICAR_ANDROID = true



// Helpers
const toNumber = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  // tenta converter "1.234,56" -> 1234.56
  const normalized = String(v).replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return isNaN(n) ? 0 : n;
};

const formatBRL = (v) =>
  (toNumber(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (d) => {
  if (!(d instanceof Date)) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`; // para backend (AAAA-MM-DD)
};

const fmtHuman = (d) => {
  if (!(d instanceof Date)) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  return `${day}/${m}/${y}`;
};

export default class Analytics extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    const today = new Date();
    this.state = {
      faturamento: 0,
      dia: "",
      username: "",
      cargo: "",
      refreshing: false,
      faturamento_previsto: 0,
      drink: 0,
      porcao: 0,
      pedidos: 0,
      restante: 0,
      caixinha: 0,
      change: 0,
      desconto: 0,
      dezporcento: 0,
      dinheiro: 0,
      credito: 0,
      debito: 0,
      pix: 0,

      // Novos estados para calendário/intervalo
      showRangeModal: false,
      showStartPicker: Platform.OS === "ios", // iOS mostra inline no modal
      showEndPicker: Platform.OS === "ios",
      startDate: today, // padrão: hoje
      endDate: today,   // padrão: hoje
      pendingStart: today,
      pendingEnd: today,
      vendasUser: [],
      rankWidth: 0,

    };
    this.socket = null
  }

  getCarrinho = () => {
    const { user } = this.context || {};
    return user?.carrinho || '';
  };

  componentDidMount() {
    this.socket = getSocket();

    this.initializeData();

    this.socket.on("faturamento_enviar", this.handleFaturamento);

  }

  componentWillUnmount() {
    if (this.socket) {
      this.socket.off("faturamento_enviar");
    }
  }


  initializeData = () => {
    this.setState({ refreshing: true }, () => {
      const carrinho = this.getCarrinho();
      this.socket?.emit("faturamento", { emitir: false, change: 0, carrinho });
      setTimeout(() => this.setState({ refreshing: false }), 400);
    });
  };

  handleFaturamento = (data) => {
    if (!data) return;
    const vendasUser = Array.isArray(data?.vendas_user) ? data.vendas_user : [];
    console.log('Vendas user recebidas:', vendasUser);

    // Normaliza números e já ordena por valor vendido (fallback, mesmo que o backend já ordene)
    const ranking = vendasUser
      .map((r) => ({
        username: r.username ?? '—',
        valor: Number(r.valor_vendido ?? 0),
        quant: Number(r.quant_vendida ?? 0),
      }))
      .sort((a, b) => b.valor - a.valor);
      console.log('Ranking processado:', ranking);

    this.setState({
      faturamento: data.faturamento,
      dia: data.dia,
      faturamento_previsto: data.faturamento_previsto,
      drink: data.drink,
      porcao: data.porcao,
      restante: data.restante,
      pedidos: data.pedidos,
      caixinha: data.caixinha,
      dezporcento: data.dezporcento,
      desconto: data.desconto,
      dinheiro: data.dinheiro,
      credito: data.credito,
      debito: data.debito,
      pix: data.pix,
      vendasUser: ranking

    });
  };


  renderRanking = () => {
    const fmtBRL = (v) =>
      (Number(v) || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
  
    const { vendasUser } = this.state;
  
    if (!vendasUser.length) {
      return <Text style={{ textAlign: "center", color: "#666", marginTop: 8 }}>Sem dados</Text>;
    }
  
    const { rankWidth } = this.state;
    const max = Math.max(...vendasUser.map(u => u.valor));
  
    // ⬇️ AQUI PRECISA DO RETURN
    return (
      <View
        onLayout={e => this.setState({ rankWidth: e.nativeEvent.layout.width })}
        style={{ marginTop: 16, width: "100%" }}
      >
        {vendasUser.map((item, idx) => {
          const VALUE_RESERVED = 140; // coluna direita
          const NAME_WIDTH = 110;     // coluna esquerda
          const trackWidth = Math.max(0, rankWidth - VALUE_RESERVED - NAME_WIDTH - 16);
          const pct = max > 0 ? item.valor_vendido / max : 0;
          const fill = Math.max(4, trackWidth * pct);
  
          return (
            <View
              key={`${item.username}-${idx}`}
              style={{ flexDirection: "row", alignItems: "center", marginVertical: 6 }}
            >
              {/* nome (uma linha) */}
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{ width: NAME_WIDTH, fontWeight: "700", color: "#1f2937", marginRight: 8 }}
              >
                {item.username}
              </Text>
  
              {/* barra */}
              <View
                style={{
                  width: trackWidth,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: "#e5e7eb",
                  overflow: "hidden",
                }}
              >
                <View style={{ width: fill, height: "100%", backgroundColor: "#3bb273" }} />
              </View>
  
              {/* valor + un. */}
              <Text
                style={{
                  width: VALUE_RESERVED,
                  textAlign: "right",
                  marginLeft: 8,
                  color: "#111827",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {fmtBRL(item.valor)}{" "}
                <Text style={{ color: "#6b7280" }}>({item.quant} un.)</Text>
              </Text>
            </View>
          );
        })}
      </View>
    );
  };
  


  mudarDia = (change) => {
    const {startDate, endDate} = this.state;
    if (startDate.getTime() !== endDate.getTime()) {
      change = 0; // se estiver em intervalo, volta para hoje
      this.setState({ startDate: new 	Date(), endDate: new Date() });
    }
    if (change <= 0) {
      const carrinho = this.getCarrinho();
      this.socket?.emit("faturamento", { emitir: false, change: change, carrinho });
            // em mudarDia (ou onde você atualiza)
      const base = new Date();
      base.setHours(0, 0, 0, 0);          // zera hora p/ evitar drift

      const alvo = new Date(base);
      alvo.setDate(base.getDate() + change); // subtrai "change" dias

      this.setState({
        change, startDate: new Date(alvo), endDate:   new Date(alvo), pendingStart: new Date(alvo), pendingEnd:   new Date(alvo),
      });
    }
  };

  _emitRange = (start, end) => {
    const date_from = fmtDate(start); // AAAA-MM-DD
    const date_to   = fmtDate(end);
    this.setState({ startDate: start, endDate: end, showRangeModal: false });

    this.socket?.emit("faturamento_range", {
      emitir: false,
      date_from,
      date_to,
      carrinho: this.getCarrinho(),
    });
  };

  // === Calendário / Intervalo ===
  abrirCalendario = () => {
    const { startDate, endDate } = this.state;
    this.setState({
      showRangeModal: true,
      pendingStart: startDate,
      pendingEnd: endDate,
      // iOS mostra os dois inline; Android deixa fechado até tocar no campo
      showStartPicker: Platform.OS === "ios",
      showEndPicker: Platform.OS === "ios",
    });
  };

  fecharCalendario = () => {
    this.setState({ showRangeModal: false });
  };

  aplicarIntervalo = () => {
      const { pendingStart, pendingEnd, showStartPicker, showEndPicker } = this.state;
      // No Android, se algum picker ainda estiver aberto, fecha e só então aplica
      if (Platform.OS !== "ios" && (showStartPicker || showEndPicker)) {
        this.setState({ showStartPicker: false, showEndPicker: false }, () => {
          setTimeout(this.aplicarIntervalo, 0);
        });
        return;
     }
    
      const start = new Date(pendingStart);
      const end = new Date(pendingEnd);
    
      if (start > end) {
        const tmp = new Date(start);
        this.setState({ pendingStart: end, pendingEnd: tmp }, () => {
          this._emitRange(end, tmp);
        });
      } else {
        this._emitRange(start, end);
      }
    };

  onChangeStart = (event, date) => {
    const type = event?.type;
    if (Platform.OS !== "ios") {
      // sempre fecha o modal do Android
      this.setState({ showStartPicker: false });
    }
    if (type !== "set" || !date) return; // ignorar cancel
    // garante Date válido
    const picked = new Date(date);
    // não deixa início passar do fim
    const { pendingEnd } = this.state;
    const safeStart = picked > pendingEnd ? pendingEnd : picked;
    this.setState({ pendingStart: safeStart }, () => {
      if (Platform.OS !== "ios") {
        this.setState({ showEndPicker: true }); // abre o "Fim" logo após escolher "Início"
      }
    });
  };
    
  onChangeEnd = (event, date) => {
    const type = event?.type;
    if (Platform.OS !== "ios") {
      this.setState({ showEndPicker: false });
    }
    if (type !== "set" || !date) return; // ignorar cancel
    const picked = new Date(date);
    const { pendingStart } = this.state;
    // não deixa fim ser antes do início
    const safeEnd = picked < pendingStart ? pendingStart : picked;
    this.setState({ pendingEnd: safeEnd }, () => {
      if (Platform.OS !== "ios" && AUTO_APLICAR_ANDROID) {
        this.aplicarIntervalo(); // aplica imediatamente no Android
      }
    });
  };

  render() {
    const {
      faturamento,
      change,
      dia,
      refreshing,
      faturamento_previsto,
      drink,
      porcao,
      pedidos,
      restante,
      caixinha,
      dezporcento,
      desconto,
      dinheiro,
      credito,
      debito,
      pix,
      // calendar
      showRangeModal,
      showStartPicker,
      showEndPicker,
      startDate,
      endDate,
      pendingStart,
      pendingEnd,
    } = this.state;

    // Dados para gráficos
    const pagamentosPie = [
      { name: "Dinheiro", population: toNumber(dinheiro), color: "#2E7D32", legendFontColor: "#333", legendFontSize: 12 },
      { name: "Crédito", population: toNumber(credito), color: "#1565C0", legendFontColor: "#333", legendFontSize: 12 },
      { name: "Débito",  population: toNumber(debito),  color: "#00ACC1", legendFontColor: "#333", legendFontSize: 12 },
      { name: "Pix",     population: toNumber(pix),     color: "#43A047", legendFontColor: "#333", legendFontSize: 12 },
    ].filter(s => s.population > 0);

    const contagensBar = {
      labels: ["Drinks", "Porções", "Pedidos", "Restantes"],
      datasets: [{ data: [toNumber(drink), toNumber(porcao), toNumber(pedidos), toNumber(restante)] }],
    };

    // TEMA CLARO para gráficos
    const chartConfig = {
      backgroundGradientFrom: "#FFFFFF",
      backgroundGradientTo: "#FFFFFF",
      decimalPlaces: 0,
      color: (opacity = 1) => `rgba(17, 24, 39, ${opacity})`,        // texto/traços escuros
      labelColor: (opacity = 1) => `rgba(55, 65, 81, ${opacity})`,   // rótulos
      barPercentage: 0.6,
      propsForBackgroundLines: { strokeWidth: 0 },
    };
    const rangeKey = `${fmtHuman(startDate)}_${fmtHuman(endDate)}_${toNumber(dinheiro)}_${toNumber(credito)}_${toNumber(debito)}_${toNumber(pix)}_${toNumber(drink)}_${toNumber(porcao)}_${toNumber(pedidos)}_${toNumber(restante)}`;

    return (
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={this.initializeData} />}
        style={{ backgroundColor: "#F8FAFF" }}  // fundo claro
      >
        <StatusBar style="dark" />
    
        {/* Container */}
        <View style={styles.container}>
    
          {/* Header / Intervalo de datas */}
          <View style={styles.headerCard}>
            <View style={styles.rowBetween}>
              <Text style={styles.screenTitle}>Analytics</Text>
    
              <TouchableOpacity onPress={this.abrirCalendario} style={styles.calendarBtn}>
                <FontAwesome name="calendar" size={18} color="#0b1020" style={{ marginRight: 8 }} />
                <Text style={styles.calendarBtnText}>Período</Text>
              </TouchableOpacity>
            </View>
    
            <View style={[styles.rowBetween, { marginTop: 12 }]}>
              <View style={styles.rangePill}>
                {startDate.getTime() !== endDate.getTime() ?(
                <Text style={styles.rangePillText}>
                  {fmtHuman(startDate)} — {fmtHuman(endDate)}
                </Text>
                ) : (
                <Text style={styles.rangePillText}>{fmtHuman(startDate)}</Text>
                  
                )}
              </View>
    
              <View style={styles.row}>
                <Button title="<" onPress={() => this.mudarDia(change - 1)} />
                {change !== 0 && <View style={{ width: 8 }} />}
                {change !== 0 && <Button title=">" onPress={() => this.mudarDia(change + 1)} />}
              </View>
            </View>
          </View>
    
          {/* Cards de KPI (fundos claros, textos escuros) */}
          <View style={styles.kpiGrid}>
            <View style={[styles.kpiCard, { backgroundColor: "#E6F7FF" }]}>
              <Text style={styles.kpiLabel}>Faturamento</Text>
              <Text style={styles.kpiValue}>{formatBRL(faturamento)}</Text>
            </View>
    
            <View style={[styles.kpiCard, { backgroundColor: "#E9FCEB" }]}>
              <Text style={styles.kpiLabel}>Previsto</Text>
              <Text style={styles.kpiValue}>{formatBRL(faturamento_previsto)}</Text>
            </View>
    
            <View style={[styles.kpiCard, { backgroundColor: "#EEF0FF" }]}>
              <Text style={styles.kpiLabel}>Pedidos</Text>
              <Text style={styles.kpiValue}>{toNumber(pedidos)}</Text>
            </View>
    
            <View style={[styles.kpiCard, { backgroundColor: "#FFF1E6" }]}>
              <Text style={styles.kpiLabel}>10%</Text>
              <Text style={styles.kpiValue}>{formatBRL(dezporcento)}</Text>
            </View>
    
            <View style={[styles.kpiCard, { backgroundColor: "#FFE8E6" }]}>
              <Text style={styles.kpiLabel}>Descontos</Text>
              <Text style={styles.kpiValue}>{formatBRL(desconto)}</Text>
            </View>
    
            <View style={[styles.kpiCard, { backgroundColor: "#E6FBF7" }]}>
              <Text style={styles.kpiLabel}>Caixinha</Text>
              <Text style={styles.kpiValue}>{formatBRL(caixinha)}</Text>
            </View>
          </View>
    
          {/* Resumo rápido por forma de pagamento (pastéis claros) */}
          <View style={styles.paySummaryRow}>
            <View style={[styles.payPill, { backgroundColor: "#ECFDF5" }]}>
              <Text style={styles.payPillTitle}>Dinheiro</Text>
              <Text style={styles.payPillValue}>{formatBRL(dinheiro)}</Text>
            </View>
            <View style={[styles.payPill, { backgroundColor: "#EFF6FF" }]}>
              <Text style={styles.payPillTitle}>Crédito</Text>
              <Text style={styles.payPillValue}>{formatBRL(credito)}</Text>
            </View>
            <View style={[styles.payPill, { backgroundColor: "#ECFEFF" }]}>
              <Text style={styles.payPillTitle}>Débito</Text>
              <Text style={styles.payPillValue}>{formatBRL(debito)}</Text>
            </View>
            <View style={[styles.payPill, { backgroundColor: "#F0FDF4" }]}>
              <Text style={styles.payPillTitle}>Pix</Text>
              <Text style={styles.payPillValue}>{formatBRL(pix)}</Text>
            </View>
          </View>
    
          {/* Gráfico 1: Pizza por forma de pagamento */}
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Formas de pagamento</Text>
            {pagamentosPie.length ? (
              <PieChart
                key={`pie_${rangeKey}`}
                data={pagamentosPie}
                width={width - 32}
                height={220}
                accessor={"population"}
                backgroundColor={"transparent"}
                chartConfig={chartConfig}
                paddingLeft={"0"}
                hasLegend={true}
              />
            ) : (
              <Text style={styles.emptyChartText}>Sem dados de pagamento para o período.</Text>
            )}
          </View>
    
          {/* Gráfico 2: Barras de quantidades */}
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Quantidades</Text>
            {(() => {
              const qtds = [toNumber(drink), toNumber(porcao), toNumber(pedidos), toNumber(restante)];
              const maxQtd = Math.max(...qtds);
              const ySegments = Math.max(1, Math.min(5, Math.floor(maxQtd) || 1));
              if (maxQtd === 0) {
                return <Text style={styles.emptyChartText}>Sem quantidades no período.</Text>;
              }
              return (
                <BarChart
                  key={`bar_${rangeKey}`}
                  data={{ labels: ["Drinks", "Porções", "Pedidos", "Restantes"], datasets: [{ data: qtds }] }}
                  width={width - 32}
                  height={240}
                  chartConfig={chartConfig}
                  style={{ borderRadius: 14 }}
                  fromZero
                  showBarTops
                  segments={ySegments}
                  formatYLabel={(y) =>
                    maxQtd <= 5 ? String(Math.round(Number(y))) : new Intl.NumberFormat("pt-BR").format(Number(y))
                  }
                />
              );
            })()}
          </View>
       
          {this.renderRanking()}


    
        </View>
    
        {/* Modal do intervalo de datas */}
        <Modal
          visible={showRangeModal}
          transparent
          animationType="fade"
          onRequestClose={this.fecharCalendario}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Selecione o período</Text>
    
              <View style={{ height: 12 }} />
    
              <Text style={styles.modalLabel}>Início</Text>
              {Platform.OS === "ios" ? (
                <DateTimePicker
                  value={pendingStart}
                  mode="date"
                  display="inline"
                  onChange={this.onChangeStart}
                  maximumDate={pendingEnd}
                />
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.dateField}
                    onPress={() => this.setState({ showStartPicker: true })}
                  >
                    <FontAwesome name="calendar" size={16} color="#6b7280" />
                    <Text style={styles.dateFieldText}>{fmtHuman(pendingStart)}</Text>
                  </TouchableOpacity>
    
                  {showStartPicker && (
                    <DateTimePicker
                      value={pendingStart}
                      mode="date"
                      display="default"
                      onChange={this.onChangeStart}
                      maximumDate={pendingEnd}
                    />
                  )}
                </>
              )}
    
              <View style={{ height: 12 }} />
    
              <Text style={styles.modalLabel}>Fim</Text>
              {Platform.OS === "ios" ? (
                <DateTimePicker
                  value={pendingEnd}
                  mode="date"
                  display="inline"
                  onChange={this.onChangeEnd}
                  minimumDate={pendingStart}
                />
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.dateField}
                    onPress={() => this.setState({ showEndPicker: true })}
                  >
                    <FontAwesome name="calendar" size={16} color="#6b7280" />
                    <Text style={styles.dateFieldText}>{fmtHuman(pendingEnd)}</Text>
                  </TouchableOpacity>
    
                  {showEndPicker && (
                    <DateTimePicker
                      value={pendingEnd}
                      mode="date"
                      display="default"
                      onChange={this.onChangeEnd}
                      minimumDate={pendingStart}
                    />
                  )}
                </>
              )}
    
              <View style={{ height: 16 }} />
    
              <View style={styles.rowBetween}>
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnGhost]} onPress={this.fecharCalendario}>
                  <Text style={[styles.modalBtnText, { color: "#0b1020" }]}>Cancelar</Text>
                </TouchableOpacity>
    
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={this.aplicarIntervalo}>
                  <Text style={[styles.modalBtnText, { color: "white" }]}>Aplicar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    );
    
  }
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },

  // Header
  headerCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  screenTitle: {
    color: "#0b1020",
    fontSize: 20,
    fontWeight: "700",
  },
  calendarBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#60a5fa",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  calendarBtnText: {
    color: "#0b1020",
    fontWeight: "700",
  },
  rangePill: {
    backgroundColor: "#FFFFFF",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  rangePillText: {
    color: "#111827",
    fontWeight: "600",
  },

  // Grid KPIs
  kpiGrid: {
    marginTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  kpiCard: {
    width: (width - 32 - 12) / 2,
    borderRadius: 16,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  kpiLabel: {
    color: "#1f2937",
    fontWeight: "700",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    opacity: 0.9,
  },
  kpiValue: {
    color: "#111827",
    fontWeight: "800",
    fontSize: 18,
    marginTop: 6,
  },

  // Charts
  chartCard: {
    backgroundColor: "#FFFFFF",
    marginTop: 16,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  chartTitle: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptyChartText: {
    color: "#6b7280",
    fontStyle: "italic",
  },

  // Lista bruta
  listCard: {
    backgroundColor: "#FFFFFF",
    marginTop: 16,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  valorText: {
    fontSize: 14,
    color: "#111827",
    marginBottom: 4,
  },

  // Modal calendário
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContent: {
    width: "100%",
    borderRadius: 16,
    backgroundColor: "white",
    padding: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0b1020",
  },
  modalLabel: {
    fontSize: 12,
    textTransform: "uppercase",
    fontWeight: "700",
    color: "#374151",
    marginBottom: 6,
  },
  dateField: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
  },
  dateFieldText: {
    marginLeft: 8,
    color: "#111827",
    fontWeight: "600",
  },

  // Utils
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  paySummaryRow: {
    marginTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  payPill: {
    flexGrow: 1,
    minWidth: (width - 32 - 24) / 2, // 2 por linha em telas pequenas
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  payPillTitle: { color: "#374151", fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  payPillValue: { color: "#111827", fontSize: 16, fontWeight: "800", marginTop: 4 },
});
