import { createServer } from "http";
import { Server } from "socket.io";
import app from "./app";
import { setIO } from "./libs/socket";
import {
  triggerSyncAllSaleInvoices,
  triggerSyncAllShifts,
} from "./v1/cloud/cloud.sync.service";
import { startPickupOrderSyncWorker } from "./v1/pickup-order/pickup-order.worker";
import dotenv from "dotenv";

dotenv.config();

const port = process.env.PORT || 3000;

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

setIO(io);

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

httpServer.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);

  // Catch up on any invoices/shifts that never made it to cloud (failed push
  // while server was down, network hiccup, etc).
  triggerSyncAllSaleInvoices();
  triggerSyncAllShifts();
  startPickupOrderSyncWorker();
});
