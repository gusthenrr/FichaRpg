import React, { useContext, useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { API_URL } from './url';
import { UserContext } from '../UserContext';
import { getSocket } from '../socket';

// ==========================
// Utils
// ==========================
const formatBRL = (n) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n || 0));

const getBasePrice = (product) => {
  if (!product) return 0;
  const candidates = [
    product.preco_base,      // prioridade
    product.preco,
    product.price,
    product.valor,
    product.valor_unitario,
  ];
  const found = candidates.find(
    (v) => typeof v !== 'undefined' && v !== null && !Number.isNaN(Number(v))
  );
  return Number(found || 0);
};

const clamp = (num, min, max) => Math.max(min, Math.min(max, Number(num)));

const getDiscountInfo = (base, type, value) => {
  const raw = Number(value || 0);
  if (type === 'value') {
    const v = Math.max(0, raw);
    const final = Math.max(0, base - v);
    return {
      label: `${formatBRL(base)} - ${formatBRL(v)} = ${formatBRL(final)}`,
      final,
    };
  }
  // percentage
  const v = clamp(raw, 0, 100);
  const final = Math.max(0, base * (1 - v / 100));
  return {
    label: `${formatBRL(base)} - ${v}% = ${formatBRL(final)}`,
    final,
  };
};

const onlyDigits = (s = '') => (s || '').replace(/\D/g, '');
const pad2 = (s) => String(s || '').padStart(2, '0');

const normalizeYearOnBlur = (y) => {
  const clean = onlyDigits(y);
  if (!clean) return '';
  if (clean.length === 2) return `20${clean}`;
  if (clean.length >= 4) return clean.slice(0, 4);
  return clean;
};

const isValidYMD = (y, m, d) => {
  const yy = Number(y), mm = Number(m), dd = Number(d);
  if (!yy || !mm || !dd) return false;
  const dt = new Date(`${yy}-${pad2(mm)}-${pad2(dd)}T00:00:00`);
  return (
    dt.getFullYear() === yy &&
    dt.getMonth() + 1 === mm &&
    dt.getDate() === dd
  );
};

const parseYMD = (ymd) => {
  if (typeof ymd !== 'string') return { d: '', m: '', y: '' };
  const [y, m, d] = ymd.split('-');
  return {
    d: onlyDigits(d).slice(0, 2) || '',
    m: onlyDigits(m).slice(0, 2) || '',
    y: onlyDigits(y).slice(0, 4) || '',
  };
};

const composeYMD = (d, m, y) => {
  const year = y || String(new Date().getFullYear());
  return `${year}-${pad2(m)}-${pad2(d)}`;
};

// ---------- clique guard geral ----------
const useGuards = () => {
  const guardsRef = useRef({});
  return useCallback((key, fn, cooldown = 300) => {
    if (guardsRef.current[key]) return;
    guardsRef.current[key] = true;
    Promise.resolve()
      .then(() => fn && fn())
      .finally(() => {
        setTimeout(() => {
          guardsRef.current[key] = false;
        }, cooldown);
      });
  }, []);
};

