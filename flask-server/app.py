from flask import Flask, request, jsonify
from flask_cors import CORS
from cs50 import SQL
from back_end import Ficha, Molodoy  # usa suas classes
import random
import time 

app = Flask(__name__)
db = SQL("sqlite:///app.db")
CORS(app, origins=["/*"])

ALLOWED_CLASSES = {"Ladino", "Guerreiro", "Bárbaro"}
ALLOWED_RACES = {"Humano", "Elfo", "Anão", "Halfling", "Meio-Orc"}
POOL = [15, 14, 13, 12, 10, 8]

def get_user_by_user_or_email(user_or_email: str):
    rows = db.execute(
        "SELECT id, userName, email FROM users WHERE userName = ? OR email = ? LIMIT 1",
        user_or_email, user_or_email
    )
    return rows[0] if rows else None

def modifiers_from(score: int) -> int:
    return (int(score) - 10) // 2

def row_to_ficha_json(row):
    return {
        "nome": row["nome"],
        "raca": row["raca"],
        "classe": row["classe"],
        "vida": row["vida"],
        "ca": row["ca"],
        "forca": {"pontos": row["forca"], "modificador": modifiers_from(row["forca"])},
        "destreza": {"pontos": row["destreza"], "modificador": modifiers_from(row["destreza"])},
        "constituicao": {"pontos": row["constituicao"], "modificador": modifiers_from(row["constituicao"])},
        "inteligencia": {"pontos": row["inteligencia"], "modificador": modifiers_from(row["inteligencia"])},
        "sabedoria": {"pontos": row["sabedoria"], "modificador": modifiers_from(row["sabedoria"])},
        "carisma": {"pontos": row["carisma"], "modificador": modifiers_from(row["carisma"])},
    }

def validate_pool(attrs: dict) -> bool:
    try:
        values = sorted([int(attrs[k]) for k in ("forca","constituicao","destreza","inteligencia","sabedoria","carisma")])
    except Exception:
        return False
    return values == sorted(POOL)

# ---------------------- AUTH -------------------------
@app.post("/cadastro")
def cadastrar():
    data = request.get_json(silent=True) or {}
    userName = (data.get("userName") or "").strip()
    email = (data.get("email") or "").strip().lower()
    senha = data.get("senha") or ""
    if not userName or not email or not senha:
        return jsonify(success=False, message="Campos obrigatórios ausentes"), 400

    exists = db.execute(
        "SELECT id FROM users WHERE userName = ? OR email = ? LIMIT 1",
        userName, email
    )
    if exists:
        return jsonify(success=False, message="Usuário ou email já existe"), 409

    db.execute("INSERT INTO users (userName, email, password_hash) VALUES (?, ?, ?)", userName, email, senha)
    return jsonify(success=True, message="Conta criada"), 201

@app.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    user_or_email = (data.get("userName") or "").strip()
    senha = data.get("senha") or ""
    if not user_or_email or not senha:
        return jsonify(success=False, message="Campos obrigatórios ausentes"), 400

    user = get_user_by_user_or_email(user_or_email)
    if not user:
        return jsonify(success=False, message="Credenciais inválidas"), 401

    row = db.execute("SELECT password_hash FROM users WHERE id = ?", user["id"])
    if row[0]["password_hash"] != senha:
        return jsonify(success=False, message="Credenciais inválidas"), 401

    return jsonify(success=True, user={"id": user["id"], "userName": user["userName"], "email": user["email"]}), 200

# ---------------------- FICHA: consulta existente ------------------------
@app.get("/ficha")
def get_ficha():
    userName = (request.args.get("userName") or "").strip()
    if not userName:
        return jsonify(success=False, message="Informe userName"), 400

    user = get_user_by_user_or_email(userName)
    if not user:
        return jsonify(success=False, message="Usuário não encontrado"), 404

    rows = db.execute("SELECT * FROM fichas WHERE user_id = ? LIMIT 1", user["id"])
    if not rows:
        return jsonify(success=False, message="Ficha não encontrada"), 404

    return jsonify(success=True, ficha=row_to_ficha_json(rows[0])), 200

