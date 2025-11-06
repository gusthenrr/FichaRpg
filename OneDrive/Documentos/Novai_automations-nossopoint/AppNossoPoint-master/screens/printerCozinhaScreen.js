// ImpressaoScreen.js
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { API_URL } from './url';
import { UserContext } from '../UserContext';
import { PrinterService } from '../PrinterService';
import { getSocket } from '../socket';

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
};

const collectPedidoIds = (raw) => {
  const set = new Set();
  if (!raw) return [];
  ensureArray(raw.ids).forEach((val) => {
    if (val !== undefined && val !== null) set.add(val);
  });
  if (raw.id !== undefined && raw.id !== null) {
    set.add(raw.id);
  }
  if (Array.isArray(raw.pedido)) {
    raw.pedido.forEach((item) => {
      const itemId = item?.id;
      if (itemId !== undefined && itemId !== null) set.add(itemId);
    });
  }
  return Array.from(set);
};

const normalizePedidoItens = (rawPedido, { quantidade, opcoes, extra } = {}) => {
  if (Array.isArray(rawPedido) && rawPedido.length) {
    return rawPedido
      .map((it) => {
        if (it && typeof it === 'object') {
          const normalized = {
            pedido: it.pedido ?? it.nome ?? '',
            quantidade: it.quantidade ?? it.quant ?? 1,
          };
          if (it.opcoes) normalized.opcoes = it.opcoes;
          if (it.extra) normalized.extra = it.extra;
          if (it.id !== undefined) normalized.id = it.id;
          return normalized;
        }
        return { pedido: String(it ?? ''), quantidade: 1 };
      })
      .filter((it) => it.pedido);
  }

  const nome = rawPedido ?? '';
  if (!nome && !quantidade && !opcoes && !extra) return [];

  const normalized = {
    pedido: String(nome),
    quantidade: quantidade ?? 1,
  };
  if (opcoes) normalized.opcoes = opcoes;
  if (extra) normalized.extra = extra;
  return [normalized];
};

const collectIdsFromItens = (itens, fallbackId) => {
  const set = new Set();
  if (Array.isArray(itens)) {
    itens.forEach((it) => {
      if (it?.id !== undefined && it?.id !== null) set.add(it.id);
    });
  }
  if (fallbackId !== undefined && fallbackId !== null) {
    set.add(fallbackId);
  }
  return Array.from(set);
};

const summarizeItensForLog = (itens) => {
  if (!Array.isArray(itens) || itens.length === 0) return '';
  return itens
    .map((it) => `${it?.quantidade ?? 1}x ${it?.pedido ?? ''}`.trim())
    .join(', ');
};

const pickEndereco = (data) =>
  data?.endereco ?? data?.endereco_entrega ?? data?.enderecoEntrega ?? '';

