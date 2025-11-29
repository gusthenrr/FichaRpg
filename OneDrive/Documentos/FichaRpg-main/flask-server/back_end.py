import random
import datetime
from abc import ABC, abstractmethod


class Dados:
    def __init__(self):
        self._rng = random

    def rolar(self, faces: int) -> int:
        return self._rng.randint(1, faces)

    def d4(self) -> int:
        return self.rolar(4)

    def d6(self) -> int:
        return self.rolar(6)

    def d8(self) -> int:
        return self.rolar(8)

    def d10(self) -> int:
        return self.rolar(10)

    def d12(self) -> int:
        return self.rolar(12)

    def d20(self) -> int:
        return self.rolar(20)


class Atributo:
    def __init__(self, ponto_atributo: int = 10):
        self.ponto_atributo: int = int(ponto_atributo)
        self.modificador: int = self.calcular_modificador()

    def calcular_modificador(self) -> int:
        mod = (self.ponto_atributo - 10) // 2
        self.modificador = mod
        return mod


class Curavel(ABC):
    @abstractmethod
    def regenerar(self):
        pass


class Ficha(Curavel):
    vida_regras = {
        "Ladino":    {"dado": 8,  "min": 5},
        "Guerreiro": {"dado": 10, "min": 6},
        "Bárbaro":   {"dado": 12, "min": 7},
    }

    def __init__(self, nome, atributo, classe, raca,
                 forca, constituicao, destreza, inteligencia, sabedoria, carisma):

        self.nome = nome
        self.atributo = atributo
        self.classe = classe
        self.raca = raca

        self.forca = Atributo(forca)
        self.constituicao = Atributo(constituicao)
        self.destreza = Atributo(destreza)
        self.inteligencia = Atributo(inteligencia)
        self.sabedoria = Atributo(sabedoria)
        self.carisma = Atributo(carisma)

        self.dado = Dados()

        self.vida = self.calculo_vida()
        self.vida_max = self.vida
        self.ca = self.ca_ficha()

        self.iniciativa = 0

    @classmethod
    def from_db_row(cls, row: dict) -> "Ficha":
        """
        Monta uma Ficha a partir de uma linha vinda do banco.
        """
        ficha = cls(
            nome=row["nome"],
            atributo=None,  # se não estiver usando, pode deixar None
            classe=row["classe"],
            raca=row["raca"],
            forca=row["forca"],
            constituicao=row["constituicao"],
            destreza=row["destreza"],
            inteligencia=row["inteligencia"],
            sabedoria=row["sabedoria"],
            carisma=row["carisma"],
        )

        # sobrescreve com os valores gravados no banco
        ficha.vida = row["vida"]
        ficha.vida_max = row["vida"]      # se no seu sistema "vida" no banco for a vida atual, pode ter um campo separado para vida_max depois
        ficha.ca = row["ca"]
        ficha.iniciativa = row.get("iniciativa", 0)

        return ficha

    def calculo_vida(self) -> int:
        regra = self.vida_regras.get(self.classe)
        faces = regra["dado"]
        minimo = regra["min"]
        roll = self.dado.rolar(faces) + self.dado.rolar(faces)
        base = max(roll, minimo)
        return max(base + self.constituicao.modificador, 1)

    def ca_ficha(self) -> int:
        return 10 + self.destreza.modificador

    def iniciativa_rolar(self) -> int:
        self.iniciativa = self.dado.d20() + self.destreza.modificador
        return self.iniciativa

    def regenerar(self):
        cura = self.dado.d4() + self.dado.d4() + 4
        cura = max(cura, 0)
        antes = self.vida
        self.vida = min(self.vida + cura, self.vida_max)
        efetiva = self.vida - antes
        return {
            "rolagem": cura,
            "curou": efetiva,
            "vida_atual": self.vida,
        }

    def atacar(self, alvo: "Monstros"):
        d20 = self.dado.d20()
        bonus_ataque = self.forca.modificador
        total = d20 + bonus_ataque

        # falha automática
        if d20 == 1:
            return {
                "tipo": "falha",
                "d20": d20,
                "critico": False,
                "dano": 0,
                "hp_alvo": alvo.hp,
            }

        crit = (d20 == 20)

        # errou o ataque
        if not crit and total < alvo.ca:
            return {
                "tipo": "errou",
                "d20": d20,
                "critico": False,
                "dano": 0,
                "hp_alvo": alvo.hp,
            }

        # dano por classe
        if self.classe == "Bárbaro":
            dano_base = self.dado.rolar(12) + self.forca.modificador
        elif self.classe == "Guerreiro":
            dano_base = self.dado.rolar(10) + self.forca.modificador
        elif self.classe == "Ladino":
            dano_base = (
                self.dado.rolar(6)
                + self.dado.rolar(6)
                + self.destreza.modificador
            )
        else:
            dano_base = self.dado.rolar(8) + self.forca.modificador

        dano = max(dano_base, 0)

        if crit:
            dano *= 2

        alvo.hp = max(alvo.hp - dano, 0)

        return {
            "tipo": "acertou",
            "d20": d20,
            "critico": crit,
            "dano": dano,
            "hp_alvo": alvo.hp,
        }

    def resumo(self) -> dict:
        return {
            "nome": self.nome,
            "raca": self.raca,
            "classe": self.classe,
            "vida": self.vida,
            "ca": self.ca,
            "forca": {
                "pontos": self.forca.ponto_atributo,
                "modificador": self.forca.modificador,
            },
            "destreza": {
                "pontos": self.destreza.ponto_atributo,
                "modificador": self.destreza.modificador,
            },
            "constituicao": {
                "pontos": self.constituicao.ponto_atributo,
                "modificador": self.constituicao.modificador,
            },
            "inteligencia": {
                "pontos": self.inteligencia.ponto_atributo,
                "modificador": self.inteligencia.modificador,
            },
            "sabedoria": {
                "pontos": self.sabedoria.ponto_atributo,
                "modificador": self.sabedoria.modificador,
            },
            "carisma": {
                "pontos": self.carisma.ponto_atributo,
                "modificador": self.carisma.modificador,
            },
        }

    def __str__(self) -> str:
        r = self.resumo()
        return (
            f"Nome: {r['nome']} | Raça: {r['raca']} | Classe: {r['classe']}\n"
            f"Vida: {r['vida']} | CA: {r['ca']}\n"
            f"Força {r['forca']['pontos']} (modificador {r['forca']['modificador']}) | "
            f"Destreza {r['destreza']['pontos']} (modificador {r['destreza']['modificador']})\n"
            f"Constituição {r['constituicao']['pontos']} (modificador {r['constituicao']['modificador']}) | "
            f"Inteligência {r['inteligencia']['pontos']} (modificador {r['inteligencia']['modificador']})\n"
            f"Sabedoria {r['sabedoria']['pontos']} (modificador {r['sabedoria']['modificador']}) | "
            f"Carisma {r['carisma']['pontos']} (modificador {r['carisma']['modificador']})"
        )


