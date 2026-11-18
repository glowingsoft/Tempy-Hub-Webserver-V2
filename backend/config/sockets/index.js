const { attachRedisAdapter } = require("./socketRedisAdapter");
const { orderSocketHandler } = require("./orders/orderSocketHandler");
const { kioskSocketHandler } = require("./kiosk/kioskSocketHandler");
const { authSocketHandler } = require("./auth/authSocketHandler");
const chatSocketHandler = require("../../commonModules/chatModule/sockets/chatSocketHandler");

function initializeSockets(io) {
  attachRedisAdapter(io);

  kioskSocketHandler(io.of("/kiosk"));
  chatSocketHandler(io.of("/chat"));
  authSocketHandler(io.of("/auth"));

  // orderSocketHandler(io.of("/staff/orders"), "staff");
  // orderSocketHandler(io.of("/admin/orders"), "admin");
  // orderSocketHandler(io.of("/organizer/orders"), "organizer");
  // orderSocketHandler(io.of("/user/orders"), "user");

  console.log("🚀 Order sockets initialized");
  console.log("🚀 Kiosk sockets initialized on /kiosk");
  console.log("🚀 Chat sockets initialized on /chat");
  console.log("🚀 Auth sockets initialized on /auth");
}


module.exports = { initializeSockets };
