// errors.js — typed application errors mapped to HTTP statuses.
//
// The pattern: throw a typed error from the service layer. The Express
// error handler in index.js inspects `err.statusCode` and `err.code` and
// returns a structured `{ error, code, details? }` JSON body. Service code
// never needs to know about HTTP.

class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL', details } = {}) {
    super(message)
    this.name = this.constructor.name
    this.statusCode = statusCode
    this.code = code
    if (details !== undefined) this.details = details
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { statusCode: 400, code: 'VALIDATION', details })
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, { statusCode: 404, code: 'NOT_FOUND' })
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, { statusCode: 409, code: 'CONFLICT' })
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED' })
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, { statusCode: 403, code: 'FORBIDDEN' })
  }
}

class InsufficientBalanceError extends ConflictError {
  constructor(message = 'Insufficient balance') {
    super(message)
    this.code = 'INSUFFICIENT_BALANCE'
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  InsufficientBalanceError,
}
