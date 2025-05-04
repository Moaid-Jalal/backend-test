const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const token = req.cookies.token;

  try {
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (decoded.exp * 1000 < Date.now()) {
        return res.status(401).json({ message: 'Token expired' });
      }

      req.user = decoded;
      next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token', error: error.message });
  }
};

const checkIfAdmin = (req) => {
  try {
    const token = req.cookies.token;
    if (!token) return false;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || decoded.exp < Date.now() / 1000) return false;

    return true
  } catch (err) {
    return false;
  }
};


module.exports = { auth, checkIfAdmin };