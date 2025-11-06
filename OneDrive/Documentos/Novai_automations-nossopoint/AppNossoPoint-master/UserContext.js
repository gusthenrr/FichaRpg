// UserContext.js
import React, { createContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

// ===== Constantes de Storage (novas) + chaves legadas para compatibilidade
const STORAGE = {
  USER: '@app/user',                 // JSON { username, cargo, token, expiresAt }
  LEGACY_USERNAME: 'username',       // legado do login
  LEGACY_TOKEN: 'userToken',         // legado do login
  LEGACY_SENHA_EXP: 'senhaExpiration', // legado do login (ms)
};

// ===== Utilitários de AsyncStorage (seguros)
async function getJSON(key, fallback = null) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  } catch {
    return fallback;
  }
}

async function setJSON(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // falha de persistência não deve quebrar a UI
  }
}

async function removeKey(key) {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // noop
  }
}

// ===== Guard anti “double tap” global simples
function useClickGuards() {
  const guardsRef = useRef({});
  return useCallback((key, fn, cooldownMs = 300) => {
    if (guardsRef.current[key]) return;
    guardsRef.current[key] = true;
    Promise.resolve()
      .then(() => fn && fn())
      .finally(() => {
        setTimeout(() => { guardsRef.current[key] = false; }, cooldownMs);
      });
  }, []);
}

// ===== Tipagem básica (JS)
const defaultUser = { username: '', cargo: '', carrinho: '', token: '', expiresAt: null };

// Create the User Context
export const UserContext = createContext({
  user: defaultUser,
  setUser: () => {},
  isLoggedIn: false,
  setIsLoggedIn: () => {},
  loading: true,
  setLoading: () => {},
  isOnline: true,
  signIn: async () => {},
  signOut: async () => {},
  updateUser: async () => {},
  guardClick: () => {},
});

// Provider
export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(defaultUser);
  const [isLoggedIn, setIsLoggedIn] = useState(false); // inicia false, valida ao restaurar
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);

  const guardClick = useClickGuards();
  const isMountedRef = useRef(false);
  const logoutTimerRef = useRef(null);

  // ===== Helpers
  const clearLogoutTimer = () => {
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
  };

  const scheduleAutoLogout = useCallback((expiresAtMs) => {
    clearLogoutTimer();
    if (!expiresAtMs || Number.isNaN(Number(expiresAtMs))) return;
    const delta = Number(expiresAtMs) - Date.now();
    if (delta <= 0) return;
    logoutTimerRef.current = setTimeout(() => {
      // expirada
      signOut();
    }, delta);
  }, []);

  const effectiveIsLoggedIn = useMemo(() => {
    const hasToken = !!user?.token;
    const notExpired =
      !user?.expiresAt || (Number(user.expiresAt) > Date.now());
    return hasToken && notExpired;
  }, [user]);

  // ===== Conectividade (NetInfo)
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setIsOnline(!!state.isConnected);
    });
    return () => unsub && unsub();
  }, []);

  // ===== Restaurar sessão (com migração de chaves antigas)
  useEffect(() => {
    isMountedRef.current = true;
    (async () => {
      try {
        setLoading(true);

        // 1) tenta novo formato
        const savedUser = await getJSON(STORAGE.USER, null);

        if (savedUser && savedUser.token) {
          if (!isMountedRef.current) return;
          setUser({
            username: savedUser.username || '',
            cargo: savedUser.cargo || '',
            carrinho: savedUser.carrinho || '',
            token: savedUser.token || '',
            expiresAt: savedUser.expiresAt || null,
          });
          setIsLoggedIn(true);
          scheduleAutoLogout(savedUser.expiresAt || null);
          return;
        }

        // 2) tenta legado (username, userToken, senhaExpiration)
        const [legacyUsername, legacyToken, legacyExp] = await Promise.all([
          AsyncStorage.getItem(STORAGE.LEGACY_USERNAME),
          AsyncStorage.getItem(STORAGE.LEGACY_TOKEN),
          AsyncStorage.getItem(STORAGE.LEGACY_SENHA_EXP),
        ]);

        const expMs = legacyExp ? parseInt(legacyExp, 10) : null;
        const notExpired = expMs ? expMs > Date.now() : true;

        if (legacyToken && legacyUsername && notExpired) {
          const legacyUser = {
            username: legacyUsername,
            cargo: '',       // será preenchido após login no seu fluxo
            carrinho: '',
            token: legacyToken,
            expiresAt: expMs || null,
          };
          if (!isMountedRef.current) return;
          setUser(legacyUser);
          setIsLoggedIn(true);
          scheduleAutoLogout(legacyUser.expiresAt);
          // também salva no novo formato para futuras aberturas
          await setJSON(STORAGE.USER, legacyUser);
        } else {
          // sessão inexistente/expirada
          if (!isMountedRef.current) return;
          setUser(defaultUser);
          setIsLoggedIn(false);
        }
      } finally {
        if (!isMountedRef.current) return;
        setLoading(false);
      }
    })();

    return () => {
      isMountedRef.current = false;
      clearLogoutTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Persistir alterações relevantes do usuário
  useEffect(() => {
    // mantém isLoggedIn coerente mesmo se setUser for chamado externamente
    if (isLoggedIn !== effectiveIsLoggedIn) setIsLoggedIn(effectiveIsLoggedIn);
    // reagenda auto-logout
    scheduleAutoLogout(user?.expiresAt || null);

    // persiste silenciosamente (não trava UI se falhar)
    setJSON(STORAGE.USER, user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ===== APIs públicas
  const signIn = useCallback(async ({ username, cargo = '', carrinho = '', token, expiresAt = null }) => {
    if (!username || !token) {
      throw new Error('Credenciais inválidas para signIn.');
    }
    const next = { username, cargo, carrinho, token, expiresAt: expiresAt ? Number(expiresAt) : null };
    setUser(next);
    setIsLoggedIn(true);
    scheduleAutoLogout(next.expiresAt);
    await setJSON(STORAGE.USER, next);
    // não tocamos nas chaves legadas aqui — seu fluxo de login já gerencia
  }, [scheduleAutoLogout]);

  const signOut = useCallback(async () => {
    clearLogoutTimer();
    setUser(defaultUser);
    setIsLoggedIn(false);
    // limpa novo formato e deixa legados como estão (se quiser limpar tudo, descomente abaixo)
    await removeKey(STORAGE.USER);
    // await removeKey(STORAGE.LEGACY_TOKEN);
    // await removeKey(STORAGE.LEGACY_USERNAME);
    // await removeKey(STORAGE.LEGACY_SENHA_EXP);
  }, []);

  const updateUser = useCallback(async (patch) => {
    setUser((prev) => {
      const next = { ...prev, ...(patch || {}) };
      // se patch atualizar expiresAt, reagenda será feito no useEffect
      return next;
    });
  }, []);

  const contextValue = useMemo(
    () => ({
      user,
      setUser,               // mantido por compatibilidade com seu código atual
      isLoggedIn,
      setIsLoggedIn,         // idem
      loading,
      setLoading,            // idem
      isOnline,
      signIn,
      signOut,
      updateUser,
      guardClick,            // para ações globais com anti “double tap”
    }),
    [user, isLoggedIn, loading, isOnline, signIn, signOut, updateUser, guardClick]
  );

  return (
    <UserContext.Provider value={contextValue}>
      {children}
    </UserContext.Provider>
  );
};
