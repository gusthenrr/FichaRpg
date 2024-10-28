import React from 'react';
import { StyleSheet, View, Button, TextInput, FlatList, TouchableOpacity, Text,ScrollView } from 'react-native';
import io from 'socket.io-client';
import { UserContext } from '../UserContext'; // Import the context

export default class HomeScreen extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      username:'',
      cargo:'',
      comand: '',
      pedido: '',
      extra: '',
      preco: null,
      preco_total:0,
      preco_pago:0,
      data: [],
      fcomanda: '',
      categoria: 'produto',
      pedido_filtrado: [],
      comanda_filtrada:[],
      comanda_filtrada_abrir:[],
      quantidadeSelecionada: [],
      pedidosSelecionados: [],
      extraSelecionados: [],
      showPedido: false,
      showComandaPedido: false,
      showComanda:false,
      showQuantidade: false,
      showPedidoSelecionado: false,
      showExtra: false,
      quantidade: 1,
      quantidadeEstoqueMensagem: null,
      quantidadeRestanteMensagem: null,
      pedidoRestanteMensagem: null,
    };
  }

  componentDidMount() {
      const { user } = this.context;
        this.setState({ username: user.username });
        console.log(user.username);
       
    

    this.socket = io('http://192.168.15.68:5000');
    this.socket.on('dados_atualizados', ({ dados }) => this.setState({ data: dados }));
    this.socket.on('preco', (data) => this.setState({ preco: data.preco_a_pagar,preco_pago:data.preco_pago,preco_total:data.preco_total}));
    this.socket.on('error', ({ message }) => console.error('Erro do servidor:', message));
    this.socket.on('pedidos', (res) => this.setState({ pedido_filtrado: res }));
    this.socket.on('comandas',(res)=> this.setState({ comanda_filtrada: res }))
    this.socket.on('comandas_abrir',(res)=> this.setState({ comanda_filtrada_abrir: res }))
    this.socket.on('showExtra', (cat) => this.setState({ showExtra: true }));
    this.socket.on('alerta_restantes', (data) => {
      this.setState({ quantidadeRestanteMensagem: data.quantidade, pedidoRestanteMensagem: data.item });
    });
    this.socket.on('quantidade_insuficiente', (data) => {
        if (data.erro) {
          this.setState({
            comand: '',
            pedido: '',
            extra: '',
            quantidade: 1,
            showQuantidade: false,
            showPedidoSelecionado: false,
            showExtra: false,
            quantidadeEstoqueMensagem: data.quantidade,
          });
        } else {
          const { comand, pedido, quantidade, extra } = this.state;
          const currentTime = this.getCurrentTime();
          this.socket.emit('insert_order', { 
            comanda: comand, 
            pedidosSelecionados: [pedido], 
            quantidadeSelecionada: [quantidade],
            extraSelecionados: [extra],
            horario: currentTime
          });
          this.setState({ comand: '', pedido: '', quantidade: 1, extra: '' });
        }
      })
  }

  componentWillUnmount() {
    this.socket.off('dados_atualizados');
    this.socket.off('preco');
    this.socket.off('error');
    this.socket.off('pedidos');
    this.socket.off('showExtra');
    this.socket.off('quantidade_insuficiente');
    this.socket.off('alerta_restantes');
  }

  changeComanda = (comand) => {
    this.setState({ comand , showComandaPedido: !!comand})
    if (comand){
      this.socket.emit('pesquisa_comanda',{comanda:comand})
    }
  };


  changePedido = (pedido) => {
    this.setState({ pedido, showPedido: !!pedido });
    if (pedido) {
      this.socket.emit('pesquisa', pedido);
    }
  };

  changeFcomanda = (fcomanda) => {
    this.setState({ fcomanda , showComanda: !!fcomanda})
    if (fcomanda){
      this.socket.emit('pesquisa_abrir_comanda',{comanda:fcomanda})
    }
  };
  
  ;
  changeCategoria = (categoria) => this.setState({ categoria });
  getCurrentTime = () => new Date().toTimeString().slice(0, 5);

  sendData = () => {
    const { comand, pedidosSelecionados, quantidadeSelecionada, extraSelecionados, pedido, quantidade, extra, username } = this.state;
    const currentTime = this.getCurrentTime();
    if (comand && pedidosSelecionados.length && quantidadeSelecionada.length) {
      this.socket.emit('insert_order', { 
        comanda: comand, 
        pedidosSelecionados, 
        quantidadeSelecionada,
        extraSelecionados,
        horario: currentTime,
        username:username,
      });
      this.setState({ comand: '', pedido: '', pedidosSelecionados: [], quantidadeSelecionada: [], extraSelecionados: [], quantidade: 1, showQuantidade: false, showPedidoSelecionado: false, showExtra: false });
    } else if (comand && pedido && quantidade) {
      console.log('fetch')
      fetch('http://192.168.15.68:5000/verificar_quantidade', {  // Endpoint correto
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            item: pedido,
            quantidade: quantidade
        })
    })
    .then(response => response.json())
    .then(data => {
      console.log(data)
      if (data.erro) {
        this.setState({
          comand: '',
          pedido: '',
          extra: '',
          quantidade: 1,
          showQuantidade: false,
          showPedidoSelecionado: false,
          showExtra: false,
          quantidadeEstoqueMensagem: data.quantidade,
        });
      } else {
        const { comand, pedido, quantidade, extra,username} = this.state;
        const currentTime = this.getCurrentTime();
        this.socket.emit('insert_order', { 
          comanda: comand, 
          pedidosSelecionados: [pedido], 
          quantidadeSelecionada: [quantidade],
          extraSelecionados: [extra],
          horario: currentTime,
          username:username,
        });
        this.setState({ comand: '', pedido: '', quantidade: 1, extra: '' });
      }
    })
    .catch(error => console.error('Erro ao adicionar pedido:', error));
    }
    else {
      console.warn('Por favor, preencha todos os campos.');
    }
  };

  getCardapio = () => {
    const { fcomanda } = this.state;
    if (fcomanda) {
      this.socket.emit('get_cardapio', { fcomanda });
      this.socket.once('preco', (data) => {
        console.log(data)
        this.props.navigation.navigate('ComandaScreen', { data: data.dados, fcomanda: this.state.fcomanda, preco: data.preco_a_pagar,preco_total:data.preco_total,preco_pago:data.preco_pago });
      });
    } else {
      console.warn('Por favor, insira a comanda.');
    }
  };

  pagarParcial = () => {
    const { valor_pago, fcomanda, preco } = this.state;
    const valorNum = parseFloat(valor_pago);
    if (!isNaN(valorNum) && valorNum > 0 && valorNum <= preco) {
      this.socket.emit('pagar_parcial', { valor_pago: valorNum, fcomanda });
      this.setState((prevState) => ({ preco: prevState.preco - valorNum, valor_pago: '' }));
    } else {
      console.warn('Insira um valor válido para pagamento parcial.');
    }
  };

  selecionarPedido = (pedido) => {
    this.setState({ pedido, pedido_filtrado: [], showQuantidade: true });
    this.socket.emit('categoria', pedido);
  };
  selecionarComandaPedido =(comand) =>{
    this.setState({ comand, comanda_filtrada: [], showComandaPedido:false})
  }
  
  selecionarComanda =(fcomanda) =>{
    this.setState({ fcomanda, comanda_filtrada_abrir: [], showComanda:false})
  }

  aumentar_quantidade = () => this.setState((prevState) => ({ quantidade: prevState.quantidade + 1 }));
  diminuir_quantidade = () => this.setState((prevState) => ({ quantidade: Math.max(prevState.quantidade - 1, 1) }));
  mudar_quantidade = (quantidade) => this.setState({ quantidade: parseInt(quantidade) || 1 });
  
  adicionarPedido = () => {
    const {pedido, quantidade} = this.state;
    fetch('http://192.168.15.68:5000/verificar_quantidade', {  // Endpoint correto
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            item: pedido,
            quantidade: quantidade
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.erro) {
            this.setState({
                quantidade: 1,
                showQuantidade: false,
                pedido: '',
                extra: '',
                showPedido: false,
                showExtra: false,
                quantidadeEstoqueMensagem: data.quantidade || 'Estoque insuficiente',
            });
        } else {
            const { pedido, quantidade, extra } = this.state;
            this.setState((prevState) => ({
                pedidosSelecionados: [...prevState.pedidosSelecionados, pedido],
                quantidadeSelecionada: [...prevState.quantidadeSelecionada, quantidade],
                extraSelecionados: extra ? [...prevState.extraSelecionados, extra] : [...prevState.extraSelecionados, ''],
                quantidade: 1,
                showQuantidade: false,
                pedido: '',
                extra: '',
                showPedidoSelecionado: true,
                showPedido: false,
                showExtra: false,
            }));
        }
    })
    .catch(error => console.error('Erro ao adicionar pedido:', error));
};


  adicionarPedidoSelecionado = (index) => this.setState((prevState) => ({ quantidadeSelecionada: prevState.quantidadeSelecionada.map((q, i) => (i === index ? q + 1 : q)) }));
  changeExtra = (extra) => this.setState({ extra });

  render() {
    const {quantidadeEstoqueMensagem,quantidadeRestanteMensagem,pedidoRestanteMensagem} = this.state
    return (
      <View style={styles.mainContainer} >
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          <View style={styles.container}>
            {quantidadeRestanteMensagem && (
              alert(`Só tem ${quantidadeRestanteMensagem} ${pedidoRestanteMensagem}`),
              this.setState({quantidadeRestanteMensagem:null,pedidoRestanteMensagem:null})
            )}
            <View style={[styles.container,styles.row]}>
              {/* Campo de Comanda (reduzido e à esquerda) */}
              <TextInput
                placeholder="Comanda"
                onChangeText={this.changeComanda}
                value={this.state.comand}
                style={[styles.input, styles.inputComanda]} // Estilo específico para o campo Comanda
              />
              {/* Campo de Pedido (à direita) */}
              <TextInput
                placeholder="Digite o pedido"
                onChangeText={this.changePedido}
                value={this.state.pedido}
                style={[styles.input, styles.inputPedido]}
              />

                {this.state.showQuantidade && (
                <View style={styles.row}>
                <Button title="-" onPress={this.diminuir_quantidade} />
                <TextInput style={[styles.input,styles.inputQuantidade]}  value={String(this.state.quantidade)} onChangeText={this.mudar_quantidade} />
                <Button title="+" style={[styles.botoes,{marginRight:0}]} onPress={this.aumentar_quantidade} />
                </View>
              )}
              </View>
              <View style={styles.container}>
              {this.state.showExtra && (
                <TextInput
                placeholder="Extra"
                onChangeText={this.changeExtra}
                value={this.state.extra}
                style={[styles.input, styles.inputPedido]}
                />
              )}
        
            </View>
            {quantidadeEstoqueMensagem && (
              alert(`Quantidade Insuficiente : apenas ${quantidadeEstoqueMensagem} no Estoque`),
              this.setState({quantidadeEstoqueMensagem:null})
            )}

            {this.state.showComandaPedido && (
                this.state.comanda_filtrada.map((item,index)=>(
                    <TouchableOpacity key={index} style={[styles.container,{alignItems:'left',padding:8}]} onPress={() => this.selecionarComandaPedido(item)}>
                      <Text style={{fontSize:20}}>{item}</Text>
            
                    </TouchableOpacity>
                  ))
            )}
        
            {this.state.showPedido && (
                this.state.pedido_filtrado.map((item,index)=>(
                    <TouchableOpacity key={index} style={[styles.container,{alignItems:'center',padding:8}]} onPress={() => this.selecionarPedido(item)}>
                      <Text style={{fontSize:20}}>{item}</Text>
            
                    </TouchableOpacity>
                  ))
            )}
            <View style={{flexDirection:'row',alignItems:'center',justifyContent:'center'}}>
            <Button  title="Adicionar" onPress={this.adicionarPedido} />
            {((!this.state.showPedido && this.state.showPedidoSelecionado)||(!this.state.showPedidoSelecionado && this.state.showPedido)) &&(
            <Button title="Enviar pedido" onPress={this.sendData} />
            )}
            </View>
  
            {this.state.showPedidoSelecionado && (
              <View>
                <FlatList
                  data={this.state.pedidosSelecionados}
                  renderItem={({ item, index }) => (
                    <View style={[styles.container,{flexDirection:'row'}]}>
                      <Text>{item}</Text>
                      <View style={[styles.container,{flexDirection:'row'}]}>
                        <Button title="-" color="red" onPress={() => this.removerPedidoSelecionado(index)} />
                        <Text>{this.state.quantidadeSelecionada[index]}</Text>
                        <Button title="+" onPress={() => this.adicionarPedidoSelecionado(index)} />
                      </View>
                    </View>
                  )}
                />
              </View>
            )}
  
            <TextInput
              placeholder="Qual comanda?"
              onChangeText={this.changeFcomanda}
              value={this.state.fcomanda}
              style={[styles.input, { marginTop: 20 }]}
            />
            <View>
            {this.state.showComanda && (
                this.state.comanda_filtrada_abrir.map((item,index)=>(
                    <TouchableOpacity key={index} style={[styles.container,{alignItems:'left',padding:8}]} onPress={() => this.selecionarComanda(item)}>
                      <Text style={{fontSize:20}}>{item}</Text>
            
                    </TouchableOpacity>
                  ))
            )}
            </View>
            <Button title="Abrir Comanda" onPress={this.getCardapio} />
          </View>
        </ScrollView>
      </View>
    ); } }


const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  formContainer: {
    marginBottom: 20,
  },
  row:{
    flexDirection:'row'
  },
  input: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    paddingHorizontal: 10,
    borderRadius: 5,
    marginBottom: 10,
  },
  inputComanda: {
    flex: 1,
    marginBottom: 15,
  },
  inputPedido: {
    flex: 2,
    marginBottom: 15,
  },
  inputExtra: {
    flex: 1,
    marginBottom: 15,
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  quantityText: {
    marginHorizontal: 10,
    fontSize: 18,
  },
  addButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
    alignItems: 'center',
    marginBottom: 20,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  stockText: {
    marginBottom: 15,
    color: 'red',
  },
  warningText: {
    color: 'orange',
    marginBottom: 10,
    fontWeight: 'bold',
  },
  listaPedidos: {
    marginTop: 15,
    marginBottom: 20,
  },
  pedidoContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: 'lightgray',
    borderRadius: 5,
  },
  pedidoText: {
    flex: 1,
    fontSize: 16,
  },
  pedidoItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'lightgray',
  },
});
