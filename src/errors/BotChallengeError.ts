export class BotChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BotChallengeError';
  }
}
