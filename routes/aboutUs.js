const express = require('express');
const router = express.Router();
const { v4: uuid4 } = require('uuid');
const cloudinary = require('../config/cloudinary');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { auth, checkIfAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Get all projects
router.use(cookieParser());

async function getLanguages() {
    return [
      { code: 'en', name: 'English' },
      { code: 'fr', name: 'French' },
      { code: 'tr', name: 'Turkish' }
    ];
  }



  router.get('/', async (req, res) => {
    try {
      console.log('Fetching content sections...');
      const isAdmin = checkIfAdmin(req);
      const userLanguage = req.query.language_code || 'en'; // اللغة المطلوبة من URL أو الإنجليزية افتراضيًا

      // 1. جلب جميع الأقسام
      const [results] = await db.query(`SELECT * FROM content_sections`);
  
      // 2. جلب الترجمات (لجميع اللغات إذا كان أدمن، أو للغة المطلوبة فقط إذا كان مستخدم عادي)
      let translationsQuery = `
        SELECT row_id, language_code, field_name, translated_text
        FROM translations
        WHERE table_name = 'content_sections'
      `;
      
      const queryParams = [];
      if (!isAdmin) {
        translationsQuery += ' AND language_code = ?';
        queryParams.push(userLanguage);
      }
      
      const [translations] = await db.query(translationsQuery, queryParams);
  
      // 3. تنظيم الترجمات في شكل: translationsMap[row_id][language_code][field_name]
      const translationsMap = {};
      translations.forEach(({ row_id, language_code, field_name, translated_text }) => {
        if (!translationsMap[row_id]) translationsMap[row_id] = {};
        if (!translationsMap[row_id][language_code]) translationsMap[row_id][language_code] = {};
        translationsMap[row_id][language_code][field_name] = translated_text;
      });

      const responseData = {
        statistics: [],
        contact_info: {},
        our_story: {},
        services: [],
      };
  
      for (const row of results) {
        const { id, section_key, section_title, content, extra_info } = row;

        if (section_key === 'statistics') {
          // الإحصائيات لا تحتاج لترجمة (أرقام فقط)
          responseData.statistics.push({
            label: section_title,
            value: Number(content)
          });
        }

        else if (section_key === 'contact_info') {
            if (!responseData.contact_info) {
              responseData.contact_info = {};
            }
          
            switch (section_title) {
              case 'Address':
                responseData.contact_info.Address = content;
                break;
              case 'Phone':
                responseData.contact_info.Phone = content;
                break;
              case 'Email':
                responseData.contact_info.Email = content;
                break;
              case 'Social Links':
                try {
                    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
                    responseData.contact_info.Social_Links = {
                      ...parsed, // يحتفظ بجميع الحقول الأصلية
                    };
                  } catch (err) {
                    console.error('Error parsing social links:', err);
                    responseData.contact_info.Social_Links = {};
                  }
                break;
            }
          }

        else if (section_key === 'our_story') {
          if (isAdmin) {
            // وضع الإدارة - إرجاع جميع الترجمات
            const entry = {
              id,
              translations: {}
            };

            const languages = await getLanguages();
            languages.forEach(lang => {
              entry.translations[lang.code] = {
                section_title: '',
                content: ''
              };
            });

            entry.translations.en = {
              section_title: section_title,
              content: content
            };
    
            if (translationsMap[id]) {
              for (const [lang, fields] of Object.entries(translationsMap[id])) {
                if (entry.translations[lang]) {
                  entry.translations[lang] = {
                    section_title: fields.section_title || entry.translations[lang].section_title,
                    content: fields.content || entry.translations[lang].content
                  };
                }
              }
            }
    
            responseData.our_story = entry;
          } else {
            // وضع المستخدم العادي - إرجاع لغة واحدة فقط
            const translatedTitle = translationsMap[id]?.[userLanguage]?.section_title || section_title;
            const translatedContent = translationsMap[id]?.[userLanguage]?.content || content;
            
            responseData.our_story = {
              id,
              section_title: translatedTitle,
              content: translatedContent
            };
          }
        }
  
        else if (section_key === 'services') {
          if (isAdmin) {
            // وضع الإدارة - إرجاع جميع الترجمات
            const entry = {
              id,
              translations: {}
            };

            const languages = await getLanguages();
            languages.forEach(lang => {
              entry.translations[lang.code] = {
                section_title: '',
                content: ''
              };
            });

            entry.translations.en = {
              section_title: section_title,
              content: content
            };
    
            if (translationsMap[id]) {
              for (const [lang, fields] of Object.entries(translationsMap[id])) {
                if (entry.translations[lang]) {
                  entry.translations[lang] = {
                    section_title: fields.section_title || entry.translations[lang].section_title,
                    content: fields.content || entry.translations[lang].content
                  };
                }
              }
            }
    
            responseData.services.push(entry);
          } else {
            // وضع المستخدم العادي - إرجاع لغة واحدة فقط
            const translatedTitle = translationsMap[id]?.[userLanguage]?.section_title || section_title;
            const translatedContent = translationsMap[id]?.[userLanguage]?.content || content;
            
            responseData.services.push({
              id,
              section_title: translatedTitle,
              content: translatedContent
            });
          }
        }
      }
  
      res.status(200).json(responseData);
    } catch (error) {
      console.error('Error fetching content sections:', error.message);
      res.status(500).json({ message: 'Error fetching content sections', error: error.message });
    }
});

router.put('/content-sections', async (req, res) => {
  const changes = req.body;

  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    // --- Contact Info ---
    if (Array.isArray(changes.contact_info)) {
      for (const item of changes.contact_info) {
        const { field, value } = item;
        if (['Address', 'Phone', 'Email'].includes(field)) {
          // تحقق إذا كان السطر موجود
          const [rows] = await connection.query(
            'SELECT id FROM content_sections WHERE section_key = ? AND section_title = ? LIMIT 1',
            ['contact_info', field]
          );
          if (rows.length > 0) {
            await connection.query(
              'UPDATE content_sections SET content = ? WHERE id = ?',
              [value, rows[0].id]
            );
          } else {
            await connection.query(
              'INSERT INTO content_sections (id, section_key, section_title, content) VALUES (?, ?, ?, ?)',
              [uuid4(), 'contact_info', field, value]
            );
          }
        } else if (field === 'Social_Links') {
          // Social_Links as JSON
          const [rows] = await connection.query(
            'SELECT id FROM content_sections WHERE section_key = ? AND section_title = ? LIMIT 1',
            ['contact_info', 'Social Links']
          );
          const jsonValue = typeof value === 'string' ? value : JSON.stringify(value);
          if (rows.length > 0) {
            await connection.query(
              'UPDATE content_sections SET content = ? WHERE id = ?',
              [jsonValue, rows[0].id]
            );
          } else {
            await connection.query(
              'INSERT INTO content_sections (id, section_key, section_title, content) VALUES (?, ?, ?, ?)',
              [uuid4(), 'contact_info', 'Social Links', jsonValue]
            );
          }
        }
      }
    }

    // --- Statistics ---
    if (Array.isArray(changes.statistics)) {
      for (const stat of changes.statistics) {
        const { label, value } = stat;
        const [rows] = await connection.query(
          'SELECT id FROM content_sections WHERE section_key = ? AND section_title = ? LIMIT 1',
          ['statistics', label]
        );
        if (rows.length > 0) {
          await connection.query(
            'UPDATE content_sections SET content = ? WHERE id = ?',
            [value, rows[0].id]
          );
        } else {
          await connection.query(
            'INSERT INTO content_sections (id, section_key, section_title, content) VALUES (?, ?, ?, ?)',
            [uuid4(), 'statistics', label, value]
          );
        }
      }
    }

    // --- Our Story ---
    if (Array.isArray(changes.our_story)) {
      for (const item of changes.our_story) {
        const { id, language, section_title, content } = item;
        if (language === 'en') {
          // تحديث أو إنشاء السطر الأساسي
          if (id) {
            await connection.query(
              'UPDATE content_sections SET section_title = ?, content = ? WHERE id = ? AND section_key = ?',
              [section_title, content, id, 'our_story']
            );
          } else {
            await connection.query(
              'INSERT INTO content_sections (id, section_key, section_title, content) VALUES (?, ?, ?, ?)',
              [uuid4(), 'our_story', section_title, content]
            );
          }
        } else {
          // تحديث أو إنشاء الترجمة
          if (!id) continue; // يجب أن يكون هناك id للسطر الأساسي
          for (const field of ['section_title', 'content']) {
            const [result] = await connection.query(
              `UPDATE translations SET translated_text = ? 
               WHERE table_name = 'content_sections' AND row_id = ? AND language_code = ? AND field_name = ?`,
              [item[field], id, language, field]
            );
            if (result.affectedRows === 0) {
              await connection.query(
                `INSERT INTO translations (id, table_name, row_id, language_code, field_name, translated_text)
                 VALUES (?, 'content_sections', ?, ?, ?, ?)`,
                [uuid4(), id, language, field, item[field]]
              );
            }
          }
        }
      }
    }

    // --- Services ---
    // Creates
    if (changes.services && Array.isArray(changes.services.creates)) {
      for (const create of changes.services.creates) {
        const { translations } = create;
        // يجب أن تحتوي الترجمات على en
        if (!translations || !translations.en) continue;
        const { section_title, content } = translations.en;
        const newId = uuid4();
        // أدخل السطر الأساسي (الإنجليزي)
        await connection.query(
          'INSERT INTO content_sections (id, section_key, section_title, content) VALUES (?, ?, ?, ?)',
          [newId, 'services', section_title, content]
        );
        // أدخل الترجمات الأخرى (غير en)
        for (const lang of Object.keys(translations)) {
          if (lang === 'en') continue;
          const t = translations[lang];
          for (const field of ['section_title', 'content']) {
            await connection.query(
              `INSERT INTO translations (id, table_name, row_id, language_code, field_name, translated_text)
               VALUES (?, 'content_sections', ?, ?, ?, ?)`,
              [uuid4(), newId, lang, field, t[field]]
            );
          }
        }
      }
    }

    // Updates
    if (changes.services && Array.isArray(changes.services.updates)) {
      for (const update of changes.services.updates) {
        const { id, language, section_title, content } = update;
        if (language === 'en') {
          await connection.query(
            'UPDATE content_sections SET section_title = ?, content = ? WHERE id = ? AND section_key = ?',
            [section_title, content, id, 'services']
          );
        } else {
          for (const field of ['section_title', 'content']) {
            const [result] = await connection.query(
              `UPDATE translations SET translated_text = ? 
               WHERE table_name = 'content_sections' AND row_id = ? AND language_code = ? AND field_name = ?`,
              [update[field], id, language, field]
            );
            if (result.affectedRows === 0) {
              await connection.query(
                `INSERT INTO translations (id, table_name, row_id, language_code, field_name, translated_text)
                 VALUES (?, 'content_sections', ?, ?, ?, ?)`,
                [uuid4(), id, language, field, update[field]]
              );
            }
          }
        }
      }
    }
    // Deletes
    if (changes.services && Array.isArray(changes.services.deletes)) {
      for (const id of changes.services.deletes) {
        await connection.query(
          'DELETE FROM translations WHERE table_name = "content_sections" AND row_id = ?',
          [id]
        );
        await connection.query(
          'DELETE FROM content_sections WHERE id = ? AND section_key = ?',
          [id, 'services']
        );
      }
    }

    await connection.commit();
    connection.release();
    res.status(200).json({ message: 'About Us information updated successfully.' });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error(error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

module.exports = router;