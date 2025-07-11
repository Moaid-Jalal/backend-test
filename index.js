const express = require('express');
const cors = require('cors');
const path = require('path');

const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const app = express();

// Middleware
// const allowedOrigins = ['https://www.kytgbm.com', 'https://nsaioabuy-v-aushb-phi.vercel.app'];
const allowedOrigins = ['https://www.kytgbm.com', 'https://admin-website-test.vercel.app/'];

app.use(helmet());

// ✅ Compression middleware (to improve performance)
app.use(compression());

// ✅ Rate limiting (basic protection from abuse)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);


app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));


app.disable('x-powered-by');

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use('/api/projects', require('./routes/projects'));
app.use('/api/aboutus', require('./routes/aboutUs'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/languages', require('./routes/languages'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!', error: err.message });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

