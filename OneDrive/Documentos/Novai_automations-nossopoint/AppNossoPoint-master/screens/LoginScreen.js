import React, { useState, useEffect, useContext, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { UserContext } from '../UserContext';
import { useToken } from '../TokenContext';
import { API_URL } from './url';

const TTL_HOURS = 14;
const FETCH_TIMEOUT_MS = 12000;

export default function Login() {
  const { setUser, isLoggedIn, setIsLoggedIn, loading, setLoading } = useContext(UserContext);
  const { expoPushToken } = useToken();

  const [username, setUsername] = useState('');
  const [senha, setSenha] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // --------- Utils ---------
  const generateToken = () =>
    Math.random().toString(36).substring(2, 7).toUpperCase();

  const withTimeout = (ms, promise) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    return Promise.race([
      promise(controller.signal),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms + 10)),
    ]).finally(() => clearTimeout(t));
  };

  const safeSetLoading = (v) => mountedRef.current && setLoading?.(v);
  const safeSetSubmitting = (v) => mountedRef.current && setSubmitting(v);

  // --------- Auto login (se houver credenciais válidas) ---------
  useEffect(() => {
    (async () => {
      safeSetLoading(true);
      try {
        const [savedUsername, savedToken, savedSenha, senhaExpiration] = await Promise.all([
          AsyncStorage.getItem('username'),
          AsyncStorage.getItem('userToken'),
          AsyncStorage.getItem('usersenha'),
          AsyncStorage.getItem('senhaExpiration'),
        ]);

        const exp = Number(senhaExpiration || 0);
        const notExpired = Number.isFinite(exp) && Date.now() < exp;

        if (savedToken && savedUsername && savedSenha && notExpired) {
          setUsername(savedUsername);
          setSenha(savedSenha);
          await attemptLogin(savedUsername, savedSenha, { silent: true });
        } else {
          // limpa restos vencidos
          await Promise.all([
            AsyncStorage.removeItem('usersenha'),
            AsyncStorage.removeItem('senhaExpiration'),
            AsyncStorage.removeItem('userToken'),
          ]);
          setIsLoggedIn(false);
        }
      } catch (err) {
        // fallback seguro
        setIsLoggedIn(false);
      } finally {
        safeSetLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------- Fluxo principal ---------
  async function attemptLogin(userRaw, passRaw, { silent = false } = {}) {
    const user = String(userRaw || '').trim();
    const pass = String(passRaw || '').trim();

    if (!user || !pass) {
      if (!silent) Alert.alert('Campos obrigatórios', 'Informe usuário e senha.');
      return false;
    }

    // bloqueia spam de cliques
    if (submitting) return false;

    // checa conectividade do dispositivo
    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      if (!silent) Alert.alert('Sem internet', 'Verifique sua conexão e tente novamente.');
      return false;
    }

    safeSetSubmitting(true);
    safeSetLoading(true);

    try {
      // tenta login (com timeout e cancelamento)
      const res = await withTimeout(FETCH_TIMEOUT_MS, (signal) =>
        fetch(`${API_URL}/verificar_username`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ username: user, senha: pass }),
        })
      );

      if (!res || !res.ok) {
        if (!silent) Alert.alert('Erro', 'Falha ao conectar ao servidor.');
        return false;
      }

      let data;
      try {
        data = await res.json();
      } catch {
        if (!silent) Alert.alert('Erro', 'Resposta inválida do servidor.');
        return false;
      }

      // backend esperado: { data: true/false, cargo: '...', carrinho: '...' }
      if (data?.data) {
        // sucesso → persiste sessão
        await persistSession(user, pass, data?.cargo, data?.carrinho);
        // seta usuário no contexto (token = expoPushToken para seu app)
        setUser?.({
          username: user,
          cargo: data?.cargo,
          carrinho: data?.carrinho || '',
          token: expoPushToken || 'semtoken',
        });
        setIsLoggedIn?.(true);
        return true;
      }

      // credenciais inválidas
      if (!silent) Alert.alert('Erro', 'Usuário ou senha inválidos.');
      return false;
    } catch (err) {
      if (!silent) {
        const msg = err?.name === 'AbortError' || String(err?.message).includes('timeout')
          ? 'Tempo de resposta excedido. Tente novamente.'
          : 'Erro de conexão com o servidor.';
        Alert.alert('Erro', msg);
      }
      return false;
    } finally {
      safeSetSubmitting(false);
      safeSetLoading(false);
    }
  }

  // salva sessão e envia expo token + cargo
  async function persistSession(user, pass, cargo, carrinho) {
    const expirationTime = Date.now() + TTL_HOURS * 60 * 60 * 1000;
    const guardar_token = generateToken();

    try {
      await Promise.all([
        AsyncStorage.setItem('userToken', guardar_token),
        AsyncStorage.setItem('username', user),
        AsyncStorage.setItem('usersenha', pass),
        AsyncStorage.setItem('senhaExpiration', String(expirationTime)),
      ]);
    } catch {
      // se falhar persistência, não bloqueia o fluxo (apenas não manterá login)
    }

    // não bloqueia a UI se esta requisição falhar — melhor esforço
    try {
      await withTimeout(FETCH_TIMEOUT_MS, (signal) =>
        fetch(`${API_URL}/salvarTokenCargo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            username: user,
            cargo,
            carrinho,
            token: expoPushToken || 'semtoken',
          }),
        })
      );
    } catch {
      // log silencioso; sem impacto no login
    }
  }

  // --------- Render ---------
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={{ marginTop: 8 }}>Carregando...</Text>
      </View>
    );
  }

  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Login</Text>
        <KeyboardAvoidingView
          behavior={'padding'}
          style={{ width: '100%', alignItems: 'center' }}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 50}
        >
          <TextInput
            style={styles.input}
            placeholder="Usuário"
            placeholderTextColor="#999"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            returnKeyType="next"
          />
          <TextInput
            style={styles.input}
            placeholder="Senha"
            placeholderTextColor="#999"
            value={senha}
            onChangeText={setSenha}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={() => attemptLogin(username, senha)}
          />

          <View style={{ width: '100%', paddingHorizontal: 24, marginTop: 6 }}>
            <Button
              title={submitting ? 'Entrando...' : 'Entrar'}
              onPress={() => attemptLogin(username, senha)}
              disabled={submitting}
            />
          </View>

          {submitting && (
            <View style={{ marginTop: 10 }}>
              <ActivityIndicator size="small" color="#0000ff" />
            </View>
          )}
        </KeyboardAvoidingView>
      </View>
    );
  }

  // Quando logado, esta tela não precisa renderizar nada (sua navegação cuida do fluxo)
  return null;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    marginBottom: 18,
    fontWeight: '700',
    color: '#111827',
  },
  input: {
    height: 44,
    width: '90%',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
});
