import 'react-native-reanimated';
import React, { useContext, useEffect } from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import HomeScreen from './screens/HomeScreen.js';
import BarmanScreen from './screens/BarmanScreen.js';
import Cozinha from './screens/CozinhaScreen.js';
import ComandaScreen from './screens/ComandaScreen.js';
import EstoqueScreen from './screens/EstoqueScreen.js';
import EstoqueGeral from './screens/EstoqueGeral.js';
import Login from './screens/LoginScreen.js';
import ChoseUser from './screens/ChoseUser.js';
import { UserContext, UserProvider } from './UserContext.js';
import PedidosScreen from './screens/PedidosScreen.js';
import Analytics from './screens/AnalyticsScreen.js';
import CoWorksScreen from './screens/coWorksScreen.js';
import Cadastro from './screens/CadastrarScreen.js';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import verComandas from './screens/Comandas.js';
import Icon from 'react-native-vector-icons/FontAwesome';
import ScreenCardapio from './screens/Cardapio.js';
import LogOut from './screens/LogOutScreen.js';
import { TokenProvider } from './TokenContext';
import ExpoPushToken from './ExpoPushToken.js';
import PricesManagement from './screens/promotionScreen.js';
import { askBtPermissions } from './permissions.js';
import { PrinterService } from './PrinterService.js';
import OpcoesScreen from './screens/opcoesScreen.js';
import HomeScreenCozinha from './screens/HomeScreenCozinha.js';
import printerCozinhaScreen from './screens/printerCozinhaScreen.js'

const Drawer = createDrawerNavigator();
const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Stack Navigator para as telas relacionadas à Home (Comandas dentro de uma Stack)
function Comanda() {
  return (
    <Stack.Navigator initialRouteName="Comandas" options={{ headerShown: false }}>
      <Stack.Screen name="Comandas" component={verComandas} />
      <Stack.Screen name="Comanda" component={ComandaScreen} />
    </Stack.Navigator>
  );
}

// Tab Navigator com as 4 abas: Início, Comanda, Barman, Pedidos
function HomeStack() {
  return (
    <Tab.Navigator initialRouteName="home">
      <Tab.Screen
        name="home"
        component={HomeScreen}
        options={{
          title: 'Inicio',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Icon name="home" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="comanda"
        component={Comanda}
        options={{
          title: 'Comanda',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Icon name="list-alt" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="pedidos"
        component={PedidosScreen}
        options={{
          title: 'Pedidos',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Icon name="list" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="barman"
        component={BarmanScreen}
        options={{
          title: 'Barman',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Icon name="beer" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Cozinha"
        component={Cozinha}
        options={{
          title: 'Cozinha',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Icon name="cutlery" color={color} size={size} />,
        }}
      />
      
    </Tab.Navigator>
  );
}

function CozinhaStack() {
  return (
    <Tab.Navigator initialRouteName="Cozinha">
      <Tab.Screen
        name="Cozinha"
        component={Cozinha}
        options={{
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Icon name="cutlery" color={color} size={size} />,
        }}
      />
      <Tab.Screen
      name='Anotar'
      component={HomeScreenCozinha}
      options={{
        headerShown: false,
        tabBarIcon: ({ color, size }) => <Icon name="pencil" color={color} size={size} />,
      }}
    />
    <Tab.Screen
        name="pedidos"
        component={PedidosScreen}
        options={{
          title: 'Pedidos',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Icon name="list" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Impressora"
        component={printerCozinhaScreen}
        options={{
          title: 'Impressora',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Icon name="print" color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}
      

function AnalytcsStack() {
  return (
    <Tab.Navigator initialRouteName="Analytics">
      <Tab.Screen
        name="Analytics"
        component={Analytics}
        options={{
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Icon name="line-chart" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="CoWorksScreen"
        component={CoWorksScreen}
        options={{
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Icon name="users" color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}

// Navegação condicional (logado vs não logado) + Drawer
function AuthNavigator() {
  const { user } = useContext(UserContext);
  const { isLoggedIn } = useContext(UserContext);
  if (!user) return null;

  return (
    <NavigationContainer>
      {user.username ? (
        user.cargo === 'ADM' ? (
          <Drawer.Navigator initialRouteName="Inicio">
            <Drawer.Screen name="Inicio" component={HomeStack} />
            {/* Barman e Pedidos comanda e cozinha agora estão no Tab do HomeStack — removidos do Drawer */}          
            <Drawer.Screen name="Cardapio" component={ScreenCardapio} />
            <Drawer.Screen name="Promocoes" component={PricesManagement} />
            <Drawer.Screen name="Estoque Carrinho" component={EstoqueScreen} />
            <Drawer.Screen name="Estoque Geral" component={EstoqueGeral} />
            <Drawer.Screen name="Opções" component={OpcoesScreen} />
            <Drawer.Screen name="AnalyticsStack" component={AnalytcsStack} />
            <Drawer.Screen name="Users" component={ChoseUser} />
            <Drawer.Screen name="Cadastrar" component={Cadastro} />
            <Drawer.Screen name="LogOut" component={LogOut} />
          </Drawer.Navigator>
        ) : user.cargo !=='Cozinha'?(
          <Drawer.Navigator initialRouteName="Home">
            <Drawer.Screen name="Home" component={HomeStack} />
            {/* Barman e Pedidos comanda e cozinha agora estão no Tab do HomeStack — removidos do Drawer */}          
            <Drawer.Screen name="Estoque" component={EstoqueScreen} />
            <Drawer.Screen name="LogOut" component={LogOut} />
          </Drawer.Navigator>
        ):(
          <Drawer.Navigator initialRouteName="Cozinha">
            <Drawer.Screen name="Cozinha" component={CozinhaStack} />
            <Drawer.Screen name="LogOut" component={LogOut} />
          </Drawer.Navigator>
        )
      ) : (
        <Stack.Navigator initialRouteName="Login">
          <Stack.Screen name="Login" component={Login} options={{ headerShown: !isLoggedIn }} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function App() {
  return (
    <UserProvider>
      <TokenProvider>
        <SafeAreaProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <ExpoPushToken />
            <AuthNavigator />
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </TokenProvider>
    </UserProvider>
  );
}

function PrinterInitGate() {
  const { user } = useContext(UserContext);

  useEffect(() => {
    const run = async () => {
      try {
        if (user?.username?.toLowerCase() === 'gustavobiondi') {
          await askBtPermissions();
          await PrinterService.selectBluetoothPrinter();
        }
      } catch (e) {
        console.log('Falha ao iniciar impressora:', e);
      }
    };
    run();
  }, [user?.username]);

  return null;
}
