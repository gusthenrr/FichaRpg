from cs50 import SQL
import random
db = SQL("sqlite:///app.db")

def seed(count=10):
  prefix = ["Gor", "Mor", "Zul", "Vor", "Krag", "Tor", "Az", "Bal", "Ur", "Rok"]
  suffix = ["gash", "mok", "thar", "grom", "nak", "zul", "rak", "dor", "grim", "mog"]
  for _ in range(count):
      nome = random.choice(prefix) + random.choice(suffix)
      hp, ca = 19, 11
      db.execute("INSERT INTO monstros (nome, tipo, hp, ca) VALUES (?, 'Molodoy', ?, ?)", nome, hp, ca)
  print(f"Criados {count} monstros.")

seed()
print("Banco inicializado ✅")