const { fail } = require('../utils/response');

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
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
