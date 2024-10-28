
import React from 'react';
import { View, FlatList, Text, StyleSheet, Button } from 'react-native';
import io from 'socket.io-client';

export default class Cozinha extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      data: [],
      data_filtrado:[],
      showFiltrado:false
    };
  }

  componentDidMount() {
    this.socket = io('http://192.168.15.68:5000');

    // Ouvir eventos de dados iniciais
    this.socket.on('initial_data', (dados) => {
      const data_temp = dados.dados_pedido.filter(item => item.categoria === '3')
      this.setState({ data:data_temp});
      console.log(data_temp)
      const data_temp_filtrado = data_temp.filter(item => item.estado !== "Pronto")
      this.setState({data_filtrado:data_temp_filtrado})
      console.log(data_temp_filtrado)
    });


  }
  componentWillUnmount() {
    this.socket.off('initial_data');
  }
  alterar_estado(id,estado){
    this.socket.emit('inserir_preparo',{id,estado})
  }
  filtrar= () =>{
    this.setState(prevState => ({
      showFiltrado:!prevState.showFiltrado
    }))
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
          renderItem={({ item,index }) => (
            <View style={styles.tableRow}>
              <Text style={styles.itemText}>{item.pedido} ({item.comanda})</Text>
              <Text style={styles.itemText}>{item.inicio}</Text>
              <Text style={styles.itemText}>{item.estado}</Text>
              {item.estado==="Em Preparo" ? (
                <Button title='Pronto' onPress={() => this.alterar_estado(item.id,'Pronto')}/>
              )
              :(item.estado === "A Fazer" ?( 
                <Button title='Começar' onPress={() => this.alterar_estado(item.id,'Em Preparo')}/>
              ):(
                <Button title='Desfazer' onPress={() => this.alterar_estado(item.id,'A Fazer')}/>
              )
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