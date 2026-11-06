const { fail } = require('../utils/response');

function validate(schema, source = 'body') {
  return (req, res, next) => {
    // Express leaves req.body undefined when Content-Type/body is missing —
    // treat that as {} so Joi returns 422 instead of crashing the handler.
    const input = req[source] == null ? {} : req[source];
    const { error, value } = schema.validate(input, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return fail(
        res,
        'Validation failed',
        422,
        error.details.map((d) => ({ field: d.path.join('.'), message: d.message }))
      );
    }
    req[source] = value;
    return next();
  };
}

module.exports = validate;
