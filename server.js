// server.js — Complete Fixed

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./src/config/database");
const authRoutes = require("./src/routes/authRoutes");
const templateRoutes = require("./src/routes/templateRoutes");
const reminderRoutes = require("./src/routes/reminderRoutes");
const notificationRoutes = require("./src/routes/notificationRoutes");
const settingsRoutes = require("./src/routes/settingsRoutes");
const doctorRoutes = require("./src/routes/doctorRoutes");
const bookingRoutes = require("./src/routes/bookingRoutes");
const appointmentRoutes = require("./src/routes/appointmentRoutes");
const patientRoutes = require("./src/routes/patientRoutes");
const reminderLogRoutes = require("./src/routes/reminderLogRoutes");
const trackingRoutes = require("./src/routes/trackingRoutes");
const integrationRoutes = require("./src/routes/integrationRoutes");

const dns = require('dns');

// ✅ Use Google DNS
dns.setServers(['8.8.8.8', '1.1.1.1']);

dotenv.config();

// ============ LOAD SERVICES ============

// ✅ Agenda (Reminder System)
require('./src/services/agendaService');

// ✅ No-Response Handler
require('./src/scheduler/noResponseHandler');

// ✅ Report Scheduler
require("./src/scheduler/reportScheduler");

// ❌ DISABLED - Old systems (commented out)
// require('./src/scheduler/reminderScheduler');
// require('./src/scheduler/cronScheduler');
// require('./src/queues/backupQueue');

// ============ CONNECT DATABASE ============
connectDB();

// ============ EXPRESS APP ============
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ ROUTES ============
app.use("/api/auth", authRoutes);
app.use("/api", templateRoutes);
app.use("/api", reminderRoutes);
app.use("/api", notificationRoutes);
app.use("/api", settingsRoutes);
app.use("/api", doctorRoutes);
app.use("/api/booking", bookingRoutes);
app.use("/api", appointmentRoutes);
app.use("/api", patientRoutes);
app.use("/api", reminderLogRoutes);
app.use("/api/tracking", trackingRoutes);
app.use("/api", integrationRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/tracking", trackingRoutes);
app.use("/api/dashboard", require("./src/routes/dashboardRoutes"));

// ============ HEALTH CHECK ============
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

// ============ ERROR HANDLING ============
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
  });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
});