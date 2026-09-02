import { createServer } from "http";
import { Server } from "socket.io";
import app from "./app";
import { setIO } from "./libs/socket";
import {
  triggerSyncAllSaleInvoices,
  triggerSyncAllShifts,
} from "./v1/cloud/cloud.sync.service";
import { triggerSyncPendingOrderCollects } from "./v1/order/order.collect.service";
import { triggerSyncMemberAnonymizeEvents } from "./v1/cloud/cloud.member-anonymize.service";
import {
  emitLastOrderPendingPayloadToSocket,
  startOrderPendingBroadcaster,
} from "./v1/order/order.pending-broadcaster";
import dotenv from "dotenv";

dotenv.config();

const port = process.env.PORT || 3000;

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

setIO(io);

// 주문 수신함 pending-count 폴링/브로드캐스트 — 무조건 시작 (env 게이트 없음).
startOrderPendingBroadcaster();

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  // 신규 소켓엔 마지막 pending-count 페이로드를 즉시 1회 전송.
  emitLastOrderPendingPayloadToSocket(socket);
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
  // S3 — 미확인 주문 collect 재시도 (order.collect.service.ts).
  triggerSyncPendingOrderCollects();
  // D3 — 멤버 익명화 이벤트 따라잡기 (매장이 migrate 를 자주 안 돌려도
  // 재기동마다 pull — cloud.member-anonymize.service.ts).
  triggerSyncMemberAnonymizeEvents();
});
