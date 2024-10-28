  import React from 'react';
  import { View, FlatList, Text, StyleSheet, Button, TextInput } from 'react-native';
  import io from 'socket.io-client';

  export default class EstoqueScreen extends React.Component {
    constructor(props) {
      super(props);
      this.state = {
        data: [],
        showEditar: false,
        itensAlterados: [],
        quantidadeText: null,
      };
    }

    componentDidMount() {
      this.socket = io('http://192.168.15.68:5000');

      this.socket.on('connect', () => {
        console.log('Conectado ao servidor');
      });

      this.socket.on('initial_data', (data) => {
        console.log('Dados iniciais recebidos:', data);
        this.setState({ data: data.dados_estoque });
      });
    }

    componentWillUnmount() {
      this.socket.disconnect();
    }

    aumentarQuantidade = (index) => {
      const atualizar = [...this.state.data];
      const pedido_na_lista = this.state.itensAlterados.some(item => item.item === atualizar[index].item);
      atualizar[index].quantidade = (parseInt(atualizar[index].quantidade) + 1).toString();
      this.setState({ data: atualizar });

      if (!pedido_na_lista) {
        this.setState(prevState => ({
          itensAlterados: [...prevState.itensAlterados, atualizar[index]]
        }));
      } else {
        this.setState(prevState => ({
          itensAlterados: prevState.itensAlterados.map(item =>
            item.item === atualizar[index].item ? { ...item, quantidade: atualizar[index].quantidade } : item
          )
        }));
      }
    };

    diminuirQuantidade = (index) => {
      const atualizar = [...this.state.data];
      const pedido_na_lista = this.state.itensAlterados.some(item => item.item === atualizar[index].item);
      atualizar[index].quantidade = Math.max(0, parseInt(atualizar[index].quantidade) - 1).toString();
      this.setState({ data: atualizar });

      if (!pedido_na_lista) {
        this.setState(prevState => ({
          itensAlterados: [...prevState.itensAlterados, atualizar[index]]
        }));
      } else {
        this.setState(prevState => ({
          itensAlterados: prevState.itensAlterados.map(item =>
            item.item === atualizar[index].item ? { ...item, quantidade: atualizar[index].quantidade } : item
          )
        }));
      }
    };

    alterarQuantidade = (quantidade, index) => {
      const atualizar = [...this.state.data];
      const pedido_na_lista = this.state.itensAlterados.some(item => item.item === atualizar[index].item);

      const newData = atualizar.map((item, ind) => {
        if (ind === index) {
          return { ...item, quantidade: quantidade };
        }
        return item;
      });

      if (!pedido_na_lista) {
        this.setState(prevState => ({
          itensAlterados: [...prevState.itensAlterados, { ...newData[index] }]
        }));
      } else {
        this.setState(prevState => ({
          itensAlterados: prevState.itensAlterados.map(item =>
            item.item === newData[index].item ? { ...item, quantidade: newData[index].quantidade } : item
          )
        }));
      }

      this.setState({ data: newData });
    };

    handleConfirmar = () => {
      const { itensAlterados } = this.state;
      this.socket.emit('atualizar_estoque', { itensAlterados });
      this.setState({ showEditar: false });
    };

    render() {
      return (
        <View style={styles.container}>
          <View style={styles.tableHeader}>
            <Text style={styles.headerText}>ITEM</Text>
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
                <Text style={styles.itemText}>{item.item}</Text>
                {this.state.showEditar ? (
                  <View style={styles.editRow}>
                    <Button title="-" onPress={() => this.diminuirQuantidade(index)} />
                    <TextInput
                      style={styles.input}
                      value={item.quantidade.toString()}
                      onChangeText={(text) => this.alterarQuantidade(text, index)}
                    />
                    <Button title="+" onPress={() => this.aumentarQuantidade(index)} />
                  </View>
                ) : (
                  <Text style={styles.itemText}>{item.quantidade}</Text>
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
      backgroundColor: '#f8f9fa',
    },
    tableHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 15,
      paddingHorizontal: 20,
      backgroundColor: '#e9ecef',
      borderRadius: 8,
      marginBottom: 10,
      width: '95%',
    },
    headerText: {
      fontSize: 20,
      fontWeight: 'bold',
    },
    tableRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderBottomWidth: 1,
      borderBottomColor: '#ccc',
      width: '95%',
    },
    itemText: {
      fontSize: 18,
      fontWeight: '400',
      flex: 2,
      textAlign: 'left',
    },
    editRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flex: 1,
    },
    input: {
      width: 40,
      textAlign: 'center',
      borderColor: '#000',
      borderWidth: 1,
      marginHorizontal: 10,
    },
  });
