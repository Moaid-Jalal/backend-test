const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database'); // تأكد من تكوين الاتصال بقاعدة البيانات
const auth = require('../middleware/auth');
const cookieParser = require('cookie-parser');


router.use(cookieParser());


router.post(
    '/send',
    [
        body('name').notEmpty().trim().escape(),
        body('email').isEmail().normalizeEmail(),
        body('message').notEmpty().trim().escape(),
    ],
    async (req, res) => {
        console.log("req.body", req.body)
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        console.log("hi")


        try {
        const { name, email, message } = req.body;

        const [result] = await db.query(
            'INSERT INTO messages (name, email, message, created_at) VALUES (?, ?, ?, NOW())',
            [name, email, message]
        );

        res.status(201).json({
            message: 'Message sent successfully',
        });
        } catch (error) {
            res.status(500).json({ message: 'Error sending message', error: error.message });
        }
    }
);

router.delete('/:id', auth, async (req, res) => {
    const messageId = req.params.id;

    console.log(req.params.id)

    try {
        const [result] = await db.query('DELETE FROM messages WHERE id = ?', [messageId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Message not found' });
        }

        res.status(200).json({ message: 'Message deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting message', error: error.message });
    }
});

router.get('/', auth, async (req, res) => {
    try {
        const limit = 10
        const offset = parseInt(req.query.offset) || 0;

        const [messages] = await db.query(`
            SELECT * FROM messages 
            ORDER BY created_at DESC
            LIMIT ? offset ?
        `, [limit, offset]);

        res.json(messages);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching messages', error: error.message });
    }
});

module.exports = router;
