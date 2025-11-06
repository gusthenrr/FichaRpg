import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";

/* ---------- utils de tipo/conversão ---------- */
const toBool = (v) => v === true || v === 1 || v === "1";
const toInt = (v) => (v ? 1 : 0);
const toNum = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/* ---------- teclado numérico conforme plataforma ---------- */
const DEC_KB = Platform.OS === "ios" ? "decimal-pad" : "numeric";

/* ---------- geração de UIDs estáveis p/ chaves ---------- */
const uid = (() => {
  let c = 1;
  return () => c++;
})();

const withUids = (groups) => {
  if (!Array.isArray(groups)) return [];
  return groups.map((g) => ({
    __uid: g.__uid ?? uid(),
    nome: String(g?.nome ?? ""),
    ids: String(g?.ids ?? ""),
    max_selected: Number.isFinite(+g?.max_selected) ? +g.max_selected : 1,
    obrigatorio: toBool(g?.obrigatorio),
    options: (Array.isArray(g?.options) ? g.options : []).map((o) => ({
      __uid: o.__uid ?? uid(),
      nome: String(o?.nome ?? ""),
      valor_extra: toNum(o?.valor_extra),
      esgotado: toBool(o?.esgotado),
    })),
  }));
};

/* ---------- parsing/normalização/serialização canônica ---------- */
function parseOpcoes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    try {
      return JSON.parse(String(value).replace(/'/g, '"'));
    } catch {
      return [];
    }
  }
}

function normalizeOpcoes(arr) {
  return withUids(
    (Array.isArray(arr) ? arr : []).map((g) => ({
      nome: String(g?.nome ?? ""),
      ids: String(g?.ids ?? ""),
      max_selected: Number.isFinite(+g?.max_selected) ? +g.max_selected : 1,
      obrigatorio: toBool(g?.obrigatorio),
      options: (Array.isArray(g?.options) ? g.options : []).map((o) => ({
        nome: String(o?.nome ?? ""),
        valor_extra: toNum(o?.valor_extra),
        esgotado: toBool(o?.esgotado),
      })),
    }))
  );
}

function serializeOpcoes(arr) {
  const out = (Array.isArray(arr) ? arr : []).map((g) => ({
    nome: g.nome ?? "",
    ids: g.ids ?? "",
    max_selected: Number.isFinite(+g.max_selected) ? +g.max_selected : 1,
    obrigatorio: toInt(g.obrigatorio),
    options: (g.options || []).map((o) => ({
      nome: o.nome ?? "",
      valor_extra: toNum(o.valor_extra),
      esgotado: toInt(o.esgotado),
    })),
  }));
  return JSON.stringify(out);
}

function canonicalize(jsonish) {
  return serializeOpcoes(normalizeOpcoes(parseOpcoes(jsonish)));
}

/* ---------- hook: throttle estável p/ onChange ---------- */
function useThrottle(value, delay) {
  const [throttled, setThrottled] = useState(value);
  const tRef = useRef(null);
  useEffect(() => {
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setThrottled(value), delay);
    return () => {
      if (tRef.current) clearTimeout(tRef.current);
    };
  }, [value, delay]);
  return throttled;
}

/* ---------- guard p/ cliques rápidos ---------- */
function usePressGuard(cooldownMs = 250) {
  const lockedRef = useRef(false);
  return (fn) => () => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    try {
      fn && fn();
    } finally {
      setTimeout(() => {
        lockedRef.current = false;
      }, cooldownMs);
    }
  };
}

