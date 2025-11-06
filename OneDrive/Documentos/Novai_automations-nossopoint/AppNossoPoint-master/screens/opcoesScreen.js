// opcoesScreen.js
import React, { useContext,useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  Switch,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Platform,
  StatusBar,
  KeyboardAvoidingView,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { API_URL } from "./url";
import { UserContext } from '../UserContext';

// ======= PALETA (alto contraste sol) =======
const COLORS = {
  bg: "#F7FAFF",
  card: "#FFFFFF",
  border: "#D9E2F2",
  text: "#0B1220",
  textDim: "#30415C",
  blue: "#0A84FF",
  blueDark: "#005FCC",
  warn: "#FFB703",
  chipBg: "#E8F1FF",
  chipActiveBg: "#0A84FF",
  chipActiveText: "#FFFFFF",
};

const FETCH_TIMEOUT_MS = 12000;

const formatBRL = (n) => {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
  } catch {
    const s = (Number.isFinite(v) ? v : 0).toFixed(2);
    return `R$ ${s.replace(".", ",")}`;
  }
};

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of arr || []) {
    const k = keyFn(it);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
  }
  return out;
}

export default function OpcoesScreen() {
  const { user } = useContext(UserContext);
  const carrinho = user?.carrinho || "";
  // ======= Filters / Query State =======
  const [search, setSearch] = useState("");
  const [grupoSlug, setGrupoSlug] = useState(""); // "" = todos
  const [somenteEsgotados, setSomenteEsgotados] = useState(false);
  const [somenteExtraPositivo, setSomenteExtraPositivo] = useState(false);

  // ======= Data =======
  const [clusters, setClusters] = useState([]); // lista visível (com filtro grupoSlug)
  const [clustersForGroups, setClustersForGroups] = useState([]); // lista para chips (SEM grupoSlug)
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // ======= Modal de Edição =======
  const [modalVisible, setModalVisible] = useState(false);
  const [currentCluster, setCurrentCluster] = useState(null);

  // edição em massa de OPÇÕES
  const [editValorEnabled, setEditValorEnabled] = useState(false);
  const [editValor, setEditValor] = useState("");
  const [editEsgotadoEnabled, setEditEsgotadoEnabled] = useState(false);
  const [editEsgotado, setEditEsgotado] = useState(false);

  // edição em massa de GRUPO (propriedades)
  const [grpMaxSelEnabled, setGrpMaxSelEnabled] = useState(false);
  const [grpMaxSel, setGrpMaxSel] = useState("");
  const [grpObrigEnabled, setGrpObrigEnabled] = useState(false);
  const [grpObrig, setGrpObrig] = useState(false);
  const [grpIdsEnabled, setGrpIdsEnabled] = useState(false);
  const [grpIds, setGrpIds] = useState("");

  // restrição por itens
  const [restrictMap, setRestrictMap] = useState({});

  // dry-run e aplicação
  const [simulating, setSimulating] = useState(false);
  const [simulateResult, setSimulateResult] = useState(null);
  const [applying, setApplying] = useState(false);

  // ======= Refs p/ estabilidade =======
  const mountedRef = useRef(true);
  const debounceTimerRef = useRef(null);
  const hydratedRef = useRef(false); // <- evita debounce antes da 1ª hidratação

  // AbortControllers por request (latest-wins)
  const aggAbortRef = useRef(null);
  const groupAbortRef = useRef(null);
  const pendingTimersRef = useRef([]);

  // request ids p/ ignorar respostas antigas
  const aggReqIdRef = useRef(0);
  const groupReqIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const unsub = NetInfo.addEventListener((state) => {
      setIsOnline(!!state.isConnected);
    });
    return () => {
      mountedRef.current = false;
      unsub && unsub();

      // aborta fetches pendentes
      try { aggAbortRef.current?.abort(); } catch {}
      try { groupAbortRef.current?.abort(); } catch {}

      // limpa timeouts
      pendingTimersRef.current.forEach((t) => clearTimeout(t));
      pendingTimersRef.current = [];
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const gruposDisponiveis = useMemo(() => {
    const gs = uniqBy(
      (clustersForGroups || []).map((c) => ({ slug: c.grupo_slug, nome: c.grupo })),
      (x) => x.slug || ""
    ).filter((x) => x.slug);
    return gs;
  }, [clustersForGroups]);

  // ======= Helper fetch com timeout/cancelamento =======
  const fetchWithTimeout = async (url, options = {}, which = "agg") => {
    if (!isOnline) {
      throw new Error("Sem internet no dispositivo.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    pendingTimersRef.current.push(timeout);

    // aborta anterior do mesmo tipo
    if (which === "agg") {
      try { aggAbortRef.current?.abort(); } catch {}
      aggAbortRef.current = controller;
      // (IMPORTANTE) não mexer no contador aqui!
    } else if (which === "group") {
      try { groupAbortRef.current?.abort(); } catch {}
      groupAbortRef.current = controller;
      // (IMPORTANTE) não mexer no contador aqui!
    }

    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      return resp;
    } finally {
      clearTimeout(timeout);
    }
  };

  // ======= Fetchers =======
  async function fetchAggregate({ showSpinner = true } = {}) {
    // controla latest-wins APENAS aqui
    const reqId = aggReqIdRef.current + 1;
    aggReqIdRef.current = reqId;

    try {
      if (showSpinner) setLoading(true);

      const params = new URLSearchParams();
      if (search?.trim()) params.set("q", search.trim());
      if (grupoSlug) params.set("grupo_slug", grupoSlug);
      if (somenteEsgotados) params.set("somente_esgotados", "1");
      if (somenteExtraPositivo) params.set("somente_extra_positivo", "1");
      params.set("limit", "100");
      params.set("carrinho", carrinho || "");

      const url = `${API_URL}/opcoes/aggregate?${params.toString()}`;
      const res = await fetchWithTimeout(url, {}, "agg");
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = `Erro ${res.status}`;
        if (txt && txt.length < 200 && !/<[^>]+>/.test(txt)) msg += ` ${txt}`;
        throw new Error(msg);
      }
      const data = await res.json();

      // latest-wins
      if (!mountedRef.current || reqId !== aggReqIdRef.current) return;
      setClusters(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err?.name === "AbortError") return; // <- não alertar cancelamentos
      const raw = err?.message || "Falha ao buscar opções.";
      const safeMsg =
        raw && raw.length < 200 && !/<[^>]+>/.test(raw) ? raw : "Falha na comunicação. Tente novamente.";
      Alert.alert("Erro", safeMsg);
    } finally {
      if (mountedRef.current && showSpinner) setLoading(false);
    }
  }

  async function fetchGroupsAggregate() {
    const reqId = groupReqIdRef.current + 1;
    groupReqIdRef.current = reqId;

    try {
      const params = new URLSearchParams();
      if (search?.trim()) params.set("q", search.trim());
      if (somenteEsgotados) params.set("somente_esgotados", "1");
      if (somenteExtraPositivo) params.set("somente_extra_positivo", "1");
      params.set("limit", "500");
      params.set("carrinho", carrinho || "");

      const url = `${API_URL}/opcoes/aggregate?${params.toString()}`;
      const res = await fetchWithTimeout(url, {}, "group");
      if (!res.ok) {
        // latest-wins: se falhar, limpamos somente se for a resposta vigente
        if (!mountedRef.current || reqId !== groupReqIdRef.current) return;
        setClustersForGroups([]);
        return;
      }
      const data = await res.json();
      if (!mountedRef.current || reqId !== groupReqIdRef.current) return;
      setClustersForGroups(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err?.name === "AbortError") return; // silencioso
      // Mantém estado anterior para não piscar chips
      // (poderia logar no console se quiser)
    }
  }

  async function onRefresh() {
    try {
      setRefreshing(true);
      await Promise.all([
        fetchAggregate({ showSpinner: false }),
        fetchGroupsAggregate(),
      ]);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }

  // primeira carga — evita corrida: 1º aggregate, depois groups
  useEffect(() => {
    let t;
    (async () => {
      await fetchAggregate({ showSpinner: true });
      t = setTimeout(() => {
        fetchGroupsAggregate();
        hydratedRef.current = true; // libera os debounces subsequentes
      }, 400);
    })();
    return () => t && clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // debounce para filtros: search/esgotados/extra>0
  useEffect(() => {
    if (!hydratedRef.current) return; // evita disparo em cima da 1ª carga
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchAggregate({ showSpinner: true });
      fetchGroupsAggregate();
    }, 350);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, somenteEsgotados, somenteExtraPositivo]);

  // fetch ao trocar grupo (leve debounce)
  useEffect(() => {
    if (!hydratedRef.current) return; // só depois de hidratar
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchAggregate({ showSpinner: true });
    }, 250); // um pouco maior para evitar colisão
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupoSlug]);

  // ======= Modal handlers =======
  function openEditModal(cluster) {
    setCurrentCluster(cluster);
    const initialRestrict = {};
    (cluster?.amostra_itens || []).forEach((it) => {
      initialRestrict[it.item_id] = true;
    });
    setRestrictMap(initialRestrict);

    // reset edição opções
    setEditValorEnabled(false);
    setEditValor("");
    setEditEsgotadoEnabled(false);
    setEditEsgotado(false);

    // reset edição grupo
    setGrpMaxSelEnabled(false);
    setGrpMaxSel("");
    setGrpObrigEnabled(false);
    setGrpObrig(false);
    setGrpIdsEnabled(false);
    setGrpIds("");

    setSimulateResult(null);
    setModalVisible(true);
  }

  function closeEditModal() {
    if (applying || simulating) return; // evita fechar enquanto processa
    setModalVisible(false);
    setCurrentCluster(null);
    setSimulateResult(null);
    setRestrictMap({});
  }

  function toggleRestrict(itemId) {
    setRestrictMap((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  }

  function selectedItemIds() {
    return Object.entries(restrictMap)
      .filter(([, v]) => !!v)
      .map(([k]) => Number(k));
  }

  // ======= Bulk OPÇÕES =======
  function buildPayloadOptions(dry_run) {
    if (!currentCluster) return null;
    const set = {};
    if (editValorEnabled && editValor !== "") {
      const v = Number(
        String(editValor).replace(",", ".").replace(/[^\d.-]/g, "")
      );
      if (!Number.isFinite(v)) {
        Alert.alert("Valor inválido", "Informe um número válido para o valor extra.");
        return null;
      }
      set.valor_extra = v;
    }
    if (editEsgotadoEnabled) {
      set.esgotado = editEsgotado ? 1 : 0;
    }
    if (Object.keys(set).length === 0) {
      Alert.alert(
        "Nada para alterar",
        "Habilite pelo menos um campo (Valor extra ou Esgotado)."
      );
      return null;
    }
    const items = selectedItemIds();
    return {
      carrinho,
      where: {
        grupo_slug: currentCluster.grupo_slug,
        opcao_slug: currentCluster.opcao_slug,
      },
      restrict_items: items.length ? items : undefined,
      set,
      dry_run,
    };
  }

  async function doSimulateOptions() {
    if (simulating || applying) return;
    if (!isOnline) {
      Alert.alert("Sem internet", "Conecte-se para simular.");
      return;
    }
    const payload = buildPayloadOptions(true);
    if (!payload) return;
    try {
      setSimulating(true);
      const res = await fetchWithTimeout(
        `${API_URL}/opcoes/bulk-update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        "agg"
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = `Erro ${res.status}`;
        if (txt && txt.length < 200 && !/<[^>]+>/.test(txt)) msg += ` ${txt}`;
        throw new Error(msg);
      }
      const data = await res.json();
      if (!mountedRef.current) return;
      setSimulateResult(data);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err?.name === "AbortError") return; // silencioso
      const raw = err?.message || "Falha ao simular alterações.";
      const safeMsg =
        raw && raw.length < 200 && !/<[^>]+>/.test(raw) ? raw : "Falha na comunicação. Tente novamente.";
      Alert.alert("Erro", safeMsg);
    } finally {
      if (mountedRef.current) setSimulating(false);
    }
  }

  async function doApplyOptions() {
    if (applying || simulating) return;
    if (!isOnline) {
      Alert.alert("Sem internet", "Conecte-se para aplicar alterações.");
      return;
    }
    const payload = buildPayloadOptions(false);
    if (!payload) return;

    try {
      setApplying(true);
      const res = await fetchWithTimeout(
        `${API_URL}/opcoes/bulk-update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        "agg"
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = `Erro ${res.status}`;
        if (txt && txt.length < 200 && !/<[^>]+>/.test(txt)) msg += ` ${txt}`;
        throw new Error(msg);
      }
      const data = await res.json();

      // sincroniza JSON dos itens (best-effort)
      if (Array.isArray(data?.items) && data.items.length) {
        fetchWithTimeout(
          `${API_URL}/opcoes/sync-json`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: data.items, carrinho }),
          },
          "group"
        ).catch(() => {});
      }

      Alert.alert(
        "Sucesso",
        `Atualizado: ${data.updated ?? data.matched ?? 0} ocorrência(s).`
      );
      closeEditModal();
      fetchAggregate();
    } catch (err) {
      if (!mountedRef.current) return;
      if (err?.name === "AbortError") return; // silencioso
      const raw = err?.message || "Falha ao aplicar alterações.";
      const safeMsg =
        raw && raw.length < 200 && !/<[^>]+>/.test(raw) ? raw : "Falha na comunicação. Tente novamente.";
      Alert.alert("Erro", safeMsg);
    } finally {
      if (mountedRef.current) setApplying(false);
    }
  }

  // ======= Bulk PROPRIEDADES DO GRUPO =======
  function buildPayloadGroup(dry_run) {
    if (!currentCluster) return null;
    const set = {};
    if (grpMaxSelEnabled && grpMaxSel !== "") {
      const n = parseInt(String(grpMaxSel).replace(/[^\d-]/g, ""), 10);
      if (!Number.isInteger(n) || n < 0) {
        Alert.alert("Valor inválido", "max_selected deve ser um inteiro >= 0.");
        return null;
      }
      set.max_selected = n;
    }
    if (grpObrigEnabled) {
      set.obrigatorio = grpObrig ? 1 : 0;
    }
    if (grpIdsEnabled) {
      set.ids = String(grpIds);
    }
    if (Object.keys(set).length === 0) {
      Alert.alert(
        "Nada para alterar",
        "Habilite pelo menos um campo (max_selected, obrigatório ou ids)."
      );
      return null;
    }
    const items = selectedItemIds();
    return {
      carrinho,
      where: { grupo_slug: currentCluster.grupo_slug },
      restrict_items: items.length ? items : undefined,
      set,
      dry_run,
    };
  }

  async function doSimulateGroup() {
    if (simulating || applying) return;
    if (!isOnline) {
      Alert.alert("Sem internet", "Conecte-se para simular.");
      return;
    }
    const payload = buildPayloadGroup(true);
    if (!payload) return;
    try {
      setSimulating(true);
      const res = await fetchWithTimeout(
        `${API_URL}/opcoes/group-props-bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        "group"
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = `Erro ${res.status}`;
        if (txt && txt.length < 200 && !/<[^>]+>/.test(txt)) msg += ` ${txt}`;
        throw new Error(msg);
      }
      const data = await res.json();
      if (!mountedRef.current) return;
      setSimulateResult(data);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err?.name === "AbortError") return; // silencioso
      const raw = err?.message || "Falha ao simular propriedades do grupo.";
      const safeMsg =
        raw && raw.length < 200 && !/<[^>]+>/.test(raw) ? raw : "Falha na comunicação. Tente novamente.";
      Alert.alert("Erro", safeMsg);
    } finally {
      if (mountedRef.current) setSimulating(false);
    }
  }

  async function doApplyGroup() {
    if (applying || simulating) return;
    if (!isOnline) {
      Alert.alert("Sem internet", "Conecte-se para aplicar alterações.");
      return;
    }
    const payload = buildPayloadGroup(false);
    if (!payload) return;
    try {
      setApplying(true);
      const res = await fetchWithTimeout(
        `${API_URL}/opcoes/group-props-bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        "group"
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = `Erro ${res.status}`;
        if (txt && txt.length < 200 && !/<[^>]+>/.test(txt)) msg += ` ${txt}`;
        throw new Error(msg);
      }
      const data = await res.json();
      Alert.alert(
        "Sucesso",
        `Grupos atualizados em ${data.updated ?? data.matched ?? 0} item(ns).`
      );
      closeEditModal();
      fetchAggregate();
    } catch (err) {
      if (!mountedRef.current) return;
      if (err?.name === "AbortError") return; // silencioso
      const raw = err?.message || "Falha ao aplicar propriedades do grupo.";
      const safeMsg =
        raw && raw.length < 200 && !/<[^>]+>/.test(raw) ? raw : "Falha na comunicação. Tente novamente.";
      Alert.alert("Erro", safeMsg);
    } finally {
      if (mountedRef.current) setApplying(false);
    }
  }

  // ======= Render =======
  const renderCluster = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          {item.grupo} • {item.opcao}
        </Text>
        <View style={styles.badges}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Ocorrências: {item.ocorrencias}</Text>
          </View>
          {item.esgotados > 0 ? (
            <View style={[styles.badge, styles.badgeWarn]}>
              <Text style={[styles.badgeText, styles.badgeWarnText]}>
                Esgotados: {item.esgotados}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.row}>
        <Text style={styles.dim}>Média extra:</Text>
        <Text style={styles.value}>
          {formatBRL(item.media_valor_extra ?? 0)}
        </Text>
      </View>

      <View style={styles.itemsRow}>
        {(item.amostra_itens || []).slice(0, 6).map((it) => (
          <View key={it.item_id} style={styles.itemChip}>
            <Text style={styles.itemChipText}>
              #{it.item_id} {it.item_nome}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.editBtn, (!isOnline || applying || simulating) && { opacity: 0.7 }]}
          onPress={() => openEditModal(item)}
          disabled={!isOnline || applying || simulating}
          activeOpacity={0.8}
        >
          <Text style={styles.editBtnText}>Editar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Banner simples de conectividade */}
      {!isOnline && (
        <View style={{ backgroundColor: "#fee2e2", padding: 8 }}>
          <Text style={{ color: "#991b1b", textAlign: "center", fontWeight: "700" }}>
            Sem internet — exibindo dados locais/anteriores
          </Text>
        </View>
      )}

      {/* Filtros */}
      <View style={styles.filters}>
        <TextInput
          placeholder="Pesquisar grupo/opção/itens..."
          placeholderTextColor="#7A8AAA"
          value={search}
          onChangeText={setSearch}
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
          <Pressable
            style={[styles.chip, !grupoSlug && styles.chipActive]}
            onPress={() => setGrupoSlug("")}
          >
            <Text style={[styles.chipText, !grupoSlug && styles.chipTextActive]}>
              Todos
            </Text>
          </Pressable>
          {gruposDisponiveis.map((g) => (
            <Pressable
              key={g.slug}
              style={[styles.chip, grupoSlug === g.slug && styles.chipActive]}
              onPress={() => setGrupoSlug(g.slug)}
            >
              <Text
                style={[
                  styles.chipText,
                  grupoSlug === g.slug && styles.chipTextActive,
                ]}
              >
                {g.nome}
              </Text>
            </Pressable>
          ))}
          {!!grupoSlug && (
            <Pressable style={[styles.chipOutline]} onPress={() => setGrupoSlug("")}>
              <Text style={styles.chipOutlineText}>Limpar filtro</Text>
            </Pressable>
          )}
        </ScrollView>

        <View style={styles.switchRow}>
          <View style={styles.switchItem}>
            <Switch
              value={somenteEsgotados}
              onValueChange={setSomenteEsgotados}
              trackColor={{ false: "#CFE3FF", true: COLORS.blue }}
              thumbColor="#fff"
            />
            <Text style={styles.switchText}>Somente esgotados</Text>
          </View>
          <View style={styles.switchItem}>
            <Switch
              value={somenteExtraPositivo}
              onValueChange={setSomenteExtraPositivo}
              trackColor={{ false: "#CFE3FF", true: COLORS.blue }}
              thumbColor="#fff"
            />
            <Text style={styles.switchText}>Extra &gt; 0</Text>
          </View>
        </View>
      </View>

      {/* Lista */}
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={COLORS.blue} />
          <Text style={{ color: COLORS.textDim, marginTop: 8 }}>Carregando...</Text>
        </View>
      ) : (
        <FlatList
          data={clusters}
          keyExtractor={(it, idx) => `${it.grupo_slug}:${it.opcao_slug}:${idx}`}
          renderItem={renderCluster}
          refreshing={refreshing}
          onRefresh={onRefresh}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={{ color: COLORS.textDim, textAlign: "center", marginTop: 32 }}>
              Nenhum resultado.
            </Text>
          }
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        />
      )}

      {/* Modal de Edição */}
      <Modal visible={modalVisible} onRequestClose={closeEditModal} animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalHeaderSafe}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {currentCluster ? `${currentCluster.grupo} • ${currentCluster.opcao}` : "Edição"}
              </Text>
              <TouchableOpacity
                onPress={closeEditModal}
                style={[styles.closePill, (applying || simulating) && { opacity: 0.7 }]}
                disabled={applying || simulating}
                activeOpacity={0.8}
              >
                <Text style={styles.closePillText}>Fechar</Text>
              </TouchableOpacity>
            </View>
          </View>

          {currentCluster ? (
            <ScrollView contentContainerStyle={{ paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
              {/* Resumo */}
              <View style={styles.summary}>
                <Text style={styles.summaryText}>
                  Ocorrências: <Text style={styles.bold}>{currentCluster.ocorrencias}</Text> • Esgotados{" "}
                  <Text style={[styles.bold, currentCluster.esgotados ? { color: COLORS.warn } : null]}>
                    {currentCluster.esgotados}
                  </Text>
                </Text>
                <Text style={styles.summaryText}>
                  Média extra: <Text style={styles.bold}>{formatBRL(currentCluster.media_valor_extra || 0)}</Text>
                </Text>
                {!isOnline && (
                  <Text style={[styles.summaryText, { color: "#b91c1c", marginTop: 6 }]}>
                    Offline — alterações desabilitadas
                  </Text>
                )}
              </View>

              {/* Seleção de itens */}
              <Text style={styles.sectionTitle}>Aplicar em quais itens?</Text>
              <View style={styles.itemsBox}>
                {(currentCluster.amostra_itens || []).map((it) => {
                  const checked = !!restrictMap[it.item_id];
                  return (
                    <Pressable
                      key={it.item_id}
                      style={[styles.itemRow, checked && styles.itemRowActive]}
                      onPress={() => toggleRestrict(it.item_id)}
                    >
                      <View style={[styles.checkbox, checked && styles.checkboxOn]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemRowTitle}>
                          #{it.item_id} {it.item_nome}
                        </Text>
                        <Text style={styles.itemRowSub}>
                          extra: {formatBRL(it.valor_extra)} • {it.esgotado ? "ESGOTADO" : "disponível"}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* ===== OPÇÕES (valor_extra / esgotado) ===== */}
              <Text style={styles.sectionTitle}>Alterar opções</Text>
              <View style={styles.editBlock}>
                <View style={styles.switchItem}>
                  <Switch
                    value={editValorEnabled}
                    onValueChange={setEditValorEnabled}
                    trackColor={{ false: "#CFE3FF", true: COLORS.blue }}
                    thumbColor="#fff"
                  />
                  <Text style={styles.switchText}>Editar valor extra</Text>
                </View>
                {editValorEnabled && (
                  <TextInput
                    placeholder="Novo valor extra (ex.: 22.00)"
                    placeholderTextColor="#7A8AAA"
                    keyboardType="decimal-pad"
                    value={editValor}
                    onChangeText={setEditValor}
                    style={styles.input}
                  />
                )}

                <View style={[styles.switchItem, { marginTop: 8 }]}>
                  <Switch
                    value={editEsgotadoEnabled}
                    onValueChange={setEditEsgotadoEnabled}
                    trackColor={{ false: "#CFE3FF", true: COLORS.blue }}
                    thumbColor="#fff"
                  />
                  <Text style={styles.switchText}>Editar status esgotado</Text>
                </View>
                {editEsgotadoEnabled && (
                  <View style={styles.switchRowLeft}>
                    <Switch
                      value={editEsgotado}
                      onValueChange={setEditEsgotado}
                      trackColor={{ false: "#CFE3FF", true: COLORS.blue }}
                      thumbColor="#fff"
                    />
                    <Text style={styles.switchText}>
                      {editEsgotado ? "Marcar ESGOTADO" : "Marcar disponível"}
                    </Text>
                  </View>
                )}

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnOutline]}
                    onPress={doSimulateOptions}
                    disabled={simulating || applying || !isOnline}
                    activeOpacity={0.8}
                  >
                    {simulating ? (
                      <ActivityIndicator color={COLORS.blue} />
                    ) : (
                      <Text style={[styles.btnText, styles.btnOutlineText]}>Simular</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={doApplyOptions}
                    disabled={applying || !isOnline}
                    activeOpacity={0.8}
                  >
                    {applying ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={[styles.btnText, styles.btnPrimaryText]}>Aplicar</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* ===== PROPRIEDADES DO GRUPO (max_selected / obrigatorio / ids) ===== */}
              <Text style={styles.sectionTitle}>Propriedades do grupo</Text>
              <View style={styles.editBlock}>
                <View style={styles.switchItem}>
                  <Switch
                    value={grpMaxSelEnabled}
                    onValueChange={setGrpMaxSelEnabled}
                    trackColor={{ false: "#CFE3FF", true: COLORS.blue }}
                    thumbColor="#fff"
                  />
                  <Text style={styles.switchText}>Editar max_selected</Text>
                </View>
                {grpMaxSelEnabled && (
                  <TextInput
                    placeholder="Novo max_selected (ex.: 1, 2, 3...)"
                    placeholderTextColor="#7A8AAA"
                    keyboardType="number-pad"
                    value={grpMaxSel}
                    onChangeText={setGrpMaxSel}
                    style={styles.input}
                  />
                )}

                <View style={[styles.switchItem, { marginTop: 8 }]}>
                  <Switch
                    value={grpObrigEnabled}
                    onValueChange={setGrpObrigEnabled}
                    trackColor={{ false: "#CFE3FF", true: COLORS.blue }}
                    thumbColor="#fff"
                  />
                  <Text style={styles.switchText}>Editar obrigatório</Text>
                </View>
                {grpObrigEnabled && (
                  <View style={styles.switchRowLeft}>
                    <Switch
                      value={grpObrig}
                      onValueChange={setGrpObrig}
                      trackColor={{ false: "#CFE3FF", true: COLORS.blue }}
                      thumbColor="#fff"
                    />
                    <Text style={styles.switchText}>
                      {grpObrig ? "Marcar OBRIGATÓRIO" : "Marcar opcional"}
                    </Text>
                  </View>
                )}

                <View style={[styles.switchItem, { marginTop: 8 }]}>
                  <Switch
                    value={grpIdsEnabled}
                    onValueChange={setGrpIdsEnabled}
                    trackColor={{ false: "#CFE3FF", true: COLORS.blue }}
                    thumbColor="#fff"
                  />
                  <Text style={styles.switchText}>Editar campo IDs</Text>
                </View>
                {grpIdsEnabled && (
                  <TextInput
                    placeholder="Novo ids (texto livre)"
                    placeholderTextColor="#7A8AAA"
                    value={grpIds}
                    onChangeText={setGrpIds}
                    style={styles.input}
                  />
                )}

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnOutline]}
                    onPress={doSimulateGroup}
                    disabled={simulating || applying || !isOnline}
                    activeOpacity={0.8}
                  >
                    {simulating ? (
                      <ActivityIndicator color={COLORS.blue} />
                    ) : (
                      <Text style={[styles.btnText, styles.btnOutlineText]}>Simular grupo</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={doApplyGroup}
                    disabled={applying || !isOnline}
                    activeOpacity={0.8}
                  >
                    {applying ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={[styles.btnText, styles.btnPrimaryText]}>Aplicar grupo</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Resultado da simulação (última operação) */}
              {simulateResult && (
                <View style={styles.simBox}>
                  <Text style={styles.simTitle}>Simulação</Text>
                  <Text style={styles.simText}>
                    Ocorrências encontradas: {simulateResult.matched}
                  </Text>
                  <Text style={styles.simText}>
                    Seriam alteradas: {simulateResult.would_update ?? simulateResult.matched ?? 0}
                  </Text>
                  {Array.isArray(simulateResult.items) && simulateResult.items.length > 0 && (
                    <Text style={styles.simHint}>
                      Itens afetados: {simulateResult.items.join(", ")}
                    </Text>
                  )}
                </View>
              )}
            </ScrollView>
          ) : (
            <View style={styles.loader}>
              <ActivityIndicator size="large" color={COLORS.blue} />
            </View>
          )}

          {/* Botão fechar fixo no rodapé para acessibilidade */}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              onPress={closeEditModal}
              style={[styles.closeBottomBtn, (applying || simulating) && { opacity: 0.7 }]}
              disabled={applying || simulating}
              activeOpacity={0.8}
            >
              <Text style={styles.closeBottomText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ======= STYLES =======
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  filters: { padding: 12, paddingBottom: 0 },
  input: {
    backgroundColor: "#FFFFFF",
    color: COLORS.text,
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginBottom: 8,
    fontSize: 16,
  },

  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 8,
  },
  switchRowLeft: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  switchItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  switchText: { color: COLORS.text, fontSize: 16 },

  chip: {
    borderWidth: 2,
    borderColor: COLORS.blue,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    marginRight: 8,
    backgroundColor: COLORS.chipBg,
  },
  chipActive: {
    backgroundColor: COLORS.chipActiveBg,
    borderColor: COLORS.chipActiveBg,
  },
  chipText: { color: COLORS.text },
  chipTextActive: { color: COLORS.chipActiveText, fontWeight: "800" },
  chipOutline: {
    borderWidth: 2,
    borderColor: COLORS.blueDark,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    marginRight: 8,
    backgroundColor: "#FFFFFF",
  },
  chipOutlineText: { color: COLORS.blueDark, fontWeight: "800" },

  loader: { alignItems: "center", justifyContent: "center", paddingTop: 24 },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { color: COLORS.text, fontWeight: "800", fontSize: 18 },
  badges: { flexDirection: "row", gap: 8 },
  badge: {
    backgroundColor: "#EFF5FF",
    borderWidth: 2,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { color: COLORS.textDim, fontSize: 12 },
  badgeWarn: { backgroundColor: "#FFF6E5", borderColor: "#FAD7A0" },
  badgeWarnText: { color: COLORS.warn, fontWeight: "800" },

  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  dim: { color: COLORS.textDim, fontSize: 15 },
  value: { color: COLORS.text, fontWeight: "800", fontSize: 16 },

  itemsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  itemChip: {
    backgroundColor: "#F0F6FF",
    borderWidth: 2,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  itemChipText: { color: COLORS.textDim, fontSize: 12 },

  footer: { marginTop: 10, alignItems: "flex-end" },
  editBtn: {
    backgroundColor: COLORS.blue,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  editBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },

  // ===== Modal
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 12,
    paddingBottom: 0,
  },
  modalHeaderSafe: {
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 8 : 16,
    backgroundColor: COLORS.bg,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  modalTitle: { color: COLORS.text, fontSize: 20, fontWeight: "900", flex: 1, paddingRight: 8 },
  closePill: {
    backgroundColor: COLORS.blue,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  closePillText: { color: "#fff", fontWeight: "800", fontSize: 16 },

  summary: {
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  summaryText: { color: COLORS.textDim, fontSize: 16 },
  bold: { color: COLORS.text, fontWeight: "900" },

  sectionTitle: { color: COLORS.text, fontWeight: "900", marginVertical: 8, fontSize: 16 },

  itemsBox: {
    backgroundColor: COLORS.card,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderRadius: 12,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.border,
  },
  itemRowActive: { backgroundColor: "#EEF5FF" },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.blue,
    backgroundColor: "transparent",
  },
  checkboxOn: { backgroundColor: COLORS.blue },
  itemRowTitle: { color: COLORS.text, fontWeight: "800", fontSize: 16 },
  itemRowSub: { color: COLORS.textDim, fontSize: 12 },

  editBlock: {
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginTop: 10,
  },

  actionsRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnOutline: {
    borderWidth: 3,
    borderColor: COLORS.blue,
    backgroundColor: "#FFFFFF",
  },
  btnOutlineText: { color: COLORS.blue, fontWeight: "900", fontSize: 16 },
  btnPrimary: { backgroundColor: COLORS.blue },
  btnPrimaryText: { color: "#111", fontWeight: "900" },
  btnText: { fontSize: 16 },

  // Resultado de simulação
  simBox: {
    backgroundColor: "#F2F7FF",
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginTop: 12,
  },
  simTitle: { color: COLORS.text, fontWeight: "900", marginBottom: 6, fontSize: 16 },
  simText: { color: COLORS.textDim },
  simHint: { color: COLORS.textDim, marginTop: 4, fontSize: 12 },

  // Rodapé do modal com botão grande de fechar
  modalFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    backgroundColor: COLORS.bg,
    borderTopWidth: 2,
    borderTopColor: COLORS.border,
  },
  closeBottomBtn: {
    backgroundColor: COLORS.blueDark,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  closeBottomText: { color: "#fff", fontWeight: "900", fontSize: 16 },
});

