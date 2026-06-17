import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket() {
  if (socket?.connected) return socket;
  // Socket.IO connects to domain root — nginx routes /socket.io/ directly to API
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  const origin = apiUrl.replace(/\/api\/?$/, '') || apiUrl;
  socket = io(`${origin}/logs`, {
    withCredentials: true,
    transports: ['websocket'],
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
