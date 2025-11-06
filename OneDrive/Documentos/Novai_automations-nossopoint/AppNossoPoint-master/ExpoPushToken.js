import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, Alert } from 'react-native';
import { useToken } from './TokenContext'; // <-- use o hook do contexto



Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,        // Mostra alerta (notificação visual)
    shouldPlaySound: true,        // Toca som
    shouldSetBadge: false,        // Não altera ícone do app
  }),
});

export default function ExpoPushToken() {
  const { setExpoPushToken } = useToken();

  useEffect(() => {
    async function getToken() {
      if (!Device.isDevice) return;

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        Alert.alert('Permissão negada');
        return;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync();
      setExpoPushToken(tokenData.data); // <-- Salva no contexto
      

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
        });
      }
    }

    getToken();
  }, []);

  return null;
}
