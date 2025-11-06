import React from 'react';
import { View, StyleSheet } from 'react-native';
import NotificacaoInfo from '../notificacaoInfo'; // ajuste o caminho se necessário

export default function TokenScreen() {
  return (
    <View style={styles.container}>
      <NotificacaoInfo />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
});