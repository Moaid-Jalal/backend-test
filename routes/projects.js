const express = require('express');
const router = express.Router();
const { v4: uuid4 } = require('uuid');
const cloudinary = require('../config/cloudinary');
const cookieParser = require('cookie-parser');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { auth, checkIfAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Get all projects
router.use(cookieParser());

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

router.put('/update/:id',
  auth,
  upload.array('images', 20),
  async (req, res) => {
    const projectId = req.params.id;
    const updates = req.body;

    try {
      const connection = await db.getConnection();
      await connection.beginTransaction();

      try {
        const projectFields = ['creation_date', 'country', 'category_id'];
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

        if (updates.translations) {
          let translations = updates.translations;
          if (typeof translations === 'string') {
            try {
              translations = JSON.parse(translations);
            } catch {
              return res.status(400).json({ message: 'Invalid translations JSON' });
            }
          }
          for (const lang of Object.keys(translations)) {
            const t = translations[lang];
            for (const field of Object.keys(t)) {
              await connection.query(
                `INSERT INTO translations (id, table_name, row_id, language_code, field_name, translated_text)
                 VALUES (?, 'projects', ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE translated_text = VALUES(translated_text)`,
                [uuid4(), projectId, lang, field, t[field]]
              );
            }
          }
        }

        if (updates.mainImageId) {
          await connection.execute(
            'UPDATE project_images SET is_main = FALSE WHERE project_id = ?',
            [projectId]
          );
          if (updates.mainImageId !== '') {
            await connection.execute(
              'UPDATE project_images SET is_main = TRUE WHERE id = ? AND project_id = ?',
              [updates.mainImageId, projectId]
            );
          }
        }

        // إضافة صور جديدة
        if (req.files && req.files.length > 0) {
          const uploadPromises = req.files.map((file, index) => {
            return new Promise((resolve, reject) => {
              const uploadStream = cloudinary.uploader.upload_stream(
                {
                  folder: 'construction-projects',
                  resource_type: 'auto',
                  transformation: [
                    { quality: "auto", fetch_format: "auto" }
                  ]
                },
                async (error, result) => {
                  if (error) reject(error);
                  else {
                    try {
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
        }

        // حذف الصور
        if (updates.imagesToDelete) {
          let imagesToDelete = updates.imagesToDelete;
          if (typeof imagesToDelete === 'string') {
            try {
              imagesToDelete = JSON.parse(imagesToDelete);
            } catch {
              imagesToDelete = [];
            }
          }
          if (Array.isArray(imagesToDelete) && imagesToDelete.length > 0) {
            try {
              await Promise.all(imagesToDelete.map(async (imageId) => {
                await cloudinary.uploader.destroy(imageId);
              }));
              const deleteQuery = 'DELETE FROM project_images WHERE id IN (?)';
              await connection.query(deleteQuery, [imagesToDelete]);
            } catch (error) {
              // ignore cloudinary errors
            }
          }
        }

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
  }
);

router.get('/:id', async (req, res) => {
  try {
    const language_code = req.query.language_code || 'en';
    const projectId = req.params.id;

    const [rows] = await db.query(`
      SELECT 
        p.id AS project_id,
        p.creation_date,
        p.country,
        c.slug AS category_slug,
        t.field_name AS project_field,
        t.translated_text AS project_text,
        pi.id AS image_id,
        pi.image_url,
        pi.is_main
      FROM projects p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN translations t 
        ON t.row_id = p.id 
        AND t.table_name = 'projects'
        AND t.language_code = ?
      LEFT JOIN project_images pi
        ON pi.project_id = p.id
      WHERE p.id = ?
    `, [language_code, projectId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    let project = {
      id: rows[0].project_id,
      creation_date: rows[0].creation_date,
      country: rows[0].country,
      category: {
        slug: rows[0].category_slug
      },
      title: rows[0].title,
      short_description: rows[0].short_description,
      extra_description: rows[0].extra_description,
      images: []
    };

    for (const row of rows) {
      if (row.project_field && row.project_text) {
        project[row.project_field] = row.project_text;
      }
      if (row.image_id) {
        const imageExists = project.images.some(image => image.id === row.image_id || image.image_url === row.image_url);
        if (!imageExists) {
          project.images.push({
            id: row.image_id,
            url: row.image_url,
            is_main: row.is_main
          });
        }
      }
    }

    console.log(project)
    res.status(200).json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching project', error: error.message });
  }
});

router.get('/admin/:id', auth, async (req, res) => {
  try {
    const projectId = req.params.id;

      const [rows] = await db.query(`
        SELECT 
          p.id AS project_id,
          p.creation_date,
          p.country,
          p.category_id,
          pt.language_code AS project_language,
          pt.field_name AS project_field,
          pt.translated_text AS project_text,
          ct.language_code AS category_language,
          ct.field_name AS category_field,
          ct.translated_text AS category_text,
          pi.id AS image_id,
          pi.image_url,
          pi.is_main
        FROM projects p
        LEFT JOIN translations pt 
          ON pt.row_id = p.id 
          AND pt.table_name = 'projects'
        LEFT JOIN categories c 
          ON p.category_id = c.id
        LEFT JOIN translations ct 
          ON ct.row_id = c.id 
          AND ct.table_name = 'categories'
        LEFT JOIN project_images pi
          ON pi.project_id = p.id
        WHERE p.id = ?
      `, [projectId]);
      
      if (rows.length === 0) {
        return res.status(404).json({ message: 'Project not found' });
      }

      let project = {
        id: rows[0].project_id,
        creation_date: rows[0].creation_date,
        country: rows[0].country,
        category_id: rows[0].category_id,
        translations: {},
        category: {
          translations: {}
        },
        images: []
      };

      for (const row of rows) {
        if (row.project_language && row.project_field) {
          if (!project.translations[row.project_language]) {
            project.translations[row.project_language] = {};
          }
          project.translations[row.project_language][row.project_field] = row.project_text;
        }
        if (row.category_language && row.category_field) {
          if (!project.category.translations[row.category_language]) {
            project.category.translations[row.category_language] = {};
          }
          project.category.translations[row.category_language][row.category_field] = row.category_text;
        }
        if (row.image_id) {
          const imageExists = project.images.some(image => image.id === row.image_id || image.image_url === row.image_url);
          if (!imageExists) {
            project.images.push({
              id: row.image_id,
              url: row.image_url,
              is_main: row.is_main
            });
          }
        }
      }


      console.log(project)
      res.status(200).json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching project', error: error.message });
  }
});


// Validation for project creation
const validateProjectData = [
  body('category_id').isString().trim().notEmpty().withMessage('Category ID is required'),
  body('translations').isObject().withMessage('Translations must be an object'),
  body('creation_date').optional().isString().trim(),
  body('country').optional().isString().trim(),
  body('mainImageIndex').optional().isInt({ min: 0 }),
];

const parseTranslations = (req, res, next) => {
  if (typeof req.body.translations === 'string') {
    try {
      req.body.translations = JSON.parse(req.body.translations);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid JSON format in translations' });
    }
  }
  next();
};

router.post('/create',
  auth,
  upload.array('images', 20),
  parseTranslations,
  validateProjectData,
  async (req, res) => {
    console.log(req.body)
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    console.log("jh")

    let translations = req.body.translations;
    if (typeof translations === 'string') {
      try {
        translations = JSON.parse(translations);
      } catch {
        return res.status(400).json({ message: 'Invalid translations JSON' });
      }
    }

    const {
      creation_date,
      country,
      category_id,
    } = req.body;

    console.log("req.body:",req.body)

    const [categoryRows] = await db.query('SELECT id FROM categories WHERE id = ?', [category_id]);
    if (categoryRows.length === 0) {
      return res.status(400).json({ message: 'Invalid category_id' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No images uploaded' });
    }

    const mainImageIndex = parseInt(req.body.mainImageIndex) || 0;

    const connection = await db.getConnection();

    await connection.beginTransaction();

    try {
      const projectId = uuid4();

      await connection.query(
        `INSERT INTO projects (
          id, creation_date, country, category_id
        ) VALUES (?, ?, ?, ?)`,
        [projectId, creation_date, country, category_id]
      );

      // أدخل الترجمات (title, short_description, extra_description) لكل لغة
      const translationRows = [];
      for (const lang of Object.keys(translations)) {
        const t = translations[lang];
        if (t.title) {
          translationRows.push([
            uuid4(), 'projects', projectId, lang, 'title', t.title
          ]);
        }
        if (t.short_description) {
          translationRows.push([
            uuid4(), 'projects', projectId, lang, 'short_description', t.short_description
          ]);
        }
        if (t.extra_description) {
          translationRows.push([
            uuid4(), 'projects', projectId, lang, 'extra_description', t.extra_description
          ]);
        }
      }
      if (translationRows.length > 0) {
        await connection.query(
          `INSERT INTO translations (id, table_name, row_id, language_code, field_name, translated_text)
           VALUES ?`,
          [translationRows]
        );
      }

      // رفع الصور
      const uploadPromises = req.files.map((file, index) => {
        return new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'construction-projects',
              resource_type: 'auto',
              transformation: [
                { quality: "auto", fetch_format: "auto" }
              ]
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
      console.error('Error creating project:', error);
      connection.rollback();
      res.status(500).json({ message: 'Error creating project', error: error.message });
    }
  }
);


// Delete project (protected route)
router.delete('/delete/:id', auth, async (req, res) => {
  const projectId = req.params.id;

  try {
    // جلب جميع الصور الخاصة بالمشروع
    const [images] = await db.query(
      'SELECT id, image_url FROM project_images WHERE project_id = ?',
      [projectId]
    );

    // حذف الصور من Cloudinary
    await Promise.all(images.map(async (img) => {
      // استخراج public_id من رابط الصورة (إذا كان من Cloudinary)
      try {
        const urlParts = img.image_url.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const publicId = fileName.split('.')[0];
        await cloudinary.uploader.destroy(`construction-projects/${publicId}`);
      } catch (e) {
        // تجاهل أي خطأ في الحذف من الكلاود
      }
    }));

    // حذف الترجمات والصور من قاعدة البيانات
    await db.query('DELETE FROM translations WHERE table_name = "projects" AND row_id = ?', [projectId]);
    await db.query('DELETE FROM project_images WHERE project_id = ?', [projectId]);
    const [result] = await db.query('DELETE FROM projects WHERE id = ?', [projectId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    res.status(200).json({ message: 'Project deleted successfully' });

  } catch (error) {
    console.log(error.message)
    res.status(500).json({ message: 'Error deleting project', error: error.message });
  }
});

module.exports = router;