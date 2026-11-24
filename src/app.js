const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Exercise uploads live under storage/exercises (or EXERCISE_MEDIA_ROOT) so they
// survive outside public/. Keep the same public URL shape the app already uses.
app.get('/media/exercises/uploads/:exerciseId/:filename', (req, res, next) => {
  try {
    const catalogue = require('./services/exerciseCatalogue');
    const { sendMediaContent } = require('./services/mediaStorage');
    const filePath = catalogue.resolveUploadFile(req.params.exerciseId, req.params.filename);
    if (!filePath) {
      return res.status(404).json({ success: false, message: 'Media file not found', errors: null });
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === '.mp4' || ext === '.m4v' || ext === '.mov'
        ? 'video/mp4'
        : ext === '.mp3' || ext === '.m4a'
          ? 'audio/mpeg'
          : ext === '.wav'
            ? 'audio/wav'
            : ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.png'
                ? 'image/png'
                : ext === '.webp'
                  ? 'image/webp'
                  : 'application/octet-stream';
    return sendMediaContent(req, res, { mime, filePath });
  } catch (err) {
    return next(err);
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
app.get('/api/openapi.json', (_req, res) => res.json(swaggerSpec));
app.use('/api/v1', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
