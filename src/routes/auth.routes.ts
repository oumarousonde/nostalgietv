import { Router } from "express";
import { signup, verifyEmail, login, changePassword, AuthError } from "../services/auth";
import { loginRateLimit, signupRateLimit } from "../middleware/rateLimit";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

authRouter.post("/auth/signup", signupRateLimit, async (req, res) => {
  const { phone, email, password } = req.body;

  try {
    const result = await signup({ phone, email, password, locale: req.locale });
    // En prod : ne pas renvoyer emailVerificationToken dans la réponse HTTP,
    // il doit partir uniquement par email. Laissé ici visible pour faciliter les tests.
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AuthError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

authRouter.post("/auth/verify-email", async (req, res) => {
  try {
    await verifyEmail(req.body.token, req.locale);
    res.json({ verified: true });
  } catch (err) {
    if (err instanceof AuthError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

authRouter.post("/auth/login", loginRateLimit, async (req, res) => {
  try {
    // identifier = numéro ou email ; "phone" et "email" restent acceptés pour compatibilité.
    const identifier = req.body.identifier ?? req.body.phone ?? req.body.email;
    const result = await login(identifier, req.body.password, req.locale);
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) return res.status(401).json({ error: err.message });
    throw err;
  }
});

authRouter.post("/auth/change-password", requireAuth, async (req, res) => {
  try {
    await changePassword(
      req.auth!.userId,
      req.body.currentPassword,
      req.body.newPassword,
      req.locale
    );
    res.json({ changed: true });
  } catch (err) {
    if (err instanceof AuthError) return res.status(400).json({ error: err.message });
    throw err;
  }
});
