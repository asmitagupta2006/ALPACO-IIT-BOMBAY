import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ApiErrorResponse } from '../../src/contracts/delta.ts';
import type { ExplainApiResponse } from '../../src/contracts/explain.ts';
import {
  ExplanationServiceError,
  generateStructuredExplanation,
  getExplanationConfigStatus,
} from '../explain/geminiService.ts';
import {
  ExplanationRequestError,
  validateExplainRequest,
} from '../explain/promptAndValidation.ts';

function sendExplainError(
  res: Response,
  status: number,
  code: string,
  error: string,
): void {
  const body: ApiErrorResponse = {
    error,
    code,
    status,
    source: 'Gemini Explanation Service',
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

export function createExplainRouter(): Router {
  const router = Router();

  router.get('/explain/status', (_req: Request, res: Response) => {
    res.json(getExplanationConfigStatus());
  });

  router.post('/explain', async (req: Request, res: Response) => {
    let validated;
    try {
      validated = validateExplainRequest(req.body);
    } catch (err) {
      if (err instanceof ExplanationRequestError) {
        sendExplainError(res, err.status, err.code, err.message);
        return;
      }
      sendExplainError(res, 400, 'INVALID_EXPLAIN_REQUEST', 'Invalid explanation payload');
      return;
    }

    try {
      const { record, cached } = await generateStructuredExplanation(validated);
      const body: ExplainApiResponse = {
        data: record,
        source: `Source: Gemini (${record.modelName}), generated ${record.generatedAt}`,
        cached,
      };
      res.json(body);
    } catch (err) {
      if (err instanceof ExplanationServiceError) {
        sendExplainError(res, err.status, err.code, err.message);
        return;
      }
      sendExplainError(
        res,
        502,
        'EXPLAIN_FAILED',
        err instanceof Error ? err.message : 'Failed to generate explanation',
      );
    }
  });

  return router;
}
