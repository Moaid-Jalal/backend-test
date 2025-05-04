const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { auth, checkIfAdmin } = require('../middleware/auth');
const cookieParser = require('cookie-parser');
const { body, param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { v4: uuid4 } = require('uuid');

router.use(cookieParser());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later'
});

// Helper: get all language codes
async function getLanguages() {
  return [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'French' },
    { code: 'tr', name: 'Turkish' }
  ];
}

// Helper: generate slug from English name
function generateSlug(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[\s\_]+/g, '-') // spaces and underscores to dash
    .replace(/[^a-z0-9-]/g, '') // remove non-alphanumeric except dash
    .replace(/-+/g, '-') // collapse multiple dashes
    .replace(/^-+|-+$/g, ''); // trim dashes
}

// Validation for category creation/update
const validateCategoryData = [
  body('icon_svg_url').isString().trim().notEmpty().withMessage('Icon SVG URL is required'),
  body('slug').isString().trim().notEmpty().withMessage('Slug is required')
    .matches(/^[a-z0-9-]+$/).withMessage('Slug can only contain lowercase letters, numbers and hyphens'),
  body('translations').isObject().withMessage('Translations must be an object'),
  body('translations.*.name').isString().trim().notEmpty().withMessage('Name is required for all languages'),
  body('translations.*.slug').isString().trim().notEmpty().withMessage('Slug is required for all languages')
    .matches(/^[a-z0-9-]+$/).withMessage('Slug can only contain lowercase letters, numbers and hyphens'),
  body('translations.*.description').optional().isString().trim()
];