# ---------------------- FICHA: rolar VIDA (não persiste) -----------------
@app.post("/ficha/roll/vida")
def ficha_roll_vida():
    data = request.get_json(silent=True) or {}
    userName = (data.get("userName") or "").strip()
    nome = (data.get("nome") or "").strip()
    raca = (data.get("raca") or "").strip()
    classe = (data.get("classe") or "").strip()
    attrs = data.get("atributos") or {}

    if not userName or not nome or not raca or not classe or not attrs:
        return jsonify(success=False, message="Campos obrigatórios ausentes"), 400
    if classe not in ALLOWED_CLASSES:
        return jsonify(success=False, message="Classe inválida"), 400
    if raca not in ALLOWED_RACES:
        return jsonify(success=False, message="Raça inválida"), 400
    if not validate_pool(attrs):
        return jsonify(success=False, message="Atributos inválidos; use o pool [15,14,13,12,10,8] sem repetição"), 400

    user = get_user_by_user_or_email(userName)
    if not user:
        return jsonify(success=False, message="Usuário não encontrado"), 404

    exists = db.execute("SELECT id FROM fichas WHERE user_id = ? LIMIT 1", user["id"])
    if exists:
        return jsonify(success=False, message="Usuário já possui ficha"), 409

    # vida conforme regra da sua classe
    regra = Ficha.vida_regras.get(classe)
    faces, minimo = int(regra["dado"]), int(regra["min"])
    r1 = random.randint(1, faces)
    r2 = random.randint(1, faces)
    base = max(r1 + r2, minimo)
    con_mod = modifiers_from(int(attrs["constituicao"]))
    vida = max(base + con_mod, 1)
    return jsonify(success=True, r1=r1, r2=r2, base=base, conMod=con_mod, vida=vida), 200

# ---------------------- FICHA: rolar CA (cosmético) & persistir ----------
@app.post("/ficha/roll/ca")
def ficha_roll_ca():
    data = request.get_json(silent=True) or {}
    userName = (data.get("userName") or "").strip()
    nome = (data.get("nome") or "").strip()
    raca = (data.get("raca") or "").strip()
    classe = (data.get("classe") or "").strip()
    attrs = data.get("atributos") or {}
    vida = data.get("vida")
    if not (userName and nome and raca and classe and attrs and isinstance(vida, int)):
        return jsonify(success=False, message="Campos obrigatórios ausentes"), 400
    if classe not in ALLOWED_CLASSES or raca not in ALLOWED_RACES or not validate_pool(attrs):
        return jsonify(success=False, message="Dados inválidos"), 400

    user = get_user_by_user_or_email(userName)
    if not user:
        return jsonify(success=False, message="Usuário não encontrado"), 404

    exists = db.execute("SELECT id FROM fichas WHERE user_id = ? LIMIT 1", user["id"])
    if exists:
        return jsonify(success=False, message="Usuário já possui ficha"), 409

    # CA é determinística: 10 + mod de Destreza
    dex_mod = modifiers_from(int(attrs["destreza"]))
    ca = 10 + dex_mod

    # persistir ficha
    db.execute("""
        INSERT INTO fichas (
          user_id, nome, raca, classe,
          forca, constituicao, destreza, inteligencia, sabedoria, carisma,
          vida, ca, iniciativa
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    """,
    user["id"], nome, raca, classe,
    int(attrs["forca"]), int(attrs["constituicao"]), int(attrs["destreza"]),
    int(attrs["inteligencia"]), int(attrs["sabedoria"]), int(attrs["carisma"]),
    int(vida), int(ca))

    row = db.execute("SELECT * FROM fichas WHERE user_id = ? LIMIT 1", user["id"])[0]
    # Valor "fake" só para animar o dado no front
    fake_roll = random.randint(1, 20)
    return jsonify(success=True, ca=ca, dexMod=dex_mod, fakeRoll=fake_roll, ficha=row_to_ficha_json(row)), 201

