const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { auth } = require('../middleware/auth');
const { v4: uuid4 } = require('uuid');

const cookieParser = require('cookie-parser');

router.use(cookieParser());

// router.post('/', auth, async (req, res) => {
//     const { code, name } = req.body;
//     console.log("req.body", req.body)

//     if (!code || !name) {
//         return res.status(400).json({ message: 'Code and name are required.' });
//     }

//     try {
//         const id = uuid4();

//         await db.query(
//             'INSERT INTO languages (id, code, name) VALUES (?, ?, ?)',
//             [id, code, name]
//         );

//         res.status(201).json({ message: 'Language created.', id });
//     } catch (err) {
//         if (err.code === 'ER_DUP_ENTRY') {
//             return res.status(400).json({ message: 'Language code already exists.' });
//         }

//         res.status(500).json({ message: 'Error creating language', error: err.message });
//     }
// });

// router.get('/', async (req, res) => {
//     try {
//         const [languages] = await db.query('SELECT * FROM languages ORDER BY created_at DESC');
//         res.json(languages);
//     } catch (err) {
//         res.status(500).json({ message: 'Error fetching languages', error: err.message });
//     }
// });

// router.put('/:code', auth, async (req, res) => {
//     const { name } = req.body;
//     if (!name) {
//         return res.status(400).json({ message: 'Name is required.' });
//     }
//     try {
//         const [result] = await db.query(
//             'UPDATE languages SET name = ? WHERE code = ?',
//             [name, req.params.code]
//         );
//         if (result.affectedRows === 0) {
//             return res.status(404).json({ message: 'Language not found.' });
//         }
//         res.json({ message: 'Language updated.' });
//     } catch (err) {
//         res.status(500).json({ message: 'Error updating language', error: err.message });
//     }
// });

// router.delete('/:code', auth, async (req, res) => {
//     try {
//         const [result] = await db.query('DELETE FROM languages WHERE code = ?', [req.params.code]);
//         if (result.affectedRows === 0) {
//             return res.status(404).json({ message: 'Language not found.' });
//         }
//         res.json({ message: 'Language deleted.' });
//     } catch (err) {
//         res.status(500).json({ message: 'Error deleting language', error: err.message });
//     }
// });

module.exports = router;