// Create category
router.post(
  '/',
  apiLimiter,
  auth,
  validateCategoryData,
  async (req, res) => {
    let { icon_svg_url, translations } = req.body;
    let slug = ''

    try {
      const languageCodes = await getLanguages();

      // Check for missing translations
      const missingLanguages = languageCodes.filter(code => !translations[code]);
      if (missingLanguages.length > 0) {
        return res.status(400).json({
          message: 'Missing translations for some languages',
          missingLanguages
        });
      }

      // Always generate main slug from English name
      if (translations['en'] && translations['en'].name) {
        slug = generateSlug(translations['en'].name);
      } else {
        return res.status(400).json({ message: 'English translation with name is required to generate slug.' });
      }

      // Check for duplicate slugs (main slug and translation slugs)
      const allSlugs = [slug, ...Object.values(translations).map(t => t.slug)];
      const [existingSlugs] = await db.query(
        `SELECT slug FROM categories WHERE slug IN (?)`,
        [allSlugs]
      );
      if (existingSlugs.length > 0) {
        return res.status(400).json({
          message: 'Some slugs already exist in categories',
          existingSlugs: existingSlugs.map(s => s.slug)
        });
      }

      // Transaction for atomicity
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const categoryId = uuid4();

        // Insert category
        await connection.query(
          'INSERT INTO categories (id, slug, icon_svg_url) VALUES (?, ?, ?)',
          [categoryId, slug, icon_svg_url]
        );

        // Prepare translations bulk insert
        const translationRows = [];
        for (const code of languageCodes) {
          const { name, description } = translations[code];
          translationRows.push([
            uuid4(), 'categories', categoryId, code, 'name', name
          ]);
          // لا تضف slug إلى جدول translations
          if (description) {
            translationRows.push([
              uuid4(), 'categories', categoryId, code, 'description', description
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

        await connection.commit();
        connection.release();
        res.status(201).json({
          success: true,
          message: 'Category created successfully',
          data: { id: categoryId, slug }
        });
      } catch (err) {
        await connection.rollback();
        connection.release();
        throw err;
      }
    } catch (err) {
      res.status(500).json({
        success: false,
        message: 'Failed to create category',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

// Get all categories
router.get(
  '/',
  apiLimiter,
  [
    query('language_code').optional().isString().trim().isLength({ min: 2, max: 5 }),
  ],
  async (req, res) => {
    try {
      const language_code = req.query.language_code || 'en';

      const [categories] = await db.query(`
        SELECT 
          c.id, 
          c.slug AS slug, -- استخدم slug من جدول الفئات فقط
          c.project_count,
          c.icon_svg_url, 
          c.created_at, 
          t_name.translated_text AS name,
          t_desc.translated_text AS description
        FROM categories c
        LEFT JOIN translations t_name ON 
          t_name.table_name = 'categories' AND 
          t_name.row_id = c.id AND 
          t_name.field_name = 'name' AND 
          t_name.language_code = ?
        LEFT JOIN translations t_desc ON 
          t_desc.table_name = 'categories' AND 
          t_desc.row_id = c.id AND 
          t_desc.field_name = 'description' AND 
          t_desc.language_code = ?
        ORDER BY c.created_at DESC
      `, [language_code, language_code]);

      console.log(categories)

      res.status(200).json(categories);
    } catch (err) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch categories',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

// Get category by id
router.get(
  '/:slug',
  apiLimiter,
  [
    param('slug').isString().trim().notEmpty(),
    query('language_code').optional().isString().trim().isLength({ min: 2, max: 5 }),
  ],
  async (req, res) => {
    try {
      const isAdmin = checkIfAdmin(req);
      const categorySlug = req.params.slug;
      const language_code = req.query.language_code || 'en';

      const [catRows] = await db.query(
        `SELECT id, slug, icon_svg_url, created_at FROM categories WHERE slug = ? LIMIT 1`,
        [categorySlug]
      );

      if (catRows.length === 0) {
        return res.status(404).json({ message: 'Category not found' });
      }

      const categoryId = catRows[0].id;

      if (isAdmin) {
        const [translations] = await db.query(
          `SELECT language_code, field_name, translated_text
           FROM translations
           WHERE table_name = 'categories' AND row_id = ?`,
          [categoryId]
        );

        const translationsObj = {};
        translations.forEach(tr => {
          if (!translationsObj[tr.language_code]) translationsObj[tr.language_code] = {};
          translationsObj[tr.language_code][tr.field_name] = tr.translated_text;
        });
        res.json({
          category: {
            ...catRows[0],
            translations: translationsObj
          }
        });

      } else {
        const [trs] = await db.query(
          `SELECT field_name, translated_text
           FROM translations
           WHERE table_name = 'categories' AND row_id = ? AND language_code = ?`,
          [categoryId, language_code]
        );
        const translation = {};
        trs.forEach(tr => {
          translation[tr.field_name] = tr.translated_text;
        });
        res.json({
          category: {
            ...catRows[0],
            translations: {
              [language_code]: translation
            }
          }
        });
      }

    } catch (err) {
      res.status(500).json({
        message: 'Failed to fetch category',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

// Get category by main slug (from categories table)
router.get(
  '/:slug/projects',
  apiLimiter,
  [
    param('slug').isString().trim().notEmpty(),
    query('language_code').optional().isString().trim().isLength({ min: 2, max: 5 }),
    query('offset').optional().isInt({ min: 0 }).toInt(),
  ],
  async (req, res) => {
    try {
      const isAdmin = checkIfAdmin(req);
      const { slug } = req.params;
      const language_code = req.query.language_code || 'en';
      const offset = req.query.offset || 0;
      const limit = 10;

      // Query projects, translations, and main images in one query (using LEFT JOINs)
      const [rows] = await db.query(`
        SELECT 
          p.id,
          p.category_id,
          p.created_at,
          p.creation_date,
          p.country,
          t.field_name AS translation_field,
          t.translated_text AS translation_text,
          pi.id AS image_id,
          pi.image_url,
          pi.is_main
        FROM categories c
        JOIN projects p ON p.category_id = c.id
        LEFT JOIN translations t ON t.table_name = 'projects' AND t.row_id = p.id AND t.language_code = ?
        LEFT JOIN project_images pi ON pi.project_id = p.id AND pi.is_main = TRUE
        WHERE c.slug = ?
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `, [language_code, slug, limit, offset]);

      if (rows.length === 0) {
        return res.status(200).json([]);
      }

      // Build projects with translations and images
      const projectsMap = {};
      for (const row of rows) {
        if (!projectsMap[row.id]) {
          projectsMap[row.id] = {
            id: row.id,
            category_id: row.category_id,
            created_at: row.created_at,
            creation_date: row.creation_date,
            country: row.country,
            images: [],
            // translations will be filled below
          };
        }
        // Add translation fields
        if (row.translation_field && row.translation_text) {
          projectsMap[row.id][row.translation_field] = row.translation_text;
        }
        // Add main image if exists and not already added
        if (row.image_id && !projectsMap[row.id].images.some(img => img.id === row.image_id)) {
          projectsMap[row.id].images.push({
            id: row.image_id,
            url: row.image_url,
            is_main: !!row.is_main
          });
        }
      }

      // Convert map to array
      const projectsArr = Object.values(projectsMap);

      res.status(200).json(projectsArr);
    } catch (err) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch projects for category',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

// Update category and translations
router.put(
  '/:id',
  apiLimiter,
  auth,
  [
    param('id').isString().trim().notEmpty(),
    body('icon_svg_url').optional().isString().trim(),
  ],
  async (req, res) => {
    try {
      const categoryId = req.params.id;
      let { icon_svg_url, translations } = req.body;

      const [[categoryResult]] = await db.query('SELECT id FROM categories WHERE id = ?', [categoryId]);
      if (!categoryResult) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      let slug;
      if (translations && translations['en'] && translations['en'].name) {
        slug = generateSlug(translations['en'].name);

        const [existingSlugs] = await db.query(
          `SELECT slug FROM categories WHERE slug = ? AND id != ?`,
          [slug, categoryId]
        );
        if (existingSlugs.length > 0) {
          return res.status(400).json({
            message: 'Slug already exists in categories',
            existingSlugs: existingSlugs.map(s => s.slug)
          });
        }
      }

      const connection = await db.getConnection();
      await connection.beginTransaction();

      try {
        if (icon_svg_url !== undefined || slug !== undefined) {
          await connection.query(
            'UPDATE categories SET icon_svg_url = COALESCE(?, icon_svg_url), slug = COALESCE(?, slug) WHERE id = ?',
            [icon_svg_url, slug, categoryId]
          );
        }

        if (translations) {
          for (const code of Object.keys(translations)) {
            const t = translations[code];
            for (const field of Object.keys(t)) {
              const [result] = await connection.query(
                `UPDATE translations
                 SET translated_text = ?
                 WHERE table_name = 'categories' AND row_id = ? AND language_code = ? AND field_name = ?`,
                [t[field], categoryId, code, field]
              );
        
              // If no rows were updated, insert a new one
              if (result.affectedRows === 0) {
                await connection.query(
                  `INSERT INTO translations (id, table_name, row_id, language_code, field_name, translated_text)
                   VALUES (?, 'categories', ?, ?, ?, ?)`,
                  [uuid4(), categoryId, code, field, t[field]]
                );
              }
            }
          }
        }

        await connection.commit();
        connection.release();
        res.json({
          message: 'Category updated successfully',
          slug
        });
      } catch (err) {
        await connection.rollback();
        connection.release();
        throw err;
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: 'Failed to update category',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

// Delete category
router.delete(
  '/:id',
  apiLimiter,
  auth,
  [
    param('id').isString().trim().notEmpty(),
  ],
  async (req, res) => {
    console.log(req.params)
    try {
      const categoryId = req.params.id;
      const [[category]] = await db.query('SELECT id FROM categories WHERE id = ?', [categoryId]);
      if (!category) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      const connection = await db.getConnection();
      await connection.beginTransaction();

      try {
        await connection.query(
          `DELETE FROM translations WHERE table_name = 'categories' AND row_id = ?`,
          [categoryId]
        );
        await connection.query('DELETE FROM categories WHERE id = ?', [categoryId]);
        await connection.commit();
        res.json({
          success: true,
          message: 'Category deleted successfully'
        });
      } catch (err) {
        await connection.rollback();
        throw err;
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: 'Failed to delete category',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

module.exports = router;