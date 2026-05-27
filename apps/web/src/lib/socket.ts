import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket() {
  if (socket?.connected) return socket;
  socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000', {
    withCredentials: true,
    transports: ['websocket'],
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
