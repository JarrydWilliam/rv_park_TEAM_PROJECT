// server/src/middleware/auth.js

function requireAuth(req, res, next) {
  // Debug log session and user
  console.log('requireAuth:', {
    sessionExists: !!req.session,
    user: req.session ? req.session.user : undefined,
    url: req.originalUrl
  });
  if (!req.session || !req.session.user) {
    // Prevent recursive /login?next=... by sanitizing nextUrl
    let nextUrl = req.originalUrl || '/';
    if (nextUrl.startsWith('/login')) {
      nextUrl = '/';
    }
    return res.redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      let nextUrl = req.originalUrl || '/';
      if (nextUrl.startsWith('/login')) {
        nextUrl = '/';
      }
      return res.redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
    }
    if (req.session.user.role !== role) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
