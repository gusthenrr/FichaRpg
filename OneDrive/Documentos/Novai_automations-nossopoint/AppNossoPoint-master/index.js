import 'react-native-reanimated';
import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import App from './App';
import { enableScreens } from 'react-native-screens';

enableScreens();
registerRootComponent(App);
