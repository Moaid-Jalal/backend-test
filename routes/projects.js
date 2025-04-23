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

router.get('/', async (req, res) => {
  try {
    const limit = 10;
    const offset = parseInt(req.query.offset) || 0;

    const [rows] = await db.query(`
      SELECT 
        projects.*,
        pi.id as image_id,
        pi.image_url,
        pi.is_main
      FROM projects
      LEFT JOIN project_images pi ON projects.id = pi.project_id AND pi.is_main = TRUE
      ORDER BY projects.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Group projects and their images
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


    res.json(projects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching projects', error: error.message });
  }
});

router.get('/search', auth, async (req, res) => {
  const searchQuery = req.query.query;
  console.log("hi")

  console.log(req.cookies.token)

  if (!searchQuery) {
    return res.status(400).json({ message: 'Please provide a search query.' });
  }

  const sqlQuery = `
    SELECT * FROM projects
    WHERE MATCH(title) AGAINST (? IN NATURAL LANGUAGE MODE)
  `;
  const [projects] = await db.query(sqlQuery, [searchQuery]);

  res.status(200).json(projects);
});

// Get single project
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        projects.*,
        categories.name AS category_name,
        categories.id AS category_id,
        pi.id,
        pi.image_url,
        pi.is_main
      FROM projects 
      LEFT JOIN categories ON projects.category_id = categories.id
      LEFT JOIN project_images pi ON projects.id = pi.project_id
      WHERE projects.id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Create project object with images array
    const project = { ...rows[0] };
    project.category = {
      id: rows[0].category_id,
      name: rows[0].category_name
    };
    delete project.category_id;
    delete project.category_name;
    delete project.id;
    delete project.image_url;
    delete project.is_main;
    project.images = [];

    // Add all images to the project
    rows.forEach(row => {
      if (row.image_url) {
        project.images.push({
          id: row.id,
          url: row.image_url,
          is_main: row.is_main
        });
      }
    });

    console.log(project)
    res.status(200).json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching project', error: error.message });
  }
});


router.post('/create',
  auth,
  upload.array('images', 20),
  [
    body('title').notEmpty().trim().escape(),
    body('description').trim().escape(),
    body('short_description').trim().escape(),
    body('creation_date').notEmpty().trim().escape(),
    body('country').notEmpty().trim().escape(),
    body('category_id').notEmpty().trim().escape(), // هذا هو category_id
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title,
      description,
      short_description,
      creation_date,
      country,
      category_id, // هذا هو category_id
    } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No images uploaded' });
    }

    const mainImageIndex = parseInt(req.body.mainImageIndex) || 0;

    const connection = await db.getConnection();

    console.log(req.body);

    await connection.beginTransaction();

    try {
      const projectId = uuid4();

      // استخدم category كـ category_id
      await connection.query(
        `INSERT INTO projects (
          id, title, description, short_description, creation_date, country, category_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [projectId, title, description, short_description, creation_date, country, category_id]
      );

      const uploadPromises = req.files.map((file, index) => {
        return new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'construction-projects',
              resource_type: 'auto'
            },
            async (error, result) => {
              if (error) reject(error);
              else {
                try {
                  await connection.query(
                    `INSERT INTO project_images (
                      project_id, image_url, is_main, display_order, created_at
                    ) VALUES (?, ?, ?, ?, NOW())`,
                    [projectId, result.secure_url, index === mainImageIndex, index]
                  );
                  resolve();
                } catch (err) {
                  reject(err);
                }
              }
            }
          );
          uploadStream.end(file.buffer);
        });
      });

      await Promise.all(uploadPromises);

      await connection.commit();
      connection.release();

      res.status(201).json({
        message: 'Project created successfully',
        projectId: projectId
      });

    } catch (error) {
      connection.rollback();
      console.log(error.message);
      res.status(500).json({ message: 'Error creating project', error: error.message });
    }
  }
);

// Update project
router.put('/update/:id',
  auth, 
  upload.array('images', 20), 
  async (req, res) => {

  const projectId = req.params.id;
  const updates = req.body;

  try {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    console.log(projectId)
    console.log(req.body)

    try {
      // Update project details if any fields changed
      // استخدم category_id بدلاً من category
      const projectFields = ['title', 'description', 'short_description', 'creation_date', 'country', 'category_id'];
      const changedFields = Object.keys(updates).filter(key => projectFields.includes(key));

      if (changedFields.length > 0) {
        const updateQuery = `
          UPDATE projects 
          SET ${changedFields.map(field => `${field} = ?`).join(', ')}
          WHERE id = ?
        `;
        const values = [...changedFields.map(field => updates[field]), projectId];
        await connection.execute(updateQuery, values);
      }

      // Handle image deletions
      if (updates.imagesToDelete && updates.imagesToDelete.length > 0) {
        const deleteQuery = 'DELETE FROM project_images WHERE id IN (?)';
        await connection.query(deleteQuery, [updates.imagesToDelete]);
      }

      // Handle main image update
      if (updates.mainImageId) {
        // First, reset all images to non-main
        await connection.execute(
          'UPDATE project_images SET is_main = FALSE WHERE project_id = ?',
          [projectId]
        );

        // Then set the new main image
        if (updates.mainImageId !== '') {
          await connection.execute(
            'UPDATE project_images SET is_main = TRUE WHERE id = ? AND project_id = ?',
            [updates.mainImageId, projectId]
          );
        }
      }

      const uploadPromises = req.files.map((file, index) => {
        return new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'construction-projects',
              resource_type: 'auto'
            },
            async (error, result) => {
              if (error) reject(error);
              else {
                try {
                  // Create image record
                  await connection.query(
                    `INSERT INTO project_images (
                      project_id, image_url, is_main, display_order, created_at
                    ) VALUES (?, ?, ?, ?, NOW())`,
                    [projectId, result.secure_url, false, index]
                  );
                  resolve();
                } catch (err) {
                  reject(err);
                }
              }
            }
          );

          uploadStream.end(file.buffer);
        });
      });

      await Promise.all(uploadPromises);

      await connection.commit();
      connection.release();

      res.status(200).json({
        message: 'Project updated successfully',
        projectId
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({
      message: 'Failed to update project',
      error: error.message
    });
  }
});

// Delete project (protected route)
router.delete('/delete/:id', auth, async (req, res) => {
  const projectId = req.params.id;

  try {
    const [project] = await db.query('SELECT title FROM projects WHERE id = ?', [projectId]);
    if (project.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Delete images from Cloudinary
    // const images = JSON.parse(project[0].images || '[]');
    // for (const imageUrl of images) {
    //   const publicId = imageUrl.split('/').pop().split('.')[0];
    //   await cloudinary.uploader.destroy(`construction-projects/${publicId}`);
    // }

    await db.query('DELETE FROM projects WHERE id = ?', [projectId]);
    res.status(200).json({ message: 'Project deleted successfully' });

  } catch (error) {
    console.log(error.message)
    res.status(500).json({ message: 'Error deleting project', error: error.message });
  }
});

module.exports = router;