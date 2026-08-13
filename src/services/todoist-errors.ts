export class TodoistAuthorizationError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = "TodoistAuthorizationError";
    this.status = status;
  }
}

export class TodoistRateLimitError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = "TodoistRateLimitError";
    this.status = status;
  }
}

export const isTodoistAuthorizationStatus = (status: number): boolean =>
  status === 401 || status === 403;

export const isTodoistRateLimitStatus = (status: number): boolean => status === 429;