// ==========================
// Modal Criar/Editar Promoção
// ==========================
const PromotionModal = ({ visible, onClose, onSave, promotion, produtosCardapio, isOnline }) => {
  const isEditing = !!promotion;

  const [name, setName] = useState('');
  const [type, setType] = useState('percentage'); // 'percentage' | 'value'
  const [value, setValue] = useState('');
  const [endDay, setEndDay] = useState('');
  const [endMonth, setEndMonth] = useState('');
  const [endYear, setEndYear] = useState('');
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  // repopula quando 'promotion' muda
  useEffect(() => {
    if (promotion) {
      setName(promotion.name ?? '');
      setType(promotion.type === 'value' ? 'value' : 'percentage');
      setValue(String(promotion.value ?? ''));

      const { d, m, y } = parseYMD(promotion.endDate);
      setEndDay(d);
      setEndMonth(m);
      setEndYear(y);

      try {
        const parsed = Array.isArray(promotion.products)
          ? promotion.products
          : JSON.parse(promotion.products);
        setSelectedProducts(Array.isArray(parsed) ? parsed : []);
      } catch {
        setSelectedProducts([]);
      }
      setSearchTerm('');
    } else {
      setName('');
      setType('percentage');
      setValue('');
      setEndDay('');
      setEndMonth('');
      setEndYear('');
      setSelectedProducts([]);
      setSearchTerm('');
    }
  }, [promotion]);

  // busca produtos (com filtro simples por nome) que ainda não foram adicionados
  const availableProducts = useMemo(() => {
    if (!searchTerm) return [];
    const term = searchTerm.toLowerCase();
    const selectedIds = new Set(selectedProducts.map(p => p.id ?? p.item_id ?? p._id));
    return (produtosCardapio || []).filter((p) => {
      const id = p.id ?? p.item_id ?? p._id;
      const already = selectedIds.has(id);
      const label = (p.item ?? p.nome ?? p.title ?? '').toLowerCase();
      return !already && label.includes(term);
    }).slice(0, 30); // limita para evitar listas gigantes
  }, [searchTerm, selectedProducts, produtosCardapio]);

  const addProduct = (product) => {
    const id = product?.id ?? product?.item_id ?? product?._id;
    if (!id) return;
    setSelectedProducts((prev) => {
      if (prev.some((p) => (p.id ?? p.item_id ?? p._id) === id)) return prev; // evita duplicados
      return [...prev, product];
    });
    setSearchTerm('');
  };

  const removeProduct = (productId) => {
    setSelectedProducts((prev) =>
      prev.filter((p) => (p.id ?? p.item_id ?? p._id) !== productId)
    );
  };

  // Handlers dos campos de data
  const onChangeDay = (t) => {
    const d = onlyDigits(t).slice(0, 2);
    if (!d) return setEndDay('');
    const num = Number(d);
    setEndDay(String(clamp(num, 1, 31)));
  };

  const onChangeMonth = (t) => {
    const m = onlyDigits(t).slice(0, 2);
    if (!m) return setEndMonth('');
    const num = Number(m);
    setEndMonth(String(clamp(num, 1, 12)));
  };

  const onChangeYear = (t) => {
    setEndYear(onlyDigits(t).slice(0, 4));
  };

  const onBlurYear = () => setEndYear(normalizeYearOnBlur(endYear));

  // validações básicas
  const isNumeric = (s) => /^-?\d+([.,]\d+)?$/.test(String(s).trim());
  const parsedValue = useMemo(() => {
    if (!isNumeric(value)) return NaN;
    return Number(String(value).replace(',', '.'));
  }, [value]);

  const canSave = useMemo(() => {
    if (!name.trim()) return false;
    if (!selectedProducts.length) return false;
    if (!endDay || !endMonth) return false;
    if (!isNumeric(value)) return false;
    const y = endYear || String(new Date().getFullYear());
    if (!isValidYMD(y, endMonth, endDay)) return false;
    if (type === 'percentage' && !(parsedValue >= 0 && parsedValue <= 100)) return false;
    if (type === 'value' && !(parsedValue >= 0)) return false;
    return true;
  }, [name, value, selectedProducts, endDay, endMonth, endYear, type, parsedValue]);

  const handleSave = () => {
    if (!isOnline) {
      Alert.alert('Sem conexão', 'Conecte-se à internet para salvar a promoção.');
      return;
    }
    if (!canSave || saving) return;

    let y = endYear;
    if (!y) y = String(new Date().getFullYear());
    else if (y.length === 2) y = `20${y}`;
    else if (y.length === 3) y = y.padStart(4, '0');

    const d = pad2(endDay);
    const m = pad2(endMonth);

    if (!isValidYMD(y, m, d)) {
      Alert.alert('Data inválida', 'Verifique dia, mês e ano.');
      return;
    }

    const endDate = composeYMD(d, m, y);

    const sanitizedValue = type === 'percentage' ? clamp(parsedValue, 0, 100) : Math.max(0, parsedValue);

    const promotionData = {
      id: isEditing ? promotion.id : Date.now().toString(),
      name: name.trim(),
      type,
      value: sanitizedValue,
      endDate,
      status: 'active',
      products: selectedProducts,
    };

    setSaving(true);
    try {
      onSave(promotionData);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // preview dinâmico
  const previewLabelFor = (prod) => {
    const base = getBasePrice(prod);
    if (!base) return `Base: ${formatBRL(0)}`;
    const { label } = getDiscountInfo(base, type, parsedValue);
    return label;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={'padding'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 50}
        style={styles.modalBackdrop}
      >
        <View style={styles.modalContainer}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>{isEditing ? 'Editar Promoção' : 'Criar Nova Promoção'}</Text>

            <Text style={styles.label}>Nome da Promoção</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Ex: Promoção de Verão"
              placeholderTextColor="#999"
              autoCorrect={false}
            />

            <Text style={styles.label}>Tipo de Desconto</Text>
            <View style={styles.typeSelectorContainer}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.typeButton, type === 'percentage' && styles.typeButtonActive]}
                onPress={() => setType('percentage')}
              >
                <Text style={[styles.typeButtonText, type === 'percentage' && styles.typeButtonTextActive]}>
                  Porcentagem (%)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.typeButton, type === 'value' && styles.typeButtonActive]}
                onPress={() => setType('value')}
              >
                <Text style={[styles.typeButtonText, type === 'value' && styles.typeButtonTextActive]}>
                  Valor Fixo (R$)
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Valor</Text>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={setValue}
              placeholder={type === 'percentage' ? 'Ex: 15 (para 15%)' : 'Ex: 10 (para R$10)'}
              keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
              placeholderTextColor="#999"
            />

            <Text style={styles.label}>Válida até</Text>
            <View style={styles.dateRow}>
              <TextInput
                style={[styles.input, styles.dateInput]}
                value={endDay}
                onChangeText={onChangeDay}
                keyboardType="numeric"
                maxLength={2}
                placeholder="DD"
                placeholderTextColor="#999"
              />
              <Text style={styles.dateSeparator}>/</Text>
              <TextInput
                style={[styles.input, styles.dateInput]}
                value={endMonth}
                onChangeText={onChangeMonth}
                keyboardType="numeric"
                maxLength={2}
                placeholder="MM"
                placeholderTextColor="#999"
              />
              <Text style={styles.dateSeparator}>/</Text>
              <TextInput
                style={[styles.input, styles.dateInputYear]}
                value={endYear}
                onChangeText={onChangeYear}
                onBlur={onBlurYear}
                keyboardType="numeric"
                maxLength={4}
                placeholder="AAAA"
                placeholderTextColor="#999"
              />
            </View>

            <Text style={styles.label}>Produtos na Promoção</Text>
            <TextInput
              style={styles.input}
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Pesquisar produto para adicionar..."
              placeholderTextColor="#999"
              autoCorrect={false}
            />

            {/* Resultados da Pesquisa com preco_base + prévia */}
            {availableProducts.length > 0 && (
              <View style={styles.searchResultsContainer}>
                {availableProducts.map((product) => {
                  const base = getBasePrice(product);
                  const preview = Number(parsedValue) || parsedValue === 0 ? previewLabelFor(product) : '';
                  return (
                    <TouchableOpacity
                      key={String(product.id ?? product.item_id ?? product._id)}
                      style={styles.searchResultItem}
                      onPress={() => addProduct(product)}
                      activeOpacity={0.85}
                    >
                      <Text style={{ fontWeight: '600' }}>{product.item ?? product.nome ?? product.title}</Text>
                      <Text style={{ color: '#555', marginTop: 2 }}>
                        Base: {formatBRL(base)}{isFinite(parsedValue) ? `  ·  ${preview}` : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Produtos Selecionados */}
            <View style={styles.selectedProductsContainer}>
              {selectedProducts.length > 0 ? (
                selectedProducts.map((product) => {
                  const id = product.id ?? product.item_id ?? product._id;
                  const base = getBasePrice(product);
                  const preview = isFinite(parsedValue) ? previewLabelFor(product) : '';
                  const label = product.item ?? product.nome ?? product.title ?? 'Produto';
                  return (
                    <View key={String(id)} style={styles.selectedProductItem}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.selectedProductText}>{label}</Text>
                        <Text style={{ color: '#555', marginTop: 2 }}>
                          Base: {formatBRL(base)}{isFinite(parsedValue) ? `  ·  ${preview}` : ''}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => removeProduct(id)} activeOpacity={0.85}>
                        <Text style={styles.removeButtonText}>X</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.emptyText}>Nenhum produto adicionado.</Text>
              )}
            </View>
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity style={[styles.button, styles.buttonClose]} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.buttonText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonSave, (!canSave || saving || !isOnline) && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={!canSave || saving || !isOnline}
              activeOpacity={0.85}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Salvar</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ==========================
// Tela Principal
// ==========================
export default function PricesManagement() {
  const [promotions, setPromotions] = useState([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedPromotion, setSelectedPromotion] = useState(null);
  const socketRef = useRef(null);
  const isMountedRef = useRef(false);
  const [produtosCardapio, setProdutosCardapio] = useState([]);
  const [showExpiredOnly, setShowExpiredOnly] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const { user } = useContext(UserContext);
  const carrinho = user?.carrinho || '';
  const [deletingId, setDeletingId] = useState(null);
  const [loading, setLoading] = useState(true);

  const guard = useGuards();

  const filteredPromotions = useMemo(() => {
    return promotions.filter((p) =>
      showExpiredOnly ? p.status === 'expired' : p.status === 'active'
    );
  }, [promotions, showExpiredOnly]);

  // Conectividade
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const connected = !!state.isConnected;
      setIsOnline(connected);
    });
    return () => unsub();
  }, []);

  // Socket
  useEffect(() => {
    isMountedRef.current = true;

    const s = getSocket();
    socketRef.current = s;

    const setSafe = (fn) => {
      if (isMountedRef.current) fn();
    };

    const onPromotionsData = (data) => {
      // aceita array (normal) ou objeto { promotions: [] }
      try {
        const list = Array.isArray(data) ? data : Array.isArray(data?.promotions) ? data.promotions : [];
        setSafe(() => setPromotions(list));
      } catch {
        // ignora payload ruim
      } finally {
        setSafe(() => setLoading(false));
      }
    };

    const onRespostaItensPromotion = (data) => {
      if (data && Array.isArray(data.dataCardapio)) {
        setSafe(() => setProdutosCardapio(data.dataCardapio));
      }
    };

    // listeners
    try {
      const payloadDefault = { emitir: false, carrinho };
      s.emit?.('getPromotions', payloadDefault);
      s.on?.('promotionsData', onPromotionsData);

      s.emit?.('getItensPromotion', payloadDefault);
      s.on?.('respostaItensPromotion', onRespostaItensPromotion);

      s.on?.('connect', () => {
        // ressincroniza ao reconectar
        const payload = { emitir: true, carrinho };
        s.emit?.('getPromotions', payload);
        s.emit?.('getItensPromotion', payload);
      });
    } catch {
      // Se algo falhar silenciosamente, manter UI utilizável
    }

    // cleanup
    return () => {
      isMountedRef.current = false;
      try {
        s.off?.('promotionsData', onPromotionsData);
        s.off?.('respostaItensPromotion', onRespostaItensPromotion);
        s.off?.('connect');
      } catch {}
      socketRef.current = null;
    };
  }, []);

  const handleOpenCreateModal = () => {
    setSelectedPromotion(null);
    setIsModalVisible(true);
  };

  const handleOpenEditModal = (promotion) => {
    setSelectedPromotion(promotion);
    setIsModalVisible(true);
  };

  const handleCloseModal = () => {
    setIsModalVisible(false);
    setSelectedPromotion(null);
  };

  const handleSavePromotion = (promotionData) => {
    // feedback otimista + broadcast por socket
    const exists = promotions.some((p) => p.id === promotionData.id);
    const type = exists ? 'update' : 'create';

    setPromotions((prev) =>
      exists ? prev.map((p) => (p.id === promotionData.id ? promotionData : p)) : [promotionData, ...prev]
    );

    try {
      socketRef.current?.emit?.('savePromotion', {
        promotionData,
        emitirBroadcast: true,
        type,
        carrinho,
      });
    } catch {
      // Mantém UI estável; backend deve sincronizar na próxima conexão
    }
  };

  // Exclusão com guard e checagem de rede
  const requestDeletePromotion = async (promo) => {
    if (!promo?.id) return;
    if (!isOnline) {
      Alert.alert('Sem conexão', 'Conecte-se à internet para excluir a promoção.');
      return;
    }
    setDeletingId(promo.id);
    try {
      const res = await fetch(`${API_URL}/delete_promotion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: promo.id, carrinho }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Erro ao excluir promoção: ${res.status} ${txt}`);
      }

      let data = null;
      try {
        data = await res.json();
      } catch {
        // 200 sem corpo: ok
      }
      if (data && data.status && data.status !== 'success') {
        throw new Error(`Backend retornou status: ${data.status}`);
      }

      setPromotions((prev) => prev.filter((p) => p.id !== promo.id));
    } catch (err) {
      Alert.alert('Erro', 'Não foi possível excluir a promoção. Tente novamente.');
    } finally {
      setDeletingId(null);
    }
  };

  const deletePromotion = (promo) =>
    guard('delete', () => {
      Alert.alert(
        'Excluir promoção',
        `Tem certeza que deseja excluir "${promo.name}" (${promo.status})?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Confirmar',
            style: 'destructive',
            onPress: () => requestDeletePromotion(promo),
          },
        ]
      );
    });

  // une dados do prod salvo na promoção com o catálogo (para pegar preco_base mais recente)
  const getProductFromCatalog = (prodRef) => {
    if (!prodRef) return null;

    // se já veio com preço, prioriza isso
    if (
      typeof prodRef === 'object' &&
      ('preco_base' in prodRef || 'preco' in prodRef || 'price' in prodRef || 'valor' in prodRef)
    ) {
      return prodRef;
    }

    const id = prodRef.id ?? prodRef.item_id ?? prodRef._id;
    if (!id) return prodRef;

    const found = (produtosCardapio || []).find(
      (p) => (p.id ?? p.item_id ?? p._id) === id
    );

    return found || prodRef;
  };

  const renderPromotionItem = ({ item }) => {
    const isExpired = item.status === 'expired';
    const promoTypeLabel = item.type === 'value' ? 'Desconto: valor fixo' : 'Desconto: porcentagem';

    let prods = [];
    try {
      prods = Array.isArray(item.products) ? item.products : JSON.parse(item.products || '[]');
    } catch {
      prods = [];
    }

    return (
      <View style={styles.itemContainer}>
        <TouchableOpacity
          onPress={() => handleOpenEditModal(item)}
          style={styles.itemClickableArea}
          activeOpacity={0.85}
        >
          <Text style={styles.itemTitle}>{item.name}</Text>
          <Text style={styles.itemSubtitle}>Válida até: {item.endDate}</Text>

          <Text style={styles.promoType}>{promoTypeLabel}</Text>

          {/* Lista de produtos com cálculo do preço final e base vindo de preco_base */}
          {prods.length > 0 && (
            <View style={styles.productsList}>
              {prods.map((p) => {
                const fullProd = getProductFromCatalog(p);
                const base = getBasePrice(fullProd);
                const info = getDiscountInfo(base, item.type, item.value);
                const labelItem = fullProd?.item ?? fullProd?.nome ?? fullProd?.title ?? 'Produto';
                const key = String(fullProd?.id ?? fullProd?.item_id ?? labelItem);
                return (
                  <View key={key} style={styles.productRow}>
                    <Text style={styles.productName}>{labelItem}</Text>
                    <Text style={{ color: '#666', marginBottom: 2 }}>Base: {formatBRL(base)}</Text>
                    <Text style={styles.productPriceCalc}>{info.label}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.itemRightCol}>
          <View
            style={[
              styles.statusBadge,
              isExpired ? styles.statusBadgeExpired : styles.statusBadgeActive,
            ]}
          >
            <Text style={styles.statusText}>{item.status}</Text>
          </View>

          <TouchableOpacity
            style={[
              styles.deleteBtn,
              deletingId === item.id && { opacity: 0.6 },
              !isOnline && { opacity: 0.6 },
            ]}
            onPress={() => deletePromotion(item)}
            disabled={deletingId === item.id || !isOnline}
            activeOpacity={0.85}
          >
            {deletingId === item.id ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.deleteBtnText}>Excluir</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const keyExtractor = (item, idx) =>
    String(item?.id ?? `${item?.name || 'promo'}:${item?.endDate || 'date'}:${idx}`);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.title}>Promoções</Text>

        <TouchableOpacity
          onPress={() => setShowExpiredOnly((prev) => !prev)}
          style={styles.toggleBtn}
          activeOpacity={0.85}
        >
          <Text style={{ fontWeight: '600' }}>
            {showExpiredOnly ? 'Ver ativas' : 'Ver expiradas'}
          </Text>
        </TouchableOpacity>
      </View>

      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>Você está offline. Algumas ações ficarão indisponíveis.</Text>
        </View>
      )}

      {loading ? (
        <View style={{ paddingTop: 40, alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#007bff" />
          <Text style={{ marginTop: 8, color: '#666' }}>Carregando promoções...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredPromotions}
          renderItem={renderPromotionItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>Nenhuma promoção encontrada.</Text>}
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={7}
        />
      )}

      <TouchableOpacity style={[styles.fab, !isOnline && { opacity: 0.6 }]} onPress={handleOpenCreateModal} disabled={!isOnline} activeOpacity={0.9}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <PromotionModal
        visible={isModalVisible}
        onClose={handleCloseModal}
        onSave={handleSavePromotion}
        promotion={selectedPromotion}
        produtosCardapio={produtosCardapio}
        isOnline={isOnline}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },

  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#eee',
    marginLeft: 12,
  },

  offlineBanner: {
    backgroundColor: '#fff3cd',
    borderBottomWidth: 1,
    borderBottomColor: '#ffeeba',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  offlineText: { color: '#856404', textAlign: 'center', fontWeight: '700' },

  list: { padding: 20 },

  itemContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  itemClickableArea: { flex: 1, paddingRight: 10 },
  itemRightCol: { alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },

  itemTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  itemSubtitle: { fontSize: 14, color: '#666', marginTop: 4 },
  promoType: { marginTop: 8, fontSize: 13, fontWeight: '600', color: '#444' },

  productsList: {
    marginTop: 8,
    backgroundColor: '#fafafa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
    padding: 8,
    gap: 6,
  },
  productRow: { borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 6, marginBottom: 6 },
  productName: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 2 },
  productPriceCalc: { fontSize: 13, color: '#555' },

  statusBadge: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 12 },
  statusBadgeActive: { backgroundColor: '#d4edda' },
  statusBadgeExpired: { backgroundColor: '#f8d7da' },
  statusText: { fontSize: 12, fontWeight: 'bold', color: '#333' },

  deleteBtn: {
    marginTop: 8,
    backgroundColor: '#dc3545',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 90,
    alignItems: 'center',
  },
  deleteBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  fab: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#007bff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  fabText: { color: '#fff', fontSize: 30, lineHeight: 30 },

  emptyText: { textAlign: 'center', marginTop: 20, color: '#666' },

  // Modal
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContainer: {
    backgroundColor: 'white',
    height: '90%',
    borderTopRightRadius: 20,
    borderTopLeftRadius: 20,
    padding: 20,
  },
  modalTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  label: { fontSize: 16, color: '#333', marginBottom: 8, marginTop: 10, fontWeight: '500' },
  input: {
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    marginBottom: 10,
    color: '#111',
  },

  dateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  dateInput: { flex: 0, width: 70, textAlign: 'center', marginBottom: 0 },
  dateInputYear: { flex: 0, width: 90, textAlign: 'center', marginBottom: 0 },
  dateSeparator: { marginHorizontal: 6, fontSize: 18, fontWeight: '700', color: '#555' },

  typeSelectorContainer: { flexDirection: 'row', marginBottom: 10 },
  typeButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
    marginHorizontal: 5,
  },
  typeButtonActive: { backgroundColor: '#007bff', borderColor: '#007bff' },
  typeButtonText: { color: '#333' },
  typeButtonTextActive: { color: '#fff', fontWeight: 'bold' },

  searchResultsContainer: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginTop: 5,
    maxHeight: 220,
  },
  searchResultItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },

  selectedProductsContainer: { marginTop: 10 },
  selectedProductItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#e9ecef',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  selectedProductText: { color: '#333', fontWeight: '600' },
  removeButtonText: { color: 'red', fontWeight: 'bold', fontSize: 16, padding: 5 },

  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  button: { flex: 1, padding: 15, borderRadius: 8, alignItems: 'center', marginHorizontal: 5 },
  buttonSave: { backgroundColor: '#28a745' },
  buttonClose: { backgroundColor: '#6c757d' },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
});
