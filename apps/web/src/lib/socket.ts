import { io, Socket } from 'socket.io-client';
import { getApiOrigin } from './api';

let socket: Socket | null = null;

export function connectSocket() {
  if (socket?.connected) return socket;
  // Socket.IO connects to domain root — nginx routes /socket.io/ directly to API
  socket = io(`${getApiOrigin()}/logs`, {
    withCredentials: true,
    transports: ['websocket'],
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
