export const FRONTEND_ORIGINS_DEFAULT = "https://localhost:5173";
export const FRONTEND_BASE_URL_DEFAULT = "https://localhost:5173";
export const RESEND_EMAIL_FROM = "ChalkTalk <noreply@joinchalktalk.com>";

export const RATE_LIMITS = Object.freeze({
  verificationPerEmail: 5,
  verificationPerIp: 100,
  loginPerEmail: 10,
  loginPerIp: 100,
  resetPerEmail: 5,
  resetPerIp: 100,
  signupPerIp: 100,
  collaborationCreatePerUser: 30,
  collaborationTicketPerUser: 300,
});

/** Resource text extraction uses the Tesseract language installed in the worker image. */
export const RESOURCE_TEXT_OCR_CONFIG = Object.freeze({
  maxOcrPages: 200,
  ocrLanguages: "eng",
});
