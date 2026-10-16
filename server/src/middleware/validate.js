import { ApiError } from '../utils/ApiError.js';

// validate({ body, query, params }) - parsed values land on req.valid
export const validate = (schemas) => (req, _res, next) => {
  req.valid = req.valid || {};
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      return next(ApiError.badRequest('Please check the highlighted fields', details));
    }
    req.valid[key] = result.data;
  }
  next();
};
