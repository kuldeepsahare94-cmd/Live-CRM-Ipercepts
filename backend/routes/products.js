const express = require('express');
const router = express.Router();
const db = require('../db');
const { requirePermission } = require('../middleware/auth');
const { fireWorkflows } = require('../services/workflowAutomation');
const images = require('../services/productImages');

// Product photos: their table is made on start-up, so a server that has
// never had photos gets it on deploy. The products table is not changed.
images.ensureSchema();

// Fields that belong to the photo, never to the product row itself.
const PHOTO_FIELDS = ['image', 'thumb', 'image_key', 'photo_key', 'image_url', 'thumb_url', 'has_image'];
function withoutPhotoFields(body) {
  const b = { ...(body || {}) };
  PHOTO_FIELDS.forEach((k) => { delete b[k]; });
  return b;
}

// A product with its photo links (never the photo itself).
const withPhoto = (id) => images.decorate(db.prepare(`SELECT ${images.COLUMNS} FROM ${images.FROM} WHERE p.id=?`).get(id));

router.get('/', requirePermission('products', 'view'), (req, res) => {
  const { active, category, q } = req.query;
  let sql = `SELECT ${images.COLUMNS} FROM ${images.FROM} WHERE 1=1`;
  const params = [];
  if (active !== undefined) { sql += ' AND p.active = ?'; params.push(active === '1' || active === 'true' ? 1 : 0); }
  if (category) { sql += ' AND p.category = ?'; params.push(category); }
  if (q) { sql += ' AND (p.product_name LIKE ? OR p.sku LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY p.product_name';
  res.json(images.decorate(db.prepare(sql).all(...params)));
});

// The sizes the CRM turns every product photo into (for the web and the app).
router.get('/image-rules', requirePermission('products', 'view'), (req, res) => {
  res.json(images.RULES);
});

router.get('/:id', requirePermission('products', 'view'), (req, res) => {
  const product = withPhoto(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  res.json(product);
});

// ----- Product photo -----
// Body: { image: 600x600 JPEG (data URL or base64), thumb: 200x200 JPEG,
//         fit?: 'fit'|'fill', original_name?, original_bytes? }
router.get('/:id/image', requirePermission('products', 'view'), (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id=?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  res.json(images.info(product.id));
});

router.put('/:id/image', requirePermission('products', 'edit'), (req, res) => {
  try {
    const before = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    const result = images.save(req.params.id, req.body, req.user.id);
    const after = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    fireWorkflows('products', 'record_updated', after, before, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not save the photo.' });
  }
});

router.delete('/:id/image', requirePermission('products', 'edit'), (req, res) => {
  try {
    res.json(images.remove(req.params.id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not remove the photo.' });
  }
});

router.post('/', requirePermission('products', 'create'), (req, res) => {
  const b = withoutPhotoFields(req.body);
  if (!b.product_name) return res.status(400).json({ error: 'product_name is required' });
  const info = db.prepare(`
    INSERT INTO products (
      product_name, sku, product_type, category, description, unit, selling_price, cost_price, tax_percent,
      currency, recurring, billing_frequency, active, owner_id
    ) VALUES (@product_name, @sku, @product_type, @category, @description, @unit, @selling_price, @cost_price, @tax_percent,
      @currency, @recurring, @billing_frequency, @active, @owner_id)
  `).run({
    sku: null, product_type: 'Product', category: null, description: null, unit: null, selling_price: 0, cost_price: 0,
    tax_percent: 0, currency: 'INR', recurring: 0, billing_frequency: null, active: 1, owner_id: null,
    ...b,
  });
  const created = db.prepare('SELECT * FROM products WHERE id=?').get(info.lastInsertRowid);
  fireWorkflows('products', 'record_created', created, null, req.user.id);
  res.status(201).json(withPhoto(created.id));
});

router.put('/:id', requirePermission('products', 'edit'), (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const m = { ...existing, ...withoutPhotoFields(req.body) };
  db.prepare(`
    UPDATE products SET product_name=?, sku=?, product_type=?, category=?, description=?, unit=?, selling_price=?,
      cost_price=?, tax_percent=?, currency=?, recurring=?, billing_frequency=?, active=?, owner_id=?, updated_at=datetime('now')
    WHERE id=?
  `).run(m.product_name, m.sku, m.product_type, m.category, m.description, m.unit, m.selling_price, m.cost_price,
    m.tax_percent, m.currency, m.recurring ? 1 : 0, m.billing_frequency, m.active ? 1 : 0, m.owner_id, req.params.id);
  const updated = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  fireWorkflows('products', 'record_updated', updated, existing, req.user.id);
  fireWorkflows('products', 'field_changed', updated, existing, req.user.id);
  res.json(withPhoto(req.params.id));
});

router.delete('/:id', requirePermission('products', 'delete'), (req, res) => {
  db.prepare('DELETE FROM product_images WHERE product_id=?').run(req.params.id);
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
