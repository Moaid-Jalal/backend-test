const express = require('express');
const router = express.Router();
const { v4: uuid4 } = require('uuid');
const cloudinary = require('../config/cloudinary');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

// Get all projects
router.use(cookieParser());


router.get('/admin', auth, async (req, res) => {
    try {
        const [results] = await db.query('SELECT * FROM content_sections');

        const organizedData = results.reduce((acc, row) => {
            const { id, section_key, section_title, content } = row;
            if (!acc[section_key]) {
                acc[section_key] = [];
            }
            acc[section_key].push({ id, section_title, content });
            return acc;
        }, {});

        console.log(organizedData);

        res.status(200).json(organizedData);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching projects', error: error.message });
    }
});

router.get('/', async (req, res) => {
    try {
        const [results] = await db.query('SELECT * FROM content_sections');

        const organizedData = results.reduce((acc, row) => {
            const { id, section_key, section_title, content } = row;
            if (!acc[section_key]) {
                acc[section_key] = [];
            }
            acc[section_key].push({ id, section_title, content });
            return acc;
        }, {});

        if (organizedData.contact_info) {
            const contactObj = {};
            organizedData.contact_info.forEach(item => {
                let parsedContent = item.content;
                try {
                    parsedContent = JSON.parse(item.content);
                } catch (e) {
                }
                const key = item.section_title.toLowerCase().replace(/\s+/g, '');
                contactObj[key] = parsedContent;
            });
            organizedData.contact_info = contactObj;
        }

        // console.log(organizedData);

        console.log("hi")

        res.status(200).json(organizedData);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching projects', error: error.message });
    }
})

router.put('/content-sections', async (req, res) => {
    const payload = req.body;

    console.log(payload)

    try {
        for (const item of payload) {
            if (item.action === 'delete' && Array.isArray(item.ids)) {
            await db.query(
                'DELETE FROM content_sections WHERE id IN (?)',
                [item.ids]
            );
            continue;
            }

            if (item.id) {
            await db.query(
                'UPDATE content_sections SET section_title = ?, content = ?, section_key = ? WHERE id = ?',
                [item.section_title, item.content, item.type, item.id]
            );
            continue;
            }

            await db.query(
            'INSERT INTO content_sections (section_key, section_title, content) VALUES (?, ?, ?)',
            [item.type, item.section_title, item.content]
            );
        }

        res.status(200).json({ message: 'Operation completed successfully.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', error });
    }
});

module.exports = router;