import { Router } from "express";
import { signup, verifyEmail, login, AuthError } from "../services/auth";
import { loginRateLimit, signupRateLimit } from "../middleware/rateLimit";

export const authRouter = Router();

authRouter.post("/auth/signup", signupRateLimit, async (req, res) => {
  const { email, password, referralCode } = req.body;

  try {
    const result = await signup({
      email,
      password,
      referralCodeUsed: referralCode || undefined,
      signupIp: req.ip,
      deviceFingerprint: req.body.deviceFingerprint,
      locale: req.locale,
    });
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
    const result = await login(req.body.email, req.body.password, req.locale);
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) return res.status(401).json({ error: err.message });
    throw err;
  }
});
