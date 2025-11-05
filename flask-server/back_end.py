import random
from abc import ABC, abstractmethod, ABCMeta

class Dados:
    def __init__(self):
        self._rng = random

    def rolar(self, faces: int) -> int:
        return self._rng.randint(1, faces)

    def d4(self) -> int:  return self.rolar(4)
    def d6(self) -> int:  return self.rolar(6)
    def d8(self) -> int:  return self.rolar(8)
    def d10(self) -> int: return self.rolar(10)
    def d12(self) -> int: return self.rolar(12)
    def d20(self) -> int: return self.rolar(20)

class Atributo:
    def __init__(self, ponto_atributo: int = 10):
        self.ponto_atributo: int = int(ponto_atributo)
        self.modificador: int = self.calcular_modificador()

    def calcular_modificador(self) -> int:
        mod = (self.ponto_atributo - 10) // 2
        self.modificador = mod
        return mod

class Ficha:
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

    def resumo(self) -> dict:
        return {
            "nome": self.nome,
            "raca": self.raca,
            "classe": self.classe,
            "vida": self.vida,
            "ca": self.ca,
            "forca": {"pontos": self.forca.ponto_atributo, "modificador": self.forca.modificador},
            "destreza": {"pontos": self.destreza.ponto_atributo, "modificador": self.destreza.modificador},
            "constituicao": {"pontos": self.constituicao.ponto_atributo, "modificador": self.constituicao.modificador},
            "inteligencia": {"pontos": self.inteligencia.ponto_atributo, "modificador": self.inteligencia.modificador},
            "sabedoria": {"pontos": self.sabedoria.ponto_atributo, "modificador": self.sabedoria.modificador},
            "carisma": {"pontos": self.carisma.ponto_atributo, "modificador": self.carisma.modificador},
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

class curar(metaclass=ABCMeta):
    def __init__(self):
        pass

    @abstractmethod
    def regenerar(self):
        pass

class Monstros(metaclass=ABCMeta):
    hp : int

    def __init__(self,hp,ca):
        self.hp = hp
        self.ca = ca

    @abstractmethod
    def atacar(self,j : "Ficha"):
        pass
        
    def __str__(self):
        if self.hp > 0:
            return f"monstro com {self.hp}"
        else:
            return f"monstro morto!"
    

class Molodoy(Monstros, curar):
    bonus_ataque = 4
    dano_faces   = 8
    bonus_dano   = 0

    def __init__(self, dados=None):
        super().__init__(hp=19, ca=11)
        self.dados = dados or Dados()
        self.hp_max = 19

    def atacar(self, j: "Ficha"):
        d20 = self.dados.d20()
        total = d20 + self.bonus_ataque

     
        if d20 == 1:
            return {"acerto": False, "falha_auto": True, "d20": d20, "ataque": total}

    
        crit = (d20 == 20)

        if not crit and total < j.ca:
            return {"acerto": False, "d20": d20, "ataque": total}

        dano = self.dados.rolar(self.dano_faces) + self.bonus_dano
        dano = max(dano, 0)
        if crit:
            dano *= 2

        j.vida = max(j.vida - dano, 0)

        return {"acerto": True, "critico": crit, "d20": d20, "ataque": total, "dano": dano, "vida_alvo": j.vida}

    def regenerar(self):
        cura = self.dados.d4() + self.dados.d4() + 4
        antes = self.hp
        self.hp = min(self.hp + cura, self.hp_max)
        efetiva = self.hp - antes
        return {"rolagem": cura, "curou": efetiva, "hp_atual": self.hp}