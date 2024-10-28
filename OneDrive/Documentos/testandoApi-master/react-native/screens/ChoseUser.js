import React, { useContext } from 'react';
import { FlatList, View, Text } from 'react-native';
import { UserContext } from '../UserContext'; // Import the UserContext
import { Button } from 'react-native'; // Import Button corretamente do 'react-native'

export default class ChoseUser extends React.Component {
  static contextType = UserContext; // Define contextType to use the context in the class component

  constructor(props) {
    super(props);
    this.state = {
      data: [], // Inicializa o estado com uma lista vazia para os dados
      showUsers: false, // Define inicialmente como false
    };
  }

  componentDidMount() {
    const { user } = this.context; // Acessa o user (com username e cargo) do contexto

    // Verifica o cargo do usuário ao montar o componente
    if (user.cargo === 'ADM') {
      this.setState({ showUsers: true }); // Atualiza o estado para permitir exibir os usuários
    }

    // Faz a requisição com base no username do contexto
    fetch('http://192.168.15.68:5000/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: user.username, // Usa o username do contexto
      }),
    })
      .then((response) => response.json()) // Converte a resposta para JSON
      .then((data) => {
        const usuarios_filtrados = data.users.filter(item => item.cargo !== 'ADM');
        // Filtra os usuários que não são 'ADM' e atualiza o estado
        console.log(data.users);
        this.setState({ data: usuarios_filtrados }); // Atualiza o estado com a lista filtrada de usuários
      })
      .catch((error) => {
        console.error('Erro:', error);
      });
  }

  // Corrige a função Liberar, agora recebendo um ID e o valor de liberação
  Liberar = (id, numero) => {
    fetch('http://192.168.15.68:5000/permitir', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: id, // Envia o ID do usuário
        numero: numero, // Envia o valor de 'numero' para liberar ou bloquear
      }),
    })
      .then((resp) => resp.json())
      .then((data) => {
        const usuarios_filtrados = data.users.filter(item => item.cargo !== 'ADM');
        // Atualiza a lista de usuários após a mudança
        this.setState({ data: usuarios_filtrados });
      })
      .catch((error) => {
        console.error('Erro:', error);
      });
  };

  render() {
    const { data, showUsers } = this.state; // Extrai data e showUsers do estado

    return (
      <View style={{ flex: 1, padding: 20 }}>
        {showUsers ? ( // Verifica o cargo do contexto
          <FlatList
            data={data}
            keyExtractor={(item, index) => index.toString()} // Adiciona uma key única para cada item
            renderItem={({ item }) => (
              <View style={{ flexDirection: 'row', padding: 10 }}>
                <Text>{item.username}</Text>
                {item.liberado === '0' ? (
                  <Button
                    title="Liberar"
                    onPress={() => this.Liberar(item.id, '1')} // Chama a função Liberar ao pressionar o botão
                  />
                ) : (
                  <Button
                    title="Bloquear"
                    onPress={() => this.Liberar(item.id, '0')} // Chama a função Liberar ao pressionar o botão
                  />
                )}
              </View>
            )}
          />
        ) : (
          <View>
            <Text>Não tem acesso a essa página</Text>
          </View>
        )}
      </View>
    );
  }
}
