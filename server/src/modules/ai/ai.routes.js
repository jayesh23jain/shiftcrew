import { Router } from 'express';
import { llmService } from '../../services/llm/index.js';

const router = Router();

// GET /api/ai/status (also /ai/status)
// Returns { enabled, provider, canUseUserData } for the UI (no keys, no secrets).
router.get('/status', (_req, res) => {
  res.json(llmService.getAiStatus());
});

export default router;
