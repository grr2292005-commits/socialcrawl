export class AuthWallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthWallError';
  }
}
