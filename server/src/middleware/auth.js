// server/src/middleware/auth.js

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    // Preserve where they were trying to go so we can send them back after login
    const nextUrl = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/login?next=${nextUrl}`);
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      const nextUrl = encodeURIComponent(req.originalUrl || '/');
      return res.redirect(`/login?next=${nextUrl}`);
    }
    if (req.session.user.role !== role) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
