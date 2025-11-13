'use client';

import { useEffect, useMemo, useState, useRef, type FormEvent } from 'react';

type AttrName =
  | 'forca'
  | 'constituicao'
  | 'destreza'
  | 'inteligencia'
  | 'sabedoria'
  | 'carisma';

type FichaResumo = {
  nome: string;
  raca: string;
  classe: string;
  vida: number;
  ca: number;
  forca: { pontos: number; modificador: number };
  destreza: { pontos: number; modificador: number };
  constituicao: { pontos: number; modificador: number };
  inteligencia: { pontos: number; modificador: number };
  sabedoria: { pontos: number; modificador: number };
  carisma: { pontos: number; modificador: number };
};

type Monstro = { id: number; nome: string; tipo: string; hp: number; ca: number };

type BattleState = {
  id: number;
  fase: 'initiative' | 'player' | 'monster' | 'ended';
  turno: number;
  j_vida: number;
  m_hp: number;
  vencedor?: 'player' | 'monster' | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:5000';

const CLASSES = ['Ladino', 'Guerreiro', 'Bárbaro'] as const;
const RACAS = ['Humano', 'Elfo', 'Anão', 'Halfling', 'Meio-Orc'] as const;
const POOL = [15, 14, 13, 12, 10, 8] as const;
const ATTRS: AttrName[] = [
  'forca',
  'constituicao',
  'destreza',
  'inteligencia',
  'sabedoria',
  'carisma',
];

type Mode = 'form' | 'rollVida' | 'rollCa' | 'showFicha' | 'battle';

export default function FichaPage() {
  const [mode, setMode] = useState<Mode>('form');
  const [userName, setUserName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string>('');
  const [ficha, setFicha] = useState<FichaResumo | null>(null);

  // form state
  const [nome, setNome] = useState('');
  const [raca, setRaca] = useState<(typeof RACAS)[number] | ''>('');
  const [classe, setClasse] = useState<(typeof CLASSES)[number] | ''>('');
  const [atributos, setAtributos] = useState<Record<AttrName, number | ''>>({
    forca: '',
    constituicao: '',
    destreza: '',
    inteligencia: '',
    sabedoria: '',
    carisma: '',
  });

  // dice animation state
  const [spinning, setSpinning] = useState(false);
  const [dieValue, setDieValue] = useState<number | null>(null);
  const [vidaInfo, setVidaInfo] = useState<{
    r1: number; conMod: number; vida: number;dado:number;
  } | null>(null);
  const [caValue, setCaValue] = useState<number | null>(null);

  // battle
  const [monstros, setMonstros] = useState<Monstro[]>([]);
  const [monstroId, setMonstroId] = useState<number | ''>('');
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [battleLog, setBattleLog] = useState<string[]>([]);

  useEffect(() => {
    const u = typeof window !== 'undefined' ? localStorage.getItem('userName') : null;
    if (!u) {
      setErro('Usuário não identificado. Faça login antes de criar a ficha.');
      setLoading(false);
      return;
    }
    setUserName(u);

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/ficha?userName=${encodeURIComponent(u)}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setFicha(data.ficha);
          setMode('showFicha');
        } else if (res.status !== 404) {
          const data = await safeJson(res);
          setErro(data?.message ?? 'Falha ao consultar ficha');
        }
      } catch {
        setErro('Erro de rede ao consultar ficha');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const usedValues = useMemo(
    () => new Set(Object.values(atributos).filter((v): v is number => typeof v === 'number')),
    [atributos]
  );
  const availableFor = (attr: AttrName) => POOL.filter(v => !usedValues.has(v) || atributos[attr] === v);
  const canSubmit =
    nome.trim().length > 0 && raca && classe && ATTRS.every(a => typeof atributos[a] === 'number');

  // ===== Form submit => step 1: roll Vida =====
  async function startRollVida(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setErro('');
    setMode('rollVida');
    setDieValue(null);
    setVidaInfo(null);
  }

  async function handleRollVida() {
    setSpinning(true);
    setDieValue(null);
    try {
      const payload = {
        userName,
        nome: nome.trim(),
        raca,
        classe,
        atributos: dumpAttrs(atributos),
      };
      const res = await fetch(`${API_BASE}/ficha/roll/vida`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await safeJson(res);
      if (!res.ok || !data?.success) throw new Error(data?.message ?? 'Falha ao rolar vida');

      // anima d20 somando os 2 dados (efeito visual simples)
      const rolledValue = data.r1;
      setTimeout(() => {
        setDieValue(rolledValue);
        setVidaInfo({ r1: data.r1, conMod: data.conMod, vida: data.vida, dado:data.dado });
        setSpinning(false);
      }, 800);
    } catch (err: any) {
      setErro(err?.message ?? 'Erro inesperado ao rolar vida');
      setSpinning(false);
    }
  }

  // ===== Step 2: roll CA (cosmético) & persist ficha =====
  async function handleRollCAAndPersist() {
    try {
      const payload = {
        userName,
        nome: nome.trim(),
        raca,
        classe,
        atributos: dumpAttrs(atributos),
        vida: vidaInfo?.vida,
      };
      const res = await fetch(`${API_BASE}/ficha/roll/ca`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await safeJson(res);
      if (!res.ok || !data?.success) throw new Error(data?.message ?? 'Falha ao calcular/persistir CA');
      // animação do dado (valor cosmético d20); CA vem do backend
      setTimeout(() => {
        setCaValue(data.ca);
        setSpinning(false);
        // ficha final persistida
        setFicha(data.ficha);
        setMode('showFicha');
      }, 800);
    } catch (err: any) {
      setErro(err?.message ?? 'Erro inesperado ao calcular CA');
      setSpinning(false);
    }
  }

  // ===== Duelar =====
  async function loadMonstros() {
    try {
      const res = await fetch(`${API_BASE}/monstros`);
      const data = await safeJson(res);
      if (!res.ok || !data?.success) throw new Error(data?.message ?? 'Falha ao carregar monstros');
      setMonstros(data.monstros);
    } catch (err: any) {
      setErro(err?.message ?? 'Erro ao carregar monstros');
    }
  }

  async function iniciarBatalha() {
    if (!ficha || !monstroId) return;
    setErro('');
    setSpinning(false);
    setDieValue(null);
    setBattleLog([]);
    try {
      const res = await fetch(`${API_BASE}/batalha/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName, monstro_id: monstroId }),
      });
      const data = await safeJson(res);
      if (!res.ok || !data?.success) throw new Error(data?.message ?? 'Falha ao iniciar batalha');
      setBattle(data.battle);
      setMode('battle');
      setBattleLog((log) => [...log, `Batalha #${data.battle.id} iniciada!`]);
    } catch (err: any) {
      setErro(err?.message ?? 'Erro ao iniciar batalha');
    }
  }

  async function rollInitiative() {
    if (!battle) return;
    setSpinning(true); setDieValue(null);
    try {
      const res = await fetch(`${API_BASE}/batalha/roll/initiative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battle_id: battle.id }),
      });
      const data = await safeJson(res);
      if (!res.ok || !data?.success) throw new Error(data?.message ?? 'Erro na iniciativa');
      setTimeout(() => {
        setSpinning(false);
        setDieValue(Math.max(data.d20_player, data.d20_monstro));
        setBattle(data.battle);
        setBattleLog((log) => [
          ...log,
          `Iniciativa: Herói ${data.d20_player}+${data.dexMod} vs Monstro ${data.d20_monstro}`,
          data.battle.fase === 'player' ? 'Você começa!' : 'O monstro começa!',
        ]);
      }, 800);
    } catch (err: any) {
      setErro(err?.message ?? 'Erro na iniciativa');
      setSpinning(false);
    }
  }

  async function playerAttack() {
    if (!battle) return;
    setSpinning(true); setDieValue(null);
    try {
      const res = await fetch(`${API_BASE}/batalha/roll/player_attack`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battle_id: battle.id }),
      });
      const data = await safeJson(res);
      if (!res.ok || !data?.success) throw new Error(data?.message ?? 'Erro no ataque do herói');
      setTimeout(() => {
        setSpinning(false);
        setDieValue(data.d20);
        setBattle(data.battle);
        setBattleLog((log) => [
          ...log,
          data.hit
            ? `Você acerta! Ataque ${data.ataque} vs CA ${data.ca_monstro} | Dano ${data.dano}${data.critico ? ' (Crítico!)' : ''}`
            : `Você erra. Ataque ${data.ataque} vs CA ${data.ca_monstro}`,
          `HP Monstro: ${data.battle.m_hp}`,
          data.battle.fase === 'ended'
            ? (data.battle.vencedor === 'player' ? '🎉 Você venceu!' : '😵 Você caiu...')
            : 'Vez do Monstro...',
        ]);
      }, 800);
    } catch (err: any) {
      setErro(err?.message ?? 'Erro no ataque do herói');
      setSpinning(false);
    }
  }

  async function monsterAttack() {
    if (!battle) return;
    setSpinning(true); setDieValue(null);
    try {
      const res = await fetch(`${API_BASE}/batalha/roll/monster_attack`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battle_id: battle.id }),
      });
      const data = await safeJson(res);
      if (!res.ok || !data?.success) throw new Error(data?.message ?? 'Erro no ataque do monstro');
      setTimeout(() => {
        setSpinning(false);
        setDieValue(data.d20);
        setBattle(data.battle);
        setBattleLog((log) => [
          ...log,
          data.hit
            ? `Monstro acerta! Ataque ${data.ataque} vs sua CA ${data.ca_jogador} | Dano ${data.dano}${data.critico ? ' (Crítico!)' : ''}`
            : `Monstro erra. Ataque ${data.ataque} vs sua CA ${data.ca_jogador}`,
          `Sua Vida: ${data.battle.j_vida}`,
          data.battle.fase === 'ended'
            ? (data.battle.vencedor === 'monster' ? '☠️ O monstro venceu...' : '🎉 Você venceu!')
            : 'Sua vez...',
        ]);
      }, 800);
    } catch (err: any) {
      setErro(err?.message ?? 'Erro no ataque do monstro');
      setSpinning(false);
    }
  }

  if (loading) return uiCard('Ficha RPG', <p>Carregando...</p>, erro);

  // === modos ===
  if (mode === 'rollVida') {
    return uiCard(
      'Criar Ficha — Etapa 1: Vida',
      <>
        <p>Gire o dado para determinar a <strong>Vida</strong> do seu herói.</p>
        <Dice spinning={spinning} value={dieValue} />
        {!vidaInfo && (
          <button onClick={handleRollVida} style={btnPrimary} disabled={spinning}>
            Girar Dado (Vida)
          </button>
        )}
        {vidaInfo && (
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: 0 }}>
              Vida = d{vidaInfo.dado}{'('}{vidaInfo.r1}{")"} + Constituição({vidaInfo.conMod}) = <b>{vidaInfo.vida}</b>
            </p>
            <button onClick={() => setMode('rollCa')} style={btnSecondary}>
              Próxima etapa: CA
            </button>
          </div>
        )}
      </>,
      erro
    );
  }

  if (mode === 'rollCa') {
    return uiCard(
      'Criar Ficha — Etapa 2: CA',
      <>
        <p>
          CA é calculada por regra ({'10 + Mod de Destreza'})
        </p>
        {!caValue && (
          <button onClick={handleRollCAAndPersist} style={btnPrimary} disabled={spinning || !vidaInfo}>
            Gerar ca.
          </button>
        )}
      </>,
      erro
    );
  }

  if (mode === 'showFicha' && ficha) {
    return uiCard(
      'Sua Ficha',
      <>
        <p style={{ margin: 0 }}>
          <strong>Nome:</strong> {ficha.nome}
        </p>
        <p style={{ margin: 0 }}>
          <strong>Raça:</strong> {ficha.raca} &nbsp;|&nbsp; <strong>Classe:</strong> {ficha.classe}
        </p>
        <p style={{ margin: 0 }}>
          <strong>Vida:</strong> {ficha.vida} &nbsp;|&nbsp; <strong>CA:</strong> {ficha.ca}
        </p>
        <hr />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {([
            ['Força', ficha.forca],
            ['Constituição', ficha.constituicao],
            ['Destreza', ficha.destreza],
            ['Inteligência', ficha.inteligencia],
            ['Sabedoria', ficha.sabedoria],
            ['Carisma', ficha.carisma],
          ] as const).map(([label, obj]) => (
            <div key={label} style={statBox}>
              <div style={statLabel}>{label}</div>
              <div style={statValue}>{obj.pontos}</div>
              <div style={statMod}>
                Mod: {obj.modificador >= 0 ? `+${obj.modificador}` : obj.modificador}
              </div>
            </div>
          ))}
        </div>

        <hr />
        <div style={{ display: 'grid', gap: 8 }}>
          <button
            style={btnSecondary}
            onClick={async () => {
              await loadMonstros();
              setMonstroId('');
              setBattle(null);
              setBattleLog([]);
              setMode('battle');
            }}
          >
            Duelar
          </button>
        </div>
      </>,
      erro
    );
  }

  if (mode === 'battle') {
    return uiCard(
      'Batalha',
      <>
        {!battle && (
          <>
            <div style={{ display: 'grid', gap: 8 }}>
              <label>Escolha um monstro:</label>
              <select
                value={monstroId}
                onChange={(e) => setMonstroId(Number(e.target.value))}
                style={input}
              >
                <option value="">Selecione...</option>
                {monstros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome} (HP {m.hp}, CA {m.ca})
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={iniciarBatalha} style={btnPrimary} disabled={!monstroId}>
                  Começar Batalha
                </button>
              </div>
            </div>
          </>
        )}

        {battle && (
          <>
            <p style={{ marginTop: 8 }}>
              <strong>Turno:</strong> {battle.turno} | <strong>Sua Vida:</strong> {battle.j_vida} |{' '}
              <strong>HP Monstro:</strong> {battle.m_hp}
            </p>
            <Dice spinning={spinning} value={dieValue} />
            {battle.fase === 'initiative' && (
              <button onClick={rollInitiative} style={btnPrimary} disabled={spinning}>
                Girar Iniciativa
              </button>
            )}
            {battle.fase === 'player' && (
              <button onClick={playerAttack} style={btnPrimary} disabled={spinning}>
                Girar Ataque do Herói
              </button>
            )}
            {battle.fase === 'monster' && (
              <button onClick={monsterAttack} style={btnSecondary} disabled={spinning}>
                Girar Ataque do Monstro
              </button>
            )}
            {battle.fase === 'ended' && (
              <p>
                {battle.vencedor === 'player' ? '🎉 Vitória!' : '☠️ Derrota...'}{' '}
                <button onClick={() => setMode('showFicha')} style={btnGhost}>Voltar</button>
              </p>
            )}
            <hr />
            <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 14 }}>
              {battleLog.map((l, i) => (
                <div key={i}>• {l}</div>
              ))}
            </div>
          </>
        )}
      </>,
      erro
    );
  }

  // default (form)
  return uiCard(
    'Criar Ficha',
    <>
      <form onSubmit={startRollVida} style={{ display: 'grid', gap: 12 }}>
        <div>
          <label style={label} htmlFor="nome">Nome do Personagem</label>
          <input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required style={input} />
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={label} htmlFor="raca">Raça</label>
            <select id="raca" value={raca} onChange={(e) => setRaca(e.target.value as any)} required style={select}>
              <option value="">Selecione...</option>
              {RACAS.map((r) => (<option key={r} value={r}>{r}</option>))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label} htmlFor="classe">Classe</label>
            <select id="classe" value={classe} onChange={(e) => setClasse(e.target.value as any)} required style={select}>
              <option value="">Selecione...</option>
              {CLASSES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
        </div>

        <fieldset style={fieldset}>
          <legend style={legend}>Atributos (use cada valor uma vez)</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {ATTRS.map((attr) => (
              <div key={attr} style={{ display: 'grid', gap: 6 }}>
                <label style={label}>{labelOf(attr)}</label>
                <select
                  value={atributos[attr] ?? ''}
                  onChange={(e) => setAtributos((old) => ({ ...old, [attr]: e.target.value ? Number(e.target.value) : '' }))}
                  required
                  style={select}
                >
                  <option value="">Selecione...</option>
                  {availableFor(attr).map((v) => (<option key={`${attr}-${v}`} value={v}>{v}</option>))}
                </select>
              </div>
            ))}
          </div>
        </fieldset>

        <button type="submit" disabled={!canSubmit} style={btnPrimary}>Próximo</button>
      </form>
    </>,
    erro
  );
}

/* ---------- Dice component (sem CSS externo) ---------- */
function Dice({ spinning, value }: { spinning: boolean; value: number | null }) {
  const [angle, setAngle] = useState(0);
  const timer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (spinning) {
      timer.current = setInterval(() => setAngle((a) => a + 36), 50);
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
      setAngle(0);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [spinning]);

  return (
    <div style={{ display: 'grid', placeItems: 'center', margin: '16px 0' }}>
      <div
        style={{
          width: 100, height: 100, borderRadius: 12,
          border: '3px solid #6a4b2f', background: '#fffdf6',
          display: 'grid', placeItems: 'center',
          fontSize: 36, fontWeight: 800, color: '#2b2116',
          transform: `rotate(${angle}deg)`,
          transition: spinning ? 'none' : 'transform .2s ease',
          boxShadow: '0 6px 0 #3a2a1a',
        }}
      >
        {value ?? '🎲'}
      </div>
    </div>
  );
}

/* ---------- helpers/estilo ---------- */
function labelOf(a: AttrName) {
  switch (a) {
    case 'forca': return 'Força';
    case 'constituicao': return 'Constituição';
    case 'destreza': return 'Destreza';
    case 'inteligencia': return 'Inteligência';
    case 'sabedoria': return 'Sabedoria';
    case 'carisma': return 'Carisma';
  }
}

function dumpAttrs(attrs: Record<AttrName, number | ''>) {
  return {
    forca: Number(attrs.forca),
    constituicao: Number(attrs.constituicao),
    destreza: Number(attrs.destreza),
    inteligencia: Number(attrs.inteligencia),
    sabedoria: Number(attrs.sabedoria),
    carisma: Number(attrs.carisma),
  };
}

async function safeJson(res: Response) { try { return await res.json(); } catch { return null; } }

function uiCard(title: string, content: React.ReactNode, erro?: string) {
  return (
    <main style={main}>
      <div style={card}>
        <h1 style={{ marginTop: 0 }}>{title}</h1>
        {erro && <p style={{ color: '#a33a2b', fontWeight: 700 }}>{erro}</p>}
        {content}
      </div>
    </main>
  );
}

const main: React.CSSProperties = {
  minHeight: '100dvh', display: 'grid', placeItems: 'center', background:
    'radial-gradient(1200px 400px at 20% -10%, #5c3a1f33, transparent 60%), radial-gradient(1200px 400px at 80% 110%, #2f3b4a33, transparent 60%), linear-gradient(180deg, #2a1f14 0%, #20160f 100%)',
  color: '#f1e8d8', padding: 24,
};
const card: React.CSSProperties = {
  width: '100%', maxWidth: 820, background: '#f8f1e1', color: '#2b2116',
  border: '2px solid #3a2a1a', borderRadius: 18, boxShadow: '0 20px 50px rgba(0,0,0,.4), inset 0 0 0 3px #e5d8b8', padding: 20,
};
const label: React.CSSProperties = { fontWeight: 700, fontSize: 14 };
const input: React.CSSProperties = { width: '100%', height: 42, border: '2px solid #6a4b2f', borderRadius: 10, padding: '0 12px', background: '#fffdf6', color:'#000' };
const select = input;
const fieldset: React.CSSProperties = { border: '2px dashed #6a4b2f', borderRadius: 12, padding: 12 };
const legend: React.CSSProperties = { padding: '0 6px', fontWeight: 700, fontSize: 13 };
const btnPrimary: React.CSSProperties = { height: 42, borderRadius: 10, padding: '0 14px', border: '2px solid #6a4b2f', background: '#6a4b2f', color: '#fff8ee', fontWeight: 700, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { ...btnPrimary, background: '#efe1c0', color: '#3a2a1a' };
const btnGhost: React.CSSProperties = { ...btnPrimary, background: 'transparent', color: '#3a2a1a' };
const statBox: React.CSSProperties = { border: '2px solid #6a4b2f', borderRadius: 10, background: '#fffdf6', padding: 10, display: 'grid', gap: 4 };
const statLabel: React.CSSProperties = { fontSize: 12, opacity: .75 };
const statValue: React.CSSProperties = { fontSize: 20, fontWeight: 800 };
const statMod: React.CSSProperties = { fontSize: 12, opacity: .85 };
