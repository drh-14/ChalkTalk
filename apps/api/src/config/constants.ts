export const FRONTEND_ORIGINS_DEFAULT = "https://localhost:5173";
export const FRONTEND_BASE_URL_DEFAULT = "https://localhost:5173";

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
