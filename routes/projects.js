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
  console.log("asASS")

  try {
    const limit = 10;

    const [rows] = await db.query(`
      SELECT 
        projects.*,
        pi.id as image_id,
        pi.image_url,
        pi.is_main
      FROM projects 
      LEFT JOIN project_images pi ON projects.id = pi.project_id
      ORDER BY projects.created_at DESC
    `, []);

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
    const projects = Array.from(projectMap.values()).slice(0, limit);


    res.json(projects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching projects', error: error.message });
  }
});

router.get('/search', auth, async (req, res) => {
  const searchQuery = req.query.query;
  console.log("hi")

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
        pi.id as image_id,
        pi.image_url,
        pi.is_main
      FROM projects 
      LEFT JOIN project_images pi ON projects.id = pi.project_id
      WHERE projects.id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Create project object with images array
    const project = { ...rows[0] };
    delete project.image_id;
    delete project.image_url;
    delete project.is_main;
    project.images = [];

    // Add all images to the project
    rows.forEach(row => {
      if (row.image_url) {
        project.images.push({
          id: row.image_id,
          url: row.image_url,
          is_main: row.is_main
        });
      }
    });

    res.status(200).json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching project', error: error.message });
  }
});


// Create project (protected route)
router.post('/create',
  auth,
  upload.array('images', 20),
  [
    body('title').notEmpty().trim().escape(),
    body('description').notEmpty().trim().escape(),

    body('short_description').notEmpty().trim().escape(),
    body('creation_date').notEmpty().trim().escape(),
    body('country').notEmpty().trim().escape(),

    body('category').notEmpty().trim().escape(),
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
      category,
    } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No images uploaded' });
    }


    const mainImageIndex = parseInt(req.body.mainImageIndex) || 0;

    const connection = await db.getConnection(); // أنشئ اتصال يدوي

    console.log(req.body)
    
    await connection.beginTransaction();

    try {

      const projectId = uuid4();

      const [result] = await connection.query(
        `INSERT INTO projects (
          id, title, description, short_description, creation_date, country, category
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,

        [projectId, title, description, short_description, creation_date, country, category]
      );

      console.log(result)

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
      connection.rollback()
      console.log(error.message)
      res.status(500).json({ message: 'Error creating project', error: error.message });
    }
  }
);

const updateProject = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const projectId = req.params.id;
  const {
    title,
    description,
    short_description,
    creation_date,
    country,
    category,
    mainImageId,
    deleteImages,
  } = req.body;

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // First check if project exists
    const [projectResult] = await connection.query(
      'SELECT * FROM projects WHERE id = ?',
      [projectId]
    );

    if (projectResult.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Project not found' });
    }

    // 1. Update project details if provided
    if (title || description || short_description || creation_date || country || category) {
      // Build dynamic query for updating only the provided fields
      const updateFields = [];
      const updateValues = [];

      if (title) {
        updateFields.push('title = ?');
        updateValues.push(title);
      }
      if (description) {
        updateFields.push('description = ?');
        updateValues.push(description);
      }
      if (short_description) {
        updateFields.push('short_description = ?');
        updateValues.push(short_description);
      }
      if (creation_date) {
        updateFields.push('creation_date = ?');
        updateValues.push(creation_date);
      }
      if (country) {
        updateFields.push('country = ?');
        updateValues.push(country);
      }
      if (category) {
        updateFields.push('category = ?');
        updateValues.push(category);
      }

      if (updateFields.length > 0) {
        const updateQuery = `UPDATE projects SET ${updateFields.join(', ')} WHERE id = ?`;
        updateValues.push(projectId);
        
        await connection.query(updateQuery, updateValues);
      }
    }

    // 2. Delete images if specified
    if (deleteImages) {
      const imagesToDelete = Array.isArray(deleteImages) 
        ? deleteImages 
        : deleteImages.split(',').map(id => id.trim());
      
      if (imagesToDelete.length > 0) {
        for (const imageId of imagesToDelete) {
          // Get image URL before deleting
          const [imageResult] = await connection.query(
            'SELECT image_url, is_main FROM project_images WHERE id = ? AND project_id = ?',
            [imageId, projectId]
          );
          
          if (imageResult.length > 0) {
            const imageUrl = imageResult[0].image_url;
            const isMain = imageResult[0].is_main;
            
            // Delete from database first
            await connection.query(
              'DELETE FROM project_images WHERE id = ?',
              [imageId]
            );
            
            // Delete from Cloudinary
            try {
              await deleteImageFromCloudinary(imageUrl);
            } catch (cloudinaryError) {
              console.error('Error deleting from Cloudinary:', cloudinaryError);
              // Continue with the transaction even if Cloudinary delete fails
            }
            
            // If we deleted the main image, we need to set a new main image
            if (isMain && !mainImageId) {
              const [firstImage] = await connection.query(
                'SELECT id FROM project_images WHERE project_id = ? LIMIT 1',
                [projectId]
              );
              
              if (firstImage.length > 0) {
                await connection.query(
                  'UPDATE project_images SET is_main = TRUE WHERE id = ?',
                  [firstImage[0].id]
                );
              }
            }
          }
        }
        
        // Reorder remaining images
        await updateImageDisplayOrder(connection, projectId);
      }
    }

    // 3. Change main image if specified
    if (mainImageId) {
      // First, set all images to not main
      await connection.query(
        'UPDATE project_images SET is_main = FALSE WHERE project_id = ?',
        [projectId]
      );
      
      // Then set the specified image as main
      await connection.query(
        'UPDATE project_images SET is_main = TRUE WHERE id = ? AND project_id = ?',
        [mainImageId, projectId]
      );
    }

    // 4. Add new images if provided
    if (req.files && req.files.length > 0) {
      // Get the current highest display_order
      const [orderResult] = await connection.query(
        'SELECT MAX(display_order) as max_order FROM project_images WHERE project_id = ?',
        [projectId]
      );
      
      let startOrder = orderResult[0].max_order !== null ? orderResult[0].max_order + 1 : 0;
      
      const uploadPromises = req.files.map((file, index) => {
        return new Promise((resolve, reject) => {
          const uploadStream = uploadImageToCloudinary(
            file,
            async (error, result) => {
              if (error) reject(error);
              else {
                try {
                  // Get count of existing images to determine if this should be main
                  const [countResult] = await connection.query(
                    'SELECT COUNT(*) as count FROM project_images WHERE project_id = ?',
                    [projectId]
                  );
                  
                  const isMain = countResult[0].count === 0; // Main if it's the first image
                  
                  await connection.query(
                    `INSERT INTO project_images (
                      project_id, image_url, is_main, display_order, created_at
                    ) VALUES (?, ?, ?, ?, NOW())`,
                    [projectId, result.secure_url, isMain, startOrder + index]
                  );
                  resolve();
                } catch (err) {
                  reject(err);
                }
              }
            }
          );
        });
      });
      
      await Promise.all(uploadPromises);
    }

    await connection.commit();
    connection.release();

    res.status(200).json({
      message: 'Project updated successfully',
      projectId: projectId
    });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('Error updating project:', error);
    res.status(500).json({ 
      message: 'Error updating project', 
      error: error.message 
    });
  }
};

// Update project (protected route)
router.put(
  '/update/:id',
  auth,
  upload.array('images', 20),
  [
    body('title').optional().trim().escape(),
    body('description').optional().trim().escape(),
    body('short_description').optional().trim().escape(),
    body('creation_date').optional().trim().escape(),
    body('country').optional().trim().escape(),
    body('category').optional().trim().escape(),
    // For image operations
    body('mainImageId').optional(),
    body('deleteImages').optional(),
  ],
  updateProject
);


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