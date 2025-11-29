from flask import Flask, request, jsonify
from flask_cors import CORS
from cs50 import SQL
from back_end import Ficha, Molodoy, Atributo, Dados
import random
import time 
import datetime

app = Flask(__name__)
db = SQL("sqlite:///app.db")
CORS(app, origins=["/*"])

ALLOWED_CLASSES = {"Ladino", "Guerreiro", "Bárbaro"}
ALLOWED_RACES = {"Humano", "Elfo", "Anão", "Halfling", "Meio-Orc"}
POOL = [15, 14, 13, 12, 10, 8]

def get_user_or_email(user_or_email: str):
    rows = db.execute(
        "SELECT id, userName, email FROM users WHERE userName = ? OR email = ? LIMIT 1",
        user_or_email, user_or_email
    )
    return rows[0] if rows else None

def definir_modificador(atributo_data):
    atributo = Atributo(atributo_data)
    return atributo, atributo.modificador

def row_to_ficha_json(row):
    forca, forca_mod = definir_modificador(row["forca"])
    destreza, destreza_mod = definir_modificador(row["destreza"])
    constituicao, const_mod = definir_modificador(row['constituicao'])
    inteligencia, inteligencia_mod = definir_modificador(row['inteligencia'])
    sabedoria, sabedoria_mod = definir_modificador(row['sabedoria'])
    carisma, carisma_mod = definir_modificador(row['carisma'])
    return {
        "nome": row["nome"],
        "raca": row["raca"],
        "classe": row["classe"],
        "vida": row["vida"],
        "ca": row["ca"],
        "forca": {"pontos": forca.ponto_atributo, "modificador": forca_mod},
        "destreza": {"pontos": destreza.ponto_atributo, "modificador": destreza_mod},
        "constituicao": {"pontos": constituicao.ponto_atributo, "modificador": const_mod},
        "inteligencia": {"pontos": inteligencia.ponto_atributo, "modificador": inteligencia_mod},
        "sabedoria": {"pontos": sabedoria.ponto_atributo, "modificador": sabedoria_mod},
        "carisma": {"pontos": carisma.ponto_atributo, "modificador": carisma_mod},
    }

def validate_pool(attrs: dict) -> bool:
    try:
        values = sorted([int(attrs[k]) for k in ("forca","constituicao","destreza","inteligencia","sabedoria","carisma")])
    except Exception:
        return False
    return values == sorted(POOL)


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

    user = get_user_or_email(user_or_email)
    if not user:
        return jsonify(success=False, message="Credenciais inválidas"), 401

    row = db.execute("SELECT password_hash FROM users WHERE id = ?", user["id"])
    if row[0]["password_hash"] != senha:
        return jsonify(success=False, message="Credenciais inválidas"), 401

    return jsonify(success=True, user={"id": user["id"], "userName": user["userName"], "email": user["email"]}), 200


@app.get("/ficha")
def get_ficha():
    userName = (request.args.get("userName") or "").strip()
    if not userName:
        return jsonify(success=False, message="Informe userName"), 400

    user = get_user_or_email(userName)
    if not user:
        return jsonify(success=False, message="Usuário não encontrado"), 404

    rows = db.execute("SELECT * FROM fichas WHERE user_id = ? LIMIT 1", user["id"])
    if not rows:
        return jsonify(success=False, message="Ficha não encontrada"), 404

    return jsonify(success=True, ficha=row_to_ficha_json(rows[0])), 200
    

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

    user = get_user_or_email(userName)
    if not user:
        return jsonify(success=False, message="Usuário não encontrado"), 404

    exists = db.execute("SELECT id FROM fichas WHERE user_id = ? LIMIT 1", user["id"])
    if exists:
        return jsonify(success=False, message="Usuário já possui ficha"), 409

    regra = Ficha.vida_regras.get(classe)
    faces, minimo = int(regra["dado"]), int(regra["min"])
    dados = Dados()
    if faces==8:dado=dados.d8()
    elif faces==10: dado = dados.d10()
    else: dado = dados.d12()
    r1 = dado
    print('dado: ', r1)
    base = max(r1,minimo)
    r1=base
    constituicao, con_mod = definir_modificador(int(attrs["constituicao"]))
    vida = max(r1 + con_mod, 1)
    return jsonify(success=True, r1=r1, conMod=con_mod, vida=vida, dado=faces), 200

@app.post("/ficha/roll/ca")
def ficha_roll_ca():
    print('entrou aqui')
    data = request.get_json(silent=True) or {}
    userName = (data.get("userName") or "").strip()
    nome = (data.get("nome") or "").strip()
    raca = (data.get("raca") or "").strip()
    classe = (data.get("classe") or "").strip()
    attrs = data.get("atributos") or {}
    vida = data.get("vida")
    print('passou pelas variaveis')
    if not (userName and nome and raca and classe and attrs and isinstance(vida, int)):
        return jsonify(success=False, message="Campos obrigatórios ausentes"), 400
    if classe not in ALLOWED_CLASSES or raca not in ALLOWED_RACES or not validate_pool(attrs):
        return jsonify(success=False, message="Dados inválidos"), 400

    user = get_user_or_email(userName)
    if not user:
        return jsonify(success=False, message="Usuário não encontrado"), 404
    print('passo  do users')
    exists = db.execute("SELECT id FROM fichas WHERE user_id = ? LIMIT 1", user["id"])
    if exists:
        return jsonify(success=False, message="Usuário já possui ficha"), 409
    print('passou do existis')
    destreza, dex_mod = definir_modificador(int(attrs["destreza"]))
    ca = 10 + dex_mod
    print('passou do ca')
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
    print('passou do banco de dados')
    row = db.execute("SELECT * FROM fichas WHERE user_id = ? LIMIT 1", user["id"])[0]
    return jsonify(success=True, ca=ca, dexMod=dex_mod, ficha=row_to_ficha_json(row)), 201



@app.get("/monstros")
def list_monstros():
    rows = db.execute("SELECT id, nome, tipo, hp, ca FROM monstros ORDER BY id DESC")
    return jsonify(success=True, monstros=rows), 200


@app.post("/batalha/iniciar")
def batalha_iniciar():
    data = request.get_json(silent=True) or {}
    userName = (data.get("userName") or "").strip()
    monstro_id = int(data.get("monstro_id") or 0)
    if not userName or not monstro_id:
        return jsonify(success=False, message="Informe userName e monstro_id"), 400

    user = get_user_or_email(userName)
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

    # Guardando o historico das batalhas, para nao perder o estado da vida dos personagens, tanto do jogador quanto do mmonstro
    db.execute("""
      INSERT INTO batalhas (user_id, monstro_id, j_vida, m_hp, fase, turno)
      VALUES (?, ?, ?, ?, 'initiative', 1)
    """, user["id"], monstro_id, int(ficha["vida"]), int(monstro["hp"]))
    b = db.execute("SELECT * FROM batalhas WHERE rowid = last_insert_rowid()")[0]
    return jsonify(success=True, battle=trim_battle(b)), 201

