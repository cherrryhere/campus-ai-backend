import db from "../db.js";

const PROFANITY = [
  "fuck","fucking","shit","asshole","bitch","bastard","cunt","dick","pussy",
  "slut","whore","faggot","nigger","retard","cock","jerk","douche",
  "motherfucker","mf","wtf","fck","bullshit","bs","damn","crap",
];

export function containsProfanity(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return PROFANITY.some((w) => new RegExp(`\\b${w}\\b`, "i").test(lower));
}

/**
 * Apply moderation to a user-generated piece of content.
 * Returns { ok: true } if clean, or { blocked: true, status, body } if not.
 * Updates user.warnings / is_suspended accordingly.
 */
export async function applyModeration(userId, text) {
  if (!containsProfanity(text)) return { ok: true };

  const user = await db.prepare("SELECT warnings, is_suspended FROM users WHERE id = ?").get(userId);
  if (user?.is_suspended) {
    return {
      blocked: true,
      status: 403,
      body: { error: "Your account is suspended.", suspended: true },
    };
  }

  const newCount = (user?.warnings || 0) + 1;
  if (newCount >= 2) {
    await db.prepare("UPDATE users SET warnings = ?, is_suspended = 1 WHERE id = ?").run(newCount, userId);
    await db
      .prepare("INSERT INTO notifications (user_id, type, title) VALUES (?, 'system', ?)")
      .run(userId, "Your account has been suspended due to repeated policy violations.");
    return {
      blocked: true,
      status: 403,
      body: { error: "Account suspended due to repeated policy violations.", suspended: true },
    };
  }

  await db.prepare("UPDATE users SET warnings = ? WHERE id = ?").run(newCount, userId);
  await db
    .prepare("INSERT INTO notifications (user_id, type, title) VALUES (?, 'system', ?)")
    .run(userId, "Warning: your post contains language that violates community guidelines. A second offense will suspend your account.");
  return {
    blocked: true,
    status: 400,
    body: {
      error: "Your post contains language that violates community guidelines. This is a warning — a second offense will suspend your account.",
      warning: true,
      warnings: newCount,
    },
  };
}
