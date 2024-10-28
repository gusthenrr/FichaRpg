from cs50 import SQL

# Conectando ao banco de dados
db = SQL('sqlite:///dados.db')

# Adicionando a coluna 'liberado' à tabela 'usuarios

dados=db.execute('SELECT * FROM usuarios')
# Imprimindo os dados
print(dados)