class Monstros(ABC):
    hp: int

    def __init__(self, hp, ca):
        self.hp = hp
        self.ca = ca

    @abstractmethod
    def atacar(self, j: "Ficha"):
        pass

    def __str__(self):
        if self.hp > 0:
            return f"monstro com {self.hp}"
        else:
            return "monstro morto!"


class Molodoy(Monstros, Curavel):
    bonus_ataque = 4
    dano_faces = 8
    bonus_dano = 0

    def __init__(self, dados=None):
        super().__init__(hp=19, ca=11)
        self.dados = dados or Dados()
        self.hp_max = 19

    @classmethod
    def from_db_row(cls, row: dict) -> "Molodoy":
        m = cls()
        m.hp = row["hp"]
        m.hp_max = row["hp"]
        m.ca = row["ca"]
        return m

    def atacar(self, j: Ficha):
        d20 = self.dados.d20()
        total = d20 + self.bonus_ataque

        if d20 == 1:
            return {
                "tipo": "falha",
                "d20": d20,
                "critico": False,
                "dano": 0,
                "hp_alvo": j.vida,
            }

        crit = (d20 == 20)

        if not crit and total < j.ca:
            return {
                "tipo": "errou",
                "d20": d20,
                "critico": False,
                "dano": 0,
                "hp_alvo": j.vida,
            }

        dano = self.dados.rolar(self.dano_faces) + self.bonus_dano
        dano = max(dano, 0)
        if crit:
            dano *= 2

        j.vida = max(j.vida - dano, 0)

        return {
            "tipo": "acertou",
            "d20": d20,
            "critico": crit,
            "dano": dano,
            "hp_alvo": j.vida,
        }

    def regenerar(self):
        cura = self.dados.d4() + self.dados.d4() + 4
        antes = self.hp
        self.hp = min(self.hp + cura, self.hp_max)
        efetiva = self.hp - antes
        return {
            "rolagem": cura,
            "curou": efetiva,
            "hp_atual": self.hp,
        }
