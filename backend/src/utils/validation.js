export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const error = new Error('Request validation failed.');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    error.details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'), message: issue.message
    }));
    throw error;
  }
  return result.data;
}
