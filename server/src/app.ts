import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { authenticate } from './middleware/auth';
import { errorHandler, notFound } from './middleware/error';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import academicRoutes from './routes/academics';
import peopleRoutes from './routes/people';
import recordRoutes from './routes/records';
import feeRoutes from './routes/fees';
import termRoutes from './routes/terms';
import timetableRoutes from './routes/timetable';
import announcementRoutes from './routes/announcements';
import reportRoutes from './routes/reports';
import admissionsRoutes, { publicAdmissionsRouter } from './routes/admissions';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
  // Document uploads are JSON for now. The admissions handler enforces a smaller cap.
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/admissions/public', publicAdmissionsRouter);

  // Everything below requires a signed-in user.
  app.use('/api', authenticate);
  app.use('/api/admissions', admissionsRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api', academicRoutes);
  app.use('/api', peopleRoutes);
  app.use('/api', recordRoutes);
  app.use('/api', feeRoutes);
  app.use('/api', termRoutes);
  app.use('/api', timetableRoutes);
  app.use('/api', announcementRoutes);
  app.use('/api', reportRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