# ---------------------- MONSTROS -----------------------------------------
@app.post("/monstros/seed")
def seed_monstros():
    count = int(request.args.get("count", 5))
    nomes = []
    prefix = ["Gor", "Mor", "Zul", "Vor", "Krag", "Tor", "Az", "Bal", "Ur", "Rok"]
    suffix = ["gash", "mok", "thar", "grom", "nak", "zul", "rak", "dor", "grim", "mog"]
    for _ in range(count):
        nome = random.choice(prefix) + random.choice(suffix)
        # tipo Molodoy dos seus classes, hp/ca padrão (poderia variar)
        hp, ca = 19, 11
        db.execute("INSERT INTO monstros (nome, tipo, hp, ca) VALUES (?, 'Molodoy', ?, ?)", nome, hp, ca)
        nomes.append(nome)
    return jsonify(success=True, created=len(nomes), nomes=nomes), 201

@app.get("/monstros")
def list_monstros():
    rows = db.execute("SELECT id, nome, tipo, hp, ca FROM monstros ORDER BY id DESC")
    return jsonify(success=True, monstros=rows), 200

# ---------------------- BATALHA ------------------------------------------
@app.post("/batalha/iniciar")
def batalha_iniciar():
    data = request.get_json(silent=True) or {}
    userName = (data.get("userName") or "").strip()
    monstro_id = int(data.get("monstro_id") or 0)
    if not userName or not monstro_id:
        return jsonify(success=False, message="Informe userName e monstro_id"), 400

    user = get_user_by_user_or_email(userName)
    if not user:
        return jsonify(success=False, message="Usuário não encontrado"), 404
    ficha_rows = db.execute("SELECT * FROM fichas WHERE user_id = ? LIMIT 1", user["id"])
    if not ficha_rows:
        return jsonify(success=False, message="Ficha não encontrada"), 404
    ficha = ficha_rows[0]

    monstro_rows = db.execute("SELECT * FROM monstros WHERE id = ? LIMIT 1", monstro_id)
    if not monstro_rows:
        return jsonify(success=False, message="Monstro não encontrado"), 404
    monstro = monstro_rows[0]

    # cria batalha
    db.execute("""
      INSERT INTO batalhas (user_id, monstro_id, j_vida, m_hp, fase, turno)
      VALUES (?, ?, ?, ?, 'initiative', 1)
    """, user["id"], monstro_id, int(ficha["vida"]), int(monstro["hp"]))
    b = db.execute("SELECT * FROM batalhas WHERE rowid = last_insert_rowid()")[0]
    return jsonify(success=True, battle=trim_battle(b)), 201

@app.post("/batalha/roll/initiative")
def batalha_roll_initiative():
    data = request.get_json(silent=True) or {}
    battle_id = int(data.get("battle_id") or 0)
    if not battle_id: return jsonify(success=False, message="battle_id é obrigatório"), 400
    b = get_battle(battle_id)
    if not b: return jsonify(success=False, message="Batalha não encontrada"), 404
    if b["fase"] != "initiative": return jsonify(success=False, message="Fase inválida"), 400

    # carrega ficha para pegar destreza
    ficha = db.execute("SELECT * FROM fichas WHERE user_id = ? LIMIT 1", b["user_id"])[0]
    dex_mod = modifiers_from(ficha["destreza"])
    d20_player = random.randint(1, 20)
    d20_monstro = random.randint(1, 20)

    if d20_player + dex_mod >= d20_monstro:
        fase = "player"
    else:
        fase = "monster"

    db.execute("UPDATE batalhas SET fase = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", fase, battle_id)
    b = get_battle(battle_id)
    return jsonify(success=True, d20_player=d20_player, dexMod=dex_mod, d20_monstro=d20_monstro, battle=trim_battle(b)), 200

