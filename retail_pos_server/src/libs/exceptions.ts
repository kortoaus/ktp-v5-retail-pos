export class HttpException extends Error {
  // result — 선택적 구조화 상세 (예: crm 402 PAYMENT_CAPTURE_FAILED 의 { reason }).
  // 있을 때만 에러 envelope 에 실린다 (없으면 기존 { ok, msg } 그대로).
  constructor(
    public statusCode: number,
    message: string,
    public result: unknown = null,
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
