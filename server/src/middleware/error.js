import { ApiError } from '../utils/ApiError.js';
import { isProd } from '../config/env.js';

export const notFound = (_req, _res, next) => next(ApiError.notFound('Route not found'));

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err.name === 'CastError') err = ApiError.badRequest('Invalid id');
  if (err.code === 11000) err = ApiError.conflict('That value is already in use');
  if (err.name === 'ValidationError') err = ApiError.badRequest(err.message);

  const status = err instanceof ApiError ? err.status : 500;
  if (status === 500) console.error(err);

  res.status(status).json({
    error: {
      message: status === 500 && isProd ? 'Something went wrong on our side' : err.message,
      details: err.details,
    },
  });
}
