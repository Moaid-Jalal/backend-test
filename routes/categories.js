const express = require('express');
const router = express.Router();
const db = require('../config/database');
const auth = require('../middleware/auth');
const { v4: uuid4 } = require('uuid');

const cookieParser = require('cookie-parser');

router.use(cookieParser());

router.post('/new', auth, async (req, res) => {
    const { name, description, icon_svg_url } = req.body;

    if (!name || !icon_svg_url) {
        return res.status(400).json({ message: 'Name and icon_svg_url is required.' });
    }

    const categoryId = uuid4();

    try {
        await db.query(
            'INSERT INTO categories (id, name, description, icon_svg_url) VALUES (?, ?, ?, ?)',
            [categoryId, name, description, icon_svg_url]
        );
        res.status(201).json({ message: 'Category created.', id: categoryId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Category already exists.' });
        }
        res.status(500).json({ message: "Error creating Category" });
    }
});


router.get('/', async (req, res) => {
    try {
        const [categories] = await db.query('SELECT * FROM categories');
        console.log("hi")
        res.json(categories);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching categories', error: err.message });
    }
});

router.get('/:categoryName/projects', async (req, res) => {
    try {
        console.log("hi")
      const limit = 10;
      const offset = parseInt(req.query.offset) || 0;
      const categoryName = req.params.categoryName;
  
      const [categoryId] = await db.query('SELECT id FROM categories WHERE name = ?', [categoryName]);

      if (categoryId.length === 0) {
        return res.status(404).json({ message: 'Category not found' });
      }
  
      const [rows] = await db.query(`
        SELECT 
          projects.*,
          pi.id as image_id,
          pi.image_url,
          pi.is_main
        FROM projects
        LEFT JOIN project_images pi ON projects.id = pi.project_id AND pi.is_main = TRUE
        WHERE projects.category_id = ?
        ORDER BY projects.created_at DESC
        LIMIT ? OFFSET ?
      `, [categoryId[0].id, limit, offset]);
  
      const projectMap = new Map();
  
      rows.forEach(row => {
        if (!projectMap.has(row.id)) {
          // Create new project entry without image properties
          const project = { ...row };
          delete project.image_id;
          delete project.image_url;
          delete project.is_main;
          project.images = [];
          
          if (row.image_url) {
            project.images.push({
              id: row.image_id,
              url: row.image_url,
              is_main: row.is_main
            });
          }
          
          projectMap.set(row.id, project);
        } else {
          // Add image to existing project
          if (row.image_url) {
            projectMap.get(row.id).images.push({
              id: row.image_id,
              url: row.image_url,
              is_main: row.is_main
            });
          }
        }
      });
  
      // Convert Map to array of projects
      const projects = Array.from(projectMap.values());
      console.log(projects)

        res.json(projects);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error fetching projects', error: error.message });
    }
});

router.get('/:categoryName', async (req, res) => {
    const { categoryName } = req.params;

    try {
        const [category] = await db.query('SELECT * FROM categories WHERE name = ?', [categoryName]);
        console.log(category)

        if (category.length === 0) {
            return res.status(404).json({ message: 'Category not found.' });
        }

        res.json(category[0]);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching category', error: err.message });
    }
})

router.put('/:categoryName', auth, async (req, res) => {
    const { categoryName } = req.params;
    const { name, description, icon_svg_url } = req.body;

    if (!name || !icon_svg_url) {
        return res.status(400).json({ message: 'Name and icon_svg_url is required.' });
    }

    try {
        await db.query(
            'UPDATE categories SET name = ?, description = ?, icon_svg_url = ? WHERE name = ?',
            [name, description, icon_svg_url, categoryName]
        );
        res.json({ message: 'Category updated.' });
    } catch (err) {
        res.status(500).json({ message: 'Error updating category', error: err.message });
    }
});

router.delete('/:id', auth, async (req, res) => {
    const { id } = req.params;

    try {
        await db.query('DELETE FROM categories WHERE id = ?', [id]);
        res.json({ message: 'Category deleted.' });
    } catch (err) {
        res.status(500).json({ message: 'Error deleting category', error: err.message });
    }
});


module.exports = router;
