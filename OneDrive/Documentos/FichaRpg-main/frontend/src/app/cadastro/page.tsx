'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Cinzel, Uncial_Antiqua } from 'next/font/google';
import styles from '../ui/auth.module.css';

const cinzel = Cinzel({ subsets: ['latin'], weight: ['400', '700'] });
const uncial = Uncial_Antiqua({ subsets: ['latin'], weight: '400' });

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:5000';

export default function Cadastro() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [okMsg, setOkMsg] = useState('');

  async function handleCadastro(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(''); setOkMsg('');

    if (senha !== confirmarSenha) {
      setErro('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/cadastro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName, email, senha }),
      });
      if (!res.ok) {
        const { message } = (await safeJson(res)) ?? {};
        throw new Error(message || 'Falha no cadastro');
      }
      setOkMsg('Conta criada! Redirecionando para o login...');
      setTimeout(() => router.push('/login'), 800);
    } catch (err: any) {
      setErro(err?.message ?? 'Erro inesperado ao cadastrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`${styles.root} ${cinzel.className}`}>
      <div className={styles.card}>
        <header className={styles.header}>
          <h1 className={`${styles.title} ${uncial.className}`}>Registro do Aventureiro</h1>
          <p className={styles.subtitle}>Crie sua conta para iniciar a jornada</p>
        </header>

        <div className={styles.content}>
          <form onSubmit={handleCadastro} className={styles.form}>
            <label className={styles.label} htmlFor="userName">Nome do Herói</label>
            <input
              id="userName" name="userName" className={styles.input}
              placeholder="ex.: Arannis, Morgana..." value={userName}
              onChange={(e) => setUserName(e.target.value)} required autoComplete="username"
            />

            <label className={styles.label} htmlFor="email">Mensageiro (Email)</label>
            <input
              id="email" name="email" className={styles.input} type="email"
              placeholder="voce@reino.com" value={email}
              onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
            />

            <label className={styles.label} htmlFor="senha">Palavra-secreta</label>
            <div className={styles.passRow}>
              <input
                id="senha" name="senha" className={styles.input}
                type={showPass ? 'text' : 'password'} placeholder="••••••••"
                value={senha} onChange={(e) => setSenha(e.target.value)}
                required autoComplete="new-password"
              />
              <button type="button" className={styles.btnGhost}
                      onClick={() => setShowPass((v) => !v)}>
                {showPass ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>

            <label className={styles.label} htmlFor="confirmarSenha">Confirmar Palavra-secreta</label>
            <div className={styles.passRow}>
              <input
                id="confirmarSenha" name="confirmarSenha" className={styles.input}
                type={showPass2 ? 'text' : 'password'} placeholder="••••••••"
                value={confirmarSenha} onChange={(e) => setConfirmarSenha(e.target.value)}
                required autoComplete="new-password"
              />
              <button type="button" className={styles.btnGhost}
                      onClick={() => setShowPass2((v) => !v)}>
                {showPass2 ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>

            {erro && <p className={styles.error}>{erro}</p>}
            {okMsg && <p className={styles.ok}>{okMsg}</p>}

            <div className={styles.actions}>
              <button type="submit" className={styles.btnPrimary} disabled={loading}>
                {loading ? 'Forjando conta...' : 'Criar conta'}
              </button>
              <Link href="/login" className={styles.btnSecondary}>
                Voltar ao login
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

async function safeJson(res: Response) {
  try { return await res.json(); } catch { return null; }
}
