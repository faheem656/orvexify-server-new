// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./src/config/database.js";
import dns from "dns";
import authRoutes from "./src/routes/authRoutes.js";


dns.setServers(["8.8.8.8", "1.1.1.1"]);

dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

console.log("✅ Report scheduler loaded");

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
});