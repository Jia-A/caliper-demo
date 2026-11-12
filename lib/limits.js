// Everything that keeps the public demo cheap and safe, in one place.
export const LIMITS = {
  perIpPer10Min: 5, // chat requests from one IP in a 10-minute window
  perIpPerDay: 20, // from one IP in a UTC day
  allPerDay: 300, // for the whole demo in a UTC day: keeps it inside the model's free tier
  maxMessages: 6, // the conversation sent each time (3 questions and their answers)
  maxMessageChars: 500, // per message
  maxBodyBytes: 16_000, // the whole request body
  maxOutputTokens: 300, // the model's reply
};
