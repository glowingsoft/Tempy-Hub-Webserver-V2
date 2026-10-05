const { attachRedisAdapter } = require("./socketRedisAdapter");
const { orderSocketHandler } = require("./orders/orderSocketHandler");
const { kioskSocketHandler } = require("./kiosk/kioskSocketHandler");

function initializeSockets(io) {
  attachRedisAdapter(io);

  kioskSocketHandler(io.of("/kiosk"));

  // orderSocketHandler(io.of("/staff/orders"), "staff");
  // orderSocketHandler(io.of("/admin/orders"), "admin");
  // orderSocketHandler(io.of("/organizer/orders"), "organizer");
  // orderSocketHandler(io.of("/user/orders"), "user");

  console.log("🚀 Order sockets initialized");
  console.log("🚀 Kiosk sockets initialized on /kiosk");
}


module.exports = { initializeSockets };