@app.post("/batalha/roll/initiative")
def batalha_roll_initiative():
    """Rola a iniciativa para decidir quem começa a batalha, entre o jogador ou o monstro, quem começa atacando."""

    data = request.get_json(silent=True) or {}
    battle_id = int(data.get("battle_id") or 0)
    if not battle_id: return jsonify(success=False, message="battle_id é obrigatório"), 400
    b = get_battle(battle_id)
    if not b: return jsonify(success=False, message="Batalha não encontrada"), 404
    if b["fase"] != "initiative": return jsonify(success=False, message="Fase inválida"), 400

    # carrega ficha para pegar destreza, atributo necessário para o cálculo da iniciativa do jogador
    ficha = db.execute("SELECT * FROM fichas WHERE user_id = ? LIMIT 1", b["user_id"])[0]
    destreza, dex_mod = definir_modificador(ficha["destreza"])
    d20=Dados()
    d20_player = d20.d20()
    d20_monstro = d20.d20()

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
    if not battle_id:
        return jsonify(success=False, message="battle_id é obrigatório"), 400

    b = get_battle(battle_id)
    if not b:
        return jsonify(success=False, message="Batalha não encontrada"), 404

    if b["fase"] != "player":
        return jsonify(success=False, message="Não é a vez do jogador"), 400
    # ficha do jogador
    ficha_row = db.execute("SELECT * FROM fichas WHERE user_id = ? LIMIT 1",b["user_id"],)[0]
    # monstro da batalha
    monstro_row = db.execute("SELECT * FROM monstros WHERE id = ? LIMIT 1",b["monstro_id"],)[0]

    ficha = Ficha.from_db_row(ficha_row)
    monstro = Molodoy.from_db_row(monstro_row)
    # usar HP atual da batalha
    monstro.hp = b["m_hp"]
    # ataque
    resultado = ficha.atacar(monstro)  # <- nome certo
    d20 = resultado["d20"]
    ataque_total = d20 + ficha.forca.modificador  # se quiser exibir o total

    if resultado["tipo"] in ("errou", "falha"):
        hit = False
        critico = False
        dano = 0
    else:
        hit = True
        critico = resultado["critico"]
        dano = resultado["dano"]

    new_m_hp = resultado["hp_alvo"]

    vencedor = None
    fase = "monster"
    if new_m_hp <= 0:
        new_m_hp = 0
        fase = "ended"
        vencedor = "player"

    db.execute(
        """
        UPDATE batalhas
        SET m_hp = ?, fase = ?, vencedor = COALESCE(vencedor, ?), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        new_m_hp, fase, vencedor, battle_id
    )

    b = get_battle(battle_id)

    return jsonify(
        success=True,
        d20=d20,
        ataque=ataque_total,
        dano=dano,
        hit=hit,
        critico=critico,
        ca_monstro=monstro.ca,   # <- objeto, não dict
        battle=trim_battle(b),
    ), 200


@app.post("/batalha/roll/monster_attack")
def batalha_monstro_attack():
    data = request.get_json(silent=True) or {}
    battle_id = int(data.get("battle_id") or 0)

    if not battle_id:
        return jsonify(success=False, message="battle_id é obrigatório"), 400

    b = get_battle(battle_id)
    if not b:
        return jsonify(success=False, message="Batalha não encontrada"), 404

    if b["fase"] != "monster":
        return jsonify(success=False, message="Não é a vez do monstro"), 400

    # pega ficha e monstro do banco
    ficha_row = db.execute(
        "SELECT * FROM fichas WHERE user_id = ? LIMIT 1",
        b["user_id"],
    )[0]

    monstro_row = db.execute(
        "SELECT * FROM monstros WHERE id = ? LIMIT 1",
        b["monstro_id"],
    )[0]

    ficha = Ficha.from_db_row(ficha_row)
    monstro = Molodoy.from_db_row(monstro_row)  # por enquanto só Molodoy mesmo

    # sobrescreve com os valores da batalha
    ficha.vida = b["j_vida"]   # vida atual do jogador na batalha
    monstro.hp = b["m_hp"]     # vida atual do monstro na batalha (se quiser usar depois)

    # ataque do monstro contra a ficha
    resultado = monstro.atacar(ficha)

    d20 = resultado["d20"]
    ataque_total = d20 + monstro.bonus_ataque  # total da rolagem do monstro

    # interpreta o resultado
    if resultado["tipo"] in ("errou", "falha"):
        hit = False
        critico = False
        dano = 0
    else:
        hit = True
        critico = resultado["critico"]
        dano = resultado["dano"]

    new_j_vida = resultado["hp_alvo"]  # vida do jogador depois do ataque

    vencedor = None
    fase = "player"
    if new_j_vida <= 0:
        new_j_vida = 0
        fase = "ended"
        vencedor = "monster"

    db.execute(
        """
        UPDATE batalhas
        SET j_vida = ?, fase = ?, vencedor = COALESCE(vencedor, ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        new_j_vida, fase, vencedor, battle_id
    )

    b = get_battle(battle_id)

    return jsonify(
        success=True,
        d20=d20,
        ataque=ataque_total,
        dano=dano,
        hit=hit,
        critico=critico,
        ca_jogador=ficha.ca,
        battle=trim_battle(b),
    ), 200


# ---------------------- utils batalha ----------------------
def get_battle(battle_id: int):
    """Retorna a batalha com o ID especificado, ou None se não existir."""
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
