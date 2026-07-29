// Tracks connected WebSocket clients and broadcasts JSON events to all of them.

const clients = new Set();

export function addClient(socket) {
  clients.add(socket);
  socket.send(JSON.stringify({ type: 'hello' }));
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

export function broadcast(event) {
  const json = JSON.stringify(event);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) socket.send(json);
  }
}

export function registerWsRoute(app) {
  app.get('/ws', { websocket: true }, (socket) => addClient(socket));
}

export function closeAllClients() {
  for (const socket of clients) socket.close();
  clients.clear();
}
