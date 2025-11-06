import React, { useContext } from 'react';
import { View, Text, Button, StyleSheet, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserContext } from '../UserContext';

export default function LogOut() {
  const { user, setUser } = useContext(UserContext);

  const handleLogOut = async () => {
    await AsyncStorage.removeItem('usersenha');
    await AsyncStorage.removeItem('senhaExpiration');
    setUser({ username: '', cargo: '', carrinho: '', token: '' }); // limpa o contexto do usuário
  };

  return (
    <View style={styles.container}>
      <View style={styles.avatarContainer}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user.username ? user.username[0].toUpperCase() : '?'}
          </Text>
        </View>
      </View>

      <Text style={styles.title}>{user.username}</Text>

      <Button title="Sair" color="#d9534f" onPress={handleLogOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f4f6f8',
    padding: 20,
  },
  avatarContainer: {
    marginBottom: 20,
  },
  avatar: {
    backgroundColor: '#007bff',
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 32,
    color: '#fff',
    fontWeight: 'bold',
  },
  title: {
    fontSize: 22,
    marginBottom: 30,
    fontWeight: 'bold',
    color: '#333',
  },
});
