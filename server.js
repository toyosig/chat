require("dotenv").config();
const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: "*" } });

// Middleware
app.use(cors());
app.use(express.json());

// Load environment variables
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/groupchat";

// Connect to MongoDB
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// Message Schema & Model
const messageSchema = new mongoose.Schema({
  username: String,
  room: String,
  message: String,
  timestamp: { type: Date, default: Date.now },
});

const Message = mongoose.model("Message", messageSchema);

// Track rooms and users
let rooms = { "interactive-session": [], "Room 2": [] }; // Updated Room 1 → interactive-session

// WebSocket Connection
io.on("connection", (socket) => {
  console.log("🟢 New WebSocket connection:", socket.id);

  // Join a chat room
  socket.on("joinRoom", async ({ username, room }) => {
    if (!username || !room) return;

    socket.join(room);
    rooms[room].push({ id: socket.id, username });

    // Send welcome message
    socket.emit("message", { username: "Chat Bot", message: `Welcome to ${room}!` });

    // Notify others in the room
    socket.broadcast.to(room).emit("message", { username: "Chat Bot", message: `${username} has joined the chat` });

    // Send chat history
    const chatHistory = await Message.find({ room }).sort({ timestamp: 1 });
    socket.emit("chatHistory", chatHistory);

    // Update users list
    io.to(room).emit("roomUsers", { users: rooms[room].map((user) => user.username) });
  });

  // Handle chat messages
  socket.on("chatMessage", async ({ room, username, message }) => {
    if (!room || !message) return;

    const newMessage = new Message({ username, room, message });
    await newMessage.save();

    io.to(room).emit("message", { username, message });
  });

  // Handle user leaving room
  socket.on("leaveRoom", ({ username, room }) => {
    if (!username || !room) return;

    rooms[room] = rooms[room].filter((user) => user.username !== username);
    socket.leave(room);

    // Notify others in the room
    io.to(room).emit("message", { username: "Chat Bot", message: `${username} has left the chat` });

    // Update users list
    io.to(room).emit("roomUsers", { users: rooms[room].map((user) => user.username) });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    for (let room in rooms) {
      let user = rooms[room].find((user) => user.id === socket.id);
      if (user) {
        rooms[room] = rooms[room].filter((u) => u.id !== socket.id);
        io.to(room).emit("message", { username: "Chat Bot", message: `${user.username} has left the chat` });
        io.to(room).emit("roomUsers", { users: rooms[room].map((user) => user.username) });
      }
    }
  });
});

// Start server
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
