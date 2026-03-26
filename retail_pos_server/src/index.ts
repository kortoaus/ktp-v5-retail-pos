import { createServer } from "http";
import { Server } from "socket.io";
import app from "./app";
import { setIO } from "./libs/socket";
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
});
