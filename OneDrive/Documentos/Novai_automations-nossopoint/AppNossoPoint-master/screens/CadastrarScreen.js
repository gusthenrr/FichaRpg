import React from 'react';
import {
  KeyboardAvoidingView,
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Picker } from '@react-native-picker/picker';
import { UserContext } from '../UserContext';
import { getSocket } from '../socket';

export default class Cadastro extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      username: '',
      senha1: '',
      senha2: '',
      showSenha2: false,
      cargo: '',
      // robustez
      isConnected: true,
      isSubmitting: false,
      submitMsg: '', // mensagens curtas de feedback
    };
    this.socket = null;

    // refs / guards
    this._isMounted = false;
    this._netinfoUnsub = null;
    this._ackTimer = null;
    this.senha2Ref = React.createRef();
  }

  // ---------- lifecycle ----------
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
    // (Opcional) escuta erros de conexão — só feedback visual simples
    if (this.socket) {
      this.socket.on?.('connect_error', () => this.safeSetState({ submitMsg: 'Falha ao conectar ao servidor.' }));
      this.socket.on?.('disconnect', () => this.safeSetState({ submitMsg: 'Servidor desconectado.' }));
    }
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
  }

  safeSetState = (updater, cb) => {
    if (!this._isMounted) return;
    this.setState(updater, cb);
  };

  // ---------- validações ----------
  validateUsername = (u) => {
    const username = String(u || '').trim();
    if (username.length < 3 || username.length > 20) {
      return { ok: false, msg: 'Username deve ter entre 3 e 20 caracteres.' };
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      return { ok: false, msg: 'Username só pode conter letras, números, . _ -' };
    }
    return { ok: true, value: username };
  };

  validatePassword = (p) => {
    const s = String(p || '');
    if (s.length < 6) return { ok: false, msg: 'Senha deve ter pelo menos 6 caracteres.' };
    return { ok: true, value: s };
  };

  validateCargo = (c) => {
    const ALLOWED = ['Colaborador', 'ADM', 'Entregador', 'Cozinha'];
    if (!ALLOWED.includes(c)) return { ok: false, msg: 'Selecione um cargo válido.' };
    return { ok: true, value: c };
  };

  // ---------- ações ----------
  verificar = async () => {
    if (this.state.isSubmitting) return; // evita clique duplo

    const { username, senha1, senha2, showSenha2, cargo, isConnected } = this.state;
    const { user } = this.context || {};
    const carrinho = user?.carrinho || '';

    // rede e socket
    if (!isConnected) {
      this.safeSetState({ submitMsg: 'Sem internet. Tente novamente.' });
      return;
    }
    if (!this.socket || !this.socket.connected) {
      this.safeSetState({ submitMsg: 'Sem conexão com o servidor.' });
      return;
    }

    // validações básicas
    const vu = this.validateUsername(username);
    if (!vu.ok) return this.feedback(vu.msg);

    const vc = this.validateCargo(cargo);
    if (!vc.ok) return this.feedback(vc.msg);

    const v1 = this.validatePassword(senha1);
    if (!v1.ok) return this.feedback(v1.msg);

    // fluxo de confirmação de senha (mantido do original, mas com UX melhor)
    if (!showSenha2) {
      this.safeSetState({ showSenha2: true, submitMsg: 'Confirme a senha.' }, () => {
        this.senha2Ref.current?.focus?.();
      });
      return;
    }

    const v2 = this.validatePassword(senha2);
    if (!v2.ok) return this.feedback(v2.msg);
    if (senha1 !== senha2) return this.feedback('Senhas não conferem.');

    // pronto para enviar
    const payload = { username: vu.value, senha: v1.value, cargo: vc.value, carrinho };

    this.safeSetState({ isSubmitting: true, submitMsg: 'Cadastrando...' });

    // tenta com ACK do servidor (se suportado). Com fallback de timeout.
    let acked = false;
    const onAck = (resp) => {
      if (acked) return;
      acked = true;
      if (this._ackTimer) {
        clearTimeout(this._ackTimer);
        this._ackTimer = null;
      }

      const ok = resp?.ok !== false; // assume sucesso se não houver flag
      if (ok) {
        this.feedback('Cadastro realizado!', true);
        this.resetForm();
      } else {
        const msg = resp?.message || 'Não foi possível cadastrar.';
        this.feedback(msg);
      }
      this.safeSetState({ isSubmitting: false });
    };

    try {
      // Emite com função de callback (ACK). Se o backend não usar ACK, caímos no timeout.
      this.socket.emit('cadastrar', payload, onAck);
      // Fallback: se nada chegar em 7s, libera e informa
      this._ackTimer = setTimeout(() => {
        if (acked) return;
        acked = true;
        this._ackTimer = null;
        this.safeSetState({ isSubmitting: false });
        this.feedback('Sem resposta do servidor. Verifique depois.');
      }, 7000);
    } catch (e) {
      this.safeSetState({ isSubmitting: false });
      this.feedback('Erro ao enviar cadastro.');
    }
  };

  resetForm = () => {
    this.safeSetState({
      username: '',
      senha1: '',
      senha2: '',
      showSenha2: false,
      cargo: '',
    });
  };

  feedback = (msg, success = false) => {
    // success não muda cor aqui, mas poderia se quiser estilizar por estado
    this.safeSetState({ submitMsg: msg });
  };

  // ---------- render ----------
  render() {
    const cargos = ['Colaborador', 'ADM', 'Entregador', 'Cozinha'];
    const { cargo, isSubmitting, submitMsg, showSenha2 } = this.state;

    const canPress =
      !isSubmitting &&
      !!this.state.username &&
      !!this.state.cargo &&
      !!this.state.senha1 &&
      (!showSenha2 || !!this.state.senha2);

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Cadastro</Text>

        <KeyboardAvoidingView
          behavior={'padding'}
          keyboardVerticalOffset={Platform.select({ ios: 80, android: 90 })}
          style={{ width: '100%', alignItems: 'center' }}
        >
          <TextInput
            style={styles.input}
            placeholder="Usuário"
            placeholderTextColor="#999"
            value={this.state.username}
            onChangeText={(username) => this.safeSetState({ username })}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            autoComplete="username-new"
            returnKeyType="next"
          />

          <View style={styles.pickerWrap}>
            <Picker
              selectedValue={cargo}
              onValueChange={(value) => this.safeSetState({ cargo: value })}
              style={styles.picker}
            >
              <Picker.Item label="Selecione o cargo..." value="" />
              {cargos.map((item) => (
                <Picker.Item key={item} label={item} value={item} />
              ))}
            </Picker>
          </View>

          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="Senha"
            placeholderTextColor="#999"
            value={this.state.senha1}
            onChangeText={(senha1) => this.safeSetState({ senha1 })}
            textContentType="newPassword"
            autoComplete="password-new"
            returnKeyType={showSenha2 ? 'next' : 'done'}
          />

          {showSenha2 && (
            <TextInput
              ref={this.senha2Ref}
              style={styles.input}
              secureTextEntry
              placeholder="Confirmar Senha"
              placeholderTextColor="#999"
              value={this.state.senha2}
              onChangeText={(senha2) => this.safeSetState({ senha2 })}
              textContentType="newPassword"
              autoComplete="password-new"
              returnKeyType="done"
            />
          )}

          <View style={styles.btnRow}>
            <TouchableOpacity
              onPress={this.verificar}
              disabled={!canPress}
              activeOpacity={0.85}
              style={[styles.btn, !canPress ? styles.btnDisabled : styles.btnPrimary]}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.btnText}>Cadastrar</Text>
              )}
            </TouchableOpacity>
          </View>

          {!!submitMsg && <Text style={styles.feedback}>{submitMsg}</Text>}
        </KeyboardAvoidingView>
      </View>
    );
  }
}

// ---------- styles ----------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 18,
    color: '#111827',
  },
  input: {
    height: 44,
    width: 300,
    borderColor: '#cbd5e1',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    color: '#111827',
    backgroundColor: '#fff',
  },
  pickerWrap: {
    width: 300,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  picker: {
    height: 44,
    width: '100%',
    color: '#111827',
    backgroundColor: '#fff',
  },
  btnRow: {
    width: 300,
    marginTop: 6,
    marginBottom: 8,
  },
  btn: {
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: '#17315c',
  },
  btnDisabled: {
    backgroundColor: '#9ca3af',
  },
  btnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  feedback: {
    marginTop: 8,
    color: '#374151',
    fontSize: 13,
    textAlign: 'center',
  },
});