/* ===================== COMPONENTE ===================== */
export default function OpcoesEditorLite({ value, onChange, editable = true }) {
  // estado principal
  const [opcoes, setOpcoes] = useState(() =>
    normalizeOpcoes(parseOpcoes(value))
  );
  // memo do último JSON canônico visto
  const lastCanonicalRef = useRef(canonicalize(value));
  // guard global de cliques
  const safePress = usePressGuard(260);

  /* --- sincroniza vinda do pai (apenas se mudar canonicamente) --- */
  useEffect(() => {
    const nextCanonical = canonicalize(value);
    if (nextCanonical !== lastCanonicalRef.current) {
      lastCanonicalRef.current = nextCanonical;
      setOpcoes(normalizeOpcoes(parseOpcoes(value)));
    }
  }, [value]);

  /* --- propaga para o pai (anti-loop + throttle) --- */
  const serialized = useMemo(() => serializeOpcoes(opcoes), [opcoes]);
  const throttledSerialized = useThrottle(serialized, 100); // 100ms é rápido e evita floods

  useEffect(() => {
    if (typeof onChange !== "function") return;
    if (throttledSerialized !== lastCanonicalRef.current) {
      lastCanonicalRef.current = throttledSerialized;
      try {
        onChange(throttledSerialized);
      } catch {
        // não deixa o editor quebrar se o pai lançar erro
      }
    }
  }, [throttledSerialized, onChange]);

  /* ------------------ handlers ------------------ */
  const setGroupName = (idx, nome) => {
    setOpcoes((prev) => {
      const next = [...prev];
      if (!next[idx]) return prev;
      next[idx] = { ...next[idx], nome };
      return next;
    });
  };

  const setOptionField = (gIdx, oIdx, patch) => {
    setOpcoes((prev) => {
      const next = [...prev];
      if (!next[gIdx]) return prev;
      const opts = [...(next[gIdx].options || [])];
      if (!opts[oIdx]) return prev;
      opts[oIdx] = { ...opts[oIdx], ...patch };
      next[gIdx] = { ...next[gIdx], options: opts };
      return next;
    });
  };

  const addGroup = safePress(() => {
    if (!editable) return;
    setOpcoes((prev) => [
      ...prev,
      {
        __uid: uid(),
        nome: "",
        ids: "",
        max_selected: 1,
        obrigatorio: false,
        options: [{ __uid: uid(), nome: "", valor_extra: 0, esgotado: false }],
      },
    ]);
  });

  const removeGroup = (idx) =>
    safePress(() => {
      if (!editable) return;
      setOpcoes((prev) => prev.filter((_, i) => i !== idx));
    })();

  const addOption = (gIdx) =>
    safePress(() => {
      if (!editable) return;
      setOpcoes((prev) => {
        const next = [...prev];
        if (!next[gIdx]) return prev;
        next[gIdx] = {
          ...next[gIdx],
          options: [
            ...(next[gIdx].options || []),
            { __uid: uid(), nome: "", valor_extra: 0, esgotado: false },
          ],
        };
        return next;
      });
    })();

  const removeOption = (gIdx, oIdx) =>
    safePress(() => {
      if (!editable) return;
      setOpcoes((prev) => {
        const next = [...prev];
        if (!next[gIdx]) return prev;
        next[gIdx] = {
          ...next[gIdx],
          options: (next[gIdx].options || []).filter((_, i) => i !== oIdx),
        };
        return next;
      });
    })();

  /* ------------------ UI ------------------ */
  const ph = "#94A3B8"; // placeholder

  return (
    <View style={styles.wrapper}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Opções do Pedido</Text>
        {editable && (
          <TouchableOpacity
            style={[styles.addBtn, !editable && styles.btnDisabled]}
            onPress={addGroup}
            disabled={!editable}
            activeOpacity={0.85}
          >
            <Text style={styles.addBtnText}>+ Grupo</Text>
          </TouchableOpacity>
        )}
      </View>

      {opcoes.length === 0 && (
        <Text style={styles.hint}>
          Nenhum grupo. {editable ? "Toque em “+ Grupo” para adicionar." : ""}
        </Text>
      )}

      {opcoes.map((g, gIdx) => (
        <View key={g.__uid ?? `g-${gIdx}`} style={styles.groupCard}>
          <View style={styles.groupHeader}>
            <View style={styles.groupTitleWrap}>
              <View style={styles.groupAccent} />
              <Text style={styles.groupTitle}>
                {g.nome || `Grupo ${gIdx + 1}`}
              </Text>
            </View>
            {editable && (
              <TouchableOpacity
                onPress={() => removeGroup(gIdx)}
                style={[styles.dangerBtn, !editable && styles.btnDisabled]}
                disabled={!editable}
                activeOpacity={0.85}
              >
                <Text style={styles.dangerBtnText}>Remover grupo</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Nome do grupo */}
          <View style={styles.row}>
            <Text style={styles.label}>Nome do grupo</Text>
            <TextInput
              style={[styles.input, !editable && styles.readonly]}
              editable={editable}
              placeholder="Ex.: Tamanho"
              placeholderTextColor={ph}
              value={g.nome}
              onChangeText={(t) => setGroupName(gIdx, t)}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {/* Opções: nome + valor_extra */}
          <View style={styles.optionsHeader}>
            <Text style={styles.subtitle}>Opções</Text>
            {editable && (
              <TouchableOpacity
                onPress={() => addOption(gIdx)}
                style={[styles.addSmallBtn, !editable && styles.btnDisabled]}
                disabled={!editable}
                activeOpacity={0.85}
              >
                <Text style={styles.addSmallBtnText}>+ Opção</Text>
              </TouchableOpacity>
            )}
          </View>

          {(g.options || []).map((o, oIdx) => (
            <View key={o.__uid ?? `g-${gIdx}-o-${oIdx}`} style={styles.optionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Nome</Text>
                <TextInput
                  style={[styles.input, !editable && styles.readonly]}
                  editable={editable}
                  placeholder="Ex.: 300g"
                  placeholderTextColor={ph}
                  value={o.nome}
                  onChangeText={(t) => setOptionField(gIdx, oIdx, { nome: t })}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>

              <View style={{ width: 130, marginLeft: 10 }}>
                <Text style={styles.label}>Valor extra</Text>
                <TextInput
                  style={[styles.input, !editable && styles.readonly]}
                  editable={editable}
                  keyboardType={DEC_KB}
                  placeholder="0,00"
                  placeholderTextColor={ph}
                  value={
                    // mantemos string coerente, sem piscar
                    String(
                      typeof o.valor_extra === "number" ? o.valor_extra : toNum(o.valor_extra)
                    )
                  }
                  onChangeText={(t) =>
                    setOptionField(gIdx, oIdx, { valor_extra: toNum(t) })
                  }
                  autoCorrect={false}
                />
              </View>

              {editable && (
                <TouchableOpacity
                  onPress={() => removeOption(gIdx, oIdx)}
                  style={styles.removeOptBtn}
                  activeOpacity={0.85}
                >
                  <Text style={styles.removeOptBtnText}>Remover</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/* ===================== STYLES ===================== */
const styles = StyleSheet.create({
  // palette clara
  wrapper: { gap: 14 },
  title: { fontWeight: "800", fontSize: 18, color: "#0F172A" }, // azul-preto
  hint: { color: "#334155", opacity: 0.8, marginTop: 6 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  // Cards claros
  groupCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0", // slate-200
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 2 },
    }),
  },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  groupTitleWrap: { flexDirection: "row", alignItems: "center" },
  groupAccent: {
    width: 6,
    height: 20,
    borderRadius: 3,
    backgroundColor: "#2563EB",
    marginRight: 8,
  }, // azul
  groupTitle: { fontWeight: "700", fontSize: 16, color: "#0F172A" },

  // Botões
  addBtn: {
    backgroundColor: "#2563EB",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  addBtnText: { color: "#fff", fontWeight: "800", letterSpacing: 0.2 },
  btnDisabled: { opacity: 0.5 },
  addSmallBtn: {
    backgroundColor: "#2563EB",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addSmallBtnText: { color: "#fff", fontWeight: "800" },
  dangerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#B91C1C",
  },
  dangerBtnText: { color: "#fff", fontWeight: "800" },
  removeOptBtn: {
    alignSelf: "flex-start",
    marginTop: 6,
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  removeOptBtnText: { color: "#7F1D1D", fontWeight: "700" },

  // Inputs claros
  row: { flexDirection: "row", gap: 10 },
  label: { color: "#334155", marginBottom: 6, fontSize: 12, fontWeight: "700" },
  input: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderColor: "#D0D7E2", // cinza-azulado claro
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#0F172A",
  },
  readonly: { opacity: 0.6 },

  optionsHeader: {
    marginTop: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  subtitle: { fontWeight: "800", fontSize: 14, color: "#0F172A" },

  // Linha da opção clara
  optionRow: {
    marginTop: 10,
    backgroundColor: "#F8FAFC", // slate-50
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 12,
    gap: 8,
  },
});