export class HttpException extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class BadRequestException extends HttpException {
  constructor(message = "Bad Request") {
    super(400, message);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = "Unauthorized") {
    super(401, message);
  }
}

export class NotFoundException extends HttpException {
  constructor(message = "Not Found") {
    super(404, message);
  }
}

export class InternalServerException extends HttpException {
  constructor(message = "Internal Server Error") {
    super(500, message);
  }
}