@app.post("/batalha/roll/player_attack")
def batalha_player_attack():
    data = request.get_json(silent=True) or {}
    battle_id = int(data.get("battle_id") or 0)
    if not battle_id: return jsonify(success=False, message="battle_id é obrigatório"), 400
    b = get_battle(battle_id)
    if not b: return jsonify(success=False, message="Batalha não encontrada"), 404
    if b["fase"] != "player": return jsonify(success=False, message="Não é a vez do jogador"), 400

    ficha = db.execute("SELECT * FROM fichas WHERE user_id = ? LIMIT 1", b["user_id"])[0]
    monstro = db.execute("SELECT * FROM monstros WHERE id = ? LIMIT 1", b["monstro_id"])[0]
    # ataque do herói: d20 + mod Força (+2 prof de exemplo)
    for_mod = modifiers_from(ficha["forca"])
    prof = 2
    d20 = random.randint(1, 20)
    ataque_total = d20 + for_mod + prof
    hit = False; critico = False; dano = 0
    if d20 == 1:
        hit = False
    else:
        critico = (d20 == 20)
        if critico or ataque_total >= monstro["ca"]:
            hit = True
            # dano: 1d8 + mod força (mínimo 1). Crítico dobra os dados (não o bônus).
            d_dado = random.randint(1, 8)
            dano = d_dado + for_mod
            if critico:
                dano += random.randint(1, 8)
            dano = max(dano, 1)

    new_m_hp = b["m_hp"] - (dano if hit else 0)
    vencedor = None
    fase = "monster"
    if new_m_hp <= 0:
        new_m_hp = 0
        fase = "ended"
        vencedor = "player"

    db.execute("UPDATE batalhas SET m_hp = ?, fase = ?, vencedor = COALESCE(vencedor, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
               new_m_hp, fase, vencedor, battle_id)
    b = get_battle(battle_id)
    return jsonify(success=True, d20=d20, ataque=ataque_total, dano=dano, hit=hit, critico=critico,
                   ca_monstro=monstro["ca"], battle=trim_battle(b)), 200

@app.post("/batalha/roll/monster_attack")
def batalha_monstro_attack():
    data = request.get_json(silent=True) or {}
    battle_id = int(data.get("battle_id") or 0)
    if not battle_id: return jsonify(success=False, message="battle_id é obrigatório"), 400
    b = get_battle(battle_id)
    if not b: return jsonify(success=False, message="Batalha não encontrada"), 404
    if b["fase"] != "monster": return jsonify(success=False, message="Não é a vez do monstro"), 400

    ficha = db.execute("SELECT * FROM fichas WHERE user_id = ? LIMIT 1", b["user_id"])[0]
    # alvo "simples" para usar Molodoy.atacar (precisa de .vida e .ca)
    class Target:
        def __init__(self, vida, ca):
            self.vida = vida
            self.ca = ca
    alvo = Target(b["j_vida"], ficha["ca"])
    monstro = db.execute("SELECT * FROM monstros WHERE id = ? LIMIT 1", b["monstro_id"])[0]
    # Por enquanto, monstro tipo Molodoy
    mol = Molodoy()
    resultado = mol.atacar(alvo)  # altera alvo.vida

    new_j_vida = int(alvo.vida)
    vencedor = None
    fase = "player"
    if new_j_vida <= 0:
        new_j_vida = 0
        fase = "ended"
        vencedor = "monster"

    db.execute("UPDATE batalhas SET j_vida = ?, fase = ?, vencedor = COALESCE(vencedor, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
               new_j_vida, fase, vencedor, battle_id)
    b = get_battle(battle_id)
    return jsonify(success=True,
                   d20=resultado.get("d20", 0),
                   ataque=resultado.get("ataque", 0),
                   dano=resultado.get("dano", 0),
                   hit=resultado.get("acerto", False),
                   critico=resultado.get("critico", False),
                   ca_jogador=ficha["ca"],
                   battle=trim_battle(b)), 200

# ---------------------- utils batalha ----------------------
def get_battle(battle_id: int):
    rows = db.execute("SELECT * FROM batalhas WHERE id = ? LIMIT 1", battle_id)
    return rows[0] if rows else None

def trim_battle(b):
    return {
        "id": b["id"], "fase": b["fase"], "turno": b["turno"],
        "j_vida": b["j_vida"], "m_hp": b["m_hp"], "vencedor": b.get("vencedor")
    }

# ---------------------- RUN ----------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)