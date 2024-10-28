import React from "react";
import { View, Text, Button } from "react-native";
import { UserContext } from "../UserContext";

export default class Analytics extends React.Component {
  static contextType = UserContext;

  constructor(props) {
    super(props);
    this.state = {
      faturamento: null,
      dia: null,
      username: "",
      cargo: "",
      showAnalytics: false,
    };
  }

  componentDidMount() {
    const { user } = this.context;

    // Atualiza o estado com as informações do usuário
    this.setState({ username: user.username, cargo: user.cargo });

    // Verifica se o cargo do usuário é 'ADM' antes de buscar os dados
    if (user.cargo === "ADM") {
      this.setState({ showAnalytics: true });

      // Faz a requisição ao backend para obter o faturamento
      fetch("http://127.0.0.1:5000/faturamento", {
        method: "GET",
      })
        .then((resp) => resp.json())
        .then((data) => {
          // Verifica se a resposta tem dados válidos
          if (data && data.faturamento !== null) {
            this.setState({ faturamento: data.faturamento, dia: data.dia });
          }
        })
        .catch((error) => {
          console.error("Erro ao buscar faturamento:", error);
        });
    }
  }

  render() {
    const { showAnalytics, faturamento, dia } = this.state;

    return (
      <View>
        {showAnalytics ? (
            <Text>
              Faturamento do dia {dia}: {faturamento}
            </Text>
          ):(
          <Text>Você não tem permissão para acessar essa tela</Text>
        )}
      </View>
    );
  }
}