export default class ImpressaoScreen extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      isConnected: true,
      queueSize: 0,
      printing: false,
      paused: false,
      logs: [],
      
    };

    // recursos
    this._pollInterval = null;
    this.socket = null;
    this._isMounted = false;
    this._netinfoUnsub = null;

    // fila e controle
    this._printQueue = [];
    this._printing = false;
    this._paused = false;

    // controle de IDs processados via socket para evitar duplicatas
    this._processedSocketIds = new Set();

    // binds
    this.processPendingPrintOrders = this.processPendingPrintOrders.bind(this);
    this._drainPrintQueue = this._drainPrintQueue.bind(this);
    this._enqueuePrintJob = this._enqueuePrintJob.bind(this);
    this.togglePause = this.togglePause.bind(this);
    this.clearQueue = this.clearQueue.bind(this);
    this.testPrint = this.testPrint.bind(this);
    this.pushLog = this.pushLog.bind(this);
  }

  getCarrinho() {
    const { user } = this.context || {};
    return user?.carrinho || '';
  }

  // ===== ciclo de vida =====
  async componentDidMount() {
    this._isMounted = true;

    // rede
    this._netinfoUnsub = NetInfo.addEventListener((state) => {
      const now = !!state.isConnected;
      if (now !== this.state.isConnected) {
        this.safeSetState({ isConnected: now });
      }
    });
    try {
      const net = await NetInfo.fetch();
      this.safeSetState({ isConnected: !!net.isConnected });
    } catch {}

    // socket
    this.socket = getSocket();
    if (this.socket) {
        const carrinho = this.getCarrinho();
        // Assina o canal/room para começar a receber eventos
      this.socket.on('emitir_pedido_cozinha', this.handleEmitirPedidoRestante);
         // Reinscreve após reconexão (importante no mobile)
    }

    // (opcional) buscar pendentes ao abrir
    this.processPendingPrintOrders();
 // Polling de segurança: só roda se não estiver pausado/ocupado
 this._pollInterval = setInterval(() => {
   if (!this._paused && !this._printing) {
     this.processPendingPrintOrders();
   }
 }, 10000);
  }

  componentWillUnmount() {
    this._isMounted = false;
    if (this._netinfoUnsub) {
      this._netinfoUnsub();
      this._netinfoUnsub = null;
    }
    if (this.socket) {
      this.socket.off('emitir_pedido_cozinha', this.handleEmitirPedidoRestante);
    }
     if (this._pollInterval) {
   clearInterval(this._pollInterval);
   this._pollInterval = null;
 }
  }

  safeSetState = (updater, cb) => {
    if (!this._isMounted) return;
    this.setState(updater, cb);
  };

  pushLog(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    this.safeSetState((s) => {
      const next = [line, ...s.logs].slice(0, 80);
      return { logs: next };
    });
  }

  // ===== socket handler =====
  handleEmitirPedidoRestante = async (data) => {
    if (!data) return;

    console.log('🔍 Dados recebidos via socket:', JSON.stringify(data, null, 2));

    const pedidoIds = collectPedidoIds(data);
    const alreadyProcessed =
      pedidoIds.length > 0 && pedidoIds.every((id) => this._processedSocketIds.has(id));
    if (alreadyProcessed) {
      this.pushLog(
        `Pedido já processado via socket (ids=${pedidoIds.join(', ') || 's/ id'}), ignorando duplicata.`,
      );
      return;
    }

    pedidoIds.forEach((id) => {
      if (id !== undefined && id !== null) {
        this._processedSocketIds.add(id);
      }
    });
    while (this._processedSocketIds.size > 1000) {
      const firstId = this._processedSocketIds.values().next().value;
      if (firstId === undefined) break;
      this._processedSocketIds.delete(firstId);
    }

    const pedidoItens = normalizePedidoItens(data?.pedido, {
      quantidade: data?.quantidade,
      opcoes: data?.opcoes,
      extra: data?.extra,
    });
    if (!pedidoItens.length) {
      this.pushLog('! Pedido recebido via socket sem itens válidos, ignorando.');
      return;
    }

    const jobData = {
      id: pedidoIds.length === 1 ? pedidoIds[0] : null,
      ids: pedidoIds,
      mesa: data?.mesa ?? data?.comanda ?? '',
      pedido: pedidoItens,
      hora: data?.hora ?? null,
      remetente: data?.remetente ?? null,
      endereco: pickEndereco(data),
      prazo: data?.prazo ?? data?.horario_para_entrega ?? null,
      sendBy: data?.sendBy ?? null,
      shouldUpdatePrinted: true,
      setor: 'cozinha',
      source: 'socket', // marca a origem
    };

    this.pushLog(
      `Novo job recebido via socket (ids=${pedidoIds.join(', ') || 's/ id'}) :: ${summarizeItensForLog(pedidoItens)}`,
    );
    console.log('📋 Job que será enviado para impressão:', JSON.stringify(jobData, null, 2));

    this._enqueuePrintJob(jobData);
  };

  // ===== fila de impressão =====
  _enqueuePrintJob(job) {
    const pedidoItens = normalizePedidoItens(job?.pedido, {
      quantidade: job?.quant ?? job?.quantidade,
      opcoes: job?.opcoes,
      extra: job?.extra,
    });

    if (!pedidoItens.length) {
      this.pushLog('! Pedido ignorado: nenhum item válido para impressão.');
      return;
    }

    const ids = (Array.isArray(job?.ids) && job.ids.length
      ? Array.from(new Set(job.ids))
      : collectIdsFromItens(pedidoItens, job?.id));

    const jobPayload = {
      ...job,
      pedidoItens,
      pedido: pedidoItens,
      ids,
      id: job?.id ?? (ids.length === 1 ? ids[0] : job?.id ?? null),
      endereco: job?.endereco ?? pickEndereco(job),
    };

    this._printQueue.push(jobPayload);
    this.safeSetState({ queueSize: this._printQueue.length });
    this._drainPrintQueue();
  }

  async _drainPrintQueue() {
    if (this._printing) return;
    this._printing = true;
    this.safeSetState({ printing: true });

    try {
      while (this._printQueue.length > 0 && this._isMounted) {
        if (this._paused) {
          this.pushLog('Fila pausada.');
          break;
        }

        const job = this._printQueue.shift();
        this.safeSetState({ queueSize: this._printQueue.length });

        try {
          const itensParaImprimir = job?.pedidoItens?.length
            ? job.pedidoItens
            : normalizePedidoItens(job?.pedido);

          if (!itensParaImprimir.length) {
            this.pushLog('! Job removido da fila sem itens válidos, ignorando.');
            continue;
          }

          const resumo = summarizeItensForLog(itensParaImprimir) || 'Pedido';
          this.pushLog(
            `[${job.source || 'unknown'}] Imprimindo: ${resumo} (mesa/comanda: ${job.mesa || '-'})`,
          );

          await PrinterService.printPedido({
            mesa: job.mesa,
            pedido: itensParaImprimir,
            hora: job.hora,
            remetente: job.remetente,
            endereco: job.endereco,
            prazo: job.prazo,
            sendBy: job.sendBy,
            setor: 'cozinha',
          });

          this.pushLog('✓ Impressão concluída');

          if (job.shouldUpdatePrinted) {
            const idsToUpdate = Array.isArray(job?.ids) && job.ids.length
              ? job.ids
              : job.id != null
                ? [job.id]
                : [];

            if (!idsToUpdate.length) {
              this.pushLog('! Nenhum ID encontrado para atualizar como impresso.');
            } else {
              try {
                const body = { carrinho: this.getCarrinho() };
                if (idsToUpdate.length === 1) body.pedidoId = idsToUpdate[0];
                else body.pedidoIds = idsToUpdate;

                const upd = await fetch(`${API_URL}/updatePrinted`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                if (!upd.ok) {
                  const txt = await upd.text();
                  this.pushLog(
                    `! Falha ao marcar impresso (ids=${idsToUpdate.join(', ')}) :: ${upd.status} ${upd.statusText} :: ${txt}`,
                  );
                } else {
                  this.pushLog(`Marcado como impresso (ids=${idsToUpdate.join(', ')}).`);
                }
              } catch (e) {
                this.pushLog(`! Erro ao atualizar status de impressão: ${String(e)}`);
              }
            }
          }
        } catch (err) {
          this.pushLog(`! Erro na impressão: ${String(err)}`);
          // continua drenando próximos itens
        }
      }
    } finally {
      this._printing = false;
      this.safeSetState({ printing: false });
      if (this._printQueue.length === 0) this.pushLog('Fila vazia.');
    }
  }

  // Buscar e enfileirar pendências do backend
  async processPendingPrintOrders() {
    // checa rede
    try {
      const net = await NetInfo.fetch();
      if (net && net.isConnected === false) {
        this.pushLog('Sem internet para buscar pendentes.');
        return;
      }
    } catch {}

    try {
      this.pushLog('Buscando pedidos pendentes...');
      const resp = await fetch(`${API_URL}/getPendingPrintOrders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printed: 0, ordem: 0, carrinho: this.getCarrinho(), categoria:3 }),
      });

      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} :: ${text}`);

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Resposta não-JSON: ${text.slice(0, 300)}`);
      }

      const list = Array.isArray(parsed?.pedidos) ? parsed.pedidos : [];
      if (!list.length) {
        this.pushLog('Nenhum pedido pendente.');
        return;
      }

      let filteredCount = 0;
      let addedCount = 0;

      for (const order of list) {
        const pedidoIds = collectPedidoIds(order);
        const alreadyProcessed =
          pedidoIds.length > 0 && pedidoIds.every((id) => this._processedSocketIds.has(id));
        if (alreadyProcessed) {
          filteredCount++;
          this.pushLog(
            `Pedido pendente já processado via socket (ids=${pedidoIds.join(', ')}) — ignorando.`,
          );
          continue;
        }

        const pedidoItens = normalizePedidoItens(order?.pedido, {
          quantidade: order?.quantidade,
          opcoes: order?.opcoes,
          extra: order?.extra,
        });

        if (!pedidoItens.length) {
          this.pushLog('! Pedido pendente sem itens válidos, ignorando.');
          continue;
        }

        this._enqueuePrintJob({
          id: pedidoIds.length === 1 ? pedidoIds[0] : null,
          ids: pedidoIds,
          mesa: order?.mesa ?? order?.comanda ?? '',
          pedido: pedidoItens,
          hora: order?.hora ?? null,
          remetente: order?.remetente ?? '',
          endereco: pickEndereco(order),
          prazo: order?.prazo ?? order?.horario_para_entrega ?? '',
          sendBy: order?.sendBy ?? '',
          shouldUpdatePrinted: true,
          setor: 'cozinha',
          source: 'pending', // marca a origem
        });
        pedidoIds.forEach((id) => {
          if (id !== undefined && id !== null) this._processedSocketIds.add(id);
        });
        while (this._processedSocketIds.size > 1000) {
          const firstId = this._processedSocketIds.values().next().value;
          if (firstId === undefined) break;
          this._processedSocketIds.delete(firstId);
        }
        addedCount++;
      }

      if (filteredCount > 0) {
        this.pushLog(`${filteredCount} pedido(s) já processado(s) via socket foram filtrados.`);
      }
      if (addedCount > 0) {
        this.pushLog(`${addedCount} pedido(s) pendente(s) adicionados à fila.`);
      }

    } catch (error) {
      this.pushLog(`! Erro ao buscar pendentes: ${String(error)}`);
    }
  }

  // ===== ações UI =====
  togglePause() {
    this._paused = !this._paused;
    this.safeSetState({ paused: this._paused });
    this.pushLog(this._paused ? 'Fila pausada pelo usuário.' : 'Fila retomada pelo usuário.');
    if (!this._paused) this._drainPrintQueue();
  }

  clearQueue() {
    const cleared = this._printQueue.length;
    this._printQueue = [];
    this.safeSetState({ queueSize: 0 });
    this.pushLog(`Fila limpa (${cleared} item(ns) descartado(s)).`);
  }

  async testPrint() {
    try {
      this.pushLog('Impressão de teste iniciada...');
      await PrinterService.printPedido({
        mesa: 'TESTE',
        pedido: 'Comprovante de Teste',
        quant: 1,
        opcoes: null,
        extra: 'Impressão OK',
        hora: new Date().toLocaleTimeString(),
        remetente: 'Sistema',
        endereco: '',
        prazo: '',
        sendBy: 'Teste',
      });
      this.pushLog('✓ Teste impresso com sucesso.');
    } catch (e) {
      this.pushLog(`! Falha no teste: ${String(e)}`);
    }
  }

  // ===== render =====
  render() {
    const { isConnected, queueSize, printing, paused, logs } = this.state;

    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

        {/* Header */}
        <View style={styles.headerBar}>
          <Text style={styles.headerTitle}>Impressão • Fila</Text>
        </View>

        {/* Status */}
        <View style={styles.statusRow}>
          <View style={styles.statusPill}>
            <View
              style={[
                styles.dot,
                { backgroundColor: isConnected ? '#10B981' : '#DC2626' },
              ]}
            />
            <Text style={styles.statusText}>{isConnected ? 'Online' : 'Offline'}</Text>
          </View>

          <View style={styles.statusPill}>
            <View
              style={[
                styles.dot,
                { backgroundColor: printing ? '#F59E0B' : '#9CA3AF' },
              ]}
            />
            <Text style={styles.statusText}>{printing ? 'Imprimindo…' : 'Parado'}</Text>
          </View>

          <View style={styles.statusPill}>
            <View
              style={[
                styles.dot,
                { backgroundColor: paused ? '#DC2626' : '#10B981' },
              ]}
            />
            <Text style={styles.statusText}>{paused ? 'Pausada' : 'Ativa'}</Text>
          </View>

          <View style={styles.statusPill}>
            <Text style={[styles.statusText, { fontWeight: '800' }]}>
              Fila: {queueSize}
            </Text>
          </View>
        </View>

        {/* Botões */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            onPress={this.processPendingPrintOrders}
            style={[styles.btn, styles.btnPrimary]}
            activeOpacity={0.9}
          >
            <Text style={styles.btnPrimaryText}>Imprimir pendentes</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={this.togglePause}
            style={[styles.btn, paused ? styles.btnResume : styles.btnWarn]}
            activeOpacity={0.9}
          >
            <Text style={paused ? styles.btnResumeText : styles.btnWarnText}>
              {paused ? 'Retomar fila' : 'Pausar fila'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={this.clearQueue}
            style={[styles.btn, styles.btnOutline]}
            activeOpacity={0.9}
          >
            <Text style={styles.btnOutlineText}>Limpar fila</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={this.testPrint}
            style={[styles.btn, styles.btnGhost]}
            activeOpacity={0.9}
          >
            <Text style={styles.btnGhostText}>Teste de impressão</Text>
          </TouchableOpacity>
        </View>

        {/* Log */}
        <View style={styles.logCard}>
          <View style={styles.logHeader}>
            <Text style={styles.logTitle}>Atividade</Text>
            {printing && <ActivityIndicator size="small" />}
          </View>

          <FlatList
            data={logs}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => <Text style={styles.logLine}>{item}</Text>}
            ListEmptyComponent={
              <Text style={[styles.logLine, { color: '#6B7280' }]}>
                Sem eventos ainda.
              </Text>
            }
          />
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  headerBar: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: '#111827' },

  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  statusText: { color: '#111827', fontWeight: '700' },

  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    minWidth: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#17315c' },
  btnPrimaryText: { color: '#fff', fontWeight: '800' },

  btnWarn: { backgroundColor: '#F59E0B' },
  btnWarnText: { color: '#111827', fontWeight: '900' },

  btnResume: { backgroundColor: '#10B981' },
  btnResumeText: { color: '#fff', fontWeight: '900' },

  btnOutline: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#9CA3AF',
  },
  btnOutlineText: { color: '#111827', fontWeight: '800' },

  btnGhost: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  btnGhostText: { color: '#111827', fontWeight: '800' },

  logCard: {
    flex: 1,
    marginHorizontal: 12,
    marginBottom: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  logTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  logLine: { fontSize: 13, color: '#111827', marginBottom: 4 },
});
