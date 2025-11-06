import io from 'socket.io-client';
import { API_URL } from './screens/url';
let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(`${API_URL}`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 20000, // 20 segundos
    });
  }
  return socket;
}
