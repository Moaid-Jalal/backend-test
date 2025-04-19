const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database');

router.post('/',
  [
    body('name').notEmpty().trim().escape(),
    body('email').isEmail().normalizeEmail(),
    body('phone').notEmpty().trim().escape(),
    body('message').notEmpty().trim().escape(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { name, email, phone, message } = req.body;

      await db.query(
        'INSERT INTO contact_messages (name, email, phone, message, created_at) VALUES (?, ?, ?, ?, NOW())',
        [name, email, phone, message]
      );

      res.status(201).json({ message: 'Message sent successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Error sending message', error: error.message });
    }
  }
);

module.exports = router;