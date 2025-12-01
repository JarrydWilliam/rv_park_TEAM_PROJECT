// server/middleware/auth.js
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    if (req.session.user.role !== role) {
      
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
