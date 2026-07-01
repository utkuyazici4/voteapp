// Image uploads. Validates mime + size, writes with a random filename, and
// returns a public URL. In production, swap the disk store for S3/R2 signed
// uploads (see README). Files are never executed and never take user names.
import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();
fs.mkdirSync(config.uploads.dir, { recursive: true });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploads.dir),
  filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + (EXT[file.mimetype] || '')),
});
const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, config.uploads.allowedMime.includes(file.mimetype)),
});

const uploadLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

router.post('/', requireAuth, uploadLimiter, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image too large' : 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'Only JPEG, PNG or WebP images are allowed' });
    const url = `${req.protocol}://${req.get('host')}/uploads/files/${path.basename(req.file.filename)}`;
    res.status(201).json({ url });
  });
});

export default router;
