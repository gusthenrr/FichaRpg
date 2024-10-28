import React from 'react';
import { View, FlatList, Text, StyleSheet, Button } from 'react-native';
import io from 'socket.io-client';

export default class BarmanScreen extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      data: [],
      data_filtrado: [],
      showFiltrado: false,
      showExtra: [],
      ingredientes: [], // Inicializa como um array vazio
    };
  }

  componentDidMount() {
    this.socket = io('http://192.168.15.68:5000');

    // Ouvir eventos de dados iniciais
    this.socket.on('initial_data', (dados) => {
      const data_temp = dados.dados_pedido.filter(item => item.categoria === '2');
      this.setState({ data: data_temp });

      const data_temp_filtrado = data_temp.filter(item => item.estado !== "Pronto");
      this.setState({ data_filtrado: data_temp_filtrado });

      // Inicializar showExtra e ingredientes com arrays do mesmo tamanho de data_temp
      this.setState({ 
        showExtra: Array(data_temp.length).fill(false),
        ingredientes: Array(data_temp.length).fill('') // Inicializa ingredientes como strings vazias
      });
    });

    // Ouvir evento de retorno dos ingredientes
    this.socket.on('ingrediente', ({ ingrediente, index }) => {
      const temp = [...this.state.ingredientes]; // Faz uma cópia do array de ingredientes
      temp[index] = ingrediente; // Atualiza o ingrediente no índice correspondente
      this.setState({ ingredientes: temp });
    });
  }

  componentWillUnmount() {
    this.socket.off('initial_data');
    this.socket.off('ingrediente');
  }

  alterar_estado(id, estado) {
    this.socket.emit('inserir_preparo', { id, estado });
  }

  filtrar = () => {
    this.setState(prevState => ({
      showFiltrado: !prevState.showFiltrado
    }));
  }

  // Método para alternar a visualização do "extra" e buscar ingredientes
  extra(index) {
    const { data_filtrado } = this.state;
    this.setState(prevState => {
      const updatedShowExtra = [...prevState.showExtra]; // Faz uma cópia do array
      updatedShowExtra[index] = !updatedShowExtra[index]; // Inverte o valor no índice correto
      return { showExtra: updatedShowExtra }; // Atualiza o estado com o novo array
    });

    // Solicita ingredientes apenas se o botão for clicado para exibir os extras
    if (!this.state.showExtra[index]) {
      this.socket.emit('get_ingredientes', { ingrediente: data_filtrado[index].pedido, index });
    }
  }

  render() {
    const dataToShow = this.state.showFiltrado
      ? this.state.data
      : this.state.data_filtrado;

    return (
      <View style={styles.container}>
        <View style={styles.tableHeader}>
          <Text style={styles.headerText}>Pedido</Text>
          <Text style={styles.headerText}>Horario Envio</Text>
          <Text style={styles.headerText}>Estado</Text>
      
          {this.state.showFiltrado ? (
            <Button title='Filtrar' onPress={this.filtrar} />
          ) : (
            <Button title='Todos' onPress={this.filtrar} />
          )}
        </View>

        <FlatList
          data={dataToShow}
          renderItem={({ item, index }) => (
            
            <View style={styles.tableRow}>
              <Text style={styles.itemText}>{item.quantidade} {item.pedido}  {item.extra} ({item.comanda})</Text>
              
              {this.state.showExtra[index] ?(
                <Button title='-' color={'red'} onPress={() => this.extra(index)} />
              ):(
              <Button title='+' onPress={() => this.extra(index)} />
              )}
              
              {this.state.showExtra[index] && (
                <Text style={styles.itemText}>{this.state.ingredientes[index]}</Text>
              )}
              
              {!this.state.showExtra[index] &&(
              <View style={styles.tableRow}>
              <Text style={styles.itemText}>{item.inicio}</Text>
              <Text style={styles.itemText}>{item.estado}</Text>
              {item.estado === "Em Preparo" ? (
                <Button title='Pronto' onPress={() => this.alterar_estado(item.id, 'Pronto')} />
              ) : item.estado === "A Fazer" ? (
                <Button title='Começar' onPress={() => this.alterar_estado(item.id, 'Em Preparo')} />
              ) : (
                <Button title='Desfazer' onPress={() => this.alterar_estado(item.id, 'A Fazer')} />
              )}
              </View>
    )}
            </View>
          )}
          keyExtractor={(item, index) => index.toString()}
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
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  itemText: {
    flex: 1,
    fontSize: 16,
  },
});