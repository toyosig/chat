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
  socketId: String, // Store socket ID instead of username
  room: String,
  message: String,
  timestamp: { type: Date, default: Date.now },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null }, // Reply reference
});

const Message = mongoose.model("Message", messageSchema);

// Track rooms and users
let rooms = { "interactive-session": [], "Room 2": [] };

// WebSocket Connection
io.on("connection", (socket) => {
  console.log("🟢 New WebSocket connection:", socket.id);

  // Join a chat room
  socket.on("joinRoom", async ({ room }) => {
    if (!room) return;
    
    socket.join(room);
    rooms[room] = rooms[room] || []; // Create room if it doesn't exist
    rooms[room].push({ id: socket.id });
    
    // Send welcome message
    socket.emit("message", { 
      socketId: "system", 
      message: `Welcome to ${room}!` 
    });
    
    // Notify others in the room
    socket.broadcast.to(room).emit("message", { 
      socketId: "system", 
      message: `A new user has joined the chat` 
    });
    
    // Send chat history with replies populated
    const chatHistory = await Message.find({ room })
      .sort({ timestamp: 1 })
      .populate("replyTo", "socketId message");
    socket.emit("chatHistory", chatHistory);
    
    // Update users count
    io.to(room).emit("roomUsers", { 
      count: rooms[room].length 
    });
  });

  // Handle chat messages (including replies)
  socket.on("chatMessage", async ({ room, message, replyTo }) => {
    if (!room || !message) return;
    
    const newMessage = new Message({
      socketId: socket.id,
      room,
      message,
      replyTo, // Store reply message ID
    });
    
    await newMessage.save();
    
    // Fetch the saved message with reply details
    const savedMessage = await Message.findById(newMessage._id)
      .populate("replyTo", "socketId message");
    
    io.to(room).emit("message", savedMessage);
  });

  // Handle clear chat request
  socket.on("clearChat", async (room) => {
    if (!room) return;
    
    // Delete all messages for this room
    await Message.deleteMany({ room });
    
    // Notify all users in the room that chat has been cleared
    io.to(room).emit("chatCleared");
    io.to(room).emit("message", { 
      socketId: "system", 
      message: "Chat history has been cleared" 
    });
  });

  // Handle user leaving room
  socket.on("leaveRoom", ({ room }) => {
    if (!room) return;
    
    rooms[room] = rooms[room].filter((user) => user.id !== socket.id);
    socket.leave(room);
    
    // Notify others in the room
    io.to(room).emit("message", { 
      socketId: "system", 
      message: `A user has left the chat` 
    });
    
    // Update users count
    io.to(room).emit("roomUsers", { 
      count: rooms[room].length 
    });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    for (let room in rooms) {
      const userIndex = rooms[room].findIndex((user) => user.id === socket.id);
      if (userIndex !== -1) {
        rooms[room].splice(userIndex, 1);
        io.to(room).emit("message", { 
          socketId: "system", 
          message: `A user has left the chat` 
        });
        io.to(room).emit("roomUsers", { 
          count: rooms[room].length 
        });
      }
    }
  });
});

// Start server
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));