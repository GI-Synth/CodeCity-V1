import { Router } from 'express';
import { getProviderStatus } from '../lib/providers/router';

const router = Router();

/** GET /api/providers/status — provider health dashboard */
router.get('/status', (_req, res) => {
  res.json(getProviderStatus());
});

export default router;
