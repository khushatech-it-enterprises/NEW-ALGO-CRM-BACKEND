const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const process = require("process");
const ticketModel = require('./models/ticket.model');
const { default: mongoose } = require('mongoose');
const cronjob = require("./Crone-Job/MonthlyMarginCron");
const databaseBackupCron = require("./Crone-Job/DatabaseBackupCron");

dotenv.config();
connectDB();

const app = express();

// -----------------------
// In your index.js, update CORS to:
const allowedOrigins = [
  'https://crm.algotrack.in',
  'http://crm.algotrack.in',
  'http://localhost:5173'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like server-to-server)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // Allow all domains
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});


// app.use(express.json());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Request logging middleware (for debugging)
app.use('/api/auth', (req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Request body:', JSON.stringify({ ...req.body, password: req.body.password ? '***' : undefined }));
  }
  next();
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/device', require('./routes/device.route'));
app.use('/api/task', require('./routes/task.route'));
app.use('/api/qstClient', require('./routes/qstClient.route'));
app.use('/api/employee', require('./routes/employee.route'));
app.use('/api/ticketCloser', require('./routes/ticketCloser.route'));
app.use('/api/technician', require('./routes/technician.route'));
app.use('/api/issueFound', require('./routes/issueFound.route'));
app.use('/api/resolution', require('./routes/resolution.route'));
app.use('/api/project', require('./routes/project.route'));
app.use('/api/ticket', require('./routes/ticket.route'));
app.use('/api/dashboard', require('./routes/maindashboard.routes'))
app.use('/api/ticketStatus', require('./routes/ticketStatus.route'));
app.use('/api/customerCharge', require('./routes/CustomerChargeRate.route'));
app.use('/api/bankStatement', require('./routes/BankSatemant.routes'));
app.use('/api/state', require('./routes/state.route'));

app.use('/api/accessoryMaster', require('./routes/accessoryMaster.route'));  // Accessory Master Route
app.use('/api/deviceMaster', require('./routes/deviceMaster.route'));  // Device Master Route
app.use('/api/simMaster', require('./routes/simMaster.route'));  // Sim Master Route
app.use('/api/zone', require('./routes/zone.route'));  // Zone Route
app.use('/api/server', require('./routes/server.route'));  // Server Route
app.use('/api/assetType', require('./routes/assetType.route'));  // Asset Type Route
app.use('/api/swaps', require('./routes/defectiveItemSwap.route'));  // Spare Device Swap Route
app.use('/api/backup', require('./routes/backup.route')); // Database Backup Route
app.use('/api/cse-group', require('./routes/cseGroup.route')); // CSE Group Master Route


app.use('/api', require('./utils/S3Utils'))  // this is used for presigned URL


app.get('/health', (req, res) => res.send('API health is OK'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


cronjob;
databaseBackupCron;
