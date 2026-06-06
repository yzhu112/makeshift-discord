import db from '#db'
import crypto from 'crypto'
import CONFIG from '#config'

setInterval(() => {
  db.sweepStaleSessions()
}, 60 * 60 * 1000)

export function sessionMiddleware() {
  return (req, res, next) => {
    const sid = req?.cookies?.sid
    if (!sid) return next()

    const row = db.getSessionBySid(sid)
    if (!row) return next()

    const { user_id, expires_at } = row
    if (expires_at > 0 && expires_at < Date.now())
      return next()

    req.session = {
      sid,
      userId: user_id
    }

    return next()
  }
}

export function createSession(userId, res) {
  const sid = crypto.randomBytes(32).toString('base64url')
  db.createSession(sid, userId)
  res.cookie('sid', sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: CONFIG.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
  })
  return sid
}

export function destroySession(req, res) {
  const sid = req?.session?.sid
  if (!sid) return

  db.destroySession(sid)
  res.clearCookie('sid')
}
