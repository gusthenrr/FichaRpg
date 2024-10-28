import React from 'react';
import { View, FlatList, Text, StyleSheet, Button, TextInput, TouchableOpacity } from 'react-native';
import io from 'socket.io-client';

export default class PedidosScreen extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      data: [],
      showEditar: false,
      pedidosAlterados: [],
    };
  }

  componentDidMount() {
    this.socket = io('http://192.168.15.68:5000');

    this.socket.on('initial_data', (dados) => {
      console.log(dados);
      this.setState({ data: dados.dados_pedido });
    });
  }

  componentWillUnmount() {
    this.socket.disconnect();
  }

  alterarPedido = (campo, valor, index) => {
    const atualizar = [...this.state.data];
    const pedido_na_lista = this.state.pedidosAlterados.some(pedido => pedido.id === atualizar[index].id);

    const newData = atualizar.map((item, ind) => {
      if (ind === index) {
        return { ...item, [campo]: valor };
      }
      return item;
    });

    if (!pedido_na_lista) {
      this.setState(prevState => ({
        pedidosAlterados: [...prevState.pedidosAlterados, { ...newData[index] }]
      }));
    } else {
      this.setState(prevState => ({
        pedidosAlterados: prevState.pedidosAlterados.map(pedido =>
          pedido.id === newData[index].id ? { ...pedido, [campo]: valor } : pedido
        )
      }));
    }

    this.setState({ data: newData });
  };

  handleConfirmar = () => {
    const { pedidosAlterados } = this.state;
    this.socket.emit('atualizar_pedidos', { pedidosAlterados });
    this.setState({ showEditar: false });
  };

  handleDelete = (index) => {
    this.alterarPedido('quantidade', '0', index);
  };

  render() {
    return (
      <View style={styles.container}>
        <View style={styles.tableHeader}>
          <Text style={styles.headerText}>Comanda</Text>
          <Text style={styles.headerText}>Quantidade</Text>
          <Text style={styles.headerText}>Pedido</Text>
          <Text style={styles.headerText}>Extra</Text>
          <Text style={styles.headerText}>Envio</Text>
          <Text style={styles.headerText}>User</Text>
          
          {!this.state.showEditar ? (
            <Button title="Editar" onPress={() => this.setState({ showEditar: true })} />
          ) : (
            <Button title="Confirmar" onPress={this.handleConfirmar} />
          )}
        </View>
        <FlatList
          data={this.state.data}
          keyExtractor={(item, index) => index.toString()}
          renderItem={({ item, index }) => (
            <View style={styles.tableRow}>
              <View style={styles.itemContainer}>
                <TextInput
                  style={styles.itemText}
                  value={item.comanda}
                  editable={this.state.showEditar}
                  onChangeText={(text) => this.alterarPedido('comanda', text, index)}
                />
              </View>
              <View style={styles.itemContainer}>
              <TextInput
                  style={styles.itemText}
                  value={item.quantidade.toString()}
                  editable={this.state.showEditar}
                  onChangeText={(text) => this.alterarPedido('quantidade', text, index)}
                />
              </View>
              
              <View style={styles.itemContainer}>
              <TextInput
                  style={styles.itemText}
                  value={item.pedido}
                  editable={this.state.showEditar}
                  onChangeText={(text) => this.alterarPedido('pedido', text, index)}
                />
                
              </View>
              <View style={styles.itemContainer}>
              <TextInput
                  style={styles.itemText}
                  value={item.extra}
                  editable={this.state.showEditar}
                  onChangeText={(text) => this.alterarPedido('extra', text, index)}
                />
              </View>
              <View style={styles.itemContainer}>
                <Text>{item.inicio}</Text>
              </View>
              <View style={styles.itemContainer}>
                <Text>{item.username}</Text>
              </View>
              {this.state.showEditar && (
                <View style={styles.itemContainer}>
                  <TouchableOpacity
                    onPress={() => this.handleDelete(index)}
                    style={styles.deleteButton}
                  >
                    <Text style={styles.deleteButtonText}>-</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  headerText: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center', // Centraliza o texto no cabeçalho
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  itemContainer: {
    flex: 1,
    justifyContent: 'center', // Centraliza verticalmente o conteúdo
  },
  itemText: {
    flex: 1,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 5,
  },
  deleteButton: {
    backgroundColor: 'transparent',
    padding: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonText: {
    fontSize: 18,
    color: 'red', // Cor do texto do botão de delete
  },
});
