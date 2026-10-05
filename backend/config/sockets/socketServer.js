// config/sockets/socketServer.js
const http = require("http");
const { Server } = require("socket.io");
const { isDev } = require("@config/origins");
const { initializeSockets } = require("./index");

function createSocketServer(app, allowedOrigins) {
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      // Match HTTP CORS: allow any origin in dev (LAN + Cloudflare tunnel clients)
      origin: isDev ? true : allowedOrigins,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
    },
  });

  // expose ONCE, globally
  global.io = io;

  initializeSockets(io);

  return server;
}

module.exports = { createSocketServer };